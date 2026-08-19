// Add labels: a folder of images plus a CSV of the application rows they
// belong to, paired by filename.
//
// This is the only way into the two hundred item scenario. The seeded corpus is
// forty-four fixtures and is deliberately not multiplied to look bigger, so a
// real batch is a real ingestion.
//
// Nothing here reaches the server. An added label lives in the browser as a
// File and is posted to the same `/api/verify` as a seeded one (ADR-014), which
// is what lets the app hold three hundred applications without acquiring a
// database.
//
// The validation rule that matters: report everything wrong at once, and ingest
// nothing until it is all right. A queue half-loaded from a spreadsheet with
// four bad rows is worse than an empty one, because the agent cannot see what
// is missing.

import type { ApplicationRecord, BeverageClass, QueueItem } from './contracts'
import { CsvError, parseCsv } from './csv'
import { downscale } from './downscale'

/** Longest edge for a card thumbnail. Small enough that a 300-card grid is cheap. */
export const THUMBNAIL_EDGE = 400

/** What the server will accept, checked here so a bad file fails where it can be fixed. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

const REQUIRED_COLUMNS = [
  'image',
  'application_reference',
  'brand_name',
  'class_type',
  'alcohol_content',
  'net_contents',
  'bottler_info',
  'beverage_class',
  'is_import',
] as const

/** `country_of_origin` is required only for imports, so it is optional here. */
export const ADD_LABELS_COLUMNS = [...REQUIRED_COLUMNS, 'country_of_origin'] as const

const BEVERAGE_CLASSES: readonly BeverageClass[] = ['wine', 'distilled_spirits', 'malt_beverage']

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', ''])

export interface IngestProblem {
  /** The spreadsheet row this is about, or null when it is about the file as a whole. */
  line: number | null
  message: string
}

export interface IngestResult {
  items: QueueItem[]
  problems: IngestProblem[]
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replaceAll(' ', '_')
}

/** Filenames are compared case-insensitively; Windows and macOS both hand them over that way. */
function imageKey(name: string): string {
  return name.trim().toLowerCase()
}

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase()
  if (TRUE_WORDS.has(value)) return true
  if (FALSE_WORDS.has(value)) return false
  return null
}

/**
 * Reads the CSV and the images into queue items, or explains everything that is
 * wrong with them.
 *
 * `existingReferences` are the application references already in the queue, so a
 * second ingestion cannot introduce a duplicate the first one would have caught.
 */
export async function ingestLabels(
  images: readonly File[],
  csvText: string,
  existingReferences: readonly string[] = [],
  onProgress?: (prepared: number, total: number) => void,
): Promise<IngestResult> {
  const problems: IngestProblem[] = []

  let records
  try {
    records = parseCsv(csvText)
  } catch (error) {
    return {
      items: [],
      problems: [{ line: null, message: error instanceof CsvError ? error.message : String(error) }],
    }
  }

  if (records.length === 0) {
    return { items: [], problems: [{ line: null, message: 'The CSV file is empty.' }] }
  }

  const header = records[0].values.map(normalizeHeader)
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column))
  if (missing.length > 0) {
    return {
      items: [],
      problems: [
        {
          line: 1,
          message:
            `The CSV is missing the column${missing.length > 1 ? 's' : ''} ` +
            `${missing.join(', ')}. Expected: ${ADD_LABELS_COLUMNS.join(', ')}.`,
        },
      ],
    }
  }

  // Images are indexed once so a three hundred row CSV is not a three hundred
  // times three hundred scan.
  const byFilename = new Map<string, File>()
  for (const file of images) {
    const key = imageKey(file.name)
    if (byFilename.has(key)) {
      problems.push({
        line: null,
        message: `Two selected images are both named ${file.name}. Filenames have to be unique.`,
      })
      continue
    }
    byFilename.set(key, file)
  }

  const dataRows = records.slice(1)
  // Named by some row, whether or not that row survived validation. An image
  // whose row failed for an unrelated reason has not been orphaned, and saying
  // so twice would send the agent looking for a second problem.
  const mentioned = new Set<string>()
  const claimed = new Set<string>()
  const references = new Set(existingReferences)
  const pending: {
    reference: string
    file: File
    application: ApplicationRecord
  }[] = []

  for (const record of dataRows) {
    const { line } = record
    let rowFailed = false
    const fail = (message: string) => {
      rowFailed = true
      problems.push({ line, message })
    }

    if (record.values.length !== header.length) {
      fail(`This row has ${record.values.length} values but the header has ${header.length}.`)
      continue
    }

    const cell = (column: string) => (record.values[header.indexOf(column)] ?? '').trim()

    const filename = cell('image')
    if (filename) mentioned.add(imageKey(filename))
    const file = filename ? byFilename.get(imageKey(filename)) : undefined
    if (!filename) fail('No image filename in the image column.')
    else if (!file) fail(`No selected image is named ${filename}.`)
    else if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      fail(`${filename} is a ${file.type || 'unrecognised file type'}. Send PNG, JPEG, or WebP.`)
    } else if (claimed.has(imageKey(filename))) {
      fail(`${filename} is already used by an earlier row.`)
    }

    const reference = cell('application_reference')
    if (!reference) fail('No application reference.')
    else if (references.has(reference)) {
      fail(`The application reference ${reference} is already in the queue.`)
    }

    const text: Record<string, string> = {}
    for (const column of ['brand_name', 'class_type', 'alcohol_content', 'net_contents', 'bottler_info']) {
      text[column] = cell(column)
      if (!text[column]) fail(`No ${column.replaceAll('_', ' ')}.`)
    }

    const beverageClass = cell('beverage_class').toLowerCase() as BeverageClass
    if (!BEVERAGE_CLASSES.includes(beverageClass)) {
      fail(
        `The beverage class ${cell('beverage_class') || '(empty)'} is not one of ` +
          `${BEVERAGE_CLASSES.join(', ')}.`,
      )
    }

    const isImport = parseBoolean(cell('is_import'))
    if (isImport === null) fail(`Could not read ${cell('is_import')} as true or false.`)

    const country = header.includes('country_of_origin') ? cell('country_of_origin') : ''
    if (isImport === true && !country) {
      // The engine compares this field only on imports, so an import without one
      // would be checked against nothing and silently pass.
      fail('This row is an import, so it needs a country of origin.')
    }

    // Everything above ran even after the first failure, so the agent sees the
    // whole picture. Only a clean row goes forward.
    if (rowFailed) continue

    claimed.add(imageKey(filename))
    references.add(reference)
    pending.push({
      reference,
      file: file as File,
      application: {
        brand_name: text.brand_name,
        class_type: text.class_type,
        alcohol_content: text.alcohol_content,
        net_contents: text.net_contents,
        bottler_info: text.bottler_info,
        country_of_origin: country || null,
        beverage_class: beverageClass,
        is_import: isImport as boolean,
      },
    })
  }

  if (pending.length === 0 && problems.length === 0) {
    problems.push({ line: null, message: 'The CSV has a header but no application rows.' })
  }

  for (const file of images) {
    if (!mentioned.has(imageKey(file.name))) {
      problems.push({ line: null, message: `${file.name} has no row in the CSV.` })
    }
  }

  if (problems.length > 0) return { items: [], problems }

  // Only now, with the whole file known to be good, is anything decoded. A
  // rejected ingestion costs no image work at all, which matters when the
  // rejected thing is three hundred photographs.
  const items: QueueItem[] = []
  for (const [index, entry] of pending.entries()) {
    const imageUrl = URL.createObjectURL(entry.file)
    let thumbnailUrl = imageUrl
    try {
      const thumbnail = await downscale(entry.file, THUMBNAIL_EDGE)
      // A file already smaller than a thumbnail comes back untouched, and
      // creating a second URL for the same bytes would only be a second thing
      // to revoke.
      if (!thumbnail.skipped) thumbnailUrl = URL.createObjectURL(thumbnail.file)
    } catch {
      // A card showing the full-size picture in a thumbnail slot is a slower
      // grid. A card with no picture is a broken one, and either way the label
      // still verifies, so this is not worth failing an ingestion over.
    }

    items.push({
      source: 'added',
      id: `added-${entry.reference}`,
      application_reference: entry.reference,
      brand_name: entry.application.brand_name,
      application: entry.application,
      imageUrl,
      thumbnailUrl,
      file: entry.file,
    })
    onProgress?.(index + 1, pending.length)
  }

  return { items, problems: [] }
}

/**
 * Releases the object URLs behind added labels.
 *
 * Called by the screen just before a reset. The reducer cannot do it: revoking
 * is a side effect and it has to stay pure. Deduplicated because an image small
 * enough to be its own thumbnail carries the same URL twice.
 */
export function revokeItemUrls(items: readonly QueueItem[]): void {
  const urls = new Set<string>()
  for (const item of items) {
    if (item.source !== 'added') continue
    urls.add(item.imageUrl)
    urls.add(item.thumbnailUrl)
  }
  for (const url of urls) URL.revokeObjectURL(url)
}
