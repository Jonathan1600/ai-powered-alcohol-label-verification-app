import { Fragment } from 'react'

import type { DiffOp } from '../lib/contracts'
import { diffSegments } from '../lib/review'

// The statutory text with the label's departures marked in place.
//
// `<del>` and `<ins>` are the real elements rather than styled spans, and each
// carries a visually hidden word, so the meaning reaches a screen reader and
// survives in greyscale. Strikethrough and underline do the same job for a
// sighted reader who cannot rely on the red and green.
function WarningDiff({ diff }: { diff: DiffOp[] }) {
  const segments = diffSegments(diff)
  if (segments.length === 0) return null

  return (
    <section aria-labelledby="warning-diff-heading" className="margin-top-3">
      <h3 id="warning-diff-heading" className="margin-bottom-05">
        Where the wording differs
      </h3>
      <p className="margin-top-0 measure-5">
        The statutory text from 27 CFR 16.21 is shown below. Words the label leaves out or changes
        are struck through, and what the label says instead is underlined.
      </p>
      <p className="review-diff__key font-body-2xs text-base-dark margin-bottom-1">
        <del className="review-diff__removed">statutory wording</del>{' '}
        <ins className="review-diff__added">label wording</ins>
      </p>
      <p className="review-diff font-body-md line-height-body-5 measure-5">
        {segments.map((segment, index) => (
          <Fragment key={index}>
            {segment.kind === 'unchanged' && <span>{segment.text}</span>}
            {segment.kind === 'removed' && (
              <del className="review-diff__removed">
                <span className="usa-sr-only">removed: </span>
                {segment.text}
              </del>
            )}
            {segment.kind === 'added' && (
              <ins className="review-diff__added">
                <span className="usa-sr-only">label says: </span>
                {segment.text}
              </ins>
            )}{' '}
          </Fragment>
        ))}
      </p>
    </section>
  )
}

export default WarningDiff
