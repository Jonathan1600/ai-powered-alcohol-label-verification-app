import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SeedQueueResponse } from '../lib/contracts'
import QueueScreen from './QueueScreen'

const { getSeedQueue } = vi.hoisted(() => ({ getSeedQueue: vi.fn() }))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getSeedQueue }
})

const queue: SeedQueueResponse = {
  count: 1,
  items: [
    {
      id: 'retry-item',
      application_reference: 'TTB-2026-RETRY',
      brand_name: 'Retry Label',
      application: {
        brand_name: 'Retry Label',
        class_type: 'Vodka',
        alcohol_content: '40% alc/vol',
        net_contents: '750 mL',
        bottler_info: 'Bottled by Example Co, Portland, OR',
        beverage_class: 'distilled_spirits',
        is_import: false,
      },
      image_url: '/api/seed/images/retry-item.png',
      thumbnail_url: '/api/seed/thumbnails/retry-item.jpg',
      status: 'not_yet_checked',
    },
  ],
}

describe('QueueScreen loading recovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets an agent retry a failed queue load without reloading the page', async () => {
    getSeedQueue.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(queue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    expect(await screen.findByRole('heading', { name: 'Backend unreachable' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Retry Label')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Backend unreachable' })).not.toBeInTheDocument()
    expect(getSeedQueue).toHaveBeenCalledTimes(2)
  })
})
