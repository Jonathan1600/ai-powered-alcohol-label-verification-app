// The API client. Owns the base URL and the error taxonomy: a 502 from the
// backend means the extraction provider failed, which per ADR-012 must be
// presented as "try again", never as a verdict about the label.

import type { SeedQueueItem, SeedQueueResponse, VerifyResponse } from './contracts'

// Falls back to the local backend so a fresh checkout runs without a .env;
// deployments set VITE_API_BASE_URL at build time.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// Client-side safety net, comfortably above the server's 30s provider timeout.
const VERIFY_TIMEOUT_MS = 60_000
// The fixture image is a small static file on the same host, so it gets a much
// tighter bound. Without one, a hung download strands the card in "checking"
// with no way out but a reload, which discards the whole session's review work.
const IMAGE_TIMEOUT_MS = 15_000

export interface VerifyFailure {
  // provider: the backend reached out and the extraction service failed (502).
  // rejected: the backend refused the request itself (413/415/422).
  // network: the backend never answered.
  kind: 'provider' | 'rejected' | 'network'
  message: string
}

export class VerifyError extends Error {
  failure: VerifyFailure

  constructor(failure: VerifyFailure) {
    super(failure.message)
    this.name = 'VerifyError'
    this.failure = failure
  }
}

export function toVerifyFailure(error: unknown): VerifyFailure {
  if (error instanceof VerifyError) return error.failure
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'network', message }
}

export async function getSeedQueue(): Promise<SeedQueueResponse> {
  const response = await fetch(`${API_BASE_URL}/api/seed/queue`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<SeedQueueResponse>
}

// FastAPI's detail is a string for our own HTTPExceptions but a list of
// objects for framework validation errors; flatten both to one line.
function detailText(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => (entry && typeof entry === 'object' && 'msg' in entry ? String(entry.msg) : null))
      .filter((msg): msg is string => msg !== null)
    if (messages.length > 0) return messages.join('; ')
  }
  return null
}

async function failureFromResponse(response: Response): Promise<VerifyFailure> {
  let detail: string | null = null
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      detail = detailText((body as { detail: unknown }).detail)
    }
  } catch {
    // Non-JSON error body; fall through to the status line.
  }
  const message = detail ?? `HTTP ${response.status}`
  if (response.status === 502) return { kind: 'provider', message }
  return { kind: 'rejected', message }
}

// Verifies one seeded item. There is no verify-by-id endpoint, so the client
// downloads the fixture image and re-uploads it with the claimed record.
export async function verifyLabel(item: SeedQueueItem): Promise<VerifyResponse> {
  let response: Response
  try {
    const imageResponse = await fetch(API_BASE_URL + item.image_url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    if (!imageResponse.ok) {
      throw new VerifyError({
        kind: 'network',
        message: `Could not download the label image (HTTP ${imageResponse.status}).`,
      })
    }
    const blob = await imageResponse.blob()

    const form = new FormData()
    form.append('image', blob, item.image_url.split('/').at(-1) ?? 'label.png')
    form.append('application', JSON.stringify(item.application))

    // No manual Content-Type: the browser sets the multipart boundary.
    response = await fetch(`${API_BASE_URL}/api/verify`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof VerifyError) throw error
    throw new VerifyError(toVerifyFailure(error))
  }

  if (!response.ok) throw new VerifyError(await failureFromResponse(response))
  return response.json() as Promise<VerifyResponse>
}
