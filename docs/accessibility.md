# Accessibility review

This is a focused accessibility review for the prototype's task-critical
paths. It uses USWDS React components where a component exists and keeps custom
behavior limited to queue-specific interactions. It is not a claim of formal
Section 508 or WCAG certification.

USWDS components are accessibility-tested, but its guidance is clear that each
application must test its own implementation. The review therefore checks the
prototype's component composition, focus movement, and status copy rather than
assuming the design-system dependency covers custom behavior.

## Automated behavior checks

The frontend suite covers behavior that can regress in DOM tests:

- The skip link targets the main review queue.
- Opening review moves focus to its heading; Next/Previous moves it again;
  Escape and Back return focus to the originating card.
- Validation and unexpected ingestion errors move focus to the error summary.
- A failed seed-queue request offers Retry without requiring a page reload.
- Unreadable images request a better photograph, while provider/network
  failures remain retryable system failures rather than label verdicts.
- Warning differences use text, insertion/deletion semantics, and screen-reader
  labels in addition to color. Batch progress supplies numeric ARIA text.

## Manual release checklist

Run this in a real browser before a public deployment. It is intentionally
short and task-based rather than a coverage exercise.

1. Use Tab from the page start: activate **Skip to main content**, then reach
   queue actions, a card heading, selection checkbox, and Verify/Open controls
   in a predictable order.
2. Disconnect the backend or use an invalid API URL. Confirm the error alert
   explains the next step and **Try again** restores the queue once connectivity
   returns.
3. Open **Add labels** and submit a malformed CSV or an unsupported image.
   Confirm the error summary receives focus, names every problem, and the queue
   remains unchanged.
4. Open a review, use Next/Previous and Escape, and confirm focus never drops
   to the document body. Check the Reset and large-batch confirmation modals
   trap focus, expose a clear dismissal, and return focus to their trigger.
5. Inspect looks-correct, needs-review, problem-found, unreadable, and failed
   states in grayscale or with a screen reader. Each must remain understandable
   from its text, icon label, and status—not color alone.

## Known boundary

The automated suite validates DOM semantics and keyboard-oriented focus
behavior. Screen-reader output, contrast in the deployed theme, and browser/
assistive-technology combinations require the manual check above before public
release.
