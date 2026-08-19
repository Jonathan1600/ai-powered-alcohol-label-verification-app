# Approach and Build Plan

Design document for the TTB label verification prototype. Written before
implementation, from the stakeholder interview requirements. Records the
architectural decisions, the reasoning behind them, and the open risks.

See [architecture.md](./architecture.md) for the system diagrams and the short
form decision records.

## 1. Problem statement

Given a label photograph and a set of claimed application field values, decide
per field whether the label supports the claim. A single label must return a
result a compliance agent can act on in under five seconds, and the same engine
must handle batches of 200 to 300, in an interface usable by non-technical
staff.

The requirements document is written as stakeholder interviews, but several of
the anecdotes are graded requirements in disguise:

| Anecdote | Actual requirement |
| --- | --- |
| Prior vendor pilot took 30 to 40 seconds and was abandoned | ~5s is a hard usability threshold and will be timed |
| "STONE'S THROW" vs "Stone's Throw" should not fail | Normalized and fuzzy matching with human-in-the-loop flagging |
| Government warning must be word-for-word, caps, bold | One field needs strict validation logic distinct from every other field |
| Government firewall blocked outbound domains | Cloud AI is fine for the prototype but the swap-out path must be designed and documented |

## 2. Settled decisions

| Decision | Choice |
| --- | --- |
| Model provider | OpenAI |
| Model | `gpt-4.1-mini`, and only this model |
| API key | Supplied via `.env` as `OPENAI_API_KEY`, the SDK's default variable name. This file is never read, printed, or committed. |
| Frontend | React, deployed on Vercel |
| Backend | Python, deployed on Render (paid Starter instance, always-on) |
| UI component system | `@trussworks/react-uswds` on top of `@uswds/uswds` |
| Bold detection failure | `needs review`, not a hard failure |
| Bounding-box overlay | Cut from scope |
| Human review | Every result is reviewable. The tool recommends, the agent decides. See section 3. |
| Primary user | The TTB reviewing agent, not the applicant. App opens on a pre-populated review queue. See section 3.1. |
| Demo reset | One button restores the seeded queue so the process can be run again. See section 5.8. |
| Single-label latency | **Hard requirement: under 5 seconds.** Not a target. See section 6. |
| Latency enforcement | Warm p95 over the fixture set. Exceeding it **blocks CI**. See section 6. |

`.env.example` at the repo root is the template. Using the SDK's default key
name means the OpenAI client needs no explicit key wiring and there is one
fewer thing to get wrong at deploy time.

## 3. Human-in-the-loop: the tool recommends, the agent decides

**Every application passes through a human. Nothing is auto-approved or
auto-rejected.** The verdict does not decide whether a person looks at the
application; it decides *how much attention* the application needs.

This is the right model, and it does not conflict with the evaluation criteria:

- **COLA approval is a legal action.** A prototype with no COLA integration and
  no authority over the system of record cannot approve or reject anything. It
  can only produce a recommendation with evidence attached. Framing the output
  as a decision would overstate what the system is.
- **It is the answer to the skeptical-agent objection.** The senior agent's
  position is that label review requires judgment. Correct. The tool does not
  replace that judgment, it removes the mechanical work that precedes it:
  reading seven fields off an image and comparing them by eye.
- **The time saving survives.** The stated goal is that agents "focus on
  complex cases," which is triage, not elimination. Today the agent extracts
  and compares every field manually at 5 to 10 minutes per application. Under
  this design the agent confirms a pre-filled, evidence-backed comparison. A
  clean match becomes a glance and a click.
- **The three-state result is a triage signal, not a gate.** That is precisely
  why the requirements ask for `needs review` as a middle state rather than a
  binary.

Practical consequences for the build:

- Vocabulary avoids "approved" and "rejected." Results read as recommendations:
  **Looks correct** / **Needs review** / **Problem found**.
- The review queue sorts problems and review items to the top. That ordering
  *is* the agent's work queue.
- Each item carries a confirm or override control. Clean matches support bulk
  confirm so a 300-item batch does not require 300 individual clicks.
- Overrides are the honest measure of accuracy. In production, logging the
  override rate per field is how you would prove the tool works. For this
  prototype the system is stateless, so overrides live in session state and
  flow into the CSV export rather than a database.

### 3.1 The user is the reviewer, not the applicant

This determines the entire shape of the interface, so it is stated explicitly.

The person using this tool is a TTB compliance agent with a stack of
applications waiting on them. They did not create those applications and they
would never upload them: applications arrive from applicants through COLA. An
interface whose first action is "upload a label" models the wrong person and
puts setup work in front of the user before they can do their job.

**The application therefore opens on a pre-populated review queue.** The agent
sees work waiting, picks something up, and works through it with AI assistance.

This does not conflict with the no-COLA-integration requirement. That
requirement says do not build an integration against government systems, which
is a different thing from having sample data that stands in for what the
integration would deliver. The seeded queue is fixture data, documented as
such, with the production note that a real deployment would populate the same
queue from COLA. Building the queue against a seam that COLA could later fill
is the accurate way to model the workflow without integrating.

Secondary benefit: an evaluator opening the deployed URL has something to do
immediately. There is no "go find a label image and type in seven fields"
barrier before the tool demonstrates value, and triage is only visible when
there is a queue holding a realistic mix of verdicts. A single-label demo
cannot show the product's actual argument.

## 4. Central architectural decision: separate reading from judging

**One vision model call performs structured extraction only. Every verdict is
computed in deterministic Python.**

The model is asked what the label literally says, returned as validated JSON.
It is never asked whether the label passes.

Reasons this is the right split:

- **The government warning cannot be judged by a language model.** Asking an
  LLM "is this text word-for-word correct?" produces agreeable paraphrase, not
  verification. The check has to be a string comparison in code against the
  canonical statutory text, producing a word-level diff on failure.
- **The matching engine becomes unit-testable with no API calls.** All decision
  logic runs against fixtures in milliseconds. This is where code quality is
  demonstrable.
- **Latency stays controllable.** One call, not a chain of reasoning steps.
- **Results are auditable.** The agent sees what was read, what was submitted,
  and the specific reason for each verdict. Under the review model in section
  3, that evidence is the entire product.

The naive alternative, handing the model both inputs and asking for a verdict,
is faster to build and worse against every stated evaluation criterion.

## 5. Components

### 5.1 Extraction contract

Pydantic models defining the model output, enforced through OpenAI structured
outputs so the response conforms to the schema rather than being parsed
hopefully:

- Per field: verbatim text as it appears on the label, plus a confidence value.
- For the government warning block specifically: raw text, whether the
  "GOVERNMENT WARNING:" prefix is all-caps, whether it renders bold, and the
  text size relative to the label.
- An overall readability assessment with a reason code (glare, angle, blur,
  resolution) when the label cannot be read.

The contract is the boundary between the probabilistic half of the system and
the deterministic half. Everything downstream of it is testable without a
network call.

### 5.2 LabelReader adapter

An interface with two implementations:

- An OpenAI `gpt-4.1-mini` implementation used in production.
- A deterministic mock used by the test suite and by an offline demo mode.

This is the direct answer to the firewall constraint. A self-hosted vision
model or an on-premise OCR engine drops in behind the same interface without
touching the matching engine. The seam is cheap to build and it is the thing
the README points at when discussing the production network risk.

### 5.3 Matching engine

The core of the project. Per-field strategies producing a three-state result:
`match`, `needs review`, `mismatch`.

Shared normalization pipeline: Unicode NFKC, whitespace collapse, case folding,
quote and apostrophe normalization (curly vs straight), punctuation variants.

| Field | Strategy |
| --- | --- |
| Brand name | Normalized exact match first, then fuzzy ratio to `needs review`, then `mismatch`. The STONE'S THROW case is exactly a caps plus apostrophe difference and must pass. |
| Class / type designation | Normalized comparison plus a synonym and abbreviation map (whisky / whiskey, word-order tolerance) |
| Alcohol content | Parse to a number, never string-compare. `45% Alc./Vol. (90 Proof)` becomes 45.0. Apply the 27 CFR tolerance bands by beverage class and cross-check that proof equals twice ABV. Exact tolerance values to be confirmed against the regulation during implementation. |
| Net contents | Parse quantity and unit, normalize units (750 mL = 0.75 L), compare numerically |
| Bottler name and address | Fuzzy, with address abbreviation normalization (St / Street), biased toward `needs review` rather than `mismatch` |
| Country of origin | Conditional field, required only for imports |
| Government warning | Strict path. See below. |

**Government warning, strict path.** Whitespace-normalized exact comparison
against the canonical statutory text. Any wording difference is a `mismatch`
accompanied by a word-level diff showing what was inserted, deleted, or
changed. Separately checked: the "GOVERNMENT WARNING:" prefix is present and
all-caps, renders bold, and meets minimum type size.

**Bold is graded softly, by decision.** Detecting font weight from a
photograph is genuinely unreliable, and a false hard-fail on a compliant label
costs more trust than it saves. Missing or altered wording is a hard
`mismatch`; "does not appear bold" is `needs review`. Caps and wording remain
strict.

### 5.4 Unreadable path

A distinct top-level outcome, not a low-confidence guess. When the image cannot
be read, return "image unreadable, request a better photo" with the specific
reason. The requirements name this as the acceptable fallback when full
handling of poor photographs is out of scope, so it must never be reached by
accident. A wrong confident answer is worse than a clear refusal.

### 5.5 Latency instrumentation

Real elapsed milliseconds are measured server-side, returned with the result,
and displayed in the interface. Reviewers will time this, and showing the
number preempts the question. The budget, measurement boundary, and enforcement
are in section 6.

### 5.6 Interface

**One primary screen: the review queue.** Not two modes, not three entry
points. The agent lands on their queue, already populated, and everything else
is an action taken on it. This is both simpler than a mode-switching design and
a truer model of the job (section 3.1).

**The queue.** A grid of label thumbnails, each card showing the brand name,
the application reference, and a status badge. Items sort by attention needed:
problems first, then review items, then clean matches, then unchecked. Cards
carry one of six states:

| State | Meaning |
| --- | --- |
| Not yet checked | Seeded or newly added, verification has not run |
| Checking | Verification in flight |
| Looks correct | All fields matched |
| Needs review | At least one soft flag, nothing disqualifying |
| Problem found | At least one hard mismatch |
| Unreadable | Image quality too poor to verify, better photo needed |

Thumbnails are cheap: seeded items ship theirs alongside the fixtures, and
newly added ones get theirs from the client-side downscale that already serves
the latency budget (section 6). They also carry real weight for the target
user, since a wall of filenames is far harder to scan than a wall of labels for
someone who thinks about the work visually.

**Actions on the queue**, all operating on the same engine:

- **Click a card** to open the full review for that application.
- **Select several and verify** as a batch.
- **Verify all unchecked**, which is the 200 to 300 item importer scenario.
- **Add labels**, which uploads new images plus application rows into the
  queue. This is the ingestion path, not a separate mode, so it does not
  compete for attention on the landing screen.
- **Reset demo**, which restores the queue to its original seeded state so the
  whole process can be run again from the start. See section 5.8.

**The review view**, reached by clicking a card: a large status banner, then a
three-column table of "Application said" / "Label shows" / status, with a
plain-English reason per row and a confirm or override control. The label image
sits alongside. No confidence decimals shown to the user. Next and previous
controls move through the queue without returning to it, since an agent working
a stack should not have to navigate back after every item.

Built with USWDS, which carries real advantages here beyond looking like a
government product:

- It is designed and tested for Section 508 and WCAG conformance, which
  directly serves the "users skew older and non-technical" requirement rather
  than being a separate accessibility workstream.
- Its Alert, Table, File Input, Step Indicator, and Banner components map
  almost one to one onto the screens this app needs.
- Its type scale and target sizes already default larger than typical web
  defaults.

**Implementation: `@trussworks/react-uswds` on top of `@uswds/uswds`.**

USWDS core ships as Sass sources plus vanilla JS and static assets, not as
React components. `@uswds/uswds` provides Sass under `packages/` and compiled
fonts, images, and JS under `dist/`, with `@uswds/compile` as the supported
Gulp-based build path. Consuming that directly from React means hand-writing
USWDS markup and class names in JSX and manually wiring the behaviors its
vanilla JS would otherwise attach.

`@trussworks/react-uswds` closes that gap. It is a TypeScript React component
library implementing USWDS 3.0 patterns, maintained by Truss, and it takes
`@uswds/uswds` as a peer dependency rather than replacing it. The design system
stays exactly the one specified; only the authoring layer changes. It is in
production use across federal projects including Vote.gov, CDC, CMS, CISA, and
DOL systems, which is itself the relevant precedent for a TTB submission.

**Both packages stay installed.** `@trussworks/react-uswds` does not bundle
USWDS, it layers on top of it, and dropping the base package breaks the build
in three separate ways:

- Its `index.css` carries only component-level styles. The design tokens,
  typography scale, grid, and utility classes all come from the USWDS
  stylesheet. Without it the components render partially styled.
- Fonts and images resolve through Sass path variables that point into the
  package (`$theme-image-path: '@uswds/uswds/img'`,
  `$theme-font-path: '@uswds/uswds/fonts'`). Those paths require the package to
  exist in `node_modules`. There is no copy step to replace it with.
- It is a peer dependency, and the library warns that version mismatches
  produce unexpected markup and CSS combinations. It should be declared and
  pinned explicitly rather than left to an implicit transitive install, so both
  packages upgrade together deliberately.

What we *do* drop is USWDS's JavaScript and the `@uswds/compile` Gulp pipeline:

- **Do not import the USWDS JS.** The library documents that doing so causes
  JS-backed components to initialize twice. React-USWDS owns those behaviors.
- **No sprite handling.** React-USWDS renders icons as inline SVG React
  components rather than loading USWDS's `sprite.svg`, which removes the asset
  step that would otherwise be needed.

Styles start as plain compiled CSS imports, which is the simplest path and
enough here since the prototype needs no brand theming. The Sass route with a
theme settings file stays available if customization is needed later.

Rejected alternative: a general-purpose component library (MUI, Chakra,
shadcn/ui) themed to resemble a federal site. It would look approximately
right and forfeit the entire point. "Built on the actual federal design
system" is a substantive answer to the government-audience requirement; a
lookalike is a liability in front of reviewers who work inside that standard
every day.

### 5.7 Batch processing

Batch is an operation on the queue, not a separate destination. Selecting
several items, or verifying all unchecked ones, runs them through bounded
concurrency (6 parallel calls) with per-item progress streamed back so cards
flip from "queued" to "checking" to their verdict individually rather than the
whole batch landing at once.

The queue order deliberately holds still while the run is in flight, which
revises an earlier version of this section that promised a live re-sort on
every arriving result. Two hundred cards reflowing under the agent's pointer is
motion, not information; problems surface early through a live "N need
attention" counter and a sort-on-demand control instead, and the
attention-needed sort applies itself when the run completes. ADR-013 records
the revision. A run above 25 items confirms first, since it spends real money
and minutes; a stop control aborts in-flight work without inventing verdicts
for it, and five consecutive provider failures halt the run rather than burning
the rest of the batch into a dead service (ADR-012).

Ingestion for new work is images plus a CSV of application rows, matched by
filename convention, validated all-or-nothing with every problem reported at
once. Added labels live entirely in the browser and post to the same verify
endpoint as seeded fixtures; there is no upload endpoint and no server-side
ingestion state (ADR-014). Bulk confirm for clean matches, restricted to
"looks correct" so a batch control can never sweep up a compliance finding.
CSV export of the whole queue including any agent overrides, with
formula-leading cells neutralised so a note typed by an agent cannot execute in
someone else's spreadsheet.

Deliberately not built: Redis, Celery, or any external queue. The README
records that a durable queue is the production answer and that an in-process
queue is the correct scope for a prototype.

### 5.8 Fixtures, seed queue, and evaluation set

One set of synthetic labels serves three purposes: it seeds the demo queue, it
backs the automated tests, and it is the evaluation set. Building it once and
using it three ways keeps the demo honest, because the queue an evaluator
clicks through is the same data the accuracy numbers come from.

Roughly 15 labels covering each failure mode: clean pass, case variance
(the STONE'S THROW case), ABV mismatch, title-case warning, altered warning
wording, missing warning, undersized warning type, missing country of origin on
an import, and unreadable images (glare, blur, angle). Plus about 20
straightforward ones so the seeded queue has realistic proportions, since a
queue where half the items are violations misrepresents the job. Each ships
with its paired application record.

**Seed state.** Queue items load as "not yet checked" rather than pre-computed.
The evaluator triggers verification and watches it run, which is what makes the
latency claim in section 6 visible instead of asserted. Pre-computing verdicts
would make the demo faster and prove nothing.

**Session isolation.** Seed data is read-only fixture content served by the
backend; review state (verdicts, confirms, overrides) lives in client session
state. Every evaluator therefore starts on a clean queue without any
server-side state, which falls out of the stateless decision rather than
needing to be built.

**Scoring.** A script runs the engine against the labeled set and reports
accuracy plus p50 and p95 latency. Warm p95 above the 5-second requirement
blocks CI; the gate design and its two-job split are in section 6. The README
states those measured numbers rather than adjectives.

### 5.9 Reset demo control

A single button on the queue screen restores the
original seeded state: all items return to "not yet checked," verdicts and
confirms and overrides are discarded, and anything added through the
add-labels path is cleared.

This matters because the intended audience runs the demo more than once. An
evaluator clicks through, reaches the end, and wants to show a colleague or
retry a path they rushed. Without a reset, the only way back is clearing
browser storage or opening a private window, which is exactly the kind of
technical workaround the simplicity requirement rules out.

Implementation is trivial given the architecture: review state is client-side,
so reset discards local state and re-reads the seed fixtures. No server call,
no persistence to unwind, and it doubles as the recovery path if a demo run
gets into a confusing state.

The control sits apart from the working actions rather than beside "verify
all," since the two are easy to confuse and one of them destroys work. It
confirms before wiping when the agent has reviewed anything, and skips the
confirmation on an untouched queue where there is nothing to lose.

### 5.10 Documentation

README with setup and run instructions, plus this approach document maintained
through the build to record decisions, assumptions, trade-offs, and known
limitations including the production network risk.

## 6. Latency: hard requirement

**A single-label verification must complete in under 5 seconds. This is a hard
requirement, not a performance target.** A build that is accurate but slower
than this has failed the brief, because that is precisely the failure that
caused agents to abandon the previous vendor pilot.

### Definition

Ambiguity here makes the number meaningless, so the measurement boundary is
fixed:

- **Measured:** wall-clock time from the user submitting a label to the result
  being rendered on screen. Includes image upload, the model call, matching,
  and the response trip. This is the number the user actually experiences.
- **Conditions:** warm backend, typical phone-camera label photo, ordinary
  broadband.
- **No cold-start caveat.** The always-on instance chosen in section 7 means
  there is no idle-spin-down path, so the measured number is what every real
  request experiences. This was deliberately removed as a reporting asterisk
  rather than explained away.

### Budget

Rough allocation of the 5 seconds, to be replaced with measured values once the
pipeline exists:

| Stage | Budget |
| --- | --- |
| Client-side downscale and upload | ~1.0s |
| Model extraction call | ~2.5s |
| Matching engine | <0.05s |
| Response and render | ~0.5s |
| Headroom | ~1.0s |

The matching engine is deterministic local computation and is effectively free.
Essentially the entire budget belongs to the network and the model, which is
why the levers below all target those two.

### Measured, phase 4

**The budget above is wrong, and the requirement is not currently met.** The
numbers below were taken once the live reader existed, against the fixture
corpus, from a residential connection over WSL. They are recorded here in place
of the estimates rather than alongside them, because an estimate kept next to a
contradicting measurement is just a nicer number to quote.

Twelve fixtures, sequential, one warm client, first call discarded:

| Statistic | Model call |
| --- | --- |
| p50 | 7.4s |
| p95 | 20.4s |
| min | 3.0s |
| max | 20.4s |

Shorter runs on clean fixtures sat lower, p50 around 5.8s, so the honest summary
is a p50 between 5 and 7 seconds with a very long tail. Against a 5 second
budget of which the model was allotted 2.5s, the extraction call alone exceeds
the entire requirement at the median.

**What was ruled out.** Each of these was measured, not reasoned about:

| Hypothesis | Result |
| --- | --- |
| Account rate limiting | Ruled out. 499/500 requests and 199,235/200,000 tokens remaining, no `retry-after` header. |
| Image payload size | Ruled out. Cutting input from 2,457 to 1,133 tokens moved the median by nothing. |
| The `detail` parameter | Ruled out, and it appears inert. `high`, `low`, and `auto` produced identical input token counts and identical latency. |
| Output schema size | Real but small. Dropping from 255 output tokens to 9 saved roughly 0.6s, about 2.4ms per token. |
| Our network round trip | Real but small. A text-only structured call completes in 0.8s from the same machine. |

So the cost is image handling on the provider's side, and its variance rather
than its floor is what breaks the requirement. The same request measured 3.0s
and 20.4s within one run.

**What this invalidates.** Lever 2 in the next section claimed client-side
downscaling was "the largest remaining lever". It is not: it does not move the
model call at all. It still reduces upload time, which is a real part of the
user-facing number on a slow connection, so it stays in the build for that
reason and not the one originally given.

**What is still open.** Every measurement here was taken from a home
connection. The 0.8s text-only baseline puts a ceiling of about 0.8s on how much
of this our own network can account for, which is not enough to close a 15s tail,
but the production path is Render to OpenAI and has not been measured. Phase 1
deploys it, and until that number exists the correct statement is that the
requirement is missed by the measurement we have, not that it is unachievable.

Three responses are available and none of them is free:

1. **Report the measured number honestly** and treat the 5 second figure as the
   target it turned out to be rather than the guarantee it was written as. This
   is the only option that does not change scope, and ADR-009 has to be revised
   with it, because a CI gate at p95 under 5 seconds would fail every build.
2. **Stream the response** so perceived time tracks progress. This does not
   change the measured number and the definition above is explicit that
   perception is not what is measured.
3. **Reduce what is asked for.** The output schema is the only lever with
   demonstrated effect, and it is worth about 0.6s, so this cannot close the gap
   on its own.

The decision belongs with the phase 1 measurement rather than ahead of it, and
this section should be rewritten once that number exists.

### Acceptance

The evaluation script in section 5.8 records per-label latency across the
fixture set and **fails if the warm p95 exceeds 5 seconds. This gate blocks
CI.** A regression past the threshold stops the build rather than filing a
warning nobody reads, which is what makes the requirement binding instead of
aspirational. The README states measured p50 and p95, not adjectives.

CI splits into two jobs, because they have very different properties:

| Job | Runs | Needs key | Blocks merge |
| --- | --- | --- | --- |
| Engine tests | Every push | No | Yes |
| Accuracy and latency gate | Every push to a repo branch | Yes | Yes |

The engine job is the deterministic matching logic from section 5.3 against
fixtures. It is fast, free, offline, and catches most regressions.

The gate job makes real `gpt-4.1-mini` calls, so it needs `OPENAI_API_KEY` as a
CI secret and costs a small amount per run. Roughly 35 fixture labels against
a mini-tier model is negligible, but it is not zero and it is worth knowing
that it scales with push frequency.

Three details make a blocking gate on a live API workable rather than
maddening:

- **p95 across the full fixture set, not max.** One unlucky call cannot fail
  the build on its own. That is the entire reason for choosing a percentile
  over a worst case.
- **Per-stage breakdown on failure.** The failure output separates upload,
  model call, matching, and response so a red build immediately shows whether
  our pipeline regressed or the API simply had a bad minute. A gate you cannot
  diagnose in ten seconds is a gate people start bypassing.
- **No automatic retries.** Re-running on failure would hide exactly the
  gradual drift the gate exists to catch. A genuine API blip is re-run
  manually, which keeps the decision visible and deliberate.

Note for a public repository: CI secrets are not exposed to pull requests from
forks, so the gate job cannot run on fork PRs. It runs on branches within the
repo and is required for merge into `main`, which covers the actual workflow
here.

### Levers

1. **Cold starts are eliminated at the infrastructure level.** A paid
   always-on Render instance, not the free tier. See section 7. This was the
   largest threat to the budget and it is resolved by deployment choice rather
   than by anything in the pipeline.
2. **Downscale client-side before upload.** Label text is legible at roughly
   1200px on the longest edge, and a 12MP phone photo spends transfer time for
   no accuracy gain. This was written as the largest remaining lever and the
   phase 4 measurement above disproved that: cutting the payload by more than
   half moved the model call by nothing. It is kept because upload time is a
   real part of the user-facing number on a slow connection, which is a smaller
   claim than the one originally made here.
3. **One model call, never a chain.** Structured output, no multi-step
   reasoning loop.
4. **Cap output tokens and keep the schema tight.** Extraction returns short
   field strings, so a compact schema directly shortens generation time.
5. **Streamed progress stages** so perceived time tracks actual time.

If the budget cannot be met, the correct response is to reduce work rather than
to accept a slower result: shrink the image further, or trim the extraction
schema. The 5 seconds is the fixed constraint and everything else is
negotiable against it.

`gpt-4.1-mini` is a good fit for this budget: it is the fast, low-cost tier of
the 4.1 family, supports image input, and supports structured outputs. Since it
is the only permitted model, the accuracy lever is prompt and schema design
rather than model selection, which raises the importance of the fixture set in
section 5.8 for catching extraction regressions.

## 7. Technology and deployment

| Layer | Choice |
| --- | --- |
| Frontend | React + Vite + `@trussworks/react-uswds` + `@uswds/uswds`, deployed on Vercel |
| Backend | Python + FastAPI, deployed on Render (paid Starter, always-on) |
| Model access | OpenAI Python SDK, `gpt-4.1-mini`, key from `OPENAI_API_KEY` |
| Contracts | Pydantic + OpenAI structured outputs |
| Tests | pytest for the matching engine |
| Persistence | None |

**No database.** Stateless: image in, result out, nothing persisted. This
satisfies the no-PII-storage and sane-retention expectation as a deliberate
design decision rather than an omission.

### Resolved: Render cold starts

**Decision: the backend runs on Render's paid Starter instance, not the free
tier.** This was the most serious technical risk in the plan and it is closed.

The risk was specific and severe. Render spins down a free web service after 15
minutes without inbound traffic, and the spin-up that follows takes roughly a
minute, during which the user watches a loading page. A reviewer opening the
deployed URL is by definition hitting an idle service, so the first impression
of the product would have been a cold start *worse* than the 30-to-40 second
latency that caused agents to abandon the previous vendor pilot. The hard
requirement in section 6 would have been unmeetable in the only run that
matters, no matter how fast the warm path measured.

Spin-down is documented as a Free-tier limitation; paid instances do not have
it. The Starter plan therefore removes the failure mode outright rather than
working around it, which is why it is preferred over the alternatives that were
considered: an external scheduled ping to keep a free instance warm, or a
warm-up request fired on page load to absorb the delay while the user is still
reading the screen. Both are workarounds for a problem that a few dollars a
month simply deletes, and both leave a window where an unlucky first visitor
still gets the bad experience.

This is worth stating plainly in the README as a deliberate infrastructure
choice made in service of the latency requirement, since it demonstrates the
constraint was treated as binding rather than aspirational.

Latency figures reported in the README are warm-path measurements, which on an
always-on instance is what every real request experiences.

### Two origins

Splitting frontend and backend across Vercel and Render means cross-origin
requests, so the backend needs explicit CORS configuration for the Vercel
domain (production and preview URLs), and the frontend needs the API base URL
as a build-time environment variable. Both are small, but both are classic
sources of a working-locally, broken-in-production surprise, so they get done
early rather than at the end.

### Secrets

`OPENAI_API_KEY` lives in `.env` locally and in the Render environment settings
in deployment, templated by the committed `.env.example`. `.env` is gitignored
and is never read, echoed, or logged. The key is used only by the backend; it
is never sent to or referenced by the frontend.

This matters more than usual here: the repository is public, so anything
committed is published immediately.

## 8. Build order

Deployment risk is front-loaded on purpose, and there are now two deployments
to prove out.

1. Scaffold both halves and deploy a placeholder to Vercel and Render on day
   one, with CORS and the API base URL wired end to end. Confirm a real request
   crosses from one to the other before writing any real logic.
2. Extraction contract, matching engine, and unit tests. Entirely offline, no
   API calls. This is the core.
3. Fixture labels and their paired application records, since they are now the
   seed queue and every screen needs them to exist.
4. LabelReader adapter and the single-label endpoint with real `gpt-4.1-mini`
   calls and latency instrumentation.
5. Review queue screen seeded from fixtures, with the reset control, plus the
   review view with confirm/override.
6. Batch verification across selected items, streamed progress, bulk confirm,
   CSV export, and the add-labels ingestion path.
7. Evaluation script, the two CI jobs with the blocking p95 latency gate,
   README, unreadable-path polish.

Stretch items (preprocessing for glare and skew) come last and only if
everything above is solid. The evaluation criteria state outright that a
working core beats an ambitious but incomplete submission.

## 9. Open risks

1. **Bold and type-size detection reliability.** Mitigated by grading softly,
   but the fixture set needs cases that specifically probe how often
   `gpt-4.1-mini` gets font weight wrong in both directions.
2. **Single-model constraint.** With no fallback model, an extraction
   regression has no escape hatch. The evaluation script is the early warning
   system.
3. **USWDS version coupling.** `@trussworks/react-uswds` and `@uswds/uswds`
   must stay on matched versions or the markup and CSS can disagree. Pin both
   and upgrade them together. If the wrapper turns out to be missing a
   component the design needs, the fallback is hand-written USWDS markup for
   that one component, not abandoning the library.
