# Forge AI — Dev Bootstrap (M1)

> **Purpose.** The single entry point for getting a fresh Forge AI v2.0
> dev environment running, from `git clone` to a green smoke test.
> Covers prerequisites, clone, `.env`, boot, verification, common
> pitfalls, and resets.
>
> **When to use it.** First time you set up the repo; first time after
> a `git pull` that touched `docker-compose.yml` or `backend/alembic/`;
> whenever the smoke test fails in a way that smells like a stale local
> environment.
>
> **Cross-link.** See [getting-started.md](../getting-started.md) for a
> 5-minute walkthrough and [seed-data.md](seed-data.md) for everything
> specific to the seed framework. The smoke validator is
> [scripts/smoke_m1.sh](../../scripts/smoke_m1.sh); the bootstrap
> script that orchestrates the full boot is
> [scripts/setup-local.sh](../../scripts/setup-local.sh).

---

## 1. Prerequisites

Forge AI v2.0 needs the following on your host:

| Tool | Version | Why | Install hint |
|---|---|---|---|
| Docker | 24+ (with the compose v2 plugin) | Runs Postgres / Redis / Keycloak / LiteLLM / floci / backend / frontend / docs-site | [Docker Desktop](https://docs.docker.com/desktop/) or `docker-ce` + `docker-compose-plugin` |
| Node | 20+ (`20.x` LTS pinned in `package.json`) | Runs `pnpm`, the Next.js dev server, and Astro/Starlight docs build | [nvm](https://github.com/nvm-sh/nvm) recommended |
| pnpm | 9+ | Monorepo package manager | `npm i -g pnpm` |
| Python | 3.13+ (project is pinned to 3.13) | Runs `uvicorn`, `pytest`, `alembic`, and the seed framework | [pyenv](https://github.com/pyenv/pyenv) recommended |
| curl, jq | any recent | `smoke_m1.sh` uses them to probe `/healthz` and Keycloak | `apt-get install -y curl jq` (or brew) |
| git | 2.40+ | Standard clone / worktree flow | preinstalled everywhere |

> **Minimum disk + RAM.** ~10 GB free for Docker volumes
> (Postgres + LiteLLM audit logs + floci S3). 16 GB RAM minimum; the
> floci emulator is lightweight but the combined dev stack prefers headroom.

Verify your toolchain:

```bash
docker --version          # Docker version 24+ ...
docker compose version    # Docker Compose version v2.x ...
node --version            # v20.x
pnpm --version            # 9.x
python3 --version         # Python 3.13.x
```

---

## 2. Clone

```bash
git clone https://github.com/forge-ai/forge-ai.git
cd forge-ai

# Optional but recommended on a feature branch:
git checkout -b feat/M1-infra-seed
```

For worktree-based parallel work (the M1 split):

```bash
git worktree add ../forge-ai-feat-m1 feat/M1-infra-seed
cd ../forge-ai-feat-m1
```

---

## 3. `.env` setup

The repo ships `.env.example` (annotated, 226 lines). Bootstrap `.env`:

```bash
cp .env.example .env
```

Then edit the values you need to override. The most common ones for a
first-time dev:

| Variable | What to set | Acceptable default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | `sk-ant-replace-me` is rejected by startup validation — see [Common pitfalls](#6-common-pitfalls) |
| `OPENAI_API_KEY` | OpenAI key (LiteLLM proxy uses this if a model needs it) | `sk-openai-replace-me` |
| `LITELLM_MASTER_KEY` | Self-chosen hex string for the LiteLLM Proxy master key | `sk-litellm-dev-replace-me` (rejected on boot unless `ALLOW_PLACEHOLDER_LLM_KEYS=true`) |
| `KEYCLOAK_ADMIN_PASSWORD` | Admin password for the Keycloak `forge` realm | `admin` (default) |
| `JWT_SECRET` | Backend JWT signing secret | any string ≥32 chars; rotate per environment |
| `LITELLM_MASTER_KEY`, `LITELLM_PROXY_URL` | LiteLLM master key & URL | defaults work for `compose up` |

> **Never commit `.env`.** It is `.gitignore`d. Production uses IAM +
> Secrets Manager.

If you only want to exercise the backend tests + seed framework (no
LLM traffic), you can keep the placeholder keys and set
`ALLOW_PLACEHOLDER_LLM_KEYS=true` in `.env` — backend startup will
accept them and `pytest` will run.

---

## 4. Boot

The single canonical entry point:

```bash
./scripts/setup-local.sh
```

It is **idempotent**: running it twice produces the same end state.
Internally it:

1. Verifies prerequisites (Docker, `docker compose`, Node, pnpm, Python).
2. Copies `.env.example` to `.env` if missing.
3. `docker compose pull` every image declared in `docker-compose.yml`.
4. `docker compose up -d --remove-orphans` to bring up `postgres`,
   `redis`, `keycloak`, `litellm`, `floci`, `backend`, `forge-ui`,
   `docs-site`.
5. Waits for `postgres` (`pg_isready`) and `keycloak` (TCP probe) to
   report healthy.
6. `alembic upgrade head` against the dev database.
7. `pip install -r backend/requirements.txt`.
8. `pnpm install --filter @forge/forge...`.
9. Prints every developer URL.

Re-runs after a `git pull`:

```bash
docker compose pull
docker compose up -d --remove-orphans
```

URLs printed by `setup-local.sh` (defaults; overridden by `.env`):

```text
Backend (FastAPI)       http://localhost:8000
Frontend (Next.js)      http://localhost:3000
Docs (Astro/Starlight)  http://localhost:4321
Postgres                localhost:5432  (user: forge)
Redis                   localhost:6379
Keycloak admin          http://localhost:8080  (admin / admin)
Keycloak realm          http://localhost:8080/realms/forge
LiteLLM Proxy           http://localhost:4000
floci (local AWS)       http://localhost:4566
```

---

## 5. Verify

Once the stack is up, run the M1 smoke test:

```bash
./scripts/smoke_m1.sh
```

It asserts the six M1 Acceptance Criteria (`AC-1..AC-6`):

| AC | What the smoke checks |
|---|---|
| AC-1 | `/healthz` returns 200 with all 7 probes green; `pytest tests/test_rls_isolation.py tests/test_healthz.py -x` exits 0 |
| AC-2 | `verify_seed_counts.py` reports every declared row count matches the data files |
| AC-3 | Keycloak `forge` realm is reachable (`/realms/forge/.well-known/openid-configuration` returns 200) |
| AC-4 | LiteLLM `chat/completions` roundtrip succeeds — skip with `--skip-llm` if `ANTHROPIC_API_KEY` is a placeholder |
| AC-5 | RLS isolation test passes (INSERT tenant A → CRUD tenant B touches 0 rows) |
| AC-6 | `docs/operations/dev-bootstrap.md` + `docs/operations/seed-data.md` present |

Useful flags for the smoke:

```bash
./scripts/smoke_m1.sh --skip-boot     # stack already up, don't restart
./scripts/smoke_m1.sh --skip-llm      # no ANTHROPIC_API_KEY
./scripts/smoke_m1.sh --skip-auth     # no Keycloak admin access
./scripts/smoke_m1.sh --max-wait 120  # tighten the /healthz wait to 2 min
./scripts/smoke_m1.sh --help          # all flags + exit codes
```

The smoke prints a per-AC verdict and exits non-zero on any failure.

If you want to verify the seed framework without a database:

```bash
python3 backend/scripts/verify_seed_counts.py        # text report
python3 backend/scripts/verify_seed_counts.py acme-corp
python3 backend/scripts/verify_seed_counts.py --json # machine-readable
```

If you want to drive the seed runner manually:

```bash
cd backend && python -m seeds apply acme-corp      # applies idempotently
cd backend && python -m seeds status               # inspects seed_runs
cd backend && python -m seeds status acme-corp
cd backend && python -m seeds reset acme-corp --confirm
```

(The `python -m seeds` entrypoint is shipped under Track B — T1.10.
Until that lands, use the API path: `POST /api/v1/seeds/acme-corp/apply`
with a Steward-role JWT.)

---

## 6. Common pitfalls

### Pitfall: backend refuses to boot with "Refusing to boot with placeholder LLM keys"

**Symptom**

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
  Value error, Refusing to boot with placeholder LLM keys: anthropic_api_key,
  litellm_master_key, openai_api_key. Set real values in your environment
  (...), or set ALLOW_PLACEHOLDER_LLM_KEYS=true to bypass (dev/test only).
```

**Cause**

The M1 startup validator (Track A — `backend/app/core/config.py`)
rejects `*-replace-me` placeholders so a dev never accidentally hits
production LiteLLM with no real LLM credentials.

**Fix**

Either set the real keys in `.env`, or — for local-only/pytest runs
where you do not need live LLM traffic — set
`ALLOW_PLACEHOLDER_LLM_KEYS=true` in `.env` and re-run
`docker compose restart backend`.

### Pitfall: `/healthz` returns 503 on a fresh stack

**Symptom**

```text
[smoke] /healthz never returned 200 within 300s
```

**Cause**

The compose stack declares healthchecks but one of the upstream
services (most often `keycloak` or `litellm`) is still starting.

**Fix**

```bash
docker compose ps                # which service is unhealthy?
docker compose logs -f keycloak  # tail logs
```

Keycloak can take 60–90s on first boot (it imports the realm export);
LiteLLM waits on Postgres + Keycloak. If they fail healthchecks, run:

```bash
docker compose down floci keycloak litellm
docker compose up -d postgres redis keycloak
# Wait until /health/ready on Keycloak returns 200, then:
docker compose up -d litellm floci backend forge-ui docs-site
```

### Pitfall: RLS test complains `phase4_oauth_clients.scopes` cannot compile on SQLite

**Symptom**

```text
sqlalchemy.exc.CompileError: (in table 'phase4_oauth_clients', column 'scopes'):
Compiler <sqlalchemy.dialects.sqlite.base.SQLiteTypeCompiler object at 0x...>
can't render element of type ARRAY
```

**Cause**

A handful of `phase4_*` models declare Postgres-only `ARRAY(Text)`
columns. SQLite's type compiler cannot render those, so any
`metadata.create_all` against an SQLite engine (e.g. the shared
`sqlite_db` test fixture) fails before tests can even start.

**Fix**

`backend/tests/test_rls_isolation.py` ships its own `sqlite_rls`
fixture that creates tables one at a time and skips any whose DDL
the SQLite compiler cannot render. The shared `sqlite_db` fixture is
left untouched on purpose; if your own tests need all-tables-on-SQLite,
use `pytest.skip()` against SQLite as the docs explicitly recommend
running those tests against real Postgres instead.

### Pitfall: `setup-local.sh` says "missing required command: docker compose v2 plugin"

**Symptom**

```text
[setup] docker compose v2 plugin not found. Install the 'docker-compose-plugin'.
```

**Cause**

`docker-compose` v1 (binary) is on `PATH`, but the v2 plugin (shipped
as a Docker Desktop / `docker-ce` extension) is not.

**Fix**

```bash
# Debian / Ubuntu:
sudo apt-get install docker-compose-plugin

# macOS:
brew install docker docker-compose

# Verify:
docker compose version
```

### Pitfall: alembic migration fails with "relation already exists"

**Symptom**

```text
alembic.exc.ProgrammingError: relation "x" already exists
```

**Cause**

You probably ran an old `backend/alembic` against a database whose
volume was not removed. The migration history is inconsistent with the
current schema.

**Fix**

```bash
docker compose down
docker volume ls | grep forge         # find the volume
docker volume rm forge_postgres_data  # safe to drop on dev
./scripts/setup-local.sh              # re-runs alembic upgrade head
```

### Pitfall: Keycloak login redirects to 404 after Keycloak restart

**Symptom**

Browser shows `404 Not Found` after Keycloak login when
`forge-realm.json` changed underfoot.

**Cause**

Keycloak caches the realm export on its first boot and re-imports it
only on missing realm. If you edit realm JSON after Keycloak already
imported it, the live realm is stale.

**Fix**

```bash
docker compose down keycloak
docker volume rm forge_keycloak_data  # drops the imported realm
docker compose up -d keycloak         # imports the canonical realm on boot
```

### Pitfall: `pnpm install` runs out of memory

**Symptom**

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**Cause**

Large monorepo with many transitive deps; pnpm's default heap (2 GB)
is not enough on machines with ≤8 GB free RAM.

**Fix**

```bash
NODE_OPTIONS="--max-old-space-size=4096" pnpm install --filter @forge/forge...
```

### Pitfall: 500 from `app/main.py` imports at module-load time

**Symptom**

```text
ImportError: cannot import name 'Settings' from partially initialized module ...
```

**Cause**

A new dependency was added to `app/core/<x>.py` but its environment
variable isn't in `.env.example` yet, so `Settings()` raises a
pydantic validation error during first import.

**Fix**

Add the variable to `.env.example`, then re-run `setup-local.sh`. If
you are in the middle of a Track A change, copy the new var's default
from the new pydantic model and put it in `.env`. `docker compose
restart backend` reloads.

---

## 7. Reset seed

The seed framework is idempotent — re-applying is a no-op — but when
you want to reset to a clean demo state:

```bash
# Drop only the rows owned by the demo seeds (Steward role required):
cd backend && python -m seeds reset acme-corp --confirm
# OR via the API:
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/reset \
     -H "Authorization: Bearer $STEWARD_JWT"
```

After a reset, re-apply to repopulate:

```bash
cd backend && python -m seeds apply acme-corp
# Or let boot do it on the next backend start.
```

Tracked run history lives in `seed_runs` (query with `psql`):

```bash
docker compose exec postgres psql -U forge -d forge \
  -c "SELECT seed_name, manifest_version, status, started_at, duration_ms
        FROM seed_runs
        ORDER BY started_at DESC
        LIMIT 10;"
```

See [seed-data.md](seed-data.md) for the full operator guide.

---

## 8. Reset DB

When the schema drifts (typically after a manual alembic revision that
isn't being applied):

```bash
# Stop the dev stack and drop the Postgres volume:
docker compose down
docker volume rm forge_postgres_data

# Re-boot — setup-local.sh runs `alembic upgrade head` and auto-seeds:
./scripts/setup-local.sh
```

> **This deletes ALL demo tenant data.** The seed framework will
> re-populate `acme-corp` + `kn-base` on next backend start, but any
> ad-hoc test rows you wrote are gone.

---

## 9. Reset everything

The nuclear option:

```bash
docker compose down -v             # drops every volume (Postgres, Redis, keycloak, floci S3)
docker system prune -af            # drops every dangling image / network
rm -rf backend/.venv apps/forge/node_modules   # drops host-only venv + node_modules

# Fresh start:
git clean -fdx .                   # ONLY if you are sure you have nothing untracked worth keeping
./scripts/setup-local.sh
```

> **Do not run `git clean -fdx` unless you mean it.** It deletes every
> untracked file (including `.env`, worktree metadata, and your day-old
> `idea-data.json`).

---

## Appendix A: Reading order

If this is your first day:

1. [README.md](../../README.md) — repo orientation.
2. [docs/getting-started.md](../getting-started.md) — 5-minute walkthrough.
3. [docs/project-context.md](../project-context.md) — the 18 constitutional rules.
4. [docs/architecture/overview.md](../architecture/overview.md) — high-level architecture map.
5. **This doc** — bootstrap.
6. [docs/operations/seed-data.md](seed-data.md) — seed framework operator guide.
7. [docs/operations/oncall-runbook.md](oncall-runbook.md) — health checks + common alerts.

## Appendix B: Where to file issues

- A pitfall not covered above? Add it to §6 (Common pitfalls).
- A seed manifest drift? File against the seed package owner and add
  the package name + the `seed_runs.checksum_after` delta.
- A RLS regression (RLS test catches a bypass)? File as **High**
  severity — M1 blocks M2 start until fixed.
