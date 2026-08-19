import { useRef, useState } from 'react'
import {
  Button,
  ButtonGroup,
  Icon,
  Modal,
  ModalFooter,
  ModalHeading,
  ModalToggleButton,
} from '@trussworks/react-uswds'
import type { ModalRef } from '@trussworks/react-uswds'

import type { QueueItem } from '../lib/contracts'
import { bulkConfirmable } from '../lib/export'
import { awaitingCheck, cardStatus } from '../lib/queue'
import { batchProgress, selectedIds, type SessionState } from '../lib/session'

/**
 * Above this many labels, verifying asks first.
 *
 * Not a technical limit. A run of two hundred spends real money at the provider
 * and takes minutes, and a control that quietly does that when an agent meant
 * to click the one next to it has not earned their trust. Below the threshold
 * the confirmation would be ceremony, which is the same reasoning the reset
 * control uses.
 */
export const CONFIRM_ABOVE = 25

interface BatchBarProps {
  items: QueueItem[]
  session: SessionState
  onVerifyMany: (ids: string[]) => void
  onStop: () => void
  onConfirmClean: (ids: string[]) => void
  onExport: () => void
  onSetSelection: (ids: string[]) => void
  onAddLabels: () => void
  /** Applies the attention-needed order to the grid now. */
  onSort: () => void
  /** True when verdicts have landed since the grid was last ordered. */
  sortStale: boolean
}

/**
 * The queue's batch controls, and the progress region a running batch turns
 * them into.
 *
 * The primary action is Verify all unchecked rather than anything to do with
 * the selection, because the scenario this screen exists for is an importer
 * filing three hundred applications at once (approach.md section 5.7).
 * Selecting a handful is the secondary path.
 */
function BatchBar({
  items,
  session,
  onVerifyMany,
  onStop,
  onConfirmClean,
  onExport,
  onSetSelection,
  onAddLabels,
  onSort,
  sortStale,
}: BatchBarProps) {
  const verifyModal = useRef<ModalRef>(null)
  const confirmModal = useRef<ModalRef>(null)
  const [pending, setPending] = useState<string[]>([])

  const running = session.batch.running
  const progress = batchProgress(session)

  const unchecked = items
    .filter((item) => awaitingCheck(cardStatus(session.checks[item.id])))
    .map((item) => item.id)
  const selected = selectedIds(session, items)
  const selectedSet = new Set(selected)
  const selectedUnchecked = unchecked.filter((id) => selectedSet.has(id))
  const confirmable = bulkConfirmable(items, session)

  function startVerifying(ids: string[]) {
    if (ids.length === 0) return
    setPending(ids)
    if (ids.length > CONFIRM_ABOVE) verifyModal.current?.toggleModal(undefined, true)
    else onVerifyMany(ids)
  }

  if (running) {
    const percent = progress.total === 0 ? 0 : Math.round((progress.settled / progress.total) * 100)
    return (
      <section
        aria-labelledby="batch-progress-heading"
        className="padding-3 margin-bottom-3 bg-base-lightest radius-sm border-left-05 border-primary"
      >
        <div className="display-flex flex-justify flex-align-center flex-wrap">
          <h2 id="batch-progress-heading" className="margin-0 font-heading-sm">
            Checking {progress.total} applications
          </h2>
          <Button type="button" secondary onClick={onStop}>
            Stop
          </Button>
        </div>

        {/* A plain ARIA progressbar rather than a USWDS component, because
            USWDS has none. aria-valuetext carries the same sentence the sighted
            reader gets, so the percentage is never the only version of it. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.settled}
          aria-valuetext={`${progress.settled} of ${progress.total} checked`}
          className="batch-progress margin-y-1"
        >
          <div className="batch-progress__fill" style={{ width: `${percent}%` }} />
        </div>

        <p className="margin-0 font-body-md">
          {progress.settled} of {progress.total} checked
          {progress.problems > 0 && (
            <>
              {' · '}
              <strong className="text-secondary-dark">
                <Icon.Error aria-hidden className="margin-right-05 text-middle" />
                {progress.problems} need attention
              </strong>
            </>
          )}
          {progress.failures > 0 && (
            <>
              {' · '}
              {progress.failures} could not be checked
            </>
          )}
        </p>

        {/* The grid is deliberately not re-ordering underneath a run (ADR-013),
            so the way problems surface early is this counter plus a control the
            agent presses when they are ready to look. */}
        {sortStale && (
          <Button type="button" outline className="margin-top-2" onClick={onSort}>
            Sort by attention needed
          </Button>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Queue actions"
      className="padding-2 margin-bottom-3 bg-base-lightest radius-sm"
    >
      <div className="display-flex flex-justify flex-align-center flex-wrap">
        <ButtonGroup>
          <Button
            type="button"
            size="big"
            disabled={unchecked.length === 0}
            onClick={() => startVerifying(unchecked)}
          >
            Verify all unchecked ({unchecked.length})
          </Button>
          <Button
            type="button"
            outline
            disabled={selectedUnchecked.length === 0}
            onClick={() => startVerifying(selectedUnchecked)}
          >
            Verify {selectedUnchecked.length} selected
          </Button>
          <Button
            type="button"
            outline
            disabled={confirmable.length === 0}
            onClick={() => confirmModal.current?.toggleModal(undefined, true)}
          >
            Confirm {confirmable.length} clean matches
          </Button>
        </ButtonGroup>

        <ButtonGroup>
          <Button type="button" unstyled onClick={onAddLabels}>
            <Icon.FileUpload aria-hidden className="margin-right-05 text-middle" />
            Add labels
          </Button>
          <Button type="button" unstyled onClick={onExport}>
            <Icon.FileDownload aria-hidden className="margin-right-05 text-middle" />
            Export CSV
          </Button>
        </ButtonGroup>
      </div>

      <div className="display-flex flex-align-center flex-wrap margin-top-1">
        <ButtonGroup>
          <Button
            type="button"
            unstyled
            disabled={items.length === 0}
            onClick={() => onSetSelection(items.map((item) => item.id))}
          >
            Select all {items.length}
          </Button>
          <Button
            type="button"
            unstyled
            disabled={selected.length === 0}
            onClick={() => onSetSelection([])}
          >
            Clear selection
          </Button>
        </ButtonGroup>
        <p className="margin-0 margin-left-2 text-base-dark">
          {selected.length} selected
          {session.batch.stopped === 'agent' && ' · the last run was stopped'}
          {session.batch.stopped === 'provider' &&
            ' · the last run stopped because the service kept failing'}
        </p>
        {sortStale && (
          <Button type="button" outline className="margin-left-auto" onClick={onSort}>
            Sort by attention needed
          </Button>
        )}
      </div>

      <Modal
        ref={verifyModal}
        id="verify-batch-modal"
        aria-labelledby="verify-batch-heading"
        aria-describedby="verify-batch-description"
      >
        <ModalHeading id="verify-batch-heading">Check {pending.length} labels?</ModalHeading>
        <div className="usa-prose">
          <p id="verify-batch-description">
            Each label is read by the extraction model, so this makes {pending.length} calls to the
            service and will take several minutes. You can stop it at any point, and anything
            already checked is kept.
          </p>
        </div>
        <ModalFooter>
          <ButtonGroup>
            <ModalToggleButton
              modalRef={verifyModal}
              closer
              onClick={() => onVerifyMany(pending)}
            >
              Yes, check them
            </ModalToggleButton>
            <ModalToggleButton modalRef={verifyModal} closer unstyled>
              Cancel
            </ModalToggleButton>
          </ButtonGroup>
        </ModalFooter>
      </Modal>

      <Modal
        ref={confirmModal}
        id="bulk-confirm-modal"
        aria-labelledby="bulk-confirm-heading"
        aria-describedby="bulk-confirm-description"
      >
        <ModalHeading id="bulk-confirm-heading">
          Confirm {confirmable.length} clean matches?
        </ModalHeading>
        <div className="usa-prose">
          <p id="bulk-confirm-description">
            This records your agreement with the recommendation on every application the check found
            nothing wrong with. Nothing that needs review or has a problem found is included. You
            can change any of them afterwards.
          </p>
        </div>
        <ModalFooter>
          <ButtonGroup>
            <ModalToggleButton
              modalRef={confirmModal}
              closer
              onClick={() => onConfirmClean(confirmable)}
            >
              Yes, confirm them
            </ModalToggleButton>
            <ModalToggleButton modalRef={confirmModal} closer unstyled>
              Cancel
            </ModalToggleButton>
          </ButtonGroup>
        </ModalFooter>
      </Modal>
    </section>
  )
}

export default BatchBar
