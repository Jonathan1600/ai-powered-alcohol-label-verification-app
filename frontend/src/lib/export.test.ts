// The export is the only way a reviewer outcome leaves the browser, so the
// test that matters is that the outcome survives the round trip intact.

import { describe, expect, it } from 'vitest'

import { parseCsv } from './csv'
import { bulkAcceptable, EXPORT_HEADER, exportCsv, exportFilename, exportRows } from './export'
import { EMPTY_SESSION, type SessionState } from './session'
import { addedItem, doneCheck, fieldResult, seedItem } from '../test/fixtures'

function session(partial: Partial<SessionState> = {}): SessionState {
  return { ...EMPTY_SESSION, ...partial }
}

function asObjects(csv: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(csv)
  return rows.map((record) =>
    Object.fromEntries(header.values.map((name, index) => [name, record.values[index] ?? ''])),
  )
}

describe('exportRows', () => {
  it('leads with the header', () => {
    expect(exportRows([], EMPTY_SESSION)).toEqual([EXPORT_HEADER])
  })

  it('keeps unchecked items in, with an empty recommendation', () => {
    const rows = asObjects(exportCsv([seedItem('a')], EMPTY_SESSION))
    expect(rows).toHaveLength(1)
    expect(rows[0].recommendation).toBe('')
    expect(rows[0].application_reference).toBe('TTB-2026-a')
    expect(rows[0].source).toBe('Seeded fixture')
  })

  it('writes the words the agent read on screen, not the wire enum', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({ checks: { a: doneCheck('problem_found', [fieldResult('alcohol_content', 'mismatch')]) } }),
      ),
    )
    expect(rows[0].recommendation).toBe('Problem found')
    expect(rows[0].alcohol_content_verdict).toBe('Mismatch')
    // A field the engine did not report on stays blank rather than guessing.
    expect(rows[0].country_of_origin_verdict).toBe('')
  })

  it('carries an accepted outcome and the reviewer note', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({
          checks: { a: doneCheck('problem_found') },
          decisions: {
            a: { outcome: 'accepted', note: 'Vintage differs, not ABV.' },
          },
        }),
      ),
    )
    expect(rows[0].reviewer_outcome).toBe('Accepted')
    expect(rows[0].agent_note).toBe('Vintage differs, not ABV.')
  })

  it('carries a rejected outcome without a note', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({ checks: { a: doneCheck('looks_correct') }, decisions: { a: { outcome: 'rejected' } } }),
      ),
    )
    expect(rows[0].reviewer_outcome).toBe('Rejected')
    expect(rows[0].agent_note).toBe('')
  })

  it('carries a rejected outcome and optional note', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({
          checks: { a: doneCheck('needs_review') },
          decisions: { a: { outcome: 'rejected', note: 'Warning typography needs correction.' } },
        }),
      ),
    )
    expect(rows[0].reviewer_outcome).toBe('Rejected')
    expect(rows[0].agent_note).toBe('Warning typography needs correction.')
  })

  it('attributes a result to the model and prompt that produced it', () => {
    const rows = asObjects(
      exportCsv([seedItem('a')], session({ checks: { a: doneCheck('looks_correct') } })),
    )
    expect(rows[0].model).toBe('gpt-4.1-mini')
    expect(rows[0].prompt_version).toBe('2026-08-18.2')
    expect(rows[0].server_total_ms).toBe('5003')
  })

  it('distinguishes an added label from a seeded fixture', () => {
    const rows = asObjects(exportCsv([addedItem('x')], EMPTY_SESSION))
    expect(rows[0].source).toBe('Added by agent')
  })

  it('neutralises a note that a spreadsheet would run as a formula', () => {
    const csv = exportCsv(
      [seedItem('a')],
      session({
        checks: { a: doneCheck('problem_found') },
        decisions: { a: { outcome: 'accepted', note: '=HYPERLINK("x")' } },
      }),
    )
    expect(csv).toContain(`'=HYPERLINK`)
    expect(asObjects(csv)[0].agent_note).toBe(`'=HYPERLINK("x")`)
  })
})

describe('exportFilename', () => {
  it('stamps the moment, so two exports do not overwrite each other', () => {
    expect(exportFilename(new Date('2026-08-18T14:30:05Z'))).toBe(
      'label-verification-2026-08-18T14-30-05.csv',
    )
  })
})

describe('bulkAcceptable', () => {
  const items = [seedItem('clean'), seedItem('problem'), seedItem('decided'), seedItem('unchecked')]

  it('offers only the clean matches nobody has decided yet', () => {
    expect(
      bulkAcceptable(
        items,
        session({
          checks: {
            clean: doneCheck('looks_correct'),
            problem: doneCheck('problem_found'),
            decided: doneCheck('looks_correct'),
          },
          decisions: { decided: { outcome: 'accepted' } },
        }),
      ),
    ).toEqual(['clean'])
  })

  it('never reaches a needs review or a problem found, whatever else is true', () => {
    expect(
      bulkAcceptable(
        items,
        session({
          checks: { clean: doneCheck('needs_review'), problem: doneCheck('problem_found') },
        }),
      ),
    ).toEqual([])
  })
})
