import { useId, useRef, useState } from 'react'
import { Alert, Button, ButtonGroup, FileInput, FormGroup, Icon, Label } from '@trussworks/react-uswds'

import type { QueueItem } from '../lib/contracts'
import { ACCEPTED_IMAGE_TYPES, ADD_LABELS_COLUMNS, ingestLabels, type IngestProblem } from '../lib/ingest'

interface AddLabelsPanelProps {
  /** References already in the queue, so a second ingestion cannot duplicate one. */
  existingReferences: string[]
  onIngested: (items: QueueItem[]) => void
  onClose: () => void
}

/**
 * Add labels: images plus a CSV of the application rows they belong to.
 *
 * This is how the queue reaches the two hundred to three hundred item scenario.
 * It is placed as one action on the queue rather than a landing screen of its
 * own, because the reviewer is not the applicant and an interface whose first
 * move is "upload a label" models the wrong person (ADR-004).
 *
 * The validation contract is all-or-nothing and all-at-once. A partly loaded
 * queue is worse than an empty one: the agent cannot see what is missing, and
 * the count at the top of the screen becomes a number nobody can trust.
 */
function AddLabelsPanel({ existingReferences, onIngested, onClose }: AddLabelsPanelProps) {
  const imagesId = useId()
  const csvId = useId()
  const [images, setImages] = useState<File[]>([])
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<IngestProblem[]>([])
  const [busy, setBusy] = useState<{ prepared: number; total: number } | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const ready = images.length > 0 && csvFile !== null

  function focusProblems() {
    // The summary is rendered by the state update above, so wait for the next
    // frame before moving a keyboard user to the corrective information.
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  async function handleAdd() {
    if (!csvFile) return
    setProblems([])
    setBusy({ prepared: 0, total: images.length })
    try {
      const text = await csvFile.text()
      const result = await ingestLabels(images, text, existingReferences, (prepared, total) =>
        setBusy({ prepared, total }),
      )
      if (result.problems.length > 0) {
        setProblems(result.problems)
        // Send focus to the summary. Without it a keyboard user is left on a
        // button that appears to have done nothing.
        focusProblems()
        return
      }
      onIngested(result.items)
    } catch (error) {
      setProblems([
        { line: null, message: error instanceof Error ? error.message : String(error) },
      ])
      focusProblems()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="add-labels-heading" className="padding-3 margin-bottom-3 border border-base-lighter radius-sm">
      <div className="display-flex flex-justify flex-align-center flex-wrap margin-bottom-1">
        <h2 id="add-labels-heading" className="margin-0 font-heading-md">
          Add labels
        </h2>
        <Button type="button" unstyled onClick={onClose}>
          <Icon.Close aria-hidden className="margin-right-05 text-middle" />
          Close
        </Button>
      </div>

      <p className="margin-top-0 measure-5">
        Choose the label images and a CSV listing one application per image. The CSV&apos;s{' '}
        <code>image</code> column has to hold the filename of the image it describes.
      </p>
      <details className="margin-bottom-2">
        <summary className="text-primary cursor-pointer">What the CSV needs</summary>
        <p className="margin-bottom-0 font-body-sm">
          Columns: <code>{ADD_LABELS_COLUMNS.join(', ')}</code>. Every column except{' '}
          <code>country_of_origin</code> is required, and that one is required when{' '}
          <code>is_import</code> is true. <code>beverage_class</code> is one of{' '}
          <code>wine</code>, <code>distilled_spirits</code>, or <code>malt_beverage</code>.
        </p>
      </details>

      {problems.length > 0 && (
        <Alert type="error" className="margin-bottom-2">
          <div ref={errorRef} tabIndex={-1}>
            <h3 className="usa-alert__heading margin-top-0">Nothing was added</h3>
            <p className="margin-top-0">
              {problems.length === 1
                ? 'One problem has to be fixed first.'
                : `${problems.length} problems have to be fixed first.`}{' '}
              The queue is unchanged.
            </p>
            <ul className="usa-list margin-bottom-0">
              {problems.map((problem, index) => (
                <li key={`${problem.line ?? 'file'}-${index}`}>
                  {problem.line !== null && <strong>Row {problem.line}: </strong>}
                  {problem.message}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      <FormGroup>
        <Label htmlFor={imagesId}>Label images</Label>
        <span className="usa-hint" id={`${imagesId}-hint`}>
          PNG, JPEG, or WebP. Large photographs are shrunk in your browser before they are sent.
        </span>
        <FileInput
          id={imagesId}
          name="label-images"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          aria-describedby={`${imagesId}-hint`}
          onChange={(event) => setImages(Array.from(event.target.files ?? []))}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor={csvId}>Application records</Label>
        <span className="usa-hint" id={`${csvId}-hint`}>
          One CSV file.
        </span>
        <FileInput
          id={csvId}
          name="application-csv"
          accept=".csv,text/csv"
          aria-describedby={`${csvId}-hint`}
          onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
        />
      </FormGroup>

      <ButtonGroup className="margin-top-2">
        <Button
          type="button"
          // aria-disabled rather than disabled, so the control keeps focus and
          // an explanation instead of vanishing from the tab order.
          aria-disabled={!ready || busy !== null}
          className={!ready || busy !== null ? 'usa-button--disabled' : undefined}
          onClick={() => {
            if (!ready || busy) return
            void handleAdd()
          }}
        >
          {busy ? `Preparing ${busy.prepared} of ${busy.total}…` : `Add ${images.length} labels`}
        </Button>
        <Button type="button" unstyled onClick={onClose}>
          Cancel
        </Button>
      </ButtonGroup>
      {!ready && (
        <p className="margin-bottom-0 font-body-sm text-base-dark">
          Choose both the images and the CSV to continue.
        </p>
      )}
    </section>
  )
}

export default AddLabelsPanel
