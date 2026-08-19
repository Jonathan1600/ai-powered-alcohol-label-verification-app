import { useEffect, useRef } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardMedia,
  Icon,
} from '@trussworks/react-uswds'

import { API_BASE_URL, type VerifyFailure } from '../lib/api'
import type { SeedQueueItem } from '../lib/contracts'
import { cardStatus, type ItemCheck } from '../lib/queue'
import StatusTag from './StatusTag'

interface QueueCardProps {
  item: SeedQueueItem
  check: ItemCheck | undefined
  onVerify: (item: SeedQueueItem) => void
}

const UNREADABLE_REASONS: Record<string, string> = {
  glare: 'Glare hides part of the label.',
  angle: 'The label was photographed at too steep an angle.',
  blur: 'The image is too blurred to read.',
  resolution: 'The image resolution is too low to read.',
}

// A failure is never a statement about the label, so this copy never asks for a
// better photograph the way an unreadable verdict does (ADR-012). Only the
// rejected path shows the server text, which is written for this audience;
// provider and network failures would otherwise leak browser internals like
// "Failed to fetch" or "signal timed out".
function failureMessage(failure: VerifyFailure): string {
  switch (failure.kind) {
    case 'provider':
      return 'The verification service had a problem. This is not a result. Try again.'
    case 'network':
      return 'Could not reach the verification service. Check your connection and try again.'
    case 'rejected':
      return `This label could not be sent for verification. ${failure.message}`
  }
}

function QueueCard({ item, check, onVerify }: QueueCardProps) {
  const status = cardStatus(check)
  const checking = status === 'checking'
  const failure = check?.phase === 'failed' ? check.error : null
  const unreadable = check?.phase === 'done' && check.result.status === 'unreadable'
  const unreadableReason = unreadable ? check.result.unreadable_reason : null
  // The action is offered until a verdict exists; a failure leaves the item
  // unchecked, so the button comes back for a retry.
  const showAction = status === 'not_yet_checked' || checking

  const headingRef = useRef<HTMLHeadingElement>(null)
  // Whether the button held focus when it was pressed, recorded in the click
  // handler itself. Focus events are not usable here: they do not fire while
  // the document is unfocused, and the button is gone by the time a blur
  // would help.
  const buttonHadFocus = useRef(false)

  useEffect(() => {
    if (showAction || !buttonHadFocus.current) return
    buttonHadFocus.current = false
    // The button left the DOM while it held focus, so the browser has dropped
    // focus to <body>. Anchor the user to this card rather than the top of a
    // 44-card document. If focus has since moved somewhere real, leave it be.
    if (document.activeElement === document.body || document.activeElement === null) {
      headingRef.current?.focus()
    }
  }, [showAction])

  return (
    <Card gridLayout={{ tablet: { col: 6 }, desktop: { col: 4 } }}>
      <CardHeader>
        <h2 className="usa-card__heading font-heading-lg" tabIndex={-1} ref={headingRef}>
          {item.brand_name}
        </h2>
      </CardHeader>
      <CardMedia>
        <img
          src={API_BASE_URL + item.thumbnail_url}
          alt={`Label photograph for ${item.brand_name}, ${item.application_reference}`}
          loading="lazy"
          className="queue-card__thumb"
        />
      </CardMedia>
      <CardBody>
        <p className="margin-top-0 margin-bottom-1 text-base-dark">{item.application_reference}</p>
        <StatusTag status={status} />
        {/* The guidance is unconditional: the backend may report an unreadable
            image without naming a defect, and that is the state where the
            instruction matters most. */}
        {unreadable && (
          <p className="margin-bottom-0 font-body-sm text-base-dark">
            {unreadableReason ? `${UNREADABLE_REASONS[unreadableReason]} ` : ''}A better photograph
            is needed.
          </p>
        )}
        {failure && (
          <p className="margin-bottom-0 font-body-sm text-secondary-dark">
            <Icon.Error aria-hidden className="margin-right-05 text-middle" />
            {failureMessage(failure)}
          </p>
        )}
      </CardBody>
      {showAction && (
        <CardFooter>
          {/* aria-disabled rather than disabled: disabling the element that
              currently has focus makes the browser blur it, and that element is
              exactly where a keyboard user is standing when they press Verify. */}
          <Button
            type="button"
            className={`width-full${checking ? ' usa-button--disabled' : ''}`}
            aria-disabled={checking}
            aria-label={`Verify label for ${item.brand_name}, ${item.application_reference}`}
            onClick={(event) => {
              if (checking) return
              buttonHadFocus.current = document.activeElement === event.currentTarget
              onVerify(item)
            }}
          >
            {checking ? 'Checking…' : 'Verify'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export default QueueCard
