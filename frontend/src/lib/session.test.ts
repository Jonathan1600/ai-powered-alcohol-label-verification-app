// The session reducer: the queue's added items, verification state, agent
// decisions, selection, and batch progress in one store, and the reset that
// clears all of it. Immutability matters here because React only re-renders on
// identity change, and because a reducer that mutates would let one item's
// update quietly rewrite another's.

import { describe, expect, it } from 'vitest'

import {
  batchProgress,
  EMPTY_SESSION,
  hasWork,
  selectedIds,
  sessionReducer,
  type SessionState,
} from './session'
import { addedItem, seedItem, verifyResponse } from '../test/fixtures'

/** A session with only the parts a test cares about spelled out. */
function session(partial: Partial<SessionState> = {}): SessionState {
  return { ...EMPTY_SESSION, ...partial }
}

const response = verifyResponse('problem_found')
const clean = verifyResponse('looks_correct')

describe('sessionReducer: verification', () => {
  it('records each action against its item id', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'verify-started', id: 'a' })
    expect(state.checks.a).toEqual({ phase: 'checking' })

    state = sessionReducer(state, { type: 'verify-succeeded', id: 'a', response })
    expect(state.checks.a).toEqual({ phase: 'done', response })

    state = sessionReducer(state, {
      type: 'verify-failed',
      id: 'a',
      error: { kind: 'network', message: 'offline' },
    })
    expect(state.checks.a).toEqual({
      phase: 'failed',
      error: { kind: 'network', message: 'offline' },
    })
  })

  it('leaves unrelated items untouched and never mutates the previous state', () => {
    const initial = session({ checks: { a: { phase: 'checking' } } })
    const next = sessionReducer(initial, { type: 'verify-started', id: 'b' })
    expect(next).not.toBe(initial)
    expect(next.checks.a).toBe(initial.checks.a)
    expect(initial.checks.b).toBeUndefined()
  })

  it('retires a decision when the item it described is checked again', () => {
    const decided = sessionReducer(
      session({
        checks: { a: { phase: 'done', response } },
        decisions: { a: { outcome: 'accepted' } },
      }),
      { type: 'verify-started', id: 'a' },
    )
    expect(decided.decisions.a).toBeUndefined()
  })

  it('returns a skipped item to unchecked with no error, because the agent stopped it', () => {
    const state = sessionReducer(session({ checks: { a: { phase: 'checking' } } }), {
      type: 'verify-skipped',
      id: 'a',
    })
    expect(state.checks.a).toBeUndefined()
  })
})

describe('sessionReducer: decisions', () => {
  it('records accepted and rejected reviewer outcomes', () => {
    let state = sessionReducer(EMPTY_SESSION, {
      type: 'decide',
      id: 'a',
      decision: { outcome: 'accepted' },
    })
    expect(state.decisions.a).toEqual({ outcome: 'accepted' })

    state = sessionReducer(state, {
      type: 'decide',
      id: 'b',
      decision: { outcome: 'rejected', note: 'Vintage differs, not ABV.' },
    })
    expect(state.decisions.b).toEqual({
      outcome: 'rejected',
      note: 'Vintage differs, not ABV.',
    })

    state = sessionReducer(state, {
      type: 'decide',
      id: 'c',
      decision: { outcome: 'accepted', note: 'Warning type is too small.' },
    })
    expect(state.decisions.c).toEqual({
      outcome: 'accepted',
      note: 'Warning type is too small.',
    })
  })

  it('records the same decision across many items for a bulk acceptance', () => {
    const state = sessionReducer(EMPTY_SESSION, {
      type: 'decide-many',
      ids: ['a', 'b', 'c'],
      decision: { outcome: 'accepted' },
    })
    expect(state.decisions).toEqual({
      a: { outcome: 'accepted' },
      b: { outcome: 'accepted' },
      c: { outcome: 'accepted' },
    })
  })

  it('leaves the store identical when a bulk accept has nothing to accept', () => {
    const initial = session({ decisions: { a: { outcome: 'accepted' } } })
    expect(sessionReducer(initial, { type: 'decide-many', ids: [], decision: { outcome: 'accepted' } }))
      .toBe(initial)
  })

  it('clears one decision without touching the verdict it described', () => {
    const state = sessionReducer(
      session({
        checks: { a: { phase: 'done', response } },
        decisions: { a: { outcome: 'accepted' } },
      }),
      { type: 'clear-decision', id: 'a' },
    )
    expect(state.decisions.a).toBeUndefined()
    expect(state.checks.a).toEqual({ phase: 'done', response })
  })

  it('is a no-op on an item that was never decided', () => {
    const initial = session({ decisions: { a: { outcome: 'accepted' } } })
    const next = sessionReducer(initial, { type: 'clear-decision', id: 'zzz' })
    expect(next.decisions).toBe(initial.decisions)
  })
})

describe('sessionReducer: selection', () => {
  it('toggles one item on and back off', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'toggle-selection', id: 'a' })
    expect(state.selection).toEqual({ a: true })
    state = sessionReducer(state, { type: 'toggle-selection', id: 'a' })
    expect(state.selection).toEqual({})
  })

  it('replaces the whole selection for select-all and clear', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'set-selection', ids: ['a', 'b'] })
    expect(state.selection).toEqual({ a: true, b: true })
    state = sessionReducer(state, { type: 'set-selection', ids: [] })
    expect(state.selection).toEqual({})
  })

  it('reads selected ids back in queue order, not click order', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c')]
    const state = sessionReducer(EMPTY_SESSION, { type: 'set-selection', ids: ['c', 'a'] })
    expect(selectedIds(state, items)).toEqual(['a', 'c'])
  })
})

describe('sessionReducer: batch', () => {
  it('claims only the items that have no verdict yet', () => {
    const state = sessionReducer(
      session({
        checks: {
          done: { phase: 'done', response },
          failed: { phase: 'failed', error: { kind: 'provider', message: 'down' } },
        },
      }),
      { type: 'batch-started', ids: ['fresh', 'done', 'failed'] },
    )

    // A failure is not a verdict, so that one is picked up again; the item that
    // already has a result keeps it.
    expect(state.batch.ids).toEqual(['fresh', 'failed'])
    expect(state.checks.fresh).toEqual({ phase: 'queued' })
    expect(state.checks.failed).toEqual({ phase: 'queued' })
    expect(state.checks.done).toEqual({ phase: 'done', response })
  })

  it('retires the decisions on the items it claims, and only those', () => {
    const state = sessionReducer(
      session({
        checks: { done: { phase: 'done', response } },
        decisions: { fresh: { outcome: 'accepted' }, done: { outcome: 'accepted' } },
      }),
      { type: 'batch-started', ids: ['fresh', 'done'] },
    )
    expect(state.decisions.fresh).toBeUndefined()
    expect(state.decisions.done).toEqual({ outcome: 'accepted' })
  })

  it('clears whatever is still queued when the run ends, and records why', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'batch-started', ids: ['a', 'b', 'c'] })
    state = sessionReducer(state, { type: 'verify-succeeded', id: 'a', response })
    state = sessionReducer(state, { type: 'batch-finished', stopped: 'agent' })

    expect(state.batch.running).toBe(false)
    expect(state.batch.stopped).toBe('agent')
    expect(state.checks.a).toEqual({ phase: 'done', response })
    expect(state.checks.b).toBeUndefined()
    expect(state.checks.c).toBeUndefined()
  })
})

describe('batchProgress', () => {
  it('derives the tally from the checks rather than keeping a second count', () => {
    let state = sessionReducer(EMPTY_SESSION, {
      type: 'batch-started',
      ids: ['a', 'b', 'c', 'd', 'e'],
    })
    state = sessionReducer(state, { type: 'verify-succeeded', id: 'a', response })
    state = sessionReducer(state, {
      type: 'verify-succeeded',
      id: 'b',
      response: verifyResponse('needs_review'),
    })
    state = sessionReducer(state, { type: 'verify-succeeded', id: 'c', response: clean })
    state = sessionReducer(state, {
      type: 'verify-failed',
      id: 'd',
      error: { kind: 'provider', message: 'down' },
    })

    expect(batchProgress(state)).toEqual({ total: 5, settled: 4, problems: 2, failures: 1 })
  })

  it('counts an unreadable result as settled but not as a problem to act on', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'batch-started', ids: ['a'] })
    state = sessionReducer(state, {
      type: 'verify-succeeded',
      id: 'a',
      response: verifyResponse('unreadable'),
    })
    expect(batchProgress(state)).toEqual({ total: 1, settled: 1, problems: 0, failures: 0 })
  })

  it('is all zeroes when no batch has run', () => {
    expect(batchProgress(EMPTY_SESSION)).toEqual({
      total: 0,
      settled: 0,
      problems: 0,
      failures: 0,
    })
  })
})

describe('sessionReducer: added items', () => {
  it('appends ingested items to whatever is already there', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'items-added', items: [addedItem('x')] })
    state = sessionReducer(state, { type: 'items-added', items: [addedItem('y')] })
    expect(state.added.map((item) => item.id)).toEqual(['x', 'y'])
  })
})

describe('sessionReducer: reset', () => {
  it('discards verdicts, decisions, selection, batch, and added labels together', () => {
    const state = session({
      added: [addedItem('x')],
      checks: { a: { phase: 'done', response }, b: { phase: 'checking' } },
      decisions: { a: { outcome: 'rejected' } },
      selection: { a: true },
      batch: { ids: ['a', 'b'], running: false, stopped: 'agent' },
    })
    expect(sessionReducer(state, { type: 'reset' })).toEqual(EMPTY_SESSION)
  })
})

describe('hasWork', () => {
  it('is false on an untouched session, so reset skips its confirmation', () => {
    expect(hasWork(EMPTY_SESSION)).toBe(false)
  })

  it('is true once anything has been checked, decided, or added', () => {
    expect(hasWork(session({ checks: { a: { phase: 'checking' } } }))).toBe(true)
    expect(hasWork(session({ decisions: { a: { outcome: 'accepted' } } }))).toBe(true)
    // Added labels are work too: a reset throws away an ingestion the agent
    // would have to redo file by file.
    expect(hasWork(session({ added: [addedItem('x')] }))).toBe(true)
  })
})
