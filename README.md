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
corpus).

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
request. The accuracy and latency gate (real model calls) is planned for
build-order step 7; see [docs/approach.md](docs/approach.md) section 6, which
also records why its threshold cannot be the one originally stated.

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

Not yet meeting the 5 second requirement, and the gap is large enough to state
plainly rather than round off. From a residential connection, warm, the
extraction call alone measured a p50 between 5 and 7 seconds and a p95 of 20.4
seconds across the fixture corpus. Rate limiting, image payload size, and the
image `detail` parameter were each ruled out by measurement rather than by
argument.

The deployed path has not been measured, so the number that matters does not
exist yet. [docs/approach.md](docs/approach.md) section 6 carries the full
measurement and the three available responses.

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
`{"status":"ok","model":"gpt-4.1-mini"}`.

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
