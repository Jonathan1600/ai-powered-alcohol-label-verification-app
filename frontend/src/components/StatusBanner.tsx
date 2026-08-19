import { Alert, AlertHeading } from '@trussworks/react-uswds'
import type { AlertProps } from '@trussworks/react-uswds'

import type { VerdictStatus } from '../lib/contracts'
import { STATUS_LABELS } from '../lib/queue'
import { REVIEW_OUTCOME_LABELS, STATUS_SUMMARY } from '../lib/review'
import type { Decision } from '../lib/session'

// The four outcomes mapped onto USWDS alert severities. The component carries
// its own icon and its own heading text, so the meaning survives in greyscale
// and in a screen reader; the color is the third signal, never the only one.
//
// Unreadable is info rather than warning on purpose. Nothing is wrong with the
// application: the photograph could not be read, and the next action is to ask
// for a better one, not to investigate a compliance finding.
const BANNER_TYPE: Record<VerdictStatus, AlertProps['type']> = {
  looks_correct: 'success',
  needs_review: 'warning',
  problem_found: 'error',
  unreadable: 'info',
}

interface StatusBannerProps {
  status: VerdictStatus
  decision?: Decision
  children?: React.ReactNode
}

function StatusBanner({ status, decision, children }: StatusBannerProps) {
  const reviewerOutcome = decision?.outcome ?? null
  const bannerType = reviewerOutcome ? (reviewerOutcome === 'accepted' ? 'success' : 'error') : BANNER_TYPE[status]
  const heading = reviewerOutcome ? REVIEW_OUTCOME_LABELS[reviewerOutcome] : STATUS_LABELS[status]
  const summary = reviewerOutcome
    ? `You recorded this reviewer outcome. The system finding and field evidence remain available below.`
    : STATUS_SUMMARY[status]

  return (
    <Alert type={bannerType} className="margin-top-0">
      <AlertHeading level="h2" className="font-heading-lg">
        {heading}
      </AlertHeading>
      <p className="margin-bottom-0">{summary}</p>
      {children}
    </Alert>
  )
}

export default StatusBanner
