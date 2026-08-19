// Pure queue logic: per-item check state, the derived card status, and the
// attention-needed sort. Kept free of React and network code so it is
// unit-testable, and kept out of the component files so
// react-refresh/only-export-components stays quiet.

import type { SeedQueueItem, VerdictStatus, VerificationResult } from './contracts'
import type { VerifyFailure } from './api'

// The six card states. The server only ever sends "not_yet_checked";
// "checking" is client-only, and the four verdicts come from the verify
// response.
export type CardStatus = VerdictStatus | 'not_yet_checked' | 'checking'

// What the client knows about one item's verification. An absent entry means
// unchecked. "failed" is a transport or provider failure, not a verdict
// (ADR-012), so its card derives back to not_yet_checked with an inline error.
export type ItemCheck =
  | { phase: 'checking' }
  | { phase: 'done'; result: VerificationResult }
  | { phase: 'failed'; error: VerifyFailure }

export type CheckState = Record<string, ItemCheck>

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

// Deterministic sort by (rank, seed position): within a rank the manifest
// order is preserved regardless of the engine's stability guarantees. Returns
// a new array; never mutates the input.
export function sortQueue(items: SeedQueueItem[], checks: CheckState): SeedQueueItem[] {
  return items
    .map((item, seedIndex) => ({ item, seedIndex, rank: STATUS_RANK[cardStatus(checks[item.id])] }))
    .sort((a, b) => a.rank - b.rank || a.seedIndex - b.seedIndex)
    .map((entry) => entry.item)
}

export type QueueAction =
  | { type: 'verify-started'; id: string }
  | { type: 'verify-succeeded'; id: string; result: VerificationResult }
  | { type: 'verify-failed'; id: string; error: VerifyFailure }

// Actions carry the item id so concurrent in-flight verifications (phase 7)
// can dispatch independently without racing each other.
export function checksReducer(state: CheckState, action: QueueAction): CheckState {
  switch (action.type) {
    case 'verify-started':
      return { ...state, [action.id]: { phase: 'checking' } }
    case 'verify-succeeded':
      return { ...state, [action.id]: { phase: 'done', result: action.result } }
    case 'verify-failed':
      return { ...state, [action.id]: { phase: 'failed', error: action.error } }
  }
}
