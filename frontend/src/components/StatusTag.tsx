import type { ComponentType } from 'react'
import { Icon, Tag } from '@trussworks/react-uswds'
import type { IconProps } from '@trussworks/react-uswds'

import { STATUS_LABELS, type CardStatus } from '../lib/queue'

// Every badge pairs an icon and a text label with its color, so status is
// never conveyed by color alone. Tokens are USWDS utility classes chosen for
// contrast: -dark backgrounds carry white text, light ones carry ink.
const STATUS_STYLES: Record<CardStatus, { className: string; Glyph: ComponentType<IconProps>; spin?: boolean }> = {
  problem_found: { className: 'bg-secondary-dark text-white', Glyph: Icon.Error },
  needs_review: { className: 'bg-gold text-ink', Glyph: Icon.Flag },
  unreadable: { className: 'bg-base-dark text-white', Glyph: Icon.VisibilityOff },
  looks_correct: { className: 'bg-success-dark text-white', Glyph: Icon.CheckCircle },
  checking: { className: 'bg-primary-lighter text-ink', Glyph: Icon.Autorenew, spin: true },
  not_yet_checked: { className: 'bg-base-lightest text-ink', Glyph: Icon.Schedule },
}

function StatusTag({ status }: { status: CardStatus }) {
  const { className, Glyph, spin } = STATUS_STYLES[status]
  return (
    <Tag
      className={`display-inline-flex flex-align-center text-no-uppercase font-body-sm padding-y-05 padding-x-1 ${className}`}
    >
      <Glyph aria-hidden className={`margin-right-05${spin ? ' queue-spin' : ''}`} />
      {STATUS_LABELS[status]}
    </Tag>
  )
}

export default StatusTag
