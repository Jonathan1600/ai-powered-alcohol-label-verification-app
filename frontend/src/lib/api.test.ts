// The client's boundary with the backend: URL composition, the multipart
// shape of a verify request, and the ADR-012 error taxonomy (a 502 is a
// provider failure, never a verdict).

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  API_BASE_URL,
  getSeedQueue,
  seedToQueueItem,
  toVerifyFailure,
  VerifyError,
  verifyLabel,
} from './api'
import type { QueueItem, SeedQueueItem, VerifyResponse } from './contracts'

const SEED: SeedQueueItem = {
  id: 'case-variance',
  application_reference: 'TTB-2026-0001',
  brand_name: "Stone's Throw",
  status: 'not_yet_checked',
  image_url: '/api/seed/images/case-variance.png',
  thumbnail_url: '/api/seed/thumbnails/case-variance.jpg',
  application: {
    brand_name: "STONE'S THROW",
    class_type: 'Straight Bourbon Whiskey',
    alcohol_content: '45% alc/vol',
    net_contents: '750 mL',
    bottler_info: 'Bottled by Example Co, Portland, OR',
    beverage_class: 'distilled_spirits',
    is_import: false,
  },
}

// The client works in resolved URLs, so every test below goes through the same
// lift the queue screen does rather than hand-building the client shape.
const ITEM: QueueItem = seedToQueueItem(SEED)

const VERIFY_RESPONSE: VerifyResponse = {
  result: { status: 'looks_correct', fields: [], unreadable_reason: null },
  timings: { read_ms: 1, model_ms: 5000, matching_ms: 2, server_total_ms: 5003 },
  model: 'gpt-5.6-luna',
  prompt_version: '2026-08-18.2',
  image_bytes: 95000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(VerifyError)
    return (error as VerifyError).failure
  }
  throw new Error('expected the promise to reject')
}

describe('getSeedQueue', () => {
  it('fetches the queue from the API base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ count: 0, items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const queue = await getSeedQueue()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/seed/queue`)
    expect(queue).toEqual({ count: 0, items: [] })
  })

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    await expect(getSeedQueue()).rejects.toThrow('HTTP 500')
  })
})

describe('verifyLabel', () => {
  it('downloads the fixture image and posts it with the application record', async () => {
    const imageBlob = new Blob(['png-bytes'], { type: 'image/png' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(imageBlob, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(VERIFY_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const response = await verifyLabel(ITEM)

    expect(fetchMock.mock.calls[0][0]).toBe(ITEM.imageUrl)
    // Both legs are bounded: an unbounded image download would strand the card
    // in "checking" with no way out but a reload.
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)

    const [verifyUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(verifyUrl).toBe(`${API_BASE_URL}/api/verify`)
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const form = init.body as FormData
    expect(form.get('image')).toBeInstanceOf(File)
    expect((form.get('image') as File).name).toBe('case-variance.png')
    expect(JSON.parse(form.get('application') as string)).toEqual(SEED.application)

    expect(response).toEqual(VERIFY_RESPONSE)
  })

  it('maps a 502 to a provider failure, distinct from a verdict (ADR-012)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }))
        .mockResolvedValueOnce(jsonResponse({ detail: 'The extraction request timed out.' }, 502)),
    )

    const failure = await failureOf(verifyLabel(ITEM))
    expect(failure.kind).toBe('provider')
    expect(failure.message).toBe('The extraction request timed out.')
  })

  it('maps a 422 with a string detail to rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }))
        .mockResolvedValueOnce(jsonResponse({ detail: 'The uploaded image is empty.' }, 422)),
    )

    const failure = await failureOf(verifyLabel(ITEM))
    expect(failure).toEqual({ kind: 'rejected', message: 'The uploaded image is empty.' })
  })

  it('flattens the list-shaped detail of a framework validation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }))
        .mockResolvedValueOnce(
          jsonResponse({ detail: [{ loc: ['body', 'image'], msg: 'Field required' }] }, 422),
        ),
    )

    const failure = await failureOf(verifyLabel(ITEM))
    expect(failure).toEqual({ kind: 'rejected', message: 'Field required' })
  })

  it('maps a failed image download to a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))

    const failure = await failureOf(verifyLabel(ITEM))
    expect(failure.kind).toBe('network')
    expect(failure.message).toContain('HTTP 404')
  })

  it('maps a fetch rejection to a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const failure = await failureOf(verifyLabel(ITEM))
    expect(failure).toEqual({ kind: 'network', message: 'Failed to fetch' })
  })

  it('carries the caller stop control into both legs, so a batch can be stopped', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(VERIFY_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    await verifyLabel(ITEM, controller.signal)

    const signals = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).signal as AbortSignal,
    )
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(false)

    controller.abort()

    // Composed with our own deadline rather than replaced by it, so the
    // caller's abort reaches the image download and the verify POST both.
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})

describe('verifyLabel, for a label the agent added', () => {
  const added: QueueItem = {
    ...ITEM,
    source: 'added',
    imageUrl: 'blob:http://localhost/added-1',
    file: new File([new Uint8Array(64)], 'bourbon.png', { type: 'image/png' }),
  }

  it('posts its own bytes instead of downloading anything', async () => {
    // Already inside the upload bound, so `downscale` passes the file straight
    // through and no canvas is involved.
    vi.stubGlobal('createImageBitmap', () =>
      Promise.resolve({ width: 900, height: 1200, close: vi.fn() }),
    )
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VERIFY_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const response = await verifyLabel(added)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE_URL}/api/verify`)
    expect((( init.body as FormData).get('image') as File).name).toBe('bourbon.png')
    expect(response).toEqual(VERIFY_RESPONSE)
  })

  it('reports a file it cannot prepare as rejected, not as a network problem', async () => {
    // "Check your connection" would be the wrong instruction for a file that
    // simply will not decode.
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('Unsupported image.')))
    vi.stubGlobal('fetch', vi.fn())

    const failure = await failureOf(verifyLabel(added))
    expect(failure.kind).toBe('rejected')
    expect(failure.message).toContain('Unsupported image.')
  })
})

describe('toVerifyFailure', () => {
  it('passes a VerifyError through and wraps anything else as network', () => {
    const original = new VerifyError({ kind: 'provider', message: 'down' })
    expect(toVerifyFailure(original)).toBe(original.failure)
    expect(toVerifyFailure(new Error('offline'))).toEqual({ kind: 'network', message: 'offline' })
    expect(toVerifyFailure('odd')).toEqual({ kind: 'network', message: 'odd' })
  })
})
