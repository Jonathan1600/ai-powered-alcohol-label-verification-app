# TTB Label Verification

AI-assisted alcohol label verification prototype for the TTB. A compliance
agent's review queue: label images are read by a vision model (structured
extraction only), and every verdict is computed by a deterministic matching
engine. The tool recommends; the agent decides.

Design docs: [docs/approach.md](docs/approach.md) (full reasoning),
[docs/architecture.md](docs/architecture.md) (diagrams and decision records),
and [docs/build-plan.md](docs/build-plan.md) (phased action plan).

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | React + Vite + TypeScript, USWDS via `@trussworks/react-uswds` |
| `backend/` | Python + FastAPI, managed with [uv](https://docs.astral.sh/uv/) |
| `docs/` | Approach document, architecture/decision records, build plan |
| `render.yaml` | Render blueprint for the backend (deploy-ready, not yet deployed) |
| `.env.example` | Template for the single repo-root `.env` used by both halves |

## Prerequisites

- Python 3.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 20+ (developed on 24)
- An OpenAI API key (only needed once real extraction endpoints exist; the
  health check runs without one)

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

From `backend/`:

```bash
uv run pytest
```

```bash
uv run ruff check .
```

CI runs these offline checks plus the frontend build on every push and pull
request. The accuracy and latency gate (real model calls, blocking on warm p95
under 5 seconds) is planned for build-order step 7; see
[docs/approach.md](docs/approach.md) section 6.

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
