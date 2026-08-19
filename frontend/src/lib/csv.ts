// Reading and writing CSV, to the extent this app needs it.
//
// Hand-rolled rather than a dependency. The read side is one scanner, the write
// side needs an escaping rule a general-purpose library will not apply for us
// (see `sanitizeCell`), and both are load-bearing enough to want tests we own.
//
// No React, no DOM: the ingestion panel and the export button both reduce to
// text in and text out, and this file is the text.

/** A structural problem in the file itself, as opposed to a bad value in a row. */
export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvError'
  }
}

export interface CsvRecord {
  /**
   * 1-based physical line where this record starts, header included, so an
   * error can say "row 14" and mean the row the agent sees in their
   * spreadsheet.
   */
  line: number
  values: string[]
}

const QUOTE = '"'

/**
 * Parses RFC 4180 text into records.
 *
 * Handles quoted fields containing commas, newlines, and doubled quotes; LF and
 * CRLF line endings; and a leading byte order mark, which is what Excel writes
 * and what would otherwise turn the first column name into something no lookup
 * matches.
 *
 * Wholly empty lines are dropped, so a trailing newline does not become a row
 * of blanks that then fails validation for reasons the agent cannot see.
 * Ragged records are returned as they are: whether a row has the wrong number
 * of cells is a question about *this* file's columns, and that belongs with the
 * code that knows what the columns should be.
 */
export function parseCsv(text: string): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const records: CsvRecord[] = []
  let values: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  let index = 0

  function endField() {
    values.push(field)
    field = ''
  }

  function endRecord() {
    endField()
    // A single empty cell is what a blank line parses to. It is not a row.
    if (!(values.length === 1 && values[0] === '')) {
      records.push({ line: recordLine, values })
    }
    values = []
    recordLine = line
  }

  while (index < source.length) {
    const char = source[index]

    if (quoted) {
      if (char === QUOTE) {
        if (source[index + 1] === QUOTE) {
          field += QUOTE
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      if (char === '\n') line += 1
      field += char
      index += 1
      continue
    }

    if (char === QUOTE && field === '') {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      endField()
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      // Consume CRLF as one terminator, never as an empty row between them.
      if (char === '\r' && source[index + 1] === '\n') index += 1
      line += 1
      index += 1
      endRecord()
      continue
    }

    field += char
    index += 1
  }

  if (quoted) {
    throw new CsvError(
      `The file ends inside a quoted value that opened on line ${recordLine}. ` +
        'A quote is probably missing its pair.',
    )
  }
  // Whatever is left when the text runs out without a final newline.
  if (field !== '' || values.length > 0) endRecord()

  return records
}

// A cell starting with any of these is treated as a formula by Excel, Sheets,
// and LibreOffice. An override note is free text typed by an agent, and the
// export lands in a spreadsheet on someone else's machine, so a note beginning
// "=" must not become executable there.
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n'])

/**
 * Neutralises a cell that a spreadsheet would otherwise evaluate.
 *
 * The leading apostrophe is the conventional fix: spreadsheets consume it and
 * show the literal text. Note that it also disarms a legitimate negative
 * number, which is a real cost and a bearable one here because no column in
 * this export carries one.
 */
export function sanitizeCell(value: string): string {
  return value !== '' && FORMULA_LEADERS.has(value[0]) ? `'${value}` : value
}

function quoteCell(value: string): string {
  const safe = sanitizeCell(value)
  if (!/[",\r\n]/.test(safe)) return safe
  return `${QUOTE}${safe.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`
}

/**
 * Writes rows as CSV text, header included by the caller as the first row.
 *
 * CRLF line endings and a trailing newline, which is what RFC 4180 specifies
 * and what Excel is least surprised by.
 */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quoteCell).join(',')).join('\r\n') + '\r\n'
}
