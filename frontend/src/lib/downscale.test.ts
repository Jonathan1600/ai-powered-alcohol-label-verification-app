/**
 * The downscale helper's decision logic.
 *
 * What is covered: whether an image is resized at all, the dimensions chosen,
 * the aspect ratio, EXIF orientation being requested, the re-encoded filename,
 * and that the decoded bitmap is released.
 *
 * What is not: pixel output. jsdom ships no image codec, so `createImageBitmap`
 * and `canvas.toBlob` are stubbed here. That boundary is worth stating plainly
 * rather than leaving a reader to assume this proves the image comes out
 * legible. Whether 1200px is enough for the model to read small print is an
 * accuracy question, and the fixture corpus answers it, not this file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downscale, JPEG_QUALITY, MAX_EDGE } from './downscale'

interface StubOptions {
  width: number
  height: number
}

const closed = vi.fn()
let lastBitmapOptions: ImageBitmapOptions | undefined

function stubImagePipeline({ width, height }: StubOptions) {
  lastBitmapOptions = undefined

  vi.stubGlobal('createImageBitmap', (_source: unknown, options?: ImageBitmapOptions) => {
    lastBitmapOptions = options
    return Promise.resolve({ width, height, close: closed })
  })

  const drawImage = vi.fn()
  const toBlob = vi.fn(
    (callback: (blob: Blob) => void, type: string, quality: number) => {
      encodedAs = { type, quality }
      callback(new Blob(['downscaled'], { type }))
    },
  )

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)

  return { drawImage, toBlob }
}

let encodedAs: { type: string; quality: number } | undefined

function labelFile(name = 'label.png', type = 'image/png'): File {
  return new File([new Uint8Array(64)], name, { type })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  closed.mockClear()
  encodedAs = undefined
})

describe('downscale', () => {
  it('shrinks the longest edge to the target', async () => {
    stubImagePipeline({ width: 3024, height: 4032 })
    const result = await downscale(labelFile())

    expect(result.skipped).toBe(false)
    expect(Math.max(result.width, result.height)).toBe(MAX_EDGE)
  })

  it('preserves the aspect ratio', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    const result = await downscale(labelFile())

    expect(result.width).toBe(1200)
    expect(result.height).toBe(900)
  })

  it('handles a portrait photo as readily as a landscape one', async () => {
    stubImagePipeline({ width: 3000, height: 4000 })
    const result = await downscale(labelFile())

    expect(result.width).toBe(900)
    expect(result.height).toBe(1200)
  })

  it('passes through an image that is already small enough', async () => {
    stubImagePipeline({ width: 900, height: 1200 })
    const original = labelFile()
    const result = await downscale(original)

    // Re-encoding a compliant image spends time to make it slightly worse.
    expect(result.skipped).toBe(true)
    expect(result.file).toBe(original)
  })

  it('treats an image exactly at the limit as small enough', async () => {
    stubImagePipeline({ width: MAX_EDGE, height: 400 })
    expect((await downscale(labelFile())).skipped).toBe(true)
  })

  it('applies EXIF orientation', async () => {
    // Without this a portrait phone photo reaches the model on its side.
    stubImagePipeline({ width: 4000, height: 3000 })
    await downscale(labelFile())

    expect(lastBitmapOptions).toEqual({ imageOrientation: 'from-image' })
  })

  it('re-encodes as JPEG at the chosen quality', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    const result = await downscale(labelFile())

    expect(encodedAs).toEqual({ type: 'image/jpeg', quality: JPEG_QUALITY })
    expect(result.file.type).toBe('image/jpeg')
  })

  it('renames the file to match its new encoding', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    const result = await downscale(labelFile('front-label.png'))

    expect(result.file.name).toBe('front-label.jpg')
  })

  it('releases the decoded bitmap', async () => {
    // A queue verifying 200 labels leaks a lot of memory otherwise.
    stubImagePipeline({ width: 4000, height: 3000 })
    await downscale(labelFile())

    expect(closed).toHaveBeenCalledOnce()
  })

  it('releases the bitmap even when encoding fails', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
      return { getContext: () => null } as unknown as HTMLCanvasElement
    }) as typeof document.createElement)

    await expect(downscale(labelFile())).rejects.toThrow(/canvas context/)
    expect(closed).toHaveBeenCalledOnce()
  })

  it('reports the original size so the saving can be shown', async () => {
    stubImagePipeline({ width: 4000, height: 3000 })
    const original = labelFile()
    const result = await downscale(original)

    expect(result.originalBytes).toBe(original.size)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('honours a caller-supplied edge', async () => {
    stubImagePipeline({ width: 4000, height: 2000 })
    const result = await downscale(labelFile(), 800)

    expect(result.width).toBe(800)
    expect(result.height).toBe(400)
  })
})
