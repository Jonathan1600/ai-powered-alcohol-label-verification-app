import { useRef } from 'react'
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

interface ResetControlProps {
  // Whether anything has been verified or decided. Drives the confirmation, and
  // nothing else.
  hasWork: boolean
  onReset: () => void
}

// Restores the seeded queue so the demo can be run again.
//
// The audience runs this more than once: an evaluator clicks through, reaches
// the end, and wants to show a colleague or retry a path they rushed
// (approach.md section 5.9). It sits apart from the working actions because one
// of them destroys work and the other does not, and it asks first only when
// there is something to lose. Confirming an empty queue teaches people to click
// through confirmations.
function ResetControl({ hasWork, onReset }: ResetControlProps) {
  const modalRef = useRef<ModalRef>(null)

  if (!hasWork) {
    return (
      <Button type="button" outline onClick={onReset}>
        <Icon.Autorenew aria-hidden className="margin-right-05 text-middle" />
        Reset the demo
      </Button>
    )
  }

  return (
    <>
      <ModalToggleButton modalRef={modalRef} opener outline>
        <Icon.Autorenew aria-hidden className="margin-right-05 text-middle" />
        Reset the demo
      </ModalToggleButton>
      <Modal
        ref={modalRef}
        id="reset-modal"
        aria-labelledby="reset-modal-heading"
        aria-describedby="reset-modal-description"
      >
        <ModalHeading id="reset-modal-heading">Reset the demo?</ModalHeading>
        <div className="usa-prose">
          <p id="reset-modal-description">
            Every verification and every decision you have recorded in this session will be
            discarded, and all applications go back to not yet checked. None of it is stored
            anywhere else, so this cannot be undone.
          </p>
        </div>
        <ModalFooter>
          <ButtonGroup>
            <ModalToggleButton modalRef={modalRef} closer secondary onClick={onReset}>
              Yes, reset the demo
            </ModalToggleButton>
            <ModalToggleButton modalRef={modalRef} closer unstyled>
              Keep my work
            </ModalToggleButton>
          </ButtonGroup>
        </ModalFooter>
      </Modal>
    </>
  )
}

export default ResetControl
