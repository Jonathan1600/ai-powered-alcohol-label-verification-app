/**
 * Shrink a label photograph before uploading it.
 *
 * A phone camera produces a 12 megapixel image. The text on a label is legible
 * at a fraction of that, so the extra pixels buy nothing and cost upload time on
 * whatever connection the reviewer happens to be on.
 *
 * Worth being precise about what this does and does not buy, because phase 4
 * measured it. Downscaling does *not* make the model call faster: cutting the
 * input by more than half moved the extraction time by nothing at all. What it
 * saves is transfer, which is the part of the budget that belongs to the network
 * rather than to the provider. That is a smaller win than approach.md section 6
 * originally assumed, and it is still a real one.
 */

/** Longest edge, in pixels, that a label is downscaled to before upload. */
export const MAX_EDGE = 1200

/** JPEG quality for the re-encode. High enough that small print survives. */
export const JPEG_QUALITY = 0.85

export interface DownscaleResult {
  file: File
  width: number
  height: number
  /** Bytes before downscaling, so the saving can be reported. */
  originalBytes: number
  /** True when the image was already small enough and was passed through. */
  skipped: boolean
  elapsedMs: number
}

/**
 * Reduce `file` so its longest edge is at most `maxEdge`.
 *
 * Returns the original untouched when it is already small enough. Re-encoding a
 * compliant image would spend time to make it slightly worse.
 */
export async function downscale(file: File, maxEdge: number = MAX_EDGE): Promise<DownscaleResult> {
  const started = performance.now()
  const originalBytes = file.size

  // `imageOrientation: 'from-image'` applies the EXIF rotation. Without it a
  // photo taken in portrait arrives at the model on its side, and every field
  // reads as unreadable for a reason no one would guess from the result.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxEdge) {
      return {
        file,
        width: bitmap.width,
        height: bitmap.height,
        originalBytes,
        skipped: true,
        elapsedMs: performance.now() - started,
      }
    }

    const scale = maxEdge / longest
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not get a 2D canvas context to downscale the image.')
    }
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) {
      throw new Error('Could not encode the downscaled image.')
    }

    return {
      file: new File([blob], replaceExtension(file.name, 'jpg'), { type: 'image/jpeg' }),
      width,
      height,
      originalBytes,
      skipped: false,
      elapsedMs: performance.now() - started,
    }
  } finally {
    // Bitmaps hold decoded pixel data. A queue verifying two hundred labels
    // leaks a lot of memory without this.
    bitmap.close()
  }
}

function replaceExtension(name: string, extension: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  return `${withoutExtension}.${extension}`
}
