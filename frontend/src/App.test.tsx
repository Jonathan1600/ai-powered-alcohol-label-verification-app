import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./components/QueueScreen', () => ({
  default: () => <p>Review queue placeholder</p>,
}))

describe('App shell', () => {
  it('offers a skip link to the page’s main review content', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(document.querySelector('main#main-content')).toBeInTheDocument()
  })
})
