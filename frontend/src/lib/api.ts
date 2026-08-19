// The API client. Owns the base URL and the error taxonomy: a 502 from the
// backend means the extraction provider failed, which per ADR-012 must be
// presented as "try again", never as a verdict about the label.

import type { QueueItem, SeedQueueItem, SeedQueueResponse, VerifyResponse } from './contracts'
import { downscale } from './downscale'

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

/**
 * Lifts a wire item into the shape the queue works in.
 *
 * The server sends root-relative paths; resolving them here means no component
 * ever has to remember to prepend the base URL, and an added item's object URL
 * can sit in the same field without a second code path.
 */
export function seedToQueueItem(item: SeedQueueItem): QueueItem {
  return {
    source: 'seed',
    id: item.id,
    application_reference: item.application_reference,
    brand_name: item.brand_name,
    application: item.application,
    imageUrl: API_BASE_URL + item.image_url,
    thumbnailUrl: API_BASE_URL + item.thumbnail_url,
  }
}

/**
 * Combines the caller's stop control with a deadline of our own.
 *
 * A batch's stop button and a hung connection are two different reasons to give
 * up on the same request, and both have to reach the same `fetch`.
 */
function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
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

/** Fetches a seeded fixture's image so it can be posted back as an upload. */
async function downloadSeedImage(
  item: QueueItem,
  signal: AbortSignal | undefined,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(item.imageUrl, {
    signal: boundedSignal(signal, IMAGE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new VerifyError({
      kind: 'network',
      message: `Could not download the label image (HTTP ${response.status}).`,
    })
  }
  return { blob: await response.blob(), filename: item.imageUrl.split('/').at(-1) ?? 'label.png' }
}

/**
 * Shrinks an added label to the upload size.
 *
 * Done here rather than at ingestion time on purpose: two hundred decoded
 * bitmaps held at once is a lot of memory for images that may never be
 * verified, and `downscale` is fast enough to sit inside the request that needs
 * it. A failure here is a rejected upload, not a network problem, so the agent
 * is told the file could not be prepared rather than to check their connection.
 */
async function prepareAddedImage(file: File): Promise<{ blob: Blob; filename: string }> {
  try {
    const { file: prepared } = await downscale(file)
    return { blob: prepared, filename: prepared.name }
  } catch (error) {
    throw new VerifyError({
      kind: 'rejected',
      message: `This image could not be prepared for upload. ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }
}

/**
 * Verifies one queue item.
 *
 * There is no verify-by-id endpoint and there is deliberately no upload
 * endpoint either (ADR-014), so both kinds of item converge on the same
 * multipart POST: seeded items download their fixture first, added ones bring
 * their own bytes.
 *
 * `signal` is the batch's stop control. It reaches both legs, so stopping a run
 * of two hundred does not leave sixty downloads still coming.
 */
export async function verifyLabel(
  item: QueueItem,
  signal?: AbortSignal,
): Promise<VerifyResponse> {
  let response: Response
  try {
    const { blob, filename } = item.file
      ? await prepareAddedImage(item.file)
      : await downloadSeedImage(item, signal)

    const form = new FormData()
    form.append('image', blob, filename)
    form.append('application', JSON.stringify(item.application))

    // No manual Content-Type: the browser sets the multipart boundary.
    response = await fetch(`${API_BASE_URL}/api/verify`, {
      method: 'POST',
      body: form,
      signal: boundedSignal(signal, VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof VerifyError) throw error
    throw new VerifyError(toVerifyFailure(error))
  }

  if (!response.ok) throw new VerifyError(await failureFromResponse(response))
  return response.json() as Promise<VerifyResponse>
}
