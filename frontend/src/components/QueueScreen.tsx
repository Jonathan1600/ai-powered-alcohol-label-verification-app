import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Alert, CardGroup, GridContainer } from '@trussworks/react-uswds'

import { API_BASE_URL, getSeedQueue, seedToQueueItem, toVerifyFailure, verifyLabel } from '../lib/api'
import { runBatch } from '../lib/batch'
import type { QueueItem } from '../lib/contracts'
import { downloadCsv, exportCsv, exportFilename } from '../lib/export'
import { revokeItemUrls } from '../lib/ingest'
import { applyOrder, awaitingCheck, cardStatus, sameOrder, sortQueue, STATUS_LABELS } from '../lib/queue'
import { DECISION_LABELS } from '../lib/review'
import { EMPTY_SESSION, hasWork, sessionReducer, type BatchStop, type Decision } from '../lib/session'
import AddLabelsPanel from './AddLabelsPanel'
import BatchBar from './BatchBar'
import QueueCard from './QueueCard'
import ResetControl from './ResetControl'
import ReviewScreen from './ReviewScreen'

/**
 * How many provider failures in a row end a run.
 *
 * A 502 is not a verdict (ADR-012), so a batch that keeps receiving them is not
 * checking labels, it is spending money to produce non-results. Stopping and
 * saying so leaves the agent with work to retry; carrying on to item three
 * hundred leaves them with a queue full of errors and no idea when it broke.
 */
const PROVIDER_FAILURE_LIMIT = 5

/** Announce progress no more often than this, and no closer together than ANNOUNCE_EVERY_MS. */
const ANNOUNCE_EVERY = 25
const ANNOUNCE_EVERY_MS = 10_000

function QueueScreen() {
  const [seeded, setSeeded] = useState<QueueItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [session, dispatch] = useReducer(sessionReducer, EMPTY_SESSION)
  // One screen-level polite live region announcing verification outcomes;
  // per-card regions would mean one for every application in the queue.
  const [announcement, setAnnouncement] = useState('')
  // The order the grid is currently drawn in. Deliberately not recomputed as
  // verdicts arrive; see ADR-013 and `applyOrder`.
  const [displayOrder, setDisplayOrder] = useState<string[]>([])
  // The item being reviewed, and the queue order as it stood when that review
  // opened. Freezing the order is what keeps Next meaning "the card that was
  // next when I started" while verdicts land and the queue behind it re-sorts.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>([])
  // The card to send focus back to when the review closes.
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const stopRef = useRef<AbortController | null>(null)

  useEffect(() => {
    getSeedQueue()
      .then((queue) => {
        const items = queue.items.map(seedToQueueItem)
        setSeeded(items)
        setDisplayOrder(items.map((item) => item.id))
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  // Seeded fixtures first, then anything the agent added, which is also the
  // order a fresh ingestion appears in at the foot of the grid.
  const items = useMemo(
    () => (seeded ? [...seeded, ...session.added] : session.added),
    [seeded, session.added],
  )
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const attentionOrder = useMemo(
    () => sortQueue(items, session.checks, session.decisions).map((item) => item.id),
    [items, session.checks, session.decisions],
  )
  const sortStale = !sameOrder(attentionOrder, displayOrder)

  // A batch runs for minutes and its closure captured the state it started
  // with, so the order it applies on finishing has to be read from here rather
  // than from that stale copy. Everything else in the run is dispatched, which
  // does not care.
  const attentionOrderRef = useRef(attentionOrder)
  useEffect(() => {
    attentionOrderRef.current = attentionOrder
  }, [attentionOrder])

  // Brand names repeat across the corpus, so the reference is what tells two
  // cards apart when a result is announced.
  function labelFor(item: QueueItem) {
    return `${item.brand_name}, ${item.application_reference}`
  }

  const applySort = useCallback(() => setDisplayOrder(attentionOrder), [attentionOrder])

  function handleVerify(item: QueueItem) {
    // Idempotence guard: only an unchecked card can start a verification, so a
    // card the batch has already claimed cannot be paid for twice.
    if (!awaitingCheck(cardStatus(session.checks[item.id]))) return
    const label = labelFor(item)
    dispatch({ type: 'verify-started', id: item.id })
    setAnnouncement(`Checking ${label}…`)
    verifyLabel(item)
      .then((response) => {
        dispatch({ type: 'verify-succeeded', id: item.id, response })
        setAnnouncement(`${label}: ${STATUS_LABELS[response.result.status]}`)
      })
      .catch((error: unknown) => {
        dispatch({ type: 'verify-failed', id: item.id, error: toVerifyFailure(error) })
        setAnnouncement(`${label}: verification failed. Try again.`)
      })
  }

  /**
   * Runs a batch over `ids`, six at a time.
   *
   * Progress is per item and immediate: each verdict is dispatched the moment
   * it lands, so a problem found at item nine is on screen while item two
   * hundred is still waiting. What is *not* immediate is the grid order, which
   * is the whole of ADR-013.
   */
  async function runBatchFor(ids: string[]) {
    const targets = ids.filter((id) => awaitingCheck(cardStatus(session.checks[id])))
    if (targets.length === 0) return

    const controller = new AbortController()
    stopRef.current = controller
    dispatch({ type: 'batch-started', ids: targets })
    setAnnouncement(`Checking ${targets.length} applications. Progress is announced as it goes.`)

    let settled = 0
    let lastAnnouncedAt = Date.now()
    let lastAnnouncedCount = 0
    let consecutiveProviderFailures = 0
    let providerStop = false

    // Counters live here rather than in state because two hundred results
    // arrive faster than React commits, and a throttle reading stale state
    // would announce the same number repeatedly.
    function maybeAnnounce() {
      const now = Date.now()
      if (settled - lastAnnouncedCount < ANNOUNCE_EVERY && now - lastAnnouncedAt < ANNOUNCE_EVERY_MS) {
        return
      }
      lastAnnouncedCount = settled
      lastAnnouncedAt = now
      setAnnouncement(`${settled} of ${targets.length} checked.`)
    }

    await runBatch(
      targets,
      async (id, signal) => {
        const item = byId.get(id)
        if (!item) throw new Error(`No queue item ${id}.`)
        dispatch({ type: 'verify-started', id })
        return verifyLabel(item, signal)
      },
      {
        signal: controller.signal,
        onSettled: (outcome) => {
          if (outcome.kind === 'skipped') {
            dispatch({ type: 'verify-skipped', id: outcome.id })
            return
          }
          settled += 1
          if (outcome.kind === 'done' && outcome.value) {
            consecutiveProviderFailures = 0
            dispatch({ type: 'verify-succeeded', id: outcome.id, response: outcome.value })
          } else {
            const failure = toVerifyFailure(outcome.error)
            dispatch({ type: 'verify-failed', id: outcome.id, error: failure })
            consecutiveProviderFailures =
              failure.kind === 'provider' ? consecutiveProviderFailures + 1 : 0
            if (consecutiveProviderFailures >= PROVIDER_FAILURE_LIMIT && !providerStop) {
              providerStop = true
              controller.abort()
            }
          }
          maybeAnnounce()
        },
      },
    )

    stopRef.current = null
    const stopped: BatchStop = providerStop ? 'provider' : controller.signal.aborted ? 'agent' : null
    dispatch({ type: 'batch-finished', stopped })
    setAnnouncement(
      stopped === 'provider'
        ? `Stopped after ${PROVIDER_FAILURE_LIMIT} failures in a row. The verification service is not responding. ${settled} of ${targets.length} were checked.`
        : stopped === 'agent'
          ? `Stopped. ${settled} of ${targets.length} were checked.`
          : `Finished. ${settled} of ${targets.length} checked.`,
    )
    // The run is over, so the reason to hold the order still is over with it.
    setDisplayOrder(attentionOrderRef.current)
  }

  function handleStop() {
    stopRef.current?.abort()
  }

  function handleConfirmClean(ids: string[]) {
    dispatch({ type: 'decide-many', ids, decision: { kind: 'confirmed' } })
    setAnnouncement(`${ids.length} clean matches confirmed.`)
  }

  function handleExport() {
    downloadCsv(exportCsv(items, session), exportFilename())
    setAnnouncement(`Exported ${items.length} applications.`)
  }

  function handleIngested(added: QueueItem[]) {
    dispatch({ type: 'items-added', items: added })
    setDisplayOrder((current) => [...current, ...added.map((item) => item.id)])
    setAdding(false)
    setAnnouncement(`${added.length} labels added to the queue.`)
  }

  function handleOpen(item: QueueItem) {
    setOrder(applyOrder(items, displayOrder).map((entry) => entry.id))
    setSelectedId(item.id)
  }

  function handleNavigate(id: string) {
    const next = byId.get(id)
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
    stopRef.current?.abort()
    // The reducer cannot do this: revoking is a side effect and it has to stay
    // pure. Without it, resetting three times leaks three queues of images.
    revokeItemUrls(session.added)
    dispatch({ type: 'reset' })
    setSelectedId(null)
    setOrder([])
    setAdding(false)
    setDisplayOrder((seeded ?? []).map((item) => item.id))
    setAnnouncement('The demo has been reset. Every application is back to not yet checked.')
  }

  const clearReturnFocus = useCallback(() => setReturnFocusId(null), [])

  const checkedCount = Object.values(session.checks).filter(
    (check) => check.phase === 'done',
  ).length
  const decidedCount = Object.keys(session.decisions).length
  const selected = selectedId ? byId.get(selectedId) : undefined

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
          {seeded && (
            <p className="margin-0 font-body-lg text-base-dark">
              {items.length} applications awaiting review
              {checkedCount > 0 ? `, ${checkedCount} checked` : ''}
              {decidedCount > 0 ? `, ${decidedCount} decided` : ''}.
            </p>
          )}
        </div>
        {seeded && <ResetControl hasWork={hasWork(session)} onReset={handleReset} />}
      </div>
      {loadError && (
        <Alert type="error">
          <h2 className="usa-alert__heading">Backend unreachable</h2>
          Could not reach {API_BASE_URL}/api/seed/queue ({loadError}). Is the backend running?
        </Alert>
      )}
      {!seeded && !loadError && <p>Loading review queue…</p>}
      {seeded && (
        <>
          <BatchBar
            items={items}
            session={session}
            onVerifyMany={(ids) => void runBatchFor(ids)}
            onStop={handleStop}
            onConfirmClean={handleConfirmClean}
            onExport={handleExport}
            onSetSelection={(ids) => dispatch({ type: 'set-selection', ids })}
            onAddLabels={() => setAdding(true)}
            onSort={applySort}
            sortStale={sortStale}
          />
          {adding && (
            <AddLabelsPanel
              existingReferences={items.map((item) => item.application_reference)}
              onIngested={handleIngested}
              onClose={() => setAdding(false)}
            />
          )}
          <CardGroup>
            {applyOrder(items, displayOrder).map((item) => (
              // Keyed by id so React moves DOM nodes on re-sort instead of
              // remounting, preserving focus and in-flight button state.
              <QueueCard
                key={item.id}
                item={item}
                check={session.checks[item.id]}
                decision={session.decisions[item.id]}
                selected={item.id in session.selection}
                onToggleSelected={(id) => dispatch({ type: 'toggle-selection', id })}
                onVerify={handleVerify}
                onOpen={handleOpen}
                restoreFocus={returnFocusId === item.id}
                onFocusRestored={clearReturnFocus}
              />
            ))}
          </CardGroup>
        </>
      )}
    </GridContainer>
  )
}

export default QueueScreen
