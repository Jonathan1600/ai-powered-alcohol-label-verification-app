// The session reducer: verification state and agent decisions in one store, and
// the reset that clears both. Immutability matters here because React only
// re-renders on identity change, and because a reducer that mutates would let
// one item's update quietly rewrite another's.

import { describe, expect, it } from 'vitest'

import type { VerificationResult } from './contracts'
import { EMPTY_SESSION, hasWork, sessionReducer, type SessionState } from './session'

const result: VerificationResult = {
  status: 'problem_found',
  fields: [],
  unreadable_reason: null,
}

describe('sessionReducer: verification', () => {
  it('records each action against its item id', () => {
    let state = sessionReducer(EMPTY_SESSION, { type: 'verify-started', id: 'a' })
    expect(state.checks.a).toEqual({ phase: 'checking' })

    state = sessionReducer(state, { type: 'verify-succeeded', id: 'a', result })
    expect(state.checks.a).toEqual({ phase: 'done', result })

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
    const initial: SessionState = { checks: { a: { phase: 'checking' } }, decisions: {} }
    const next = sessionReducer(initial, { type: 'verify-started', id: 'b' })
    expect(next).not.toBe(initial)
    expect(next.checks.a).toBe(initial.checks.a)
    expect(initial.checks.b).toBeUndefined()
  })

  it('retires a decision when the item it described is checked again', () => {
    const decided = sessionReducer(
      { checks: { a: { phase: 'done', result } }, decisions: { a: { kind: 'confirmed' } } },
      { type: 'verify-started', id: 'a' },
    )
    expect(decided.decisions.a).toBeUndefined()
  })
})

describe('sessionReducer: decisions', () => {
  it('records a confirm and an override with the corrected status', () => {
    let state = sessionReducer(EMPTY_SESSION, {
      type: 'decide',
      id: 'a',
      decision: { kind: 'confirmed' },
    })
    expect(state.decisions.a).toEqual({ kind: 'confirmed' })

    state = sessionReducer(state, {
      type: 'decide',
      id: 'b',
      decision: { kind: 'overridden', corrected: 'looks_correct', note: 'Vintage differs, not ABV.' },
    })
    expect(state.decisions.b).toEqual({
      kind: 'overridden',
      corrected: 'looks_correct',
      note: 'Vintage differs, not ABV.',
    })
  })

  it('clears one decision without touching the verdict it described', () => {
    const state = sessionReducer(
      { checks: { a: { phase: 'done', result } }, decisions: { a: { kind: 'confirmed' } } },
      { type: 'clear-decision', id: 'a' },
    )
    expect(state.decisions.a).toBeUndefined()
    expect(state.checks.a).toEqual({ phase: 'done', result })
  })

  it('is a no-op on an item that was never decided', () => {
    const initial: SessionState = { checks: {}, decisions: { a: { kind: 'confirmed' } } }
    const next = sessionReducer(initial, { type: 'clear-decision', id: 'zzz' })
    expect(next.decisions).toBe(initial.decisions)
  })
})

describe('sessionReducer: reset', () => {
  it('discards verdicts and decisions together', () => {
    const state: SessionState = {
      checks: { a: { phase: 'done', result }, b: { phase: 'checking' } },
      decisions: { a: { kind: 'overridden', corrected: 'looks_correct' } },
    }
    expect(sessionReducer(state, { type: 'reset' })).toEqual(EMPTY_SESSION)
  })
})

describe('hasWork', () => {
  it('is false on an untouched session, so reset skips its confirmation', () => {
    expect(hasWork(EMPTY_SESSION)).toBe(false)
  })

  it('is true once anything has been checked or decided', () => {
    expect(hasWork({ checks: { a: { phase: 'checking' } }, decisions: {} })).toBe(true)
    expect(hasWork({ checks: {}, decisions: { a: { kind: 'confirmed' } } })).toBe(true)
  })
})
