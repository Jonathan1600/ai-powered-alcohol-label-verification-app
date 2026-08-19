// The sort and state-derivation contract for the queue screen: attention
// needed first, worked items out of the way, deterministic within a rank, and a
// card that never moves just because Verify was pressed.

import { describe, expect, it } from 'vitest'

import { cardStatus, sortQueue, STATUS_LABELS, STATUS_RANK } from './queue'
import type { CheckState, DecisionState } from './session'
import { doneCheck, seedItem } from '../test/fixtures'

const done = doneCheck

describe('cardStatus', () => {
  it('treats an absent entry as not yet checked', () => {
    expect(cardStatus(undefined)).toBe('not_yet_checked')
  })

  it('maps checking and each verdict through directly', () => {
    expect(cardStatus({ phase: 'checking' })).toBe('checking')
    expect(cardStatus(done('looks_correct'))).toBe('looks_correct')
    expect(cardStatus(done('needs_review'))).toBe('needs_review')
    expect(cardStatus(done('problem_found'))).toBe('problem_found')
    expect(cardStatus(done('unreadable'))).toBe('unreadable')
  })

  it('derives a failure back to not_yet_checked, because a provider failure is not a verdict (ADR-012)', () => {
    expect(
      cardStatus({ phase: 'failed', error: { kind: 'provider', message: 'boom' } }),
    ).toBe('not_yet_checked')
  })
})

describe('sortQueue', () => {
  it('orders by attention needed: problems, review, unreadable, clean, unchecked', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c'), seedItem('d'), seedItem('e')]
    const checks: CheckState = {
      a: done('looks_correct'),
      b: done('unreadable'),
      c: done('problem_found'),
      e: done('needs_review'),
      // d stays unchecked
    }
    expect(sortQueue(items, checks).map((i) => i.id)).toEqual(['c', 'e', 'b', 'a', 'd'])
  })

  it('keeps seed order within a rank', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c')]
    expect(sortQueue(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not move a card when Verify is pressed', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c')]
    const before = sortQueue(items, {}).map((i) => i.id)
    const after = sortQueue(items, { b: { phase: 'checking' } }).map((i) => i.id)
    expect(after).toEqual(before)
  })

  it('moves exactly the item whose verdict arrived', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c')]
    const sorted = sortQueue(items, { b: done('problem_found') }).map((i) => i.id)
    expect(sorted).toEqual(['b', 'a', 'c'])
  })

  it('sinks a decided item below the undecided items it shares a status with', () => {
    const items = [seedItem('a'), seedItem('b'), seedItem('c')]
    const checks: CheckState = {
      a: done('problem_found'),
      b: done('problem_found'),
      c: done('problem_found'),
    }
    const decisions: DecisionState = { a: { kind: 'confirmed' } }
    expect(sortQueue(items, checks, decisions).map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('never lifts a decided item above a worse status', () => {
    // A confirmed problem still outranks an undecided clean pass: the sort is
    // about attention first and completion second.
    const items = [seedItem('a'), seedItem('b')]
    const checks: CheckState = { a: done('looks_correct'), b: done('problem_found') }
    const decisions: DecisionState = { b: { kind: 'confirmed' } }
    expect(sortQueue(items, checks, decisions).map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('treats an override the same as a confirm for ordering', () => {
    const items = [seedItem('a'), seedItem('b')]
    const checks: CheckState = { a: done('needs_review'), b: done('needs_review') }
    const decisions: DecisionState = {
      a: { kind: 'overridden', corrected: 'looks_correct' },
    }
    expect(sortQueue(items, checks, decisions).map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('does not mutate its input', () => {
    const items = [seedItem('a'), seedItem('b')]
    sortQueue(items, { b: done('problem_found') })
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('status tables', () => {
  it('cover all six states consistently', () => {
    expect(Object.keys(STATUS_RANK).sort()).toEqual(Object.keys(STATUS_LABELS).sort())
    expect(Object.keys(STATUS_RANK)).toHaveLength(6)
    // Checking shares the unchecked rank; that equality is what keeps a card
    // in place while it is being verified.
    expect(STATUS_RANK.checking).toBe(STATUS_RANK.not_yet_checked)
  })
})
