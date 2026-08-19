import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import QueueCard from './QueueCard'
import { doneCheck, seedItem } from '../test/fixtures'

describe('QueueCard reviewer outcomes', () => {
  it('uses a balanced USWDS queue row and keeps the queue controls available', () => {
    render(
      <QueueCard
        item={seedItem('a')}
        check={undefined}
        decision={undefined}
        selected={false}
        onToggleSelected={vi.fn()}
        onVerify={vi.fn()}
        onOpen={vi.fn()}
        restoreFocus={false}
        onFocusRestored={vi.fn()}
      />,
    )

    const [card] = screen.getAllByRole('listitem').filter((item) => item.classList.contains('usa-card'))
    expect(card).toHaveClass('grid-col-12', 'queue-card')
    expect(card).not.toHaveClass('usa-card--flag')
    expect(screen.getByRole('img')).toHaveClass('queue-card__thumb')
    expect(card.querySelector('.queue-card__selection')).toBeInTheDocument()
    expect(card.querySelector('.queue-card__identity')).toBeInTheDocument()
    expect(card.querySelector('.queue-card__state')).toBeInTheDocument()
    expect(card.querySelector('.queue-card__actions')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /select.*TTB/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /verify label/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open the review/i })).toBeInTheDocument()
  })

  it('shows the reviewer outcome instead of the raw system status', () => {
    render(
      <QueueCard
        item={seedItem('a')}
        check={doneCheck('problem_found')}
        decision={{ outcome: 'accepted' }}
        selected={false}
        onToggleSelected={vi.fn()}
        onVerify={vi.fn()}
        onOpen={vi.fn()}
        restoreFocus={false}
        onFocusRestored={vi.fn()}
      />,
    )

    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.queryByText('Problem found')).not.toBeInTheDocument()
  })
})
