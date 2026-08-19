/**
 * The review view as an agent meets it.
 *
 * These render the real component rather than testing its helpers, because the
 * things worth pinning here are the things a pure function cannot see: that an
 * unchecked item does not pretend to have compared anything, that a decision
 * cannot be recorded without saying what it is, and that focus lands somewhere
 * useful when the agent moves through the stack.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ReviewScreen from './ReviewScreen'
import type { DiffOp } from '../lib/contracts'
import type { ItemCheck } from '../lib/session'
import {
  doneCheck,
  fieldResult,
  seedItem,
  verificationResult,
  verifyResponse,
} from '../test/fixtures'

const ORDER = ['a', 'b', 'c']

function renderReview(overrides: Partial<React.ComponentProps<typeof ReviewScreen>> = {}) {
  const props = {
    item: seedItem('b'),
    check: undefined as ItemCheck | undefined,
    decision: undefined,
    order: ORDER,
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onVerify: vi.fn(),
    onDecide: vi.fn(),
    onClearDecision: vi.fn(),
    ...overrides,
  }
  render(<ReviewScreen {...props} />)
  return props
}

describe('states', () => {
  it('offers verification and claims no comparison on an unchecked item', async () => {
    const props = renderReview()

    expect(screen.getByRole('heading', { name: 'Not checked yet' })).toBeInTheDocument()
    // The application's own values are visible; the label column is not.
    expect(screen.getByText('40% alc/vol')).toBeInTheDocument()
    expect(screen.getAllByText('Not checked yet').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Awaiting verification').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Verify this label' }))
    expect(props.onVerify).toHaveBeenCalledWith(props.item)
  })

  it('requests the label image in CORS mode, because Verify fetches the same URL', () => {
    // A plain <img> is a no-cors request. The browser caches that response and
    // then hands it to the CORS fetch inside verifyLabel, which sees no
    // Access-Control-Allow-Origin and fails. Both requests must agree on the
    // mode or opening an item breaks verifying it.
    renderReview()
    const image = screen.getByRole('img', { name: /Label photograph/ })
    expect(image).toHaveAttribute('crossorigin', 'anonymous')
  })

  it('says a verification is running rather than showing a stale table', () => {
    renderReview({ check: { phase: 'checking' } })
    expect(screen.getByText(/Checking this label against the application/)).toBeInTheDocument()
  })

  it('reports a failure as something to retry, never as a verdict', () => {
    renderReview({ check: { phase: 'failed', error: { kind: 'provider', message: 'boom' } } })

    expect(screen.getByText(/This is not a result/)).toBeInTheDocument()
    // No banner: a provider failure says nothing about the label (ADR-012).
    expect(screen.queryByRole('heading', { name: 'Problem found' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify this label' })).toBeInTheDocument()
  })

  it('shows the verdict, every field reason, and the decision controls', () => {
    renderReview({
      check: doneCheck('problem_found', [
        fieldResult('brand_name', 'match'),
        fieldResult('alcohol_content', 'mismatch', {
          claimed: '40% alc/vol',
          extracted: '45% alc/vol',
          reason: 'The application says 40% but the label reads 45%.',
        }),
      ]),
    })

    expect(screen.getByRole('heading', { name: 'Problem found' })).toBeInTheDocument()
    expect(screen.getByText('45% alc/vol')).toBeInTheDocument()
    expect(
      screen.getByText('The application says 40% but the label reads 45%.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Record your decision' })).toBeInTheDocument()
  })

  it('asks for a better photograph on an unreadable label and compares nothing', () => {
    renderReview({
      check: {
        phase: 'done',
        response: verifyResponse('unreadable', [], {
          result: verificationResult('unreadable', { unreadable_reason: 'glare' }),
        }),
      },
    })

    expect(screen.getByRole('heading', { name: 'Unreadable' })).toBeInTheDocument()
    expect(screen.getByText(/Glare hides part of the label/)).toBeInTheDocument()
    // Nothing was compared, so there is no comparison to show.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders the word-level diff when the warning wording failed', () => {
    const diff: DiffOp[] = [
      { op: 'equal', expected: 'may cause', actual: 'may cause' },
      { op: 'replace', expected: 'health problems', actual: 'serious health problems' },
    ]
    renderReview({
      check: doneCheck('problem_found', [
        fieldResult('government_warning', 'mismatch', { diff, extracted: 'GOVERNMENT WARNING…' }),
      ]),
    })

    const diffSection = screen.getByRole('region', { name: 'Where the wording differs' })
    expect(within(diffSection).getByText('health problems')).toBeInTheDocument()
    expect(within(diffSection).getByText('serious health problems')).toBeInTheDocument()
    // The table defers to the block rather than printing 50 words in a cell.
    expect(screen.getByText(/See the comparison below/)).toBeInTheDocument()
  })
})

describe('moving through the queue', () => {
  it('reports the position and walks to the neighbouring items', async () => {
    const props = renderReview()
    expect(screen.getByText('Application 2 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next application' }))
    expect(props.onNavigate).toHaveBeenCalledWith('c')

    await userEvent.click(screen.getByRole('button', { name: 'Previous application' }))
    expect(props.onNavigate).toHaveBeenCalledWith('a')
  })

  it('closes both ends of the queue', () => {
    renderReview({ item: seedItem('a') })
    expect(screen.getByRole('button', { name: 'Previous application' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next application' })).toBeEnabled()
  })

  it('puts focus on the heading so a move announces where it landed', () => {
    renderReview()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('returns to the queue on Escape and on the back control', async () => {
    const props = renderReview()

    await userEvent.click(screen.getByRole('button', { name: /Back to the queue/ }))
    expect(props.onBack).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(props.onBack).toHaveBeenCalledTimes(2)
  })
})

describe('recording a decision', () => {
  const checked = doneCheck('problem_found', [fieldResult('brand_name', 'mismatch')])

  it('confirms the recommendation in one click', async () => {
    const props = renderReview({ check: checked })

    await userEvent.click(screen.getByRole('button', { name: /^Confirm/ }))
    expect(props.onDecide).toHaveBeenCalledWith('b', { kind: 'confirmed' })
  })

  it('refuses to save an override that does not say what is correct', async () => {
    const props = renderReview({ check: checked })

    await userEvent.click(screen.getByRole('button', { name: 'I disagree' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }))

    expect(props.onDecide).not.toHaveBeenCalled()
    expect(screen.getByText('Choose the result you believe is correct.')).toBeInTheDocument()
    // Focus goes to the choices, not nowhere.
    expect(screen.getByRole('radio', { name: 'Looks correct' })).toHaveFocus()
  })

  it('records the corrected status and the note, which is the accuracy signal', async () => {
    const props = renderReview({ check: checked })

    await userEvent.click(screen.getByRole('button', { name: 'I disagree' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Looks correct' }))
    await userEvent.type(screen.getByLabelText(/Note/), 'The ABV difference is a rounding artefact.')
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }))

    expect(props.onDecide).toHaveBeenCalledWith('b', {
      kind: 'overridden',
      corrected: 'looks_correct',
      note: 'The ABV difference is a rounding artefact.',
    })
  })

  it('reads a recorded decision back and offers to change it', async () => {
    const props = renderReview({
      check: checked,
      decision: { kind: 'overridden', corrected: 'looks_correct', note: 'Checked by hand.' },
    })

    expect(screen.getByRole('heading', { name: /Decision recorded/ })).toBeInTheDocument()
    expect(screen.getByText(/looks correct/)).toBeInTheDocument()
    expect(screen.getByText(/Checked by hand\./)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Change this decision' }))
    expect(props.onClearDecision).toHaveBeenCalledWith('b')
  })
})
