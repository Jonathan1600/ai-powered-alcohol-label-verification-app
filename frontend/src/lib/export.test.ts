// The export is the only way an override leaves the browser, so the test that
// matters is that a disagreement survives the round trip intact.

import { describe, expect, it } from 'vitest'

import { parseCsv } from './csv'
import { bulkConfirmable, EXPORT_HEADER, exportCsv, exportFilename, exportRows } from './export'
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

  it('carries an override with the status the agent chose and their note', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({
          checks: { a: doneCheck('problem_found') },
          decisions: {
            a: { kind: 'overridden', corrected: 'looks_correct', note: 'Vintage differs, not ABV.' },
          },
        }),
      ),
    )
    expect(rows[0].agent_decision).toBe('Overridden')
    expect(rows[0].agent_corrected_to).toBe('Looks correct')
    expect(rows[0].agent_note).toBe('Vintage differs, not ABV.')
  })

  it('leaves the corrected column empty on a confirm, which corrects nothing', () => {
    const rows = asObjects(
      exportCsv(
        [seedItem('a')],
        session({ checks: { a: doneCheck('looks_correct') }, decisions: { a: { kind: 'confirmed' } } }),
      ),
    )
    expect(rows[0].agent_decision).toBe('Confirmed')
    expect(rows[0].agent_corrected_to).toBe('')
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
        decisions: { a: { kind: 'overridden', corrected: 'looks_correct', note: '=HYPERLINK("x")' } },
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

describe('bulkConfirmable', () => {
  const items = [seedItem('clean'), seedItem('problem'), seedItem('decided'), seedItem('unchecked')]

  it('offers only the clean matches nobody has decided yet', () => {
    expect(
      bulkConfirmable(
        items,
        session({
          checks: {
            clean: doneCheck('looks_correct'),
            problem: doneCheck('problem_found'),
            decided: doneCheck('looks_correct'),
          },
          decisions: { decided: { kind: 'confirmed' } },
        }),
      ),
    ).toEqual(['clean'])
  })

  it('never reaches a needs review or a problem found, whatever else is true', () => {
    expect(
      bulkConfirmable(
        items,
        session({
          checks: { clean: doneCheck('needs_review'), problem: doneCheck('problem_found') },
        }),
      ),
    ).toEqual([])
  })
})
