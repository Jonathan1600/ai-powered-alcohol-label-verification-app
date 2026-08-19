// Pure queue derivation: the card status one item shows, and the
// attention-needed sort. State itself lives in session.ts; this file only reads
// it. Kept free of React and network code so it is unit-testable, and kept out
// of the component files so react-refresh/only-export-components stays quiet.

import type { SeedQueueItem, VerdictStatus } from './contracts'
import type { CheckState, DecisionState, ItemCheck } from './session'

// The six card states. The server only ever sends "not_yet_checked";
// "checking" is client-only, and the four verdicts come from the verify
// response.
export type CardStatus = VerdictStatus | 'not_yet_checked' | 'checking'

export function cardStatus(check: ItemCheck | undefined): CardStatus {
  if (!check) return 'not_yet_checked'
  switch (check.phase) {
    case 'checking':
      return 'checking'
    case 'done':
      return check.result.status
    case 'failed':
      // A failure is not a verdict; the item is still waiting to be checked.
      return 'not_yet_checked'
  }
}

// Attention-needed order: problems, then review items, then unreadable (the
// agent must request a better photo, but there is no compliance finding yet),
// then clean, then unchecked. "checking" shares the unchecked rank so a card
// stays put when Verify is pressed and moves exactly once, on the verdict.
export const STATUS_RANK: Record<CardStatus, number> = {
  problem_found: 0,
  needs_review: 1,
  unreadable: 2,
  looks_correct: 3,
  checking: 4,
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
  not_yet_checked: 'Not yet checked',
}

// Deterministic sort by (status rank, undecided first, seed position).
//
// The second key is what makes this a work queue rather than a list: an item
// the agent has confirmed or overridden is finished, so it sinks below the
// items of the same status that still need a decision, and the top of the
// screen is always what is left to do. Within a rank the manifest order is
// preserved regardless of the engine's stability guarantees. Returns a new
// array; never mutates the input.
export function sortQueue(
  items: SeedQueueItem[],
  checks: CheckState,
  decisions: DecisionState = {},
): SeedQueueItem[] {
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
