// The whole client-side review session: what has been checked, and what the
// agent decided about it.
//
// One reducer owns both halves because the reset control has to clear them
// together, and because that is the entire implementation of "restore the
// seeded state" under ADR-006. There is no server state to unwind and no
// request to make: the seeded queue is already in memory, every card's status
// derives from `checks`, so dropping this state *is* the reset
// (approach.md section 5.9).

import type { VerifyFailure } from './api'
import type { VerdictStatus, VerificationResult } from './contracts'

// What the client knows about one item's verification. An absent entry means
// unchecked. "failed" is a transport or provider failure, not a verdict
// (ADR-012), so its card derives back to not_yet_checked with an inline error.
export type ItemCheck =
  | { phase: 'checking' }
  | { phase: 'done'; result: VerificationResult }
  | { phase: 'failed'; error: VerifyFailure }

export type CheckState = Record<string, ItemCheck>

// What the agent recorded about one item.
//
// A confirm agrees with the recommendation. An override says what the agent
// believes instead, and it carries that corrected status rather than a bare
// flag: "the agent disagreed" cannot be scored, while "the tool said problem
// found and the agent said looks correct" can. Overrides are the honest
// accuracy measure in approach.md section 3, and phase 7 exports them.
export type Decision =
  | { kind: 'confirmed' }
  | { kind: 'overridden'; corrected: VerdictStatus; note?: string }

export type DecisionState = Record<string, Decision>

export interface SessionState {
  checks: CheckState
  decisions: DecisionState
}

export const EMPTY_SESSION: SessionState = { checks: {}, decisions: {} }

export type SessionAction =
  | { type: 'verify-started'; id: string }
  | { type: 'verify-succeeded'; id: string; result: VerificationResult }
  | { type: 'verify-failed'; id: string; error: VerifyFailure }
  | { type: 'decide'; id: string; decision: Decision }
  | { type: 'clear-decision'; id: string }
  | { type: 'reset' }

function withoutKey<T>(state: Record<string, T>, id: string): Record<string, T> {
  if (!(id in state)) return state
  const next = { ...state }
  delete next[id]
  return next
}

// Every action carries the item id so concurrent in-flight verifications
// (phase 7) dispatch independently without racing each other.
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'verify-started':
      return {
        // A decision describes a verdict. Re-checking an item retires that
        // verdict, so the decision goes with it rather than being left to
        // describe a result the agent never saw.
        decisions: withoutKey(state.decisions, action.id),
        checks: { ...state.checks, [action.id]: { phase: 'checking' } },
      }
    case 'verify-succeeded':
      return {
        ...state,
        checks: { ...state.checks, [action.id]: { phase: 'done', result: action.result } },
      }
    case 'verify-failed':
      return {
        ...state,
        checks: { ...state.checks, [action.id]: { phase: 'failed', error: action.error } },
      }
    case 'decide':
      return { ...state, decisions: { ...state.decisions, [action.id]: action.decision } }
    case 'clear-decision':
      return { ...state, decisions: withoutKey(state.decisions, action.id) }
    case 'reset':
      return EMPTY_SESSION
  }
}

// Whether there is review work a reset would destroy. The reset control asks
// for confirmation only when this is true; on an untouched queue there is
// nothing to lose and a modal would be ceremony (approach.md section 5.9).
export function hasWork(state: SessionState): boolean {
  return Object.keys(state.checks).length > 0 || Object.keys(state.decisions).length > 0
}
