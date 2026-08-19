import { useState } from 'react'
import { Button, ButtonGroup, Label, Textarea } from '@trussworks/react-uswds'

import type { VerdictStatus } from '../lib/contracts'
import { STATUS_LABELS } from '../lib/queue'
import { decisionSummary } from '../lib/review'
import type { Decision } from '../lib/session'

interface DecisionBarProps {
  status: VerdictStatus
  decision: Decision | undefined
  onDecide: (decision: Decision) => void
  onClear: () => void
}

// A reviewer can leave the system finding alone or set the final Accepted or
// Rejected outcome. The raw result stays visible as evidence either way.
function DecisionBar({ status, decision, onDecide, onClear }: DecisionBarProps) {
  const [note, setNote] = useState('')

  function reset() {
    setNote('')
  }

  function recordOutcome(outcome: Decision['outcome']) {
    onDecide({ outcome, note: note.trim() || undefined })
    reset()
  }

  if (decision) {
    return (
      <section
        aria-labelledby="decision-heading"
        className="margin-top-4 padding-3 bg-base-lightest border-left-05 border-primary radius-sm"
      >
        <h2 id="decision-heading" className="margin-top-0 font-heading-md">
          Reviewer outcome recorded
        </h2>
        <p className="margin-y-1">{decisionSummary(decision)}</p>
        {decision.note && (
          <p className="margin-y-1 text-base-dark">Your note: {decision.note}</p>
        )}
        <Button
          type="button"
          outline
          onClick={() => {
            reset()
            onClear()
          }}
        >
          Change outcome
        </Button>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="decision-heading"
      className="margin-top-4 padding-3 bg-base-lightest border-left-05 border-primary radius-sm"
    >
      <h2 id="decision-heading" className="margin-top-0 font-heading-md">
        Set reviewer outcome
      </h2>
      <p className="margin-top-05">
        The current system finding is {STATUS_LABELS[status]}. Accept or reject this application, or
        leave it unchanged and return later.
      </p>

      <Label htmlFor="reviewer-note">
        Reviewer note <span className="text-base-dark font-body-2xs">(optional)</span>
      </Label>
      <span id="reviewer-note-hint" className="usa-hint">
        Record any context that informed your outcome.
      </span>
      <Textarea
        id="reviewer-note"
        name="reviewer-note"
        aria-describedby="reviewer-note-hint"
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <ButtonGroup className="margin-top-2">
        <Button type="button" onClick={() => recordOutcome('accepted')}>
          Accept
        </Button>
        <Button type="button" outline onClick={() => recordOutcome('rejected')}>
          Reject
        </Button>
      </ButtonGroup>
    </section>
  )
}

export default DecisionBar
