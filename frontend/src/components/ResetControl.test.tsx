/**
 * The reset control's one rule: ask before destroying work, and only then.
 *
 * A confirmation on an untouched queue is not a harmless extra click. It trains
 * an evaluator to dismiss the dialog without reading it, which is exactly the
 * habit that makes the real one useless (approach.md section 5.9).
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import ResetControl from './ResetControl'

// jsdom performs no layout, so every element measures zero and the modal's
// focus trap concludes it has nothing to trap and throws. Giving elements a
// non-zero box is the narrowest fix; it changes nothing the tests assert on.
// The trap itself is wrapper behaviour and is checked in a real browser.
beforeAll(() => {
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList
  }
})

describe('ResetControl', () => {
  it('resets immediately when there is nothing to lose', async () => {
    const onReset = vi.fn()
    render(<ResetControl hasWork={false} onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: /Reset the demo/ }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Reset the demo?' })).not.toBeInTheDocument()
  })

  it('confirms first when verifications or decisions exist', async () => {
    const onReset = vi.fn()
    render(<ResetControl hasWork onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: /Reset the demo/ }))
    expect(onReset).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Reset the demo?' })).toBeInTheDocument()
    // The dialog says what is lost and that it cannot be recovered.
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Yes, reset the demo' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('keeps the work when the agent backs out', async () => {
    const onReset = vi.fn()
    render(<ResetControl hasWork onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: /Reset the demo/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep my work' }))

    expect(onReset).not.toHaveBeenCalled()
  })
})
