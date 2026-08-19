import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import QueueCard from './QueueCard'
import { doneCheck, seedItem } from '../test/fixtures'

describe('QueueCard reviewer outcomes', () => {
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
