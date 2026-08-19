// The CSV codec. Reading covers what a spreadsheet actually exports, and
// writing covers the one thing a spreadsheet does that we have to defend
// against.

import { describe, expect, it } from 'vitest'

import { CsvError, parseCsv, sanitizeCell, serializeCsv } from './csv'

function valuesOf(text: string): string[][] {
  return parseCsv(text).map((record) => record.values)
}

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(valuesOf('a,b\n1,2\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('reads CRLF the same as LF', () => {
    expect(valuesOf('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas inside quoted values', () => {
    expect(valuesOf('brand,bottler\nX,"Bottled by X, Bardstown, KY"\n')).toEqual([
      ['brand', 'bottler'],
      ['X', 'Bottled by X, Bardstown, KY'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(valuesOf('note\n"She said ""no"" twice"\n')).toEqual([
      ['note'],
      ['She said "no" twice'],
    ])
  })

  it('keeps newlines inside quoted values', () => {
    expect(valuesOf('note\n"line one\nline two"\n')).toEqual([['note'], ['line one\nline two']])
  })

  it('reads a final row with no trailing newline', () => {
    expect(valuesOf('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops blank lines rather than returning rows of empty cells', () => {
    expect(valuesOf('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps genuinely empty cells inside a row', () => {
    expect(valuesOf('a,b,c\n1,,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })

  it('strips the byte order mark Excel writes', () => {
    expect(parseCsv('\ufeffimage,brand\nx.png,X\n')[0].values[0]).toBe('image')
  })

  it('numbers records by the line an agent would see in their spreadsheet', () => {
    const records = parseCsv('image,brand\na.png,A\nb.png,B\n')
    expect(records.map((record) => record.line)).toEqual([1, 2, 3])
  })

  it('counts embedded newlines so later rows are still numbered correctly', () => {
    const records = parseCsv('a\n"one\ntwo"\nthree\n')
    expect(records.map((record) => record.line)).toEqual([1, 2, 4])
  })

  it('returns ragged rows as they are, leaving the column question to the caller', () => {
    expect(valuesOf('a,b,c\n1,2\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ])
  })

  it('refuses a file that ends inside a quoted value', () => {
    expect(() => parseCsv('a,b\n"unterminated,2\n')).toThrow(CsvError)
  })
})

describe('sanitizeCell', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx', '\nx'])(
    'disarms %j so a spreadsheet shows it instead of running it',
    (value) => {
      expect(sanitizeCell(value)).toBe(`'${value}`)
    },
  )

  it('leaves ordinary text and an empty cell alone', () => {
    expect(sanitizeCell('Stone’s Throw')).toBe('Stone’s Throw')
    expect(sanitizeCell('750 mL')).toBe('750 mL')
    expect(sanitizeCell('')).toBe('')
  })
})

describe('serializeCsv', () => {
  it('writes CRLF rows with a trailing newline', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n')
  })

  it('quotes only the cells that need it', () => {
    expect(serializeCsv([['plain', 'has,comma', 'has"quote', 'has\nnewline']])).toBe(
      'plain,"has,comma","has""quote","has\nnewline"\r\n',
    )
  })

  it('disarms a formula cell before quoting it', () => {
    expect(serializeCsv([['=cmd|calc']])).toBe("'=cmd|calc\r\n")
  })

  it('round-trips through the parser', () => {
    const rows = [
      ['reference', 'note'],
      ['TTB-2026-0001', 'Bottled by X, Bardstown, KY'],
      ['TTB-2026-0002', 'She said "no"'],
      ['TTB-2026-0003', 'line one\nline two'],
    ]
    expect(valuesOf(serializeCsv(rows))).toEqual(rows)
  })
})
