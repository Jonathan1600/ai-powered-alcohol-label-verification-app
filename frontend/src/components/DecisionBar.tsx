import { useRef, useState } from 'react'
import {
  Button,
  ButtonGroup,
  ErrorMessage,
  Fieldset,
  FormGroup,
  Icon,
  Label,
  Radio,
  Textarea,
} from '@trussworks/react-uswds'

import type { VerdictStatus } from '../lib/contracts'
import { STATUS_LABELS } from '../lib/queue'
import { decisionSummary, OVERRIDE_CHOICES } from '../lib/review'
import type { Decision } from '../lib/session'

interface DecisionBarProps {
  status: VerdictStatus
  decision: Decision | undefined
  onDecide: (decision: Decision) => void
  onClear: () => void
}

// The agent's decision on one item. Confirm agrees with the recommendation;
// override says what the agent believes instead and is the accuracy signal the
// whole tool is measured by (approach.md section 3), which is why it asks for
// the corrected outcome rather than settling for "disagreed".
//
// Nothing here approves or rejects an application. The vocabulary stays at the
// level this prototype actually operates on, per ADR-003.
function DecisionBar({ status, decision, onDecide, onClear }: DecisionBarProps) {
  const [overriding, setOverriding] = useState(false)
  const [corrected, setCorrected] = useState<VerdictStatus | null>(null)
  const [note, setNote] = useState('')
  const [showError, setShowError] = useState(false)
  const firstChoiceRef = useRef<HTMLInputElement>(null)

  function reset() {
    setOverriding(false)
    setCorrected(null)
    setNote('')
    setShowError(false)
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!corrected) {
      // Nothing to record yet. Say so and send focus to the choices rather than
      // disabling the button, which would leave a keyboard user pressing a
      // control that silently does nothing.
      setShowError(true)
      firstChoiceRef.current?.focus()
      return
    }
    onDecide({ kind: 'overridden', corrected, note: note.trim() || undefined })
    reset()
  }

  if (decision) {
    return (
      <section
        aria-labelledby="decision-heading"
        className="margin-top-4 padding-3 bg-base-lightest border-left-05 border-primary radius-sm"
      >
        <h2 id="decision-heading" className="margin-top-0 font-heading-md">
          <Icon.CheckCircle aria-hidden className="margin-right-05 text-middle" />
          Decision recorded
        </h2>
        <p className="margin-y-1">{decisionSummary(decision)}</p>
        {decision.kind === 'overridden' && decision.note && (
          <p className="margin-y-1 text-base-dark">Your note: {decision.note}</p>
        )}
        <Button type="button" outline onClick={onClear}>
          Change this decision
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
        Record your decision
      </h2>
      <p className="margin-top-05">
        This is a recommendation, not a determination. Confirm it if you agree, or record what you
        found instead.
      </p>

      {!overriding && (
        <ButtonGroup>
          <Button type="button" onClick={() => onDecide({ kind: 'confirmed' })}>
            Confirm: {STATUS_LABELS[status].toLowerCase()}
          </Button>
          <Button type="button" outline onClick={() => setOverriding(true)}>
            I disagree
          </Button>
        </ButtonGroup>
      )}

      {overriding && (
        <form onSubmit={handleSave}>
          <FormGroup error={showError}>
            <Fieldset legend="What did you find instead?" legendStyle="default">
              {showError && (
                <ErrorMessage>Choose the result you believe is correct.</ErrorMessage>
              )}
              {OVERRIDE_CHOICES.map((choice, index) => (
                <Radio
                  key={choice}
                  id={`override-${choice}`}
                  name="override-corrected"
                  label={STATUS_LABELS[choice]}
                  value={choice}
                  inputRef={index === 0 ? firstChoiceRef : undefined}
                  checked={corrected === choice}
                  onChange={() => {
                    setCorrected(choice)
                    setShowError(false)
                  }}
                />
              ))}
            </Fieldset>
          </FormGroup>

          <Label htmlFor="override-note">
            Note <span className="text-base-dark font-body-2xs">(optional)</span>
          </Label>
          <span id="override-note-hint" className="usa-hint">
            What did you see that the check did not?
          </span>
          <Textarea
            id="override-note"
            name="override-note"
            aria-describedby="override-note-hint"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <ButtonGroup className="margin-top-2">
            <Button type="submit">Save decision</Button>
            <Button type="button" unstyled onClick={reset}>
              Cancel
            </Button>
          </ButtonGroup>
        </form>
      )}
    </section>
  )
}

export default DecisionBar
