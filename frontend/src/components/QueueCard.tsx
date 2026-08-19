import { useEffect, useRef } from 'react'
import {
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardMedia,
  Checkbox,
  Icon,
  Tag,
} from '@trussworks/react-uswds'

import type { QueueItem } from '../lib/contracts'
import { cardStatus } from '../lib/queue'
import { DECISION_LABELS, failureMessage, unreadableGuidance } from '../lib/review'
import type { Decision, ItemCheck } from '../lib/session'
import StatusTag from './StatusTag'

interface QueueCardProps {
  item: QueueItem
  check: ItemCheck | undefined
  decision: Decision | undefined
  selected: boolean
  onToggleSelected: (id: string) => void
  onVerify: (item: QueueItem) => void
  onOpen: (item: QueueItem) => void
  // True for the card the agent just came back from, so focus lands where they
  // left rather than at the top of a 44-card document.
  restoreFocus: boolean
  onFocusRestored: () => void
}

function QueueCard({
  item,
  check,
  decision,
  selected,
  onToggleSelected,
  onVerify,
  onOpen,
  restoreFocus,
  onFocusRestored,
}: QueueCardProps) {
  const status = cardStatus(check)
  // Queued and checking are both "hands off": one is waiting for the pool, the
  // other is in it, and neither should take a second Verify.
  const busy = status === 'checking' || status === 'queued'
  const failure = check?.phase === 'failed' ? check.error : null
  const result = check?.phase === 'done' ? check.response.result : null
  const unreadable = result?.status === 'unreadable'
  const unreadableReason = unreadable ? result.unreadable_reason : null
  // The action is offered until a verdict exists; a failure leaves the item
  // unchecked, so the button comes back for a retry.
  const showVerify = status === 'not_yet_checked' || busy

  const headingRef = useRef<HTMLHeadingElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  // Whether the button held focus when it was pressed, recorded in the click
  // handler itself. Focus events are not usable here: they do not fire while
  // the document is unfocused, and the button is gone by the time a blur
  // would help.
  const buttonHadFocus = useRef(false)

  useEffect(() => {
    if (showVerify || !buttonHadFocus.current) return
    buttonHadFocus.current = false
    // The button left the DOM while it held focus, so the browser has dropped
    // focus to <body>. Anchor the user to this card rather than the top of a
    // 44-card document. If focus has since moved somewhere real, leave it be.
    if (document.activeElement === document.body || document.activeElement === null) {
      headingRef.current?.focus()
    }
  }, [showVerify])

  useEffect(() => {
    if (!restoreFocus) return
    openRef.current?.focus()
    onFocusRestored()
  }, [restoreFocus, onFocusRestored])

  return (
    <Card gridLayout={{ tablet: { col: 6 }, desktop: { col: 4 } }}>
      <CardHeader>
        <h2 className="usa-card__heading font-heading-lg" tabIndex={-1} ref={headingRef}>
          {/* The heading is the primary way into an item, which is what a card
              grid leads a mouse user to click. A real button keeps it one tab
              stop with an accessible name that already reads as the item. */}
          <button
            type="button"
            ref={openRef}
            className="usa-button usa-button--unstyled text-no-underline text-left"
            onClick={() => onOpen(item)}
          >
            {item.brand_name}
          </button>
        </h2>
      </CardHeader>
      <CardMedia>
        <img
          src={item.thumbnailUrl}
          alt={`Label photograph for ${item.brand_name}, ${item.application_reference}`}
          loading="lazy"
          className="queue-card__thumb"
        />
      </CardMedia>
      <CardBody>
        <p className="margin-top-0 margin-bottom-1 text-base-dark">{item.application_reference}</p>
        {/* The visible word stays "Select" so 44 cards do not each shout their
            own brand name down the page, while the hidden half gives the
            checkbox an accessible name that identifies it in a screen reader's
            form-controls list. Both live inside the one label, so the visible
            text is a prefix of the accessible name and WCAG 2.5.3 holds. */}
        <Checkbox
          id={`select-${item.id}`}
          name="queue-selection"
          className="margin-bottom-1"
          checked={selected}
          onChange={() => onToggleSelected(item.id)}
          label={
            <>
              Select
              <span className="usa-sr-only">
                {' '}
                {item.brand_name}, {item.application_reference}
              </span>
            </>
          }
        />
        <div className="display-flex flex-wrap flex-align-center margin-bottom-05">
          <StatusTag status={status} />
          {decision && (
            <Tag className="display-inline-flex flex-align-center text-no-uppercase font-body-sm padding-y-05 padding-x-1 margin-left-1 bg-white border border-base text-ink">
              <Icon.Check aria-hidden className="margin-right-05" />
              {DECISION_LABELS[decision.kind]}
            </Tag>
          )}
        </div>
        {unreadable && (
          <p className="margin-bottom-0 font-body-sm text-base-dark">
            {unreadableGuidance(unreadableReason)}
          </p>
        )}
        {failure && (
          <p className="margin-bottom-0 font-body-sm text-secondary-dark">
            <Icon.Error aria-hidden className="margin-right-05 text-middle" />
            {failureMessage(failure)}
          </p>
        )}
      </CardBody>
      <CardFooter>
        <ButtonGroup>
          {showVerify && (
            // aria-disabled rather than disabled: disabling the element that
            // currently has focus makes the browser blur it, and that element is
            // exactly where a keyboard user is standing when they press Verify.
            <Button
              type="button"
              className={busy ? 'usa-button--disabled' : undefined}
              aria-disabled={busy}
              aria-label={`Verify label for ${item.brand_name}, ${item.application_reference}`}
              onClick={(event) => {
                if (busy) return
                buttonHadFocus.current = document.activeElement === event.currentTarget
                onVerify(item)
              }}
            >
              {status === 'queued' ? 'Queued' : status === 'checking' ? 'Checking…' : 'Verify'}
            </Button>
          )}
          <Button
            type="button"
            outline
            aria-label={`Open the review for ${item.brand_name}, ${item.application_reference}`}
            onClick={() => onOpen(item)}
          >
            Open review
          </Button>
        </ButtonGroup>
      </CardFooter>
    </Card>
  )
}

export default QueueCard
