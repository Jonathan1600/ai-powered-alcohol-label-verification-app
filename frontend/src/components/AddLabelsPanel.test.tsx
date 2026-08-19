import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import AddLabelsPanel from './AddLabelsPanel'

const { ingestLabels } = vi.hoisted(() => ({ ingestLabels: vi.fn() }))

vi.mock('../lib/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ingest')>()
  return { ...actual, ingestLabels }
})

describe('AddLabelsPanel errors', () => {
  it('moves focus to an unexpected preparation failure so the corrective message is announced', async () => {
    ingestLabels.mockRejectedValueOnce(new Error('The selected files could not be read.'))
    const user = userEvent.setup()

    render(
      <AddLabelsPanel existingReferences={[]} onIngested={vi.fn()} onClose={vi.fn()} />,
    )

    await user.upload(
      screen.getByLabelText('Label images'),
      new File(['image'], 'label.png', { type: 'image/png' }),
    )
    await user.upload(
      screen.getByLabelText('Application records'),
      new File(['image\nlabel.png'], 'applications.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add 1 labels' }))

    const heading = await screen.findByRole('heading', { name: 'Nothing was added' })
    expect(screen.getByText('The selected files could not be read.')).toBeInTheDocument()
    await waitFor(() => expect(heading.parentElement).toHaveFocus())
  })
})
