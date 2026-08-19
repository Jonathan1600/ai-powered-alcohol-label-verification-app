/**
 * The diff's job is evidence: show the statutory text and mark exactly where
 * the label departs from it. Colour is the part of that which some readers will
 * not get, so the elements and the hidden labels are what these tests pin.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import WarningDiff from './WarningDiff'
import type { DiffOp } from '../lib/contracts'

const ALTERED: DiffOp[] = [
  { op: 'equal', expected: 'Consumption of alcoholic beverages', actual: 'Consumption of alcoholic beverages' },
  { op: 'replace', expected: 'may', actual: 'can' },
  { op: 'equal', expected: 'cause health problems.', actual: 'cause health problems.' },
]

describe('WarningDiff', () => {
  it('keeps the unchanged statutory text around the change', () => {
    render(<WarningDiff diff={ALTERED} />)
    expect(screen.getByText('Consumption of alcoholic beverages')).toBeInTheDocument()
    expect(screen.getByText('cause health problems.')).toBeInTheDocument()
  })

  it('marks the removal and the addition with real del and ins elements', () => {
    const { container } = render(<WarningDiff diff={ALTERED} />)

    const removed = container.querySelector('.review-diff del')
    const added = container.querySelector('.review-diff ins')
    expect(removed).toHaveTextContent('may')
    expect(added).toHaveTextContent('can')
  })

  it('names each edit for a screen reader, so the meaning is not the colour', () => {
    render(<WarningDiff diff={ALTERED} />)
    expect(screen.getByText('removed:')).toBeInTheDocument()
    expect(screen.getByText('label says:')).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<WarningDiff diff={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
