// Presentation logic for the review view. No React, no network: the copy the
// screen reads from, the traversal arithmetic behind Next and Previous, and the
// fold that turns the backend's diff opcodes into render-ready segments.

import type { VerifyFailure } from './api'
import type {
  ApplicationRecord,
  DiffOp,
  FieldName,
  FieldResult,
  FieldVerdict,
  UnreadableReason,
  VerdictStatus,
} from './contracts'
import type { Decision } from './session'

// Field labels are written the way an agent would say them out loud, not the
// way the schema spells them.
export const FIELD_LABELS: Record<FieldName, string> = {
  brand_name: 'Brand name',
  class_type: 'Class and type',
  alcohol_content: 'Alcohol content',
  net_contents: 'Net contents',
  bottler_info: 'Bottler or importer',
  country_of_origin: 'Country of origin',
  government_warning: 'Government warning',
}

// One plain sentence per outcome, for the banner at the top of the review. The
// vocabulary stays recommendation-shaped: nothing here says approved or
// rejected, because the agent decides (ADR-003).
export const STATUS_SUMMARY: Record<VerdictStatus, string> = {
  looks_correct: 'Every field checked matches the application. Confirm to finish this item.',
  needs_review: 'Something on this label needs your judgement before the application moves on.',
  problem_found: 'At least one field disagrees with the application, or a required statement is wrong.',
  unreadable: 'The label could not be read, so nothing was compared. A better photograph is needed.',
}

export const FIELD_VERDICT_LABELS: Record<FieldVerdict, string> = {
  match: 'Match',
  needs_review: 'Needs review',
  mismatch: 'Mismatch',
}

// The comparison table renders one of these per row. It covers both the
// verified case, where the engine supplied a verdict, and the unchecked case,
// where all the agent can see is what the application claims. Keeping them one
// shape means the table has one code path and the screen stays honest about
// which column is empty and why.
export interface ComparisonRow {
  field: FieldName
  claimed: string | null
  extracted: string | null
  verdict: FieldVerdict | null
  reason: string | null
  diff: DiffOp[] | null
}

// The warning's claimed value is 50 words of statute. Naming it rather than
// printing it keeps the table scannable; the text itself belongs in the diff
// block, where it is the subject rather than a cell.
export const WARNING_CLAIMED_LABEL = 'The statutory text required by 27 CFR 16.21'

export function rowsFromResult(fields: FieldResult[]): ComparisonRow[] {
  return fields.map((field) => ({
    field: field.field,
    claimed: field.claimed,
    extracted: field.extracted,
    verdict: field.verdict,
    reason: field.reason,
    diff: field.diff ?? null,
  }))
}

// What an unchecked item shows: the application's side of the comparison, with
// the label column empty because nothing has read it yet. Country of origin
// appears only for imports, matching the engine, which leaves the field out
// entirely on a domestic product rather than inventing a fourth verdict.
export function rowsFromApplication(application: ApplicationRecord): ComparisonRow[] {
  const claims: [FieldName, string | null][] = [
    ['brand_name', application.brand_name],
    ['class_type', application.class_type],
    ['alcohol_content', application.alcohol_content],
    ['net_contents', application.net_contents],
    ['bottler_info', application.bottler_info],
  ]
  if (application.is_import) {
    claims.push(['country_of_origin', application.country_of_origin ?? null])
  }
  claims.push(['government_warning', WARNING_CLAIMED_LABEL])

  return claims.map(([field, claimed]) => ({
    field,
    claimed,
    extracted: null,
    verdict: null,
    reason: null,
    diff: null,
  }))
}

// Where the agent is in the stack, and where Next and Previous go.
export interface Traversal {
  previousId: string | null
  nextId: string | null
  // 1-based, for "Item 3 of 44". Zero when the id is not in the order at all,
  // which should not happen but must not render as "Item 0 of 44" if it does.
  position: number
  total: number
}

// `order` is a snapshot of the sorted queue taken when the review view opened.
// It is deliberately not recomputed as verdicts arrive: an agent working an
// item should not have the stack resorted underneath them mid-task, and Next
// should mean the card that was next when they started.
export function traversal(order: string[], currentId: string): Traversal {
  const index = order.indexOf(currentId)
  if (index === -1) {
    return { previousId: null, nextId: null, position: 0, total: order.length }
  }
  return {
    previousId: index > 0 ? order[index - 1] : null,
    nextId: index < order.length - 1 ? order[index + 1] : null,
    position: index + 1,
    total: order.length,
  }
}

// One run of words, and what happened to it. `removed` is statutory text the
// label dropped or replaced; `added` is what the label says instead.
export interface DiffSegment {
  kind: 'unchanged' | 'removed' | 'added'
  text: string
}

// Folds difflib opcodes into a single readable sequence: the statutory text in
// order, with the label's departures marked in place. A replacement becomes a
// removal immediately followed by an addition, which is what lets the reader
// see "may" struck out and "can" inserted right where it happened.
export function diffSegments(ops: DiffOp[]): DiffSegment[] {
  const segments: DiffSegment[] = []
  for (const op of ops) {
    if (op.op === 'equal') {
      if (op.expected) segments.push({ kind: 'unchanged', text: op.expected })
      continue
    }
    if (op.expected) segments.push({ kind: 'removed', text: op.expected })
    if (op.actual) segments.push({ kind: 'added', text: op.actual })
  }
  return segments
}

const UNREADABLE_REASONS: Record<UnreadableReason, string> = {
  glare: 'Glare hides part of the label.',
  angle: 'The label was photographed at too steep an angle.',
  blur: 'The image is too blurred to read.',
  resolution: 'The image resolution is too low to read.',
}

// The guidance is unconditional: the backend may report an unreadable image
// without naming a defect, and that is the state where the instruction matters
// most.
export function unreadableGuidance(reason: UnreadableReason | null): string {
  const cause = reason ? `${UNREADABLE_REASONS[reason]} ` : ''
  return `${cause}A better photograph is needed before this label can be checked.`
}

// A failure is never a statement about the label, so this copy never asks for a
// better photograph the way an unreadable verdict does (ADR-012). Only the
// rejected path shows the server text, which is written for this audience;
// provider and network failures would otherwise leak browser internals like
// "Failed to fetch" or "signal timed out".
export function failureMessage(failure: VerifyFailure): string {
  switch (failure.kind) {
    case 'provider':
      return 'The verification service had a problem. This is not a result. Try again.'
    case 'network':
      return 'Could not reach the verification service. Check your connection and try again.'
    case 'rejected':
      return `This label could not be sent for verification. ${failure.message}`
  }
}

export const DECISION_LABELS: Record<Decision['kind'], string> = {
  confirmed: 'Confirmed',
  overridden: 'Overridden',
}

// What the queue card and the review view say about a decision already made.
// Reads back the agent's own action so a returning reviewer can tell at a
// glance whether they agreed with the tool or corrected it.
export function decisionSummary(decision: Decision): string {
  if (decision.kind === 'confirmed') return 'You confirmed this recommendation.'
  return `You recorded this as ${STATUS_LABELS_LOWER[decision.corrected]} instead.`
}

// Mid-sentence forms of the four verdicts, so the summary above reads as
// English rather than as a badge dropped into a sentence.
const STATUS_LABELS_LOWER: Record<VerdictStatus, string> = {
  looks_correct: 'looks correct',
  needs_review: 'needs review',
  problem_found: 'a problem found',
  unreadable: 'unreadable',
}

// The three outcomes an agent can choose when overriding. Unreadable is not
// among them: it describes the photograph rather than the application, and an
// agent who thinks the image is unusable requests a better one rather than
// recording a compliance judgement.
export const OVERRIDE_CHOICES: VerdictStatus[] = ['looks_correct', 'needs_review', 'problem_found']
