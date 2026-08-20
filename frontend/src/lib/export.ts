// The CSV export: the whole queue, what the tool recommended, and what the
// agent decided about it.
//
// Reviewer outcomes are the reason this exists. This prototype has no database,
// so the only way a decision leaves the browser is through this file. Everything
// else here is context that makes that outcome interpretable six months later:
// what the tool found and how long verification took.
//
// Wide format, one row per application, one column per field verdict. Long
// format would be tidier and would also mean an agent opening this in Excel
// sees seven rows per application and cannot sort it.

import type { FieldName, QueueItem } from './contracts'
import { serializeCsv } from './csv'
import { cardStatus, STATUS_LABELS } from './queue'
import { decisionLabel, FIELD_VERDICT_LABELS } from './review'
import type { Decision, SessionState } from './session'

// Every field the engine can report on, in the order the review table shows
// them, so the export reads the way the screen does.
const FIELD_ORDER: FieldName[] = [
  'brand_name',
  'class_type',
  'alcohol_content',
  'net_contents',
  'bottler_info',
  'country_of_origin',
  'government_warning',
]

export const EXPORT_HEADER: string[] = [
  'application_reference',
  'brand_name',
  'source',
  'recommendation',
  ...FIELD_ORDER.map((field) => `${field}_verdict`),
  'reviewer_outcome',
  'agent_note',
  'server_total_ms',
]

function decisionNote(decision: Decision | undefined): string {
  return decision?.note ?? ''
}

/**
 * Builds the export as rows of strings, header first.
 *
 * Unchecked items are included with an empty recommendation rather than
 * dropped. The export is the queue, not the finished part of it, and a
 * spreadsheet that silently omits the forty applications nobody got to would
 * misreport the day's work.
 */
export function exportRows(items: readonly QueueItem[], session: SessionState): string[][] {
  const rows: string[][] = [EXPORT_HEADER]

  for (const item of items) {
    const check = session.checks[item.id]
    const decision = session.decisions[item.id]
    const response = check?.phase === 'done' ? check.response : null
    const result = response?.result ?? null

    const verdicts = new Map(result?.fields.map((field) => [field.field, field.verdict]) ?? [])

    rows.push([
      item.application_reference,
      item.brand_name,
      item.source === 'seed' ? 'Seeded fixture' : 'Added by agent',
      // The status word an agent read on screen, not the wire enum. This file
      // is for a person, and `problem_found` is not what the tool told them.
      result ? STATUS_LABELS[result.status] : '',
      ...FIELD_ORDER.map((field) => {
        const verdict = verdicts.get(field)
        return verdict ? FIELD_VERDICT_LABELS[verdict] : ''
      }),
      decision ? decisionLabel(decision) : '',
      decisionNote(decision),
      response ? String(Math.round(response.timings.server_total_ms)) : '',
    ])
  }

  return rows
}

export function exportCsv(items: readonly QueueItem[], session: SessionState): string {
  return serializeCsv(exportRows(items, session))
}

/**
 * A filename carrying the moment the export was taken.
 *
 * Nothing here is stored, so two exports from two sessions are the only record
 * that exists and they must not overwrite each other in a downloads folder.
 */
export function exportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replaceAll(':', '-')
  return `label-verification-${stamp}.csv`
}

/**
 * Hands the CSV to the browser as a download.
 *
 * The one function in this file that touches the DOM, kept here because the
 * object URL it creates has to be revoked and the pairing is easiest to get
 * right in one place. A leaked one holds the whole export in memory for the
 * life of the tab.
 */
export function downloadCsv(text: string, filename: string): void {
  // A BOM, so Excel opens it as UTF-8 rather than as the local codepage and
  // turns "Stone’s Throw" into mojibake.
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * The items a bulk accept would act on: clean matches nobody has decided yet.
 *
 * Deliberately only `looks_correct`. A bulk control that could sweep up a
 * problem found is a control that turns a compliance finding into a rubber
 * stamp, and the whole design rests on the agent deciding (ADR-003).
 */
export function bulkAcceptable(items: readonly QueueItem[], session: SessionState): string[] {
  return items
    .filter(
      (item) =>
        cardStatus(session.checks[item.id]) === 'looks_correct' &&
        !(item.id in session.decisions),
    )
    .map((item) => item.id)
}
