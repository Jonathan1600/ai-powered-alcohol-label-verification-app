import { useCallback, useEffect, useReducer, useState } from 'react'
import { Alert, CardGroup, GridContainer } from '@trussworks/react-uswds'

import { API_BASE_URL, getSeedQueue, toVerifyFailure, verifyLabel } from '../lib/api'
import type { SeedQueueItem } from '../lib/contracts'
import { cardStatus, sortQueue, STATUS_LABELS } from '../lib/queue'
import { DECISION_LABELS } from '../lib/review'
import { EMPTY_SESSION, hasWork, sessionReducer, type Decision } from '../lib/session'
import QueueCard from './QueueCard'
import ResetControl from './ResetControl'
import ReviewScreen from './ReviewScreen'

function QueueScreen() {
  const [items, setItems] = useState<SeedQueueItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [session, dispatch] = useReducer(sessionReducer, EMPTY_SESSION)
  // One screen-level polite live region announcing verification outcomes;
  // per-card regions would mean 44 of them.
  const [announcement, setAnnouncement] = useState('')
  // The item being reviewed, and the queue order as it stood when that review
  // opened. Freezing the order is what keeps Next meaning "the card that was
  // next when I started" while verdicts land and the queue behind it re-sorts.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>([])
  // The card to send focus back to when the review closes.
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null)

  useEffect(() => {
    getSeedQueue()
      .then((queue) => setItems(queue.items))
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  // Brand names repeat across the corpus, so the reference is what tells two
  // cards apart when a result is announced.
  function labelFor(item: SeedQueueItem) {
    return `${item.brand_name}, ${item.application_reference}`
  }

  function handleVerify(item: SeedQueueItem) {
    // Idempotence guard: only an unchecked card can start a verification.
    if (cardStatus(session.checks[item.id]) !== 'not_yet_checked') return
    const label = labelFor(item)
    dispatch({ type: 'verify-started', id: item.id })
    setAnnouncement(`Checking ${label}…`)
    verifyLabel(item)
      .then((response) => {
        dispatch({ type: 'verify-succeeded', id: item.id, result: response.result })
        setAnnouncement(`${label}: ${STATUS_LABELS[response.result.status]}`)
      })
      .catch((error: unknown) => {
        dispatch({ type: 'verify-failed', id: item.id, error: toVerifyFailure(error) })
        setAnnouncement(`${label}: verification failed. Try again.`)
      })
  }

  function handleOpen(item: SeedQueueItem) {
    setOrder(sortQueue(items ?? [], session.checks, session.decisions).map((entry) => entry.id))
    setSelectedId(item.id)
  }

  function handleNavigate(id: string) {
    const next = items?.find((entry) => entry.id === id)
    if (!next) return
    setSelectedId(id)
    setAnnouncement(`${labelFor(next)}: ${STATUS_LABELS[cardStatus(session.checks[id])]}`)
  }

  const handleBack = useCallback(() => {
    setReturnFocusId(selectedId)
    setSelectedId(null)
  }, [selectedId])

  function handleDecide(id: string, decision: Decision) {
    dispatch({ type: 'decide', id, decision })
    setAnnouncement(`Decision recorded: ${DECISION_LABELS[decision.kind].toLowerCase()}.`)
  }

  function handleReset() {
    dispatch({ type: 'reset' })
    setSelectedId(null)
    setOrder([])
    setAnnouncement('The demo has been reset. Every application is back to not yet checked.')
  }

  const clearReturnFocus = useCallback(() => setReturnFocusId(null), [])

  const checkedCount = Object.values(session.checks).filter(
    (check) => check.phase === 'done',
  ).length
  const decidedCount = Object.keys(session.decisions).length
  const selected = selectedId ? items?.find((entry) => entry.id === selectedId) : undefined

  // The live region lives outside the branch so an announcement survives the
  // switch between the queue and the review view.
  const liveRegion = (
    <div aria-live="polite" className="usa-sr-only">
      {announcement}
    </div>
  )

  if (selected) {
    return (
      <>
        {liveRegion}
        <ReviewScreen
          item={selected}
          check={session.checks[selected.id]}
          decision={session.decisions[selected.id]}
          order={order}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onVerify={handleVerify}
          onDecide={handleDecide}
          onClearDecision={(id) => dispatch({ type: 'clear-decision', id })}
        />
      </>
    )
  }

  return (
    <GridContainer containerSize="widescreen" className="padding-y-4">
      {liveRegion}
      <div className="display-flex flex-justify flex-align-end flex-wrap margin-bottom-2">
        <div>
          <h1 className="margin-bottom-05">Review queue</h1>
          {items && (
            <p className="margin-0 font-body-lg text-base-dark">
              {items.length} applications awaiting review
              {checkedCount > 0 ? `, ${checkedCount} checked` : ''}
              {decidedCount > 0 ? `, ${decidedCount} decided` : ''}.
            </p>
          )}
        </div>
        {items && <ResetControl hasWork={hasWork(session)} onReset={handleReset} />}
      </div>
      {loadError && (
        <Alert type="error">
          <h2 className="usa-alert__heading">Backend unreachable</h2>
          Could not reach {API_BASE_URL}/api/seed/queue ({loadError}). Is the backend running?
        </Alert>
      )}
      {!items && !loadError && <p>Loading review queue…</p>}
      {items && (
        <CardGroup>
          {sortQueue(items, session.checks, session.decisions).map((item) => (
            // Keyed by id so React moves DOM nodes on re-sort instead of
            // remounting, preserving focus and in-flight button state.
            <QueueCard
              key={item.id}
              item={item}
              check={session.checks[item.id]}
              decision={session.decisions[item.id]}
              onVerify={handleVerify}
              onOpen={handleOpen}
              restoreFocus={returnFocusId === item.id}
              onFocusRestored={clearReturnFocus}
            />
          ))}
        </CardGroup>
      )}
    </GridContainer>
  )
}

export default QueueScreen
