# Dev Stack Validation — 2026-06-21

Validation run after adding the `docs-site` (Astro.js 5 + Starlight)
service to the docker-compose dev stack.

## Compose Validation

- `docker compose config --quiet`: **PASS** (exit 0)
- Services (8, was 7):
  - `postgres`
  - `redis`
  - `floci`
  - `keycloak`
  - `litellm`
  - `backend`
  - `forge-ui`
  - `docs-site` (NEW — Astro 5 + Starlight on :4321)
- Volumes (3, unchanged):
  - `forge-postgres-data`
  - `forge-redis-data`
  - `forge-floci-data`
- `docs-site` resolved block:
  - build context `./docs-site`, dockerfile `Dockerfile`
  - container_name `forge-docs`
  - ports `${DOCS_SITE_PORT:-4321}:4321`
  - depends_on `backend` (service_started)
  - environment: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4321`
  - network `forge-net`
  - no healthcheck at the compose layer (provided by Dockerfile `HEALTHCHECK`)

## Image Build

- `docker compose build docs-site`: **PASS**
- Build context size: 5.11 kB (lean — `.dockerignore` excludes `node_modules`, `.astro`, `dist`)
- Multi-stage Dockerfile produces:
  - `forge-dev-docs-site` (final runtime image)
  - Built-in `HEALTHCHECK` pings `http://127.0.0.1:4321/` every 30s
- Static output: **69 HTML pages** generated from 68 markdown sources
  + homepage + 404 fallback. Pagefind indexed 68 pages (3595 words).

## Container Smoke Test

- `docker run --rm -d -p 4321:4321 forge-dev-docs-site`: starts cleanly
- Healthcheck state: `healthy` after ~8s (within `start_period: 15s`)
- HTTP probes:
  - `GET /` → 200 (24 457 B)
  - `GET /start-here/quickstart/` → 200 (54 518 B)
  - `GET /concepts/knowledge-graph/` → 200 (45 432 B)
  - `GET /architecture/adr-001-aws/` → 200 (43 192 B)
  - `GET /commands/code-review/` → 200 (51 168 B)
  - `GET /commands/` → 200 (53 267 B)
  - `GET /this-page-does-not-exist/` → 404 (7 999 B, custom Starlight 404)
- Sample page DOM: `<title>Quickstart | Forge AI</title>`

## Scripts

- `setup-local.sh`: `bash -n` **PASS**
- `deploy.sh`: `bash -n` **PASS**
- `floci-init/01-create-buckets.sh`: `bash -n` **PASS`

## Python

- `backend/app/main.py`: `python3 -m py_compile` **PASS**
- `backend/app/services/forge_commands.py`: `python3 -m py_compile` **PASS**
- `backend/app/agents/sdlc_agent.py`: `python3 -m py_compile` **PASS**

## Files Touched

- `docker-compose.yml` — added `docs-site` service block (existing services untouched)
- `.env.example` — added `DOCS_SITE_PORT=4321` and section header
- `docs-site/Dockerfile` — new, multi-stage build (deps / build / runtime)
- `docs-site/.dockerignore` — new, excludes `node_modules`, `.astro`, `dist`, env files
- `docs-site/src/content.config.ts` — new, declares `docs` collection with Starlight's `docsSchema()` so production-mode defaults apply
- `docs-site/astro.config.mjs` — `social` field repared from array to Starlight's expected `{ github: string }` object
- `scripts/setup-local.sh` — added non-fatal `docs-site` health probe + URL print
- `scripts/README.md` — added `docs-site/Dockerfile` row and `docs-site` mention in stack list

## Issues Found & Resolved

1. **Starlight `social` schema mismatch.** The existing
   `docs-site/astro.config.mjs` declared `social` as an array of
   `{ icon, label, href }`. Starlight 0.30's Zod schema expects
   `{ [platform]: string }`. Build failed with `social: Expected
   type "object", received "array"`. **Fix:** rewrote as
   `social: { github: 'https://github.com/forge-ai/forge-ai' }`.

2. **Starlight docs collection returned 0 routes.** Initial
   `docker compose build docs-site` succeeded but only emitted
   `/404.html` and `/`. Root cause: `docs-site` had no
   `src/content.config.ts`, so Astro 5 fell back to legacy
   collections, but with a flat schema that lacks Starlight's
   defaults. Specifically, the production-mode filter in
   `@astrojs/starlight/utils/routing.ts`
   (`data.draft === false`) excluded every markdown file because
   none declared `draft: false`. **Fix:** added
   `docs-site/src/content.config.ts` that registers the `docs`
   collection with `docsLoader()` and `docsSchema()` so the
   Starlight frontmatter defaults apply. Build now emits 69 pages.

3. **Healthcheck IPv6 resolution.** Alpine's `wget` resolves
   `localhost` to `[::1]` first; the Astro preview server only
   binds `0.0.0.0`. **Fix:** changed the healthcheck URL to
   `http://127.0.0.1:4321/`. After the fix the container reports
   `healthy` within the start period.

## Next Steps

- `docker compose up -d` — confirm the full stack boots cleanly
  end-to-end (postgres → redis → keycloak → litellm → floci →
  backend → forge-ui → docs-site). Note: brings up multiple large
  images; first boot will pull ~1 GB.
- Consider wiring `docs-site` as a workspace into
  `docs-site/package.json` so contributors can `pnpm --filter
  forge-ai-docs dev` for hot reload outside Docker.
- `scripts/setup-local.sh` currently `warn`s on docs-site health
  failures (docs are not on the request path). Promote to `fail`
  once CI smoke runs against the full stack.

## How To Run

```bash
cp .env.example .env          # if not already done
./scripts/setup-local.sh      # first-time bootstrap (now includes docs-site)
docker compose up -d          # subsequent boots
open http://localhost:4321    # Astro/Starlight docs
```
