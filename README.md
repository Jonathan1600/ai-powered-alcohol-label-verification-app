# TTB Label Verification

AI-assisted alcohol label verification prototype for the TTB. A compliance
agent's review queue: label images are read by a vision model (structured
extraction only), and every verdict is computed by a deterministic matching
engine. The tool recommends; the agent decides.

Design docs: [docs/approach.md](docs/approach.md) (full reasoning and build
plan) and [docs/architecture.md](docs/architecture.md) (diagrams and decision
records).

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | React + Vite + TypeScript, USWDS via `@trussworks/react-uswds` |
| `backend/` | Python + FastAPI, managed with [uv](https://docs.astral.sh/uv/) |
| `docs/` | Approach document and architecture/decision records |
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

## Deployment (planned, not yet live)

- **Frontend:** Vercel, auto-detected Vite build from `frontend/`. Set
  `VITE_API_BASE_URL` to the Render URL in the Vercel project settings.
- **Backend:** Render via [render.yaml](render.yaml), on the paid Starter
  instance. Always-on is a deliberate choice in service of the hard 5-second
  latency requirement: free-tier spin-down would put a ~1 minute cold start in
  front of the first reviewer request (ADR-007). Set `OPENAI_API_KEY` and
  `ALLOWED_ORIGINS` (the Vercel production and preview origins) in the Render
  dashboard.
