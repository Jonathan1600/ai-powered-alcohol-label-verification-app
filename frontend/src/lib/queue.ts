// Pure queue derivation: the card status one item shows, and the
// attention-needed sort. State itself lives in session.ts; this file only reads
// it. Kept free of React and network code so it is unit-testable, and kept out
// of the component files so react-refresh/only-export-components stays quiet.

import type { QueueItem, VerdictStatus } from './contracts'
import type { CheckState, DecisionState, ItemCheck } from './session'

// The card states. The server only ever sends "not_yet_checked"; "queued" and
// "checking" are client-only, and the four verdicts come from the verify
// response.
export type CardStatus = VerdictStatus | 'not_yet_checked' | 'queued' | 'checking'

export function cardStatus(check: ItemCheck | undefined): CardStatus {
  if (!check) return 'not_yet_checked'
  switch (check.phase) {
    case 'queued':
      return 'queued'
    case 'checking':
      return 'checking'
    case 'done':
      return check.response.result.status
    case 'failed':
      // A failure is not a verdict; the item is still waiting to be checked.
      return 'not_yet_checked'
  }
}

// Attention-needed order: problems, then review items, then unreadable (the
// agent must request a better photo, but there is no compliance finding yet),
// then clean, then unchecked. "queued" and "checking" share the unchecked rank
// so a card stays put when Verify is pressed and moves exactly once, on the
// verdict.
export const STATUS_RANK: Record<CardStatus, number> = {
  problem_found: 0,
  needs_review: 1,
  unreadable: 2,
  looks_correct: 3,
  checking: 4,
  queued: 4,
  not_yet_checked: 4,
}

// Single source of truth for the visible badge text, the aria-live copy, and
// the tests.
export const STATUS_LABELS: Record<CardStatus, string> = {
  problem_found: 'Problem found',
  needs_review: 'Needs review',
  unreadable: 'Unreadable',
  looks_correct: 'Looks correct',
  checking: 'Checking…',
  queued: 'Queued',
  not_yet_checked: 'Not yet checked',
}

/**
 * The statuses that mean "no verdict yet", which is what verify-all acts on and
 * what a card offers its own Verify button for.
 *
 * A failed item derives back to `not_yet_checked` (ADR-012), so a provider
 * outage leaves work to retry rather than a queue that believes it is finished.
 */
export function awaitingCheck(status: CardStatus): boolean {
  return status === 'not_yet_checked'
}

// Deterministic sort by (status rank, undecided first, seed position).
//
// The second key is what makes this a work queue rather than a list: an item
// the reviewer has accepted or rejected is finished, so it sinks below the
// items of the same status that still need a decision, and the top of the
// screen is always what is left to do. Within a rank the manifest order is
// preserved regardless of the engine's stability guarantees. Returns a new
// array; never mutates the input.
export function sortQueue(
  items: QueueItem[],
  checks: CheckState,
  decisions: DecisionState = {},
): QueueItem[] {
  return items
    .map((item, seedIndex) => ({
      item,
      seedIndex,
      rank: STATUS_RANK[cardStatus(checks[item.id])],
      decided: item.id in decisions ? 1 : 0,
    }))
    .sort((a, b) => a.rank - b.rank || a.decided - b.decided || a.seedIndex - b.seedIndex)
    .map((entry) => entry.item)
}

/**
 * Arranges `items` into a previously captured order.
 *
 * This is what freezing the grid during a batch is made of (ADR-013). The
 * attention-needed sort still runs, but its result is applied when the agent
 * asks for it rather than on every one of two hundred arriving verdicts, so
 * cards do not move out from under a pointer or a focus ring mid-reach.
 *
 * Ids the order does not know about, which is what a fresh ingestion produces,
 * go to the end in their own order rather than being dropped.
 */
export function applyOrder(items: QueueItem[], order: readonly string[]): QueueItem[] {
  if (order.length === 0) return items
  const rank = new Map(order.map((id, index) => [id, index]))
  return items
    .map((item, index) => ({ item, index, rank: rank.get(item.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
}

/** Whether two orders are the same list in the same sequence. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
