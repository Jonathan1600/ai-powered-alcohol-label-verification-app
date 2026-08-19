import { render, screen, waitFor } from '@testing-library/react'
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

const navigationQueue: SeedQueueResponse = {
  count: 3,
  items: ['First Label', 'Second Label', 'Third Label'].map((brand_name, index) => ({
    ...queue.items[0],
    id: `navigation-${index + 1}`,
    application_reference: `TTB-2026-NAV-${index + 1}`,
    brand_name,
    application: { ...queue.items[0].application, brand_name },
  })),
}

describe('QueueScreen loading recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('lets an agent retry a failed queue load without reloading the page', async () => {
    getSeedQueue.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(queue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    expect(await screen.findByRole('heading', { name: 'Backend unreachable' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Retry Label')).toBeInTheDocument()
    const queueList = document.querySelector<HTMLElement>('.queue-list')
    expect(queueList).toBeInTheDocument()
    expect(queueList?.querySelectorAll(':scope > .queue-card')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Backend unreachable' })).not.toBeInTheDocument()
    expect(getSeedQueue).toHaveBeenCalledTimes(2)
  })
})

describe('QueueScreen review history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('returns to the dashboard with Back and reopens the review with Forward', async () => {
    getSeedQueue.mockResolvedValueOnce(queue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    const openButton = await screen.findByRole('button', {
      name: 'Open the review for Retry Label, TTB-2026-RETRY',
    })
    await user.click(openButton)

    expect(await screen.findByRole('heading', { level: 1, name: 'Retry Label' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('review')).toBe('retry-item')

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry Label' })).toHaveFocus())

    window.history.forward()
    const reviewHeading = await screen.findByRole('heading', { level: 1, name: 'Retry Label' })
    expect(reviewHeading).toHaveFocus()
  })

  it('keeps Previous and Next inside one history entry', async () => {
    getSeedQueue.mockResolvedValueOnce(navigationQueue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    await user.click(
      await screen.findByRole('button', {
        name: 'Open the review for Second Label, TTB-2026-NAV-2',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Next application' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Third Label' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('review')).toBe('navigation-3')

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument()
  })

  it('opens a direct review URL and lets its in-app back arrow return to the dashboard', async () => {
    window.history.replaceState(null, '', '/?review=retry-item')
    getSeedQueue.mockResolvedValueOnce(queue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Retry Label' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Back to the queue/ }))

    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).has('review')).toBe(false)
  })

  it('returns to the dashboard from a review when Escape is pressed', async () => {
    getSeedQueue.mockResolvedValueOnce(queue)
    const user = userEvent.setup()

    render(<QueueScreen />)

    await user.click(
      await screen.findByRole('button', {
        name: 'Open the review for Retry Label, TTB-2026-RETRY',
      }),
    )
    await user.keyboard('{Escape}')

    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).has('review')).toBe(false)
  })

  it('normalizes an unknown review URL to the dashboard', async () => {
    window.history.replaceState(null, '', '/?review=missing-item')
    getSeedQueue.mockResolvedValueOnce(queue)

    render(<QueueScreen />)

    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument()
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('review')).toBe(false))
  })
})
