import type { ComponentType } from 'react'
import { Icon, Tag } from '@trussworks/react-uswds'
import type { IconProps } from '@trussworks/react-uswds'

import type { FieldVerdict } from '../lib/contracts'
import { STATUS_LABELS, type CardStatus } from '../lib/queue'
import { FIELD_VERDICT_LABELS } from '../lib/review'

interface TagStyle {
  className: string
  Glyph: ComponentType<IconProps>
  spin?: boolean
}

const TAG_CLASSES =
  'display-inline-flex flex-align-center text-no-uppercase font-body-sm padding-y-05 padding-x-1'

// Every badge pairs an icon and a text label with its color, so status is
// never conveyed by color alone. Tokens are USWDS utility classes chosen for
// contrast: -dark backgrounds carry white text, light ones carry ink.
const STATUS_STYLES: Record<CardStatus, TagStyle> = {
  problem_found: { className: 'bg-secondary-dark text-white', Glyph: Icon.Error },
  needs_review: { className: 'bg-gold text-ink', Glyph: Icon.Flag },
  unreadable: { className: 'bg-base-dark text-white', Glyph: Icon.VisibilityOff },
  looks_correct: { className: 'bg-success-dark text-white', Glyph: Icon.CheckCircle },
  checking: { className: 'bg-primary-lighter text-ink', Glyph: Icon.Autorenew, spin: true },
  not_yet_checked: { className: 'bg-base-lightest text-ink', Glyph: Icon.Schedule },
}

// The three field verdicts borrow the item-level colors deliberately: a
// mismatched field and a problem-found item look the same because they mean the
// same thing at two scales. One vocabulary across both screens (continuity).
const FIELD_VERDICT_STYLES: Record<FieldVerdict, TagStyle> = {
  match: { className: 'bg-success-dark text-white', Glyph: Icon.CheckCircle },
  needs_review: { className: 'bg-gold text-ink', Glyph: Icon.Flag },
  mismatch: { className: 'bg-secondary-dark text-white', Glyph: Icon.Error },
}

function StatusTag({ status }: { status: CardStatus }) {
  const { className, Glyph, spin } = STATUS_STYLES[status]
  return (
    <Tag className={`${TAG_CLASSES} ${className}`}>
      <Glyph aria-hidden className={`margin-right-05${spin ? ' queue-spin' : ''}`} />
      {STATUS_LABELS[status]}
    </Tag>
  )
}

export function FieldVerdictTag({ verdict }: { verdict: FieldVerdict }) {
  const { className, Glyph } = FIELD_VERDICT_STYLES[verdict]
  return (
    <Tag className={`${TAG_CLASSES} ${className}`}>
      <Glyph aria-hidden className="margin-right-05" />
      {FIELD_VERDICT_LABELS[verdict]}
    </Tag>
  )
}

export default StatusTag
