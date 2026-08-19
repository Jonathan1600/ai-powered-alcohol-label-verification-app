import { useEffect, useRef } from 'react'
import { Button, ButtonGroup, Grid, GridContainer, Icon } from '@trussworks/react-uswds'

import { API_BASE_URL } from '../lib/api'
import type { SeedQueueItem } from '../lib/contracts'
import { cardStatus } from '../lib/queue'
import {
  failureMessage,
  rowsFromApplication,
  rowsFromResult,
  traversal,
  unreadableGuidance,
} from '../lib/review'
import type { Decision, ItemCheck } from '../lib/session'
import ComparisonTable from './ComparisonTable'
import DecisionBar from './DecisionBar'
import StatusBanner from './StatusBanner'
import WarningDiff from './WarningDiff'

interface ReviewScreenProps {
  item: SeedQueueItem
  check: ItemCheck | undefined
  decision: Decision | undefined
  // A snapshot of the queue order taken when this view opened, so working an
  // item never resorts the stack underneath the agent. See lib/review.ts.
  order: string[]
  onNavigate: (id: string) => void
  onBack: () => void
  onVerify: (item: SeedQueueItem) => void
  onDecide: (id: string, decision: Decision) => void
  onClearDecision: (id: string) => void
}

function ReviewScreen({
  item,
  check,
  decision,
  order,
  onNavigate,
  onBack,
  onVerify,
  onDecide,
  onClearDecision,
}: ReviewScreenProps) {
  const status = cardStatus(check)
  const result = check?.phase === 'done' ? check.result : null
  const failure = check?.phase === 'failed' ? check.error : null
  const { previousId, nextId, position, total } = traversal(order, item.id)

  const headingRef = useRef<HTMLHeadingElement>(null)

  // Focus the heading on arrival and on every move through the stack. Without
  // it, Next leaves focus on a button that now describes a different item and a
  // screen reader user hears nothing about where they landed.
  useEffect(() => {
    headingRef.current?.focus()
  }, [item.id])

  // Escape returns to the queue, matching every other layered view a user of
  // government services will have met.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onBack])

  const warningRow = result?.fields.find((field) => field.field === 'government_warning')

  // Rendered twice, above and below the comparison, so an agent who has read to
  // the end of a long table does not scroll back up to move on. The two copies
  // carry different accessible names so a screen reader's element list does not
  // show the same control twice.
  //
  // These are genuinely `disabled` rather than `aria-disabled` as elsewhere in
  // the app: every navigation moves focus to the heading, so a button that
  // becomes disabled at the end of the queue is never the element holding
  // focus when it happens.
  function navigation(placement: 'top' | 'bottom') {
    return (
      <ButtonGroup>
        <Button
          type="button"
          outline
          disabled={!previousId}
          onClick={() => previousId && onNavigate(previousId)}
          aria-label={`Previous application${placement === 'bottom' ? ' in the queue' : ''}`}
        >
          <Icon.NavigateBefore aria-hidden className="margin-right-05 text-middle" />
          Previous
        </Button>
        <Button
          type="button"
          outline
          disabled={!nextId}
          onClick={() => nextId && onNavigate(nextId)}
          aria-label={`Next application${placement === 'bottom' ? ' in the queue' : ''}`}
        >
          Next
          <Icon.NavigateNext aria-hidden className="margin-left-05 text-middle" />
        </Button>
      </ButtonGroup>
    )
  }

  return (
    <GridContainer containerSize="widescreen" className="padding-y-3">
      <div className="display-flex flex-justify flex-align-center flex-wrap margin-bottom-2">
        <Button type="button" unstyled onClick={onBack}>
          <Icon.ArrowBack aria-hidden className="margin-right-05 text-middle" />
          Back to the queue
        </Button>
        <p className="margin-0 text-base-dark">
          Application {position} of {total}
        </p>
        {navigation('top')}
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="margin-bottom-05">
        {item.brand_name}
      </h1>
      <p className="margin-top-0 font-body-lg text-base-dark">
        {item.application_reference} &middot; {item.application.class_type}
      </p>

      <Grid row gap={4}>
        {/* The image is first in the source so a phone shows the label before
            the table that discusses it, and moves to the right at desktop where
            there is room for both. */}
        <Grid tablet={{ col: 12 }} desktop={{ col: 4 }} className="desktop:order-last">
          <div className="review-image">
            <h2 className="font-heading-sm margin-top-0 margin-bottom-1">Label image</h2>
            {/* crossOrigin is load-bearing, not decoration. This is the same
                URL `verifyLabel` downloads with fetch(), and a plain <img> is a
                no-cors request: the browser caches that response and then
                reuses it for the CORS fetch, which sees no
                Access-Control-Allow-Origin and fails. Requesting the image in
                CORS mode too means both share one cache entry that satisfies
                both. Removing this breaks Verify from inside the review view.
                The queue thumbnail needs no such thing; its URL is never
                fetched. */}
            <img
              src={API_BASE_URL + item.image_url}
              crossOrigin="anonymous"
              alt={`Label photograph for ${item.brand_name}, ${item.application_reference}. Its text is compared field by field in the table on this page.`}
              className="review-image__img radius-md border border-base-lighter"
            />
            <a
              className="usa-link display-inline-block margin-top-1"
              href={API_BASE_URL + item.image_url}
              target="_blank"
              rel="noreferrer"
            >
              Open the full-size image
              <Icon.Launch aria-hidden className="margin-left-05 text-middle" />
              <span className="usa-sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </Grid>

        <Grid tablet={{ col: 12 }} desktop={{ col: 8 }}>
          {result && <StatusBanner status={result.status} />}

          {status === 'checking' && (
            <p className="font-body-lg">
              <Icon.Autorenew aria-hidden className="margin-right-1 text-middle queue-spin" />
              Checking this label against the application…
            </p>
          )}

          {!result && status !== 'checking' && (
            <div className="padding-3 bg-base-lightest radius-sm">
              <h2 className="margin-top-0 font-heading-md">Not checked yet</h2>
              <p>
                The application values are below. Verify the label to read what it actually says and
                compare the two.
              </p>
              {failure && (
                <p className="text-secondary-dark">
                  <Icon.Error aria-hidden className="margin-right-05 text-middle" />
                  {failureMessage(failure)}
                </p>
              )}
              <Button type="button" size="big" onClick={() => onVerify(item)}>
                Verify this label
              </Button>
            </div>
          )}

          {result?.status === 'unreadable' ? (
            <p className="font-body-lg measure-5">
              {unreadableGuidance(result.unreadable_reason)}
            </p>
          ) : (
            <ComparisonTable
              rows={result ? rowsFromResult(result.fields) : rowsFromApplication(item.application)}
              checked={Boolean(result)}
            />
          )}

          {warningRow?.diff && <WarningDiff diff={warningRow.diff} />}

          {result && (
            <DecisionBar
              status={result.status}
              decision={decision}
              onDecide={(next) => onDecide(item.id, next)}
              onClear={() => onClearDecision(item.id)}
            />
          )}

          <div className="display-flex flex-justify-end margin-top-4">{navigation('bottom')}</div>
        </Grid>
      </Grid>
    </GridContainer>
  )
}

export default ReviewScreen
