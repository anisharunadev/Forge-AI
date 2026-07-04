# Forge AI — Seed Data (M1)

> **Purpose.** The single operator guide for the Forge AI v2.0 seed
> framework. Documents every installed seed package, the row counts it
> ships, the canonical UUIDs used in M1 dogfood, and the workflows for
> adding a new package, re-applying, and inspecting run history.
>
> **When to use it.** During dogfood (so you know what "the demo
> tenant" actually contains); when adding a new demo or reference seed
> package; when resetting or diffing the demo state; when debugging a
> drifted `seed_runs` row.
>
> **Cross-link.** The seed framework itself is described in the
> backend README and in `backend/seeds/framework/seed_runner.py`. The
> bootstrap contract is in
> [docs/operations/dev-bootstrap.md](dev-bootstrap.md). The data
> validator script is
> [backend/scripts/verify_seed_counts.py](../../backend/scripts/verify_seed_counts.py).

---

## 1. Package catalog

The seed packages live under `backend/seeds/packages/`. Two ship with
M1:

| Package | Tenant type | Allow in prod? | Total rows | Use case |
|---|---|---|---|---|
| `acme-corp` | `demo` | **no** | 1,035 | Pilots, dogfood, UI demos |
| `kn-base` | `reference` | **yes** | 23 | Auto-applied on every new tenant via the F-507 day-one bootstrap |

> **Production safety.** `acme-corp` carries
> `production_safety.allow_in_prod = false`. The runner refuses to apply
> it against `environment=production` unless the caller passes
> `--allow-in-prod`. `kn-base` is allowed in production because every
> new tenant needs standards, templates, policies, and tool bundles
> regardless of demo state.

Add a third column to the same row when a new package ships — for
example, `acme-secondary` for a second demo tenant or `customer-acme`
for a real customer onboarding seed.

---

## 2. acme-corp — row counts

`acme-corp` ships **1,035 rows** spread across **23 tables**. The full
per-table count is asserted by the manifest and enforced by
`tests/seeds/test_acme_corp_integrity.py` and
`backend/scripts/verify_seed_counts.py`.

| Table | Rows | Order | Natural key |
|---|---:|---:|---|
| `tenants` | 1 | 1 | `slug` |
| `users` | 8 | 2 | `(tenant_id, email)` |
| `roles` | 6 | 3 | `(tenant_id, name)` |
| `rbac_assignments` | 24 | 4 | `(tenant_id, user_id, role_id)` |
| `projects` | 1 | 5 | `(tenant_id, name)` |
| `repos` | 14 | 6 | `(tenant_id, source_url)` |
| `connectors` | 5 | 7 | `(tenant_id, project_id, type)` |
| `architecture_adrs` | 18 | 8 | `(tenant_id, project_id, number)` |
| `architecture_api_contracts` | 12 | 9 | `(tenant_id, project_id, name, version)` |
| `architecture_risk_registers` | 8 | 10 | `(tenant_id, project_id, name)` |
| `agents` | 15 | 11 | `(tenant_id, name)` |
| `artifacts` | 150 | 12 | `(tenant_id, type, version)` |
| `hooks` | 10 | 13 | `(tenant_id, name)` |
| `roadmaps` | 4 | 14 | `(tenant_id, project_id, name)` |
| `ideas` | 50 | 15 | `(tenant_id, project_id, title)` |
| `idea_analyses` | 50 | 16 | `(tenant_id, idea_id)` |
| `opportunity_scores` | 50 | 17 | `(tenant_id, idea_id)` |
| `prds` | 6 | 18 | `(tenant_id, project_id, idea_id, version)` |
| `workflow_sessions` | 30 | 19 | `(tenant_id, project_id, name)` |
| `workflow_steps` | 120 | 20 | `(tenant_id, session_id, step_number)` |
| `graph_nodes` | 200 | 21 | `(tenant_id, node_key)` |
| `graph_edges` | 250 | 22 | `(tenant_id, source_node_key, target_node_key, edge_kind)` |
| `conflicts` | 3 | 23 | `(tenant_id, title)` |

**Insert order matters.** The `order` column tells the runner which
data file to load first so foreign keys resolve. `tenants` is inserted
before `users`; `projects` before every table that FKs into it; `ideas`
before `idea_analyses`, `opportunity_scores`, `prds`, and
`workflow_sessions`. The reference resolver (`_id_ref` pointers in
data files) also walks in `order`.

### Stable IDs

The package uses stable, hard-coded UUIDs so the same set of related
rows is identifiable across reseeds, exports, and tests:

| Entity | UUID range |
|---|---|
| Tenant | `11111111-1111-1111-1111-111111111111` |
| Project | `22222222-2222-2222-2222-222222222222` |
| User | `33333333-3333-3333-3333-33333333NNNN` |
| Role | `44444444-4444-4444-4444-44444444NNNN` |
| Repo | `55555555-5555-5555-5555-55555555NNNN` |
| Connector | `77777777-7777-7777-7777-77777777NNNN` |
| ADR | `88888888-8888-8888-8888-88888888NNNN` |
| API contract | `99999999-9999-9999-9999-99999999NNNN` |
| Risk register | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` |
| Workflow session | `cccccccc-cccc-cccc-cccc-ccccccccccNN` |

> If your tests reference tenant `11111111-...-111`, that is `acme-corp`.
> Hand-rolled keys make cross-package conflict assertions easy (e.g.
> a graph edge from `acme-corp` to a kn-base template).

### Users

Eight demo users, mapped 1:1 to persona-cookie logins in dev:

| Email | Title | Keycloak `sub` |
|---|---|---|
| `sarah.chen@acme-corp.dev` | Platform Steward | `kc-acme-sarah-chen` |
| `mike.patel@acme-corp.dev` | Tech Lead | `kc-acme-mike-patel` |
| `elena.rodriguez@acme-corp.dev` | Principal Architect | `kc-acme-elena-rodriguez` |
| `james.wright@acme-corp.dev` | Senior Developer | `kc-acme-james-wright` |
| `priya.nair@acme-corp.dev` | Security Engineer | `kc-acme-priya-nair` |
| `robert.kim@acme-corp.dev` | VP Engineering (Sponsor) | `kc-acme-robert-kim` |
| `alex.morgan@acme-corp.dev` | DevOps Engineer | `kc-acme-alex-morgan` |
| `lisa.zhang@acme-corp.dev` | Platform DevOps Engineer | `kc-acme-lisa-zhang` |

If you sign in via the dev persona-cookie flow (`NODE_ENV=development`),
the cookie maps a display name to one of these accounts so the UI
behaves like the real user.

### Roles

Six named RBAC roles, applied via 24 `rbac_assignments`:

| Role | Sample permissions |
|---|---|
| `steward` | `tenant:manage`, `seeds:manage`, `seeds:reset:all`, `audit:view` |
| `tech_lead` | `artifact:create`, `artifact:approve`, `workflow:run` |
| `architect` | `adr:*`, `api_contract:*`, `risk_register:*` |
| `developer` | `story:*`, `task:*`, `comment:create` |
| `security` | `security_report:*`, `guardrail:manage` |
| `sponsor` | `roadmap:approve`, `approval:approve`, read-only on most artifacts |

### Repos

14 GitHub repositories anchored to the single `Acme Platform` project:

- 12 microservices (`acme-frontend`, `acme-api-gateway`, `acme-cart`,
  `acme-checkout`, `acme-payment`, `acme-inventory`, `acme-catalog`,
  `acme-search`, `acme-recommendations`, `acme-fulfillment`,
  `acme-shipping`, `acme-notifications`).
- 2 shared libraries (`acme-shared-types`, `acme-shared-utils`).

### Connectors

5 connectors with realistic webhook URLs:

| Name | Type | Purpose |
|---|---|---|
| `acme-github` | `github` | 14 repos, push + PR + release events |
| `acme-jira` | `jira` | 3 boards (`ACME`, `ACME-PLATFORM`, `ACME-PLATFORM-OPS`) |
| `acme-slack` | `slack` | 4 channels (`#acme-incidents`, `#acme-deploys`, ...) |
| `acme-pagerduty` | `secrets` | 4 prod services + escalation policy |
| `acme-aws` | `aws` | Cross-account role `ForgeCrossAccountRole` |

### Intentional conflicts

`023_conflicts.json` seeds 3 intentional conflicts used by ADR-003
("hybrid MDM — steward priority") to demonstrate the conflict UI:

1. **Naming convention conflict** — `auth-service` vs `identity-service`
   for the same domain.
2. **API versioning conflict** — v1 vs v2 of the checkout API.
3. **Database technology conflict** — Postgres vs DynamoDB for cart state.

These are demo-only; production tenants cannot have `is_demo=true`
conflicts.

---

## 3. kn-base — row counts

`kn-base` ships **23 rows** spread across **4 tables**. It is the
baseline package applied on every new tenant via the F-507 day-one
bootstrap.

| Table | Rows | Order |
|---|---:|---:|
| `standards` | 8 | 1 |
| `templates` | 5 | 2 |
| `policies` | 4 | 3 |
| `tool_bundles` | 6 | 4 |

> 23 rows is the total across `standards + templates + policies + tool_bundles`.
> Each row carries `tenant_id` so the package is applied **once per
> new tenant** — re-running a `kn-base` apply against an existing tenant
> is a no-op (every natural key includes `tenant_id`).

| Table | Natural key |
|---|---|
| `standards` | `(tenant_id, name)` |
| `templates` | `(tenant_id, type, name, version)` |
| `policies` | `(tenant_id, name)` |
| `tool_bundles` | `(tenant_id, bundle_key)` |

---

## 4. Tenant + project UUIDs (canonical for M1 dogfood)

| Tenant | UUID | Slug | Project | Project UUID |
|---|---|---|---|---|
| Acme Corp (`acme-corp`) | `11111111-1111-1111-1111-111111111111` | `acme-corp` | Acme Platform | `22222222-2222-2222-2222-222222222222` |

> The Keycloak dev realm hardcodes the same set of `tenant_id`
> attributes on every demo user so an OIDC login maps 1:1 onto these
> rows. The OIDC handler materialises a `Tenant` row on first login if
> one is missing (see `app/services/tenants.py`).

When you add a second demo tenant (e.g. `acme-secondary`), pick a new
prefix — `66666666-...` mirrors the existing convention.

---

## 5. How to add a new seed package

Adding a new package is a 5-step recipe:

### Step 1 — Pick a slug and tenant type

- Slug becomes the directory name under `backend/seeds/packages/`
  (e.g. `acme-secondary`, `customer-bigco`).
- `tenant_type` must be one of: `demo` (NOT allowed in prod),
  `reference` (allowed in prod — like `kn-base`), or `customer_seed`
  (allowed in prod; intended for a real customer's onboarding state).

### Step 2 — Author `manifest.json`

```bash
mkdir -p backend/seeds/packages/<slug>/data
```

`manifest.json` validates against
`backend/seeds/framework/manifest_schema.json` (JSON Schema 2020-12).
Minimum shape:

```json
{
  "name": "<slug>",
  "version": 1,
  "tenant_type": "demo | reference | customer_seed",
  "description": "<one-paragraph summary>",
  "data_files": [
    {
      "file": "001_<table>.json",
      "table": "<table>",
      "order": 1,
      "idempotency_key": ["<col1>", "<col2>"],
      "description": "<row bundle summary>"
    }
  ],
  "row_counts_expected": {
    "<table>": 12
  },
  "production_safety": { "allow_in_prod": false }
}
```

Rules of thumb:

- `data_files[*].order` starts at 1 and is contiguous; the runner
  sorts and applies in that order.
- `idempotency_key` is a strict subset of the target table's columns.
  Always include `tenant_id` for tenant-scoped tables so re-applies
  collapse per-tenant.
- `row_counts_expected` keys must match the table names in `data_files`.
- The validate script `verify_seed_counts.py` exits non-zero if any
  expected count disagrees with the actual data file rows — add this
  assertion to CI.

### Step 3 — Author `data/*.json`

Every file is a JSON object with a `rows` array:

```json
{
  "rows": [
    { "id": "...uuid...", "tenant_id": "...", "project_id": "...", ... }
  ]
}
```

Cross-file references use the `_id_ref` directive — see the existing
`acme-corp` data files for the syntax (e.g. `idea_id` in `019_` and
`020_` resolve into the idea's UUID after the `015_ideas` row is in
place).

### Step 4 — Add the README

Short. One paragraph: what the package is for, who applies it, and
whether it can run in production. Mirror the existing
`acme-corp/README.md` and `kn-base/README.md`.

### Step 5 — Validate

```bash
python3 backend/scripts/verify_seed_counts.py <slug>
```

CI should run the integrity suite and the `verify_seed_counts.py`
script on every PR that touches `backend/seeds/packages/<slug>/`.
The existing tests live in
`backend/tests/seeds/test_<slug>_integrity.py` (mirror
`test_acme_corp_integrity.py`).

---

## 6. Apply vs auto-seed

There are two ways the runner gets called:

### A. Manual — `seed_runner.apply(name)`

Privileged entrypoint. Requires a Steward-role JWT (`seeds:manage`).

```bash
# Via the CLI entrypoint (Track B — T1.10 ships python -m seeds):
cd backend && python -m seeds apply acme-corp

# Via the API:
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/apply \
     -H "Authorization: Bearer $STEWARD_JWT"
```

The manual apply path is the only path operators use when:

- Resetting a drifted tenant.
- Onboarding a new real customer (`customer_seed` packages).
- Replaying a seed in dev.

### B. Auto-seed on first boot

The backend lifespan (Track B — T1.9) calls
`seed_runner.apply("acme-corp")` and `seed_runner.apply("kn-base")` on
the **first boot** of a fresh database. The check uses the
`seed_migrations` table — if any successful apply row for that package
version exists, the auto-seed is a no-op.

Re-boot is therefore safe: the second boot sees existing
`seed_migrations` rows and skips the apply (the runner's idempotent
UPSERTs would also make this safe, but skipping is cheaper and writes
one fewer audit row).

> Escape hatches:
>
> - `SKIP_AUTO_SEED=true` in `.env` disables auto-seed entirely
>   (useful for fast CI runs).
> - `SKIP_AUTO_MIGRATE=true` skips both `alembic upgrade head` and
>   `seed_runner.apply()` (only safe if you know the schema is
>   already current).

`kn-base` is auto-applied via the F-507 day-one bootstrap whenever a
new `Tenant` row is created. That path is owned by the tenant
provisioning service, not the backend lifespan, and uses the same
`SeedRunner` underneath.

---

## 7. Inspecting run history (`seed_runs`)

Every apply / reset / rollback produces one row in `seed_runs` (and
one success row in `seed_migrations`). Both tables live next to the
business tables and are readable by anyone with `audit:view`.

### All runs for a package (last 20)

```sql
SELECT seed_name, manifest_version, operation, status, started_at,
       duration_ms, error
  FROM seed_runs
 WHERE seed_name = 'acme-corp'
 ORDER BY started_at DESC
 LIMIT 20;
```

### Last successful apply, anywhere

```sql
SELECT seed_name, manifest_version, applied_at, applied_by,
       row_counts, checksum
  FROM seed_migrations
 WHERE success = TRUE
 ORDER BY applied_at DESC
 LIMIT 10;
```

### Drift detection

`SeedRunner.diff(name)` compares the live DB row counts against the
manifest's `row_counts_expected`. Drift > 0 means a row was inserted
or deleted outside the seed framework — investigate before re-applying.

```bash
# CLI (Track B — T1.10):
cd backend && python -m seeds diff acme-corp

# Equivalent SQL:
SELECT 'tenants'    AS t, COUNT(*) FROM tenants
UNION ALL SELECT 'users',     COUNT(*) FROM users
UNION ALL SELECT 'roles',     COUNT(*) FROM roles
-- ...
;
```

### Failed applies

```sql
SELECT seed_name, started_at, completed_at, error
  FROM seed_runs
 WHERE status = 'failed'
 ORDER BY started_at DESC
 LIMIT 20;
```

`error` is a JSONB payload with `type` and `message`. Common
explanations:

- `BrokenReferenceError` — a `_id_ref` pointer in a data file could
  not resolve. Fix the order or the foreign key.
- `SchemaMismatchError` — the live DB schema is missing a column the
  manifest expects. Run `alembic upgrade head` and retry.
- `DependencyNotSatisfiedError` — a `dependencies` block in the
  manifest points at a package/version that hasn't been applied yet.
- `ApplyRolledBackError` — the UPSERT path raised mid-transaction; the
  runner rolled back. Inspect the inner exception in `error.message`.

### Forcing a re-apply

The runner is idempotent at the row level, but to **force a complete
re-apply** (e.g. after changing a manifest version), first reset:

```bash
cd backend && python -m seeds reset acme-corp --scope all --confirm
cd backend && python -m seeds apply acme-corp
```

The `--scope all` flag wipes every row owned by the seed. Audit the
event before running it on a tenant with real traffic.

---

## 8. Operator quick reference

| Task | Command |
|---|---|
| Verify package row counts (no DB) | `python3 backend/scripts/verify_seed_counts.py` |
| Apply (CLI — Track B) | `cd backend && python -m seeds apply acme-corp` |
| Apply (API) | `POST /api/v1/seeds/acme-corp/apply` (Steward JWT) |
| Reset (CLI — Track B) | `cd backend && python -m seeds reset acme-corp --confirm` |
| Reset (API) | `POST /api/v1/seeds/acme-corp/reset` (Steward JWT) |
| Status | `cd backend && python -m seeds status acme-corp` |
| Diff | `cd backend && python -m seeds diff acme-corp` |
| Run integrity tests | `cd backend && pytest tests/seeds -x` |
| Tail run history | `psql ... -c "SELECT * FROM seed_runs ORDER BY started_at DESC LIMIT 10;"` |

When in doubt, run `verify_seed_counts.py` first — it is a 200 ms
file-only check that catches the most common drift (someone edited a
data file without bumping `row_counts_expected`, or vice-versa).
