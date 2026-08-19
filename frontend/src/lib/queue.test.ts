// The sort and state-derivation contract for the queue screen: attention
// needed first, deterministic within a rank, and a card that never moves just
// because Verify was pressed.

import { describe, expect, it } from 'vitest'

import type { SeedQueueItem, VerificationResult } from './contracts'
import {
  cardStatus,
  checksReducer,
  sortQueue,
  STATUS_LABELS,
  STATUS_RANK,
  type CheckState,
} from './queue'

function item(id: string): SeedQueueItem {
  return {
    id,
    application_reference: `TTB-2026-${id}`,
    brand_name: `Brand ${id}`,
    status: 'not_yet_checked',
    image_url: `/api/seed/images/${id}.png`,
    thumbnail_url: `/api/seed/thumbnails/${id}.jpg`,
    application: {
      brand_name: `Brand ${id}`,
      class_type: 'Vodka',
      alcohol_content: '40% alc/vol',
      net_contents: '750 mL',
      bottler_info: 'Bottled by Example Co, Portland, OR',
      beverage_class: 'distilled_spirits',
      is_import: false,
    },
  }
}

function done(status: VerificationResult['status']): CheckState[string] {
  return { phase: 'done', result: { status, fields: [], unreadable_reason: null } }
}

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
    const items = [item('a'), item('b'), item('c'), item('d'), item('e')]
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
    const items = [item('a'), item('b'), item('c')]
    expect(sortQueue(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not move a card when Verify is pressed', () => {
    const items = [item('a'), item('b'), item('c')]
    const before = sortQueue(items, {}).map((i) => i.id)
    const after = sortQueue(items, { b: { phase: 'checking' } }).map((i) => i.id)
    expect(after).toEqual(before)
  })

  it('moves exactly the item whose verdict arrived', () => {
    const items = [item('a'), item('b'), item('c')]
    const sorted = sortQueue(items, { b: done('problem_found') }).map((i) => i.id)
    expect(sorted).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate its input', () => {
    const items = [item('a'), item('b')]
    sortQueue(items, { b: done('problem_found') })
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('checksReducer', () => {
  it('records each action against its item id', () => {
    let state: CheckState = {}
    state = checksReducer(state, { type: 'verify-started', id: 'a' })
    expect(state.a).toEqual({ phase: 'checking' })

    const result: VerificationResult = { status: 'looks_correct', fields: [], unreadable_reason: null }
    state = checksReducer(state, { type: 'verify-succeeded', id: 'a', result })
    expect(state.a).toEqual({ phase: 'done', result })

    state = checksReducer(state, {
      type: 'verify-failed',
      id: 'a',
      error: { kind: 'network', message: 'offline' },
    })
    expect(state.a).toEqual({ phase: 'failed', error: { kind: 'network', message: 'offline' } })
  })

  it('leaves unrelated items untouched and never mutates the previous state', () => {
    const initial: CheckState = { a: { phase: 'checking' } }
    const next = checksReducer(initial, { type: 'verify-started', id: 'b' })
    expect(next).not.toBe(initial)
    expect(next.a).toBe(initial.a)
    expect(initial.b).toBeUndefined()
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
