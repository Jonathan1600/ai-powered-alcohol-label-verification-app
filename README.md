# TTB Label Verification

AI-assisted alcohol label verification prototype for the TTB. A compliance
agent's review queue: label images are read by a vision model (structured
extraction only), and every verdict is computed by a deterministic matching
engine. The tool recommends; the agent decides.

Design docs: [docs/approach.md](docs/approach.md) (full reasoning),
[docs/architecture.md](docs/architecture.md) (diagrams and decision records),
[docs/build-plan.md](docs/build-plan.md) (phased action plan),
[docs/assumptions.md](docs/assumptions.md) (every constant and where it came
from), and [docs/fixtures.md](docs/fixtures.md) (the seed and evaluation
corpus), and [docs/accessibility.md](docs/accessibility.md) (the focused
accessibility review and release checklist).

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | React + Vite + TypeScript, USWDS via `@trussworks/react-uswds` |
| `backend/` | Python + FastAPI, managed with [uv](https://docs.astral.sh/uv/) |
| `docs/` | Approach document, architecture/decision records, build plan, assumptions, fixture corpus |
| `backend/fixtures/` | 44 committed seed labels, thumbnails, and the manifest carrying their expected verdicts |
| `backend/tools/` | The deterministic fixture generator, plus `probe_extraction.py` for prompt iteration |
| `render.yaml` | Render blueprint for the backend (deploy-ready, not yet deployed) |
| `.env.example` | Template for the single repo-root `.env` used by both halves |

## Prerequisites

- Python 3.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 20+ (developed on 24)
- An OpenAI API key. Needed for `POST /api/verify` and the `live` tests. The
  health check, the seed queue, and the whole offline test suite run without
  one.

## Setup

Copy the environment template and fill in your values:

```bash
cp .env.example .env
```

`.env` lives at the repo root and serves both halves: the backend reads it
directly, and Vite is configured (`envDir`) to read the `VITE_`-prefixed
variables from the same file. It is gitignored and must never be committed.

## Run

Backend (from `backend/`):

```bash
uv sync
```

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Frontend (from `frontend/`):

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The page performs a live call to the backend's
`/api/health` endpoint, so a green "Backend connected" alert confirms CORS and
the API base URL are wired correctly end to end.

## Tests

From `backend/`. This runs offline and needs no API key, which is deliberate:
the matching engine is the part worth testing hardest and it must stay
independently testable.

```bash
uv run pytest
```

```bash
uv run ruff check .
```

Live tests that call the real model are marked `live` and deselected by
default. They cost a small amount of money per run.

```bash
uv run pytest -m live
```

From `frontend/`:

```bash
npm run test
```

CI runs the offline suites plus the frontend build on every push and pull
request. A separate live evaluation gate runs on the latest same-repository PR
revision only, so real-model calls are not duplicated across pushes. It needs a
reviewed baseline before it can pass; fork PRs cannot run it because GitHub does
not expose repository secrets to forks.

### Live evaluation

The evaluator uses one warm-up plus one sequential call per committed fixture,
with no automatic retry. Its local mode is the pre-merge regression gate:

```bash
uv run python -m tools.evaluate --target local --json-output evaluation-report.json
```

This is a live OpenAI evaluation, not an offline test. Put `OPENAI_API_KEY` in
the repository-root `.env` before running it. A `Missing credentials` error
means that variable is absent from both the shell and `.env`.

After deploying the backend, measure the Render endpoint separately. This is
the deployed-backend path, not browser render time:

```bash
EVALUATION_API_BASE_URL=https://your-service.onrender.com \
  uv run python -m tools.evaluate --target deployed --json-output evaluation-report.json
```

Only after reviewing healthy reports, create the local baseline and then append
the deployed baseline to the same committed file:

```bash
uv run python -m tools.evaluate --accept-report evaluation-report.json

EVALUATION_API_BASE_URL=https://your-service.onrender.com \
  uv run python -m tools.evaluate --target deployed --json-output deployed-evaluation-report.json
uv run python -m tools.evaluate --accept-report deployed-evaluation-report.json
```

The initial report-only run succeeds even without a baseline; CI still fails
before making model calls until the approved file is committed.

The baseline binds the manifest hash and model. Prompt version is retained as
review metadata so a prompt change is evaluated against the existing approved
thresholds without requiring a new baseline on every PR. The gate blocks unsafe
false-clears, failed fixture calls, material accuracy regression, and p95 more
than 25% above the approved measurement; it does not falsely claim the current
five-second product requirement is met.

### GPT-5.6 Luna migration

The active extraction configuration is `gpt-5.6-luna` with explicit low
reasoning effort. Luna supports the Responses API, image input, and structured
outputs used by this service. The committed baseline below is historical
`gpt-4.1-mini` evidence, so it must be replaced only after a reviewed Luna live
evaluation; until then the live CI gate will intentionally reject it as a
different model identity.

### Current local evaluation evidence

The repository contains a reviewed local baseline for the committed 44-fixture
corpus. The Phase 9 review run used one warm-up and one unretried call per
fixture; it passed that gate without unsafe false-clears:

| Measure | Result |
| --- | --- |
| Overall-status accuracy | 77.3% (10 errors) |
| Field-verdict accuracy | 92.1% (21 of 266 field verdicts incorrect) |
| Model-call p50 | 4.62 seconds |
| Model-call p95 | 7.81 seconds |

These are local-reader model-call measurements, not end-to-end browser times
and not Render measurements. They do not establish that the five-second
user-experience requirement is met. The deployed path remains unmeasured until
the separate `--target deployed` command is run after deployment.

For the same-repository PR gate, add the key separately as the repository
Actions secret `OPENAI_API_KEY` under **Settings → Secrets and variables →
Actions**. A local `.env` and Render's environment settings are intentionally
unavailable to GitHub-hosted runners. The manual deployed mode instead needs the
repository variable `EVALUATION_API_BASE_URL`.

## Verifying a label

`POST /api/verify` takes a multipart form with the label image and the claimed
application record, and returns per-field verdicts with server-side stage
timings.

```bash
curl -X POST http://localhost:8000/api/verify   -F "image=@backend/fixtures/images/clean-bourbon-750.png"   -F 'application={"brand_name":"Copper Kettle","class_type":"Kentucky Straight Bourbon Whiskey","alcohol_content":"45% Alc./Vol. (90 Proof)","net_contents":"750 mL","bottler_info":"Bottled by Copper Kettle Distillery, 480 Rickhouse Rd, Bardstown, KY","beverage_class":"distilled_spirits","is_import":false}'
```

To iterate on the extraction prompt, `tools/probe_extraction.py` shows a reading
beside the fixture's ground truth:

```bash
uv run python -m tools.probe_extraction --all-warnings
```

### Measured latency

The current local evidence is the Phase 9 44-fixture run above: model-call p50
4.62 seconds and p95 7.81 seconds. It is still not an end-to-end measurement,
and p95 exceeds the five-second product requirement. The deployed path has not
been measured, so no deployed performance claim is made. Historical Phase 4
measurements and the investigation of payload, rate limiting, and `detail` are
preserved in [docs/approach.md](docs/approach.md) section 6.

## Design choices and limits

- Nothing is persisted: the backend discards request images and queue decisions
  live only in the browser session. The reset control clears that session work.
- The 44 synthetic seed labels stand in for applications that a future COLA
  integration would provide; this prototype does not connect to COLA or make
  approval decisions.
- The statutory warning wording and capitalization are strict. Bold and type
  size are soft `needs review` signals because a photograph is not reliable
  enough to make either a hard failure.
- The prototype uses OpenAI behind `LabelReader`. That adapter is the production
  seam for a self-hosted vision or OCR reader if the documented firewall
  constraint prevents cloud access.
- Render Starter is intentional: an always-on backend avoids the free tier's
  idle cold start. Deployment is still pending, so this has not yet been
  measured in production.

## Batch verification and adding labels

The queue's action bar runs the 200-to-300-item importer scenario: verify all
unchecked (or a selection) through a pool of 6 concurrent calls, with per-item
progress, a stop control, and a halt after 5 consecutive provider failures.
The grid order holds still while a run is in flight (ADR-013); problems
surface through a live counter and a sort-on-demand control.

**Add labels** ingests images plus one CSV of application rows, matched by the
CSV's `image` column to each file's name. Columns:

```
image, application_reference, brand_name, class_type, alcohol_content,
net_contents, bottler_info, beverage_class, is_import, country_of_origin
```

`beverage_class` is one of `wine`, `distilled_spirits`, or `malt_beverage`;
`is_import` reads true/false (also yes/no, 1/0); `country_of_origin` is
required only when `is_import` is true, because the engine only compares it on
imports. Validation is all-or-nothing: every problem is reported at once,
against spreadsheet row numbers, and nothing enters the queue until the file is
clean. Added labels live entirely in the browser and are posted to the same
`/api/verify` as seeded items (ADR-014); they do not survive a reload.

**Export CSV** writes the whole queue, unchecked items included: the
recommendation, per-field verdicts, the agent's decision (with the corrected
status and note on an override), and the server time for each checked result.
Cells that a spreadsheet would run as formulas are neutralised with a leading
apostrophe.

## Seed fixtures

The demo queue is served from 44 committed synthetic labels that also back the
engine tests and form the evaluation set. `GET /api/seed/queue` returns them,
all unverified.

The images are committed, so nothing needs regenerating to run or deploy the
app. To rebuild them after editing `backend/tools/fixtures/specs.py`:

```bash
cd backend && uv sync --group fixtures && uv run python -m tools.generate_fixtures
```

Pillow lives in its own `fixtures` dependency group, so neither CI nor the
Render build installs it. See [docs/fixtures.md](docs/fixtures.md) for the
corpus inventory and the rendering decisions behind it.

## Deployment

Backend on Render, frontend on Vercel. Not yet live; these are the steps to
bring it up.

**Do these in order.** Each half needs the other's URL, so the sequence is:
deploy the backend, deploy the frontend against it, then point the backend's
CORS allowlist back at the frontend.

### 1. Backend on Render

The repo already contains a valid [render.yaml](render.yaml), so the blueprint
route is fewer steps and fewer chances to mistype a field.

**Option A, blueprint (recommended).** In Render choose **New > Blueprint**,
point it at this repository, and let it read `render.yaml`. Every setting below
is already declared there. You only need to supply the two secrets in step 1.3.

**Option B, manual web service.** Choose **New > Web Service** and fill in:

| Field | Value |
| --- | --- |
| Language / Runtime | Python 3 |
| Root Directory | `backend` |
| Build Command | `pip install uv && uv sync --frozen --no-dev` |
| Start Command | `uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance Type | **Starter** (not Free) |

Two notes on those values:

- `render.yaml` declares the build command as `uv sync --frozen --no-dev`,
  which assumes `uv` is already present on the image. Prefixing
  `pip install uv &&` makes it work regardless and costs a few seconds. Drop
  the prefix if the image turns out to ship `uv`.
- Leave `$PORT` as a literal. Render injects it at runtime, and hardcoding
  `8000` will cause the service to fail its health check.

**1.3 Environment variables.** Both are marked `sync: false` in the blueprint,
meaning they are never stored in the repo and must be set in the dashboard:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your key |
| `ALLOWED_ORIGINS` | Leave empty for now; filled in step 3 |

**Instance type is a design decision, not a default.** Free-tier services spin
down after 15 minutes idle and take roughly a minute to wake, which would put a
cold start longer than the entire latency budget in front of the first reviewer
request. Starter is always-on. See ADR-007 in
[docs/architecture.md](docs/architecture.md).

**Verify:** `GET https://<your-service>.onrender.com/api/health` returns
`{"status":"ok","model":"gpt-5.6-luna"}`.

### 2. Frontend on Vercel

Import the repository and set:

| Field | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |

Root Directory matters: there is no `vercel.json`, so without it Vercel builds
from the repository root and finds no application.

**Environment variable:**

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | The Render URL from step 1, no trailing slash |

Vite inlines `VITE_`-prefixed variables at **build** time, so changing this
later requires a redeploy. Restarting is not enough.

### Vercel Web Analytics

The frontend includes Vercel Web Analytics for aggregate page-view telemetry;
enable Web Analytics in the Vercel project's **Analytics** tab after deploying.

### 3. Close the CORS loop

Back in Render, set `ALLOWED_ORIGINS` to the Vercel production domain and
redeploy the backend.

**Verify the whole path:** open the Vercel URL. A green "Backend connected"
alert means the frontend reached the backend across origins and CORS is
correct. A red alert with a CORS error in the browser console means
`ALLOWED_ORIGINS` does not match the domain the browser actually sent.

### Known limitation: Vercel preview deployments

Preview URLs are generated per deployment, so a fixed `ALLOWED_ORIGINS` list
cannot cover them. Production works; previews fail CORS.

Two options: accept production-only backend access for the prototype, or change
the middleware in `backend/app/main.py` from `allow_origins` to
`allow_origin_regex` matching the Vercel preview domain pattern. The current
code uses the fixed list.
