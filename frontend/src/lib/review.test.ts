// The review view's pure logic: where Next and Previous go, and how the
// backend's diff opcodes become something renderable.

import { describe, expect, it } from 'vitest'

import type { DiffOp, FieldName } from './contracts'
import {
  decisionSummary,
  diffSegments,
  FIELD_LABELS,
  FIELD_VERDICT_LABELS,
  OVERRIDE_CHOICES,
  STATUS_SUMMARY,
  traversal,
} from './review'

const ORDER = ['a', 'b', 'c']

describe('traversal', () => {
  it('reports the position one-based, the way it is read aloud', () => {
    expect(traversal(ORDER, 'b')).toMatchObject({ position: 2, total: 3 })
  })

  it('has no previous at the head and no next at the tail', () => {
    expect(traversal(ORDER, 'a').previousId).toBeNull()
    expect(traversal(ORDER, 'a').nextId).toBe('b')
    expect(traversal(ORDER, 'c').nextId).toBeNull()
    expect(traversal(ORDER, 'c').previousId).toBe('b')
  })

  it('walks a single-item queue with both ends closed', () => {
    expect(traversal(['only'], 'only')).toEqual({
      previousId: null,
      nextId: null,
      position: 1,
      total: 1,
    })
  })

  it('reports position zero for an id outside the snapshot rather than "item 0 of 3"', () => {
    expect(traversal(ORDER, 'missing')).toEqual({
      previousId: null,
      nextId: null,
      position: 0,
      total: 3,
    })
  })
})

describe('diffSegments', () => {
  function op(kind: DiffOp['op'], expected: string, actual: string): DiffOp {
    return { op: kind, expected, actual }
  }

  it('keeps the unchanged runs, so the edits render inside the statutory text', () => {
    const segments = diffSegments([
      op('equal', 'may cause', 'may cause'),
      op('insert', '', 'serious'),
      op('equal', 'health problems', 'health problems'),
    ])
    expect(segments).toEqual([
      { kind: 'unchanged', text: 'may cause' },
      { kind: 'added', text: 'serious' },
      { kind: 'unchanged', text: 'health problems' },
    ])
  })

  it('splits a replacement into the removal and the addition, in that order', () => {
    expect(diffSegments([op('replace', 'may', 'can')])).toEqual([
      { kind: 'removed', text: 'may' },
      { kind: 'added', text: 'can' },
    ])
  })

  it('renders a deletion with nothing added', () => {
    expect(diffSegments([op('delete', 'and may cause health problems', '')])).toEqual([
      { kind: 'removed', text: 'and may cause health problems' },
    ])
  })

  it('drops empty sides rather than emitting blank segments', () => {
    expect(diffSegments([op('equal', '', ''), op('insert', '', 'serious')])).toEqual([
      { kind: 'added', text: 'serious' },
    ])
  })

  it('returns nothing for an empty diff', () => {
    expect(diffSegments([])).toEqual([])
  })
})

describe('copy tables', () => {
  it('label every field the engine can return', () => {
    const engineFields: FieldName[] = [
      'brand_name',
      'class_type',
      'alcohol_content',
      'net_contents',
      'bottler_info',
      'country_of_origin',
      'government_warning',
    ]
    for (const field of engineFields) {
      expect(FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(FIELD_LABELS)).toHaveLength(engineFields.length)
  })

  it('summarise all four outcomes and all three field verdicts', () => {
    expect(Object.keys(STATUS_SUMMARY)).toHaveLength(4)
    expect(Object.keys(FIELD_VERDICT_LABELS)).toHaveLength(3)
  })

  it('never offers unreadable as an override, since it describes the photograph', () => {
    expect(OVERRIDE_CHOICES).not.toContain('unreadable')
    expect(OVERRIDE_CHOICES).toHaveLength(3)
  })
})

describe('decisionSummary', () => {
  it('reads back a confirm and an override in the agent’s own terms', () => {
    expect(decisionSummary({ kind: 'confirmed' })).toContain('confirmed')
    expect(decisionSummary({ kind: 'overridden', corrected: 'problem_found' })).toContain(
      'a problem found',
    )
  })
})
