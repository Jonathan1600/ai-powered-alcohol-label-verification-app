import { Table } from '@trussworks/react-uswds'

import { FIELD_LABELS, WARNING_CLAIMED_LABEL, type ComparisonRow } from '../lib/review'
import { FieldVerdictTag } from './StatusTag'

interface ComparisonTableProps {
  rows: ComparisonRow[]
  // False before the item has been verified, when the label column is empty
  // because nothing has read it yet rather than because nothing was found.
  checked: boolean
}

// Distinguishes "the label does not carry this" from "nobody has looked yet".
// Both are blank cells, and an agent must never confuse them.
function Missing({ checked }: { checked: boolean }) {
  return (
    <span className="text-base-dark text-italic">
      {checked ? 'Not found on the label' : 'Not checked yet'}
    </span>
  )
}

// The government warning is 50 words of statute on both sides. Printed in full
// it swamps every other row at every screen size, so the table names it and the
// diff block below carries the text itself.
function warningCell(row: ComparisonRow, checked: boolean) {
  if (!checked) return <Missing checked={false} />
  if (row.diff) return 'The wording differs. See the comparison below.'
  if (row.extracted) return 'The warning appears on the label.'
  return <Missing checked />
}

function ComparisonTable({ rows, checked }: ComparisonTableProps) {
  return (
    <Table striped fullWidth stackedStyle="headers" className="review-table">
      <caption className="usa-sr-only">
        Each application field, what the label shows, and the result of comparing them.
      </caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Application said</th>
          <th scope="col">Label shows</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isWarning = row.field === 'government_warning'
          return (
            <tr key={row.field}>
              <th scope="row" data-label="Field">
                {FIELD_LABELS[row.field]}
              </th>
              <td data-label="Application said">
                {isWarning ? WARNING_CLAIMED_LABEL : (row.claimed ?? <Missing checked={checked} />)}
              </td>
              <td data-label="Label shows">
                {isWarning
                  ? warningCell(row, checked)
                  : (row.extracted ?? <Missing checked={checked} />)}
              </td>
              <td data-label="Result">
                {row.verdict ? (
                  <>
                    <FieldVerdictTag verdict={row.verdict} />
                    {/* The engine's own sentence, kept on the row it explains so
                        it stays attached when the table stacks on a phone. */}
                    <p className="margin-y-05 font-body-sm">{row.reason}</p>
                  </>
                ) : (
                  <span className="text-base-dark text-italic">Awaiting verification</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export default ComparisonTable
