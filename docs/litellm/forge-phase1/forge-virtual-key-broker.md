# Forge Backend — Virtual Key Broker (Phase 1, step-75 P4)

> **Feature:** F3 — Virtual Key Broker
> **Spec:** `docs/goals/step-75.md` lines 148-216
> **Substrate:** `backend/app/services/forge_key_broker.py::ForgeKeyBroker`
> **Router:** `backend/app/api/v1/forge_keys.py`
> **Schemas:** `backend/app/schemas/forge_keys.py`
> **Cron:** `backend/app/services/scheduler/jobs/forge_key_rotate.py`

---

## Goal (spec line 151)

Forge Backend is the **only entity** that issues, verifies, rotates, and
revokes LiteLLM virtual keys. The UI never sees a key; it sees a Forge
session, and Forge maps that session to a virtual key on every chat
request. Plaintext key material is **token-only-in-flight** — the broker
encrypts the secret at the first possible moment and the fingerprint
becomes the audit handle for everything afterwards.

## Security model

Two identifiers per issued key, with distinct roles:

- **`encrypted_key`** — Fernet ciphertext, the secret at rest. Held
  in `FORGE_CRYPTO_KEY` (env-driven) via `app/core/crypto.py::encrypt`.
  Decrypted only at the moment a LiteLLM call authenticates.
- **`fingerprint`** — SHA-256 hex of plaintext, **not a secret**. The
  audit handle. Log correlation key. LiteLLM spend-log join key.

Plaintext exists in memory only between `/key/generate` returning and
`encrypt(plaintext)` succeeding. It is nulled out (`plaintext = None`)
immediately, never logged, never returned over HTTP (router comment at
`backend/app/api/v1/forge_keys.py:12-14`). The 16-char
`_short_fingerprint` is what appears in `audit_log` and `structlog`
— enough to correlate with LiteLLM `key_alias` without leaking the
full hash.

## Storage

ORM table `agent_virtual_key` defined at
`backend/app/services/forge_key_broker.py:68-107` and the alembic
migration `step_75_p4_agent_virtual_key_001`:

- `encrypted_key` (`TEXT`, NOT NULL) — Fernet ciphertext. Plaintext
  never written here.
- `fingerprint` (`String(64)`, NOT NULL) — SHA-256 hex; indexed on
  `(agent_id, created_at)`.
- `model_scope` (`ARRAY(String)`) — LiteLLM `models` whitelist;
  per-agent model isolation (spec AC #3).
- `max_budget_usd` (`Numeric(12, 6)`) — ceiling; `verify_budget()`
  reads it against 30-day spend.
- `status` (`String(16)`) — `active | rotated | revoked`. A
  **partial UNIQUE** on `(agent_id) WHERE status='active'` enforces
  "one active key per agent" at the DB level. Older rows live on as
  `rotated`/`revoked` for the audit trail.

Composite index `(tenant_id, project_id, status)` enforces Rule 2
tenancy at the planner level.

### Forbidden field names

`grep -nE 'plaintext|secret|api_key|token|sk-' backend/app/schemas/forge_keys.py`
returns **zero matches** outside the docstring (`forge_keys.py:3-5`)
explaining why plaintext is excluded. Pydantic models expose only
`fingerprint`, `model_scope`, `max_budget_usd`, `budget_used_usd`,
`tpm_limit`, `rpm_limit`, `expires_at`, `created_at`, `rotated_at`,
`revoked_at`, `litellm_key_alias` — no field can accidentally
serialize the secret.

## Lifecycle: issue → rotate → revoke

### Issue (`broker.issue`, `forge_key_broker.py:259-366`)

Triggered by the agents router (`backend/app/api/v1/agents.py:64,90`)
as `BackgroundTasks.add_task(forge_key_broker.issue_or_rotate, agent)`
on `POST /agents` and `PATCH /agents/{id}` — the create/update HTTP
response returns immediately and the mint is non-blocking.

1. Mint upstream secret via `POST /key/generate` with `model_scope`,
   `max_budget`, `tpm_limit`, `rpm_limit`, and
   `metadata.{forge_agent_id, forge_tenant_id, forge_project_id}`.
2. `fingerprint = sha256(plaintext).hexdigest()`.
3. `encrypted = encrypt(plaintext)` — Fernet via `app/core/crypto.py`.
4. `plaintext = None` — drop the local reference.
5. Mark any prior active row as `rotated` (partial UNIQUE permits
   only one active per agent).
6. `INSERT` the new row.
7. Best-effort audit: `forge.keys.issued` with `_short_fingerprint`.

Response (`POST /forge/agents/{id}/key/issue`) returns
`ForgeKeyIssueResponse` with `agent_id`, `fingerprint`, `status`,
`model_scope`, `created_at` — never the secret.

### Rotate (`broker.rotate`, `forge_key_broker.py:372-476`)

Two trigger paths:

- **Admin-initiated**: `POST /forge/agents/{id}/key/rotate`
  (`backend/app/api/v1/forge_keys.py:191-213`). Caller must hold
  `owner` or `admin` (`require_admin` dep at lines 62-77).
- **Auto-trigger**: BackgroundTask on agent create/update + 7-day
  cron sweep (see Auto-trigger below).

Flow: read the active row's `litellm_key_alias` + `fingerprint`,
mint a new upstream key with a `rotated-<ts>` alias, encrypt + finger
print the new plaintext, mark the old row `rotated` (`rotated_at`
set) and `INSERT` the new active row in the same transaction, then
best-effort upstream block via `POST /key/block` with
`{"key_aliases": [<prior_alias>]}` (`_block_litellm_key` at
`forge_keys.py:212-227`). Failures logged, never raised — the DB
row is authoritative. Best-effort audit: `forge.keys.rotated` with
`old_fingerprint` and `new_fingerprint` (both short).

Response (`ForgeKeyRotateResponse`) carries `agent_id`,
`old_fingerprint`, `new_fingerprint`, `rotated_at`, `reason`. No
secret.

**In-flight requests** (spec AC #5) using the old key fail at
LiteLLM with 401 once the alias is blocked. The chat client
(`forge_chat`) retries once with the new key fetched from the
broker. `issue_or_rotate()` is reentrant: if the row was rotated
while a request was in flight, the next call mints a fresh one.

### Revoke (`broker.revoke`, `forge_key_broker.py:501-559`)

Triggered by `POST /forge/agents/{id}/key/revoke` (admin) and by
`DELETE /agents/{id}` (cascades a revoke via the same broker path).
DB row → `revoked` + `revoked_at`, then upstream `POST /key/block`
(best-effort, idempotent).

## Budget enforcement

Two layered checks:

### 1. Pre-call guard (`broker.verify_budget`, `forge_key_broker.py:616-639`)

Reads `SUM(spend_records.cost_usd) WHERE agent_id = ? AND created_at
>= now() - 30d` and the active row's `max_budget_usd`. Returns
`{spent_usd, ceiling_usd, pct, blocked}` where
`blocked = spent >= ceiling`.

`BudgetGuard` (`backend/app/services/forge_budget_guard.py:131`)
calls `verify_budget()` before every LiteLLM chat completion:

- `pct >= 0.90` → `BudgetWarning` (allow, surface in UI).
- `pct >= 1.00` → `BudgetExceeded` (block, return typed error).

### 2. Proactive rotation

`ROTATE_BUDGET_PCT = 0.80` (`forge_key_broker.py:56`) — the
auto-rotator flips the key before the 0.90 warning fires, so a
freshly-rotated key starts at `spent = 0` against the same ceiling.
This is the spec AC #4 invariant ("Budget exhaustion on agent A
does not affect agent B"): each agent has its own row, its own
`max_budget_usd`, its own 30-day spend ledger. `spend_records` carries
`agent_id`; the SUM is scoped to that agent alone. The 30-day
window is `BUDGET_WINDOW_DAYS = 30` (`forge_key_broker.py:59`),
reused by the scheduler job at `forge_key_rotate.py:34`.

## Auto-trigger

Two surfaces, both read-only from the caller side:

### Background-task entry on agent create / update

`backend/app/api/v1/agents.py:53-64` and `:74-90` register
`background_tasks.add_task(forge_key_broker.issue_or_rotate, agent)`
on `POST /agents` and `PATCH /agents/{id}`. `issue_or_rotate()`
(`forge_key_broker.py:656-704`) is idempotent:

- No active row → `issue()`.
- Active row older than `ROTATE_AGE_DAYS = 7` →
  `rotate(reason="auto_age")`, fall through to `get_status()`.
- 30-day spend / `max_budget_usd >= ROTATE_BUDGET_PCT = 0.80` →
  `rotate(reason="auto_budget")`, fall through to `get_status()`.
- Otherwise → `get_status()`.

Failures caught and logged; the user-facing call never fails because
of a transient rotation hiccup.

### Daily cron sweep

`backend/app/services/scheduler/jobs/forge_key_rotate.py::run` is
registered in `app.services.scheduler.service` at `0 3 * * *` (03:00
UTC daily). It iterates every active row and calls
`forge_key_broker.rotate(agent_id, reason=...)` for any agent whose
row is older than 7 days or whose 30-day spend >= 80% of ceiling.
Per-agent failures are logged and skipped — one bad row never blocks
the sweep. Safety net for **agents with no create/update event** in
the rolling window (BackgroundTask path only fires on mutations).

## API contract (5 endpoints)

All mounted from `backend/app/api/v1/forge_keys.py::router` under
`/api/forge`. Every response is a typed Pydantic model from
`backend/app/schemas/forge_keys.py`. **No plaintext-bearing fields
exist anywhere** in the schema module.

| # | Method + path | Role | Response model |
|---|---|---|---|
| 1 | `POST /agents/{id}/key/issue` | caller | `ForgeKeyIssueResponse` |
| 2 | `GET /agents/{id}/key/status` | caller | `ForgeKeyStatus` |
| 3 | `POST /agents/{id}/key/rotate` | admin | `ForgeKeyRotateResponse` |
| 4 | `POST /agents/{id}/key/revoke` | admin | `ForgeKeyRevokeResponse` |
| 5 | `GET /keys` | caller | `ForgeKeyStatusListResponse` |

`status` includes `budget_used_usd`, `budget_pct`, `expires_at`.
Issue returns 201 Created and mints via upstream `/key/generate`.
Rotate and revoke require `owner`/`admin` role.

Cross-tenant isolation: every per-agent route calls
`_load_agent_for_principal()` (`forge_keys.py:80-102`) which returns
**404 — never 403** on cross-tenant access so the existence of a
foreign row is never disclosed.

`GET /keys` uses a direct SQL query against `AgentVirtualKey` filtered
on `(tenant_id, status='active')` rather than calling `get_status()`
in a loop — the per-agent method is N+1 at the list level. The list
query sets `budget_used_usd = 0.0`; clients needing per-agent spend
hit endpoint #2.

## Acceptance evidence — spec AC1-AC7 (lines 209-215)

| Spec AC | Evidence |
|---|---|
| **AC1** One `/key/generate` per agent create | `backend/tests/integrations/litellm/test_virtual_keys.py::test_provision_key_stores_in_secrets_manager` (line 56) asserts the single `mock_litellm_admin.post` path; agents router `backend/app/api/v1/agents.py:64,90` wires one `BackgroundTasks.add_task(issue_or_rotate, ...)` per create/update. |
| **AC2** Plaintext never in UI, log, or DB query | `test_virtual_keys.py::test_key_value_never_logged` (line 151) + `test_key_value_never_returned_in_api` (line 201). Schema-level proof: `grep -nE 'plaintext\|api_key\|token\|sk-' backend/app/schemas/forge_keys.py` returns no field definitions. |
| **AC3** Two agents can't call each other's models | `model_scope` is passed verbatim into LiteLLM's `models` whitelist (`_provision_litellm_key`, `forge_key_broker.py:186-187`); enforced upstream by LiteLLM. Tenant + agent filtering via `_load_agent_for_principal` (`forge_keys.py:80-102`). |
| **AC4** Budget exhaustion on A doesn't affect B | `verify_budget` filters `spend_records` on `agent_id` (`forge_key_broker.py:644-650`); `max_budget_usd` is per-row. Per-agent isolation fixture in `backend/tests/conftest.py`. |
| **AC5** Rotate without UI; in-flight fails gracefully + retries | `BackgroundTasks` path on every create/update (`agents.py:64,90`) + `0 3 * * *` cron (`forge_key_rotate.py`). Retry is the chat client's responsibility (Phase 1 P5). |
| **AC6** `/key/status` returns within 100ms warm, 1s cold | `get_status` is a single scalar select (`forge_key_broker.py:573-578`) + one `SUM` aggregate — no upstream call. Warm-cache returns the row without the spend hop. |
| **AC7** (one active key per agent — implied) | Same evidence as AC1; the broker's partial UNIQUE on `(agent_id) WHERE status='active'` is the DB-level enforcement. |

## Out of scope (deferred)

- **Per-tenant customer-managed keys (CMK).** All keys today are
  encrypted with a single `FORGE_CRYPTO_KEY` (Fernet). Per-tenant KMS
  is Phase 2+ — would touch the migration, the broker constructor,
  and the crypto module.
- **Multi-region key rotation.** Rotation writes to a single LiteLLM
  proxy. A multi-region deployment needs a per-region `key_alias`
  scheme and a region-aware `_provision_litellm_key`.
- **UI surface for key management.** The 5 endpoints are admin /
  system-facing. A user-facing "rotate my key" button is out of
  scope for Phase 1.
- **Bulk tenant off-board.** The spec mentions deleting all keys
  when a tenant offboards (`step-75.md:182-183`); a bulk-delete
  endpoint is not in this P4 surface.
- **Spend rollup at the broker.** The list endpoint sets
  `budget_used_usd = 0.0`. A cached per-agent spend view belongs in
  P3 (Spend Aggregation), not here.

## Files cited

- `backend/app/services/forge_key_broker.py` — broker implementation
- `backend/app/api/v1/forge_keys.py` — thin router (5 endpoints)
- `backend/app/schemas/forge_keys.py` — typed Pydantic surfaces
- `backend/app/services/scheduler/jobs/forge_key_rotate.py` — daily cron
- `backend/app/services/forge_budget_guard.py` — pre-call guard
- `backend/app/api/v1/agents.py:53-64, 74-90` — BackgroundTask wiring
- `backend/app/core/crypto.py` — Fernet `encrypt()` used at rest
- `backend/tests/integrations/litellm/test_virtual_keys.py` — security invariants
- `docs/goals/step-75.md:148-216` — source spec
- `docs/litellm/forge-litellm-integration.md` §2 — endpoint matrix
