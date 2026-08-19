// The whole client-side review session: what is in the queue, what has been
// checked, what the agent decided about it, what is selected, and whether a
// batch is running.
//
// One reducer owns all of it because the reset control has to clear them
// together, and because that is the entire implementation of "restore the
// seeded state" under ADR-006. There is no server state to unwind and no
// request to make: the seeded queue is already in memory, every card's status
// derives from `checks`, so dropping this state *is* the reset
// (approach.md section 5.9).
//
// The one thing reset cannot do from in here is revoke the object URLs behind
// added labels, because that is a side effect and this function is not allowed
// one. `revokeItemUrls` in lib/ingest.ts is called by the screen just before it
// dispatches.

import type { VerifyFailure } from './api'
import type { QueueItem, VerifyResponse } from './contracts'

// What the client knows about one item's verification. An absent entry means
// unchecked. "failed" is a transport or provider failure, not a verdict
// (ADR-012), so its card derives back to not_yet_checked with an inline error.
//
// "queued" exists so a batch can claim its items the moment it starts. Without
// it, an agent could press Verify on a card the pool is about to pick up and
// pay for the same label twice; and two hundred cards all claiming to be
// "checking" when six of them are would be a straightforward lie.
export type ItemCheck =
  | { phase: 'queued' }
  | { phase: 'checking' }
  | { phase: 'done'; response: VerifyResponse }
  | { phase: 'failed'; error: VerifyFailure }

export type CheckState = Record<string, ItemCheck>

// What the agent recorded about one item.
//
// No reviewer action leaves the system finding intact. When an agent does act,
// their outcome is deliberately binary and independent from the model's
// triage result; the CSV carries both pieces of information.
export type Decision = { outcome: 'accepted' | 'rejected'; note?: string }

export type DecisionState = Record<string, Decision>

/** Why a batch ended early. `null` means it ran to the end of its list. */
export type BatchStop = 'agent' | 'provider' | null

// A batch is remembered as the list it was given, not as a set of counters.
// Everything the progress region shows is derived from `checks` by
// `batchProgress`, so there is no second copy of the truth to fall out of step
// with the cards.
export interface BatchState {
  ids: string[]
  running: boolean
  stopped: BatchStop
}

export const NO_BATCH: BatchState = { ids: [], running: false, stopped: null }

export interface SessionState {
  /** Labels the agent added from their own machine. Seeded items live in the screen. */
  added: QueueItem[]
  checks: CheckState
  decisions: DecisionState
  selection: Record<string, true>
  batch: BatchState
}

export const EMPTY_SESSION: SessionState = {
  added: [],
  checks: {},
  decisions: {},
  selection: {},
  batch: NO_BATCH,
}

export type SessionAction =
  | { type: 'items-added'; items: QueueItem[] }
  | { type: 'verify-started'; id: string }
  | { type: 'verify-succeeded'; id: string; response: VerifyResponse }
  | { type: 'verify-failed'; id: string; error: VerifyFailure }
  | { type: 'verify-skipped'; id: string }
  | { type: 'decide'; id: string; decision: Decision }
  | { type: 'decide-many'; ids: string[]; decision: Decision }
  | { type: 'clear-decision'; id: string }
  | { type: 'toggle-selection'; id: string }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'batch-started'; ids: string[] }
  | { type: 'batch-finished'; stopped: BatchStop }
  | { type: 'reset' }

function withoutKey<T>(state: Record<string, T>, id: string): Record<string, T> {
  if (!(id in state)) return state
  const next = { ...state }
  delete next[id]
  return next
}

function withoutKeys<T>(state: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  const next = { ...state }
  for (const id of ids) delete next[id]
  return next
}

// Every action carries the item id so concurrent in-flight verifications
// dispatch independently without racing each other.
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'items-added':
      return { ...state, added: [...state.added, ...action.items] }

    case 'verify-started':
      return {
        ...state,
        // A decision describes a verdict. Re-checking an item retires that
        // verdict, so the decision goes with it rather than being left to
        // describe a result the agent never saw.
        decisions: withoutKey(state.decisions, action.id),
        checks: { ...state.checks, [action.id]: { phase: 'checking' } },
      }

    case 'verify-succeeded':
      return {
        ...state,
        checks: { ...state.checks, [action.id]: { phase: 'done', response: action.response } },
      }

    case 'verify-failed':
      return {
        ...state,
        checks: { ...state.checks, [action.id]: { phase: 'failed', error: action.error } },
      }

    case 'verify-skipped':
      // Stopped before it got an answer. Back to unchecked, with no error
      // shown: the agent stopped it, so telling them something went wrong
      // would be reporting their own action back to them as a fault.
      return { ...state, checks: withoutKey(state.checks, action.id) }

    case 'decide':
      return { ...state, decisions: { ...state.decisions, [action.id]: action.decision } }

    case 'decide-many': {
      if (action.ids.length === 0) return state
      const decisions = { ...state.decisions }
      for (const id of action.ids) decisions[id] = action.decision
      return { ...state, decisions }
    }

    case 'clear-decision':
      return { ...state, decisions: withoutKey(state.decisions, action.id) }

    case 'toggle-selection':
      return action.id in state.selection
        ? { ...state, selection: withoutKey(state.selection, action.id) }
        : { ...state, selection: { ...state.selection, [action.id]: true } }

    case 'set-selection':
      return { ...state, selection: Object.fromEntries(action.ids.map((id) => [id, true])) }

    case 'batch-started': {
      // Claim only what is genuinely unchecked. An item that already carries a
      // verdict is not re-verified by a batch, so its result and the decision
      // resting on it both survive.
      const claimed = action.ids.filter((id) => {
        const phase = state.checks[id]?.phase
        return phase === undefined || phase === 'failed'
      })
      const checks = { ...state.checks }
      for (const id of claimed) checks[id] = { phase: 'queued' }
      return {
        ...state,
        checks,
        decisions: withoutKeys(state.decisions, claimed),
        batch: { ids: claimed, running: true, stopped: null },
      }
    }

    case 'batch-finished': {
      // Anything still queued never started. Clear it rather than leaving two
      // hundred cards claiming to be waiting for a run that has ended.
      const stale = state.batch.ids.filter((id) => state.checks[id]?.phase === 'queued')
      return {
        ...state,
        checks: stale.length > 0 ? withoutKeys(state.checks, stale) : state.checks,
        batch: { ...state.batch, running: false, stopped: action.stopped },
      }
    }

    case 'reset':
      return EMPTY_SESSION
  }
}

export interface BatchProgress {
  total: number
  settled: number
  /** Problem found or needs review, the two the agent has to act on. */
  problems: number
  /** Transport or provider failures. Never verdicts (ADR-012). */
  failures: number
}

/**
 * What the progress region shows, derived rather than counted.
 *
 * Reading it back off `checks` means the number beside the progress bar and the
 * badges on the cards cannot disagree, which a pair of incremented counters
 * would eventually manage.
 */
export function batchProgress(state: SessionState): BatchProgress {
  let settled = 0
  let problems = 0
  let failures = 0

  for (const id of state.batch.ids) {
    const check = state.checks[id]
    if (!check) continue
    if (check.phase === 'failed') {
      settled += 1
      failures += 1
      continue
    }
    if (check.phase !== 'done') continue
    settled += 1
    const status = check.response.result.status
    if (status === 'problem_found' || status === 'needs_review') problems += 1
  }

  return { total: state.batch.ids.length, settled, problems, failures }
}

/** The ids currently selected, in the order the caller's list gives them. */
export function selectedIds(state: SessionState, items: QueueItem[]): string[] {
  return items.filter((item) => item.id in state.selection).map((item) => item.id)
}

// Whether there is review work a reset would destroy. The reset control asks
// for confirmation only when this is true; on an untouched queue there is
// nothing to lose and a modal would be ceremony (approach.md section 5.9).
export function hasWork(state: SessionState): boolean {
  return (
    Object.keys(state.checks).length > 0 ||
    Object.keys(state.decisions).length > 0 ||
    state.added.length > 0
  )
}
