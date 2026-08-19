import { useEffect, useReducer, useState } from 'react'
import { Alert, CardGroup, GridContainer } from '@trussworks/react-uswds'

import { API_BASE_URL, getSeedQueue, toVerifyFailure, verifyLabel } from '../lib/api'
import type { SeedQueueItem } from '../lib/contracts'
import { cardStatus, checksReducer, sortQueue, STATUS_LABELS } from '../lib/queue'
import QueueCard from './QueueCard'

function QueueScreen() {
  const [items, setItems] = useState<SeedQueueItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checks, dispatch] = useReducer(checksReducer, {})
  // One screen-level polite live region announcing verification outcomes;
  // per-card regions would mean 44 of them.
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    getSeedQueue()
      .then((queue) => setItems(queue.items))
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  function handleVerify(item: SeedQueueItem) {
    // Idempotence guard: only an unchecked card can start a verification.
    if (cardStatus(checks[item.id]) !== 'not_yet_checked') return
    // Brand names repeat across the corpus, so the reference is what tells two
    // cards apart when a result is announced.
    const label = `${item.brand_name}, ${item.application_reference}`
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

  const checkedCount = Object.values(checks).filter((check) => check.phase === 'done').length

  return (
    <GridContainer containerSize="widescreen" className="padding-y-4">
      <h1>Review queue</h1>
      <div aria-live="polite" className="usa-sr-only">
        {announcement}
      </div>
      {loadError && (
        <Alert type="error">
          <h2 className="usa-alert__heading">Backend unreachable</h2>
          Could not reach {API_BASE_URL}/api/seed/queue ({loadError}). Is the backend running?
        </Alert>
      )}
      {!items && !loadError && <p>Loading review queue…</p>}
      {items && (
        <>
          <p className="font-body-lg">
            {items.length} applications awaiting review
            {checkedCount > 0 ? `, ${checkedCount} checked` : ''}.
          </p>
          <CardGroup>
            {sortQueue(items, checks).map((item) => (
              // Keyed by id so React moves DOM nodes on re-sort instead of
              // remounting, preserving focus and in-flight button state.
              <QueueCard
                key={item.id}
                item={item}
                check={checks[item.id]}
                onVerify={handleVerify}
              />
            ))}
          </CardGroup>
        </>
      )}
    </GridContainer>
  )
}

export default QueueScreen
