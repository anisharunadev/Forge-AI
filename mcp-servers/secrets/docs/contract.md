# Forge AI-128 v0 — secrets-mcp contract

This document is the contract every follow-up child issue must
honour. v0 is the landable skeleton; the children add the
production wiring.

## 1. `secret_ref` grammar (closed)

```
tenants/{tenant_id}/secrets/{name}@{version}
```

- `tenant_id` matches `/^[A-Za-z0-9][A-Za-z0-9_-]*$/` (1–128 chars).
- `name` matches `/^[A-Za-z0-9][A-Za-z0-9_./-]*$/` (1–256 chars).
- `version` is `latest` or `/^[1-9][0-9]{0,9}$/`.
- The parser accepts a leading `secrets/{name}` (the customer-facing
  form) for backwards compatibility; the broker always emits the
  full `tenants/{tid}/…` form.

Changing the grammar requires an ADR (one-way door per
ADR-0003 §10 sub-decision 4).

## 2. Redacted envelope shape (closed)

```ts
interface RedactedSecret {
  redacted: true;        // always
  secret_ref: string;    // canonical form, parser output
  value_len: number;     // UTF-8 byte length of the raw value
  fingerprint: string;   // 16-char hex SHA-256 prefix
  expires_at: string;    // ISO-8601, backing-store defined
  resolved_at: string;   // ISO-8601, broker clock
  version: string;       // the resolved version
}
```

**Never** the raw value. **Never** a way to recover the raw value
from any field above.

## 3. Tools

| Tool      | Args                                              | Notes |
|-----------|---------------------------------------------------|-------|
| `resolve` | `{ secret_ref }`                                  | Returns `{ ok, envelope }` or `{ ok: false, code, message }` |
| `rotate`  | `{ secret_ref, new_value }`                       | Returns `{ ok, secret_ref, version, created_at }` or error envelope. `new_value` is never echoed back. |
| `use_for` | `{ secret_ref, intent, payload }`                 | Broker-side raw-use pattern (Forge AI-128.f). Returns `{ ok, result: { intent, result, side_effect_fingerprint } }` or error envelope. The raw value never enters the response — the broker resolves the secret, calls the registered handler in-process, and returns only the action's result. |

Error codes: `tenant_scope`, `not_found`, `invalid_ref`, `store_error`, `unknown_intent`, `invalid_payload`.

### `use_for` intents (v1)

| Intent                          | Action                                      | v1 handler          |
|---------------------------------|---------------------------------------------|---------------------|
| `github.commit_sign`            | Sign a git commit with the tenant's PAT     | stub                |
| `slack.webhook_post`            | Post to a Slack webhook with the tenant's secret | stub             |
| `aws.s3.put_object_signed`      | Upload an S3 object with the tenant's access key | stub             |

The v1 handlers are deterministic, side-effect-free stubs (the
integration suite exercises them). Replacing a stub with a real
side-effecting client is a follow-up owned by the `auth-engineer`
hire — the brokered-action interface and the
`secret.used_for_<intent>` audit event shape are the contract.

## 4. Broker-side raw-use pattern

When an MCP needs a raw value (e.g. signing a commit with a PAT),
the agent does **not** call `resolve`. The agent calls the
*target* MCP with an *intent* (e.g. `git.sign(commit=…)`); that
target MCP is brokered through the `secrets-mcp` on the agent's
behalf. The PAT never enters the agent's prompt or memory. v0
ships the broker; the intent-routing layer is `Forge AI-128.f`.

## 5. Audit events (closed)

Three action types, all on the `secret.*` namespace:

| Action                | When                                  | Required fields |
|-----------------------|---------------------------------------|-----------------|
| `secret.resolved`     | `resolve` succeeded                   | `tenant_id`, `actor`, `agent_type`, `secret_ref`, `fingerprint`, `value_len`, `decision=allow`, `trace_id`, `timestamp` |
| `secret.rotated`      | `rotate` succeeded                    | `tenant_id`, `actor`, `agent_type`, `secret_ref`, `decision=allow`, `trace_id`, `timestamp`, `version` (in metadata) |
| `secret.access_denied`| any failure (incl. malformed ref)     | same as above with `decision=deny` and `reason` ∈ {`invalid_ref`, `tenant_scope`, `not_found`, `store_error`} |
| `secret.used_for_<intent>` | `use_for` succeeded              | `tenant_id`, `actor`, `agent_type`, `secret_ref`, `fingerprint`, `value_len`, `decision=allow`, `trace_id`, `timestamp`, `intent` + `side_effect_fingerprint` in metadata |

**No** event ever carries the raw value or a derivative that
could recover it. The audit log is the *fact* the secret was
touched, not the content.

### Production sink: Forge AI-36

The production audit sink is `Forge AIAuditSink` (`src/audit-fora.ts`).
It POSTs each event to `{Forge AI_AUDIT_URL}/v1/audit/events` with the
Forge AI-36 envelope shape (ADR-0003 §8.1):

- `actor`, `tenant_id`, `principal="agent"`, `scopes_used=[]`,
  `action`, `decision`, `trace_id`, `timestamp`, `metadata`.
- `metadata` carries the secrets-mcp-only fields: `agent_type`,
  `secret_ref`, `fingerprint` (allow only), `value_len` (allow only),
  `reason` (deny only), plus any `metadata` from the broker.

The forwarder is **fire-and-forget** — the broker's `emit(...)` is
synchronous and never blocks on a network round-trip. 5xx is retried
with exponential backoff (3 attempts, 100ms/200ms/400ms). 4xx is
dropped (a malformed event is a caller bug, not a transient
failure). A defence-in-depth `assertNoCredentials` walks the
serialised body and refuses to POST if it contains a
credential-shaped substring; the event is logged to stderr and
dropped.

The `InMemoryAuditSink` remains the test default
(`Forge AI_AUDIT_SINK=memory`); the production default is
`Forge AI_AUDIT_SINK=fora`, gated by `Forge AI_AUDIT_URL`.

## 6. Per-tenant configuration

The server process is pinned to one tenant at boot
(`Forge AI_TENANT_ID`). The backing-store kind is `memory` (v0) or
`aws-secrets-manager` (Forge AI-128.b). Cross-tenant reads are
rejected at the store layer with `TenantScopeError`; the server
itself never re-derives a tenant from the ref alone.

## 7. CI gates that must pass before v0 → done

- [x] `npm run typecheck` (TS strict)
- [x] `npm run build` (tsc)
- [x] `npm test` (unit — grammar, redact, broker)
- [x] `node test/unit-aws.mjs` (AWS Secrets Manager adapter)
- [x] `node test/unit-audit.mjs` (Forge AI-36 audit forwarder)
- [x] `node test/unit-brokered.mjs` (broker-side raw-use)
- [x] `node test/property/memory-dump.mjs` (property: no raw value in agent-observable surfaces, 200 fuzz runs)
- [x] `npm run smoke` (MCP stdio e2e)
- [x] gitleaks scan (Forge AI-128.e) — `.gitleaks.toml` + regression test
- [x] secrets: block lint rule (Forge AI-128.d) — `tools/lint-secrets-blocks.mjs` + fixtures
- [x] property test: agent memory dump has no raw value (Forge AI-128.g) — `test/property/memory-dump.mjs`

## 8. Acceptance criteria mapping

| Forge AI-128 acceptance criterion                              | Where satisfied                                  |
|------------------------------------------------------------|--------------------------------------------------|
| `resolve` returns a redacted envelope; raw value never in response or log | `src/broker.ts` redact + audit sink; smoke test asserts no leak |
| Same `secret_ref` in a different tenant resolves to a different value (or `not_found`) | `TenantScopeError` at the store; smoke test asserts `tenant_scope` |
| Rotation creates a new version; old version revokable independently | `InMemorySecretStore.rotate` appends, never overwrites; `AwsSecretsManagerStore.rotate` calls `PutSecretValue`; unit + unit-aws tests assert `r1` still resolves to v1 after `rotate` to v2 |
| Memory dump shows no raw value                              | `Forge AI-128.g` (deferred)                          |
| Pre-commit gitleaks + CI secret-scan + lint rule           | `Forge AI-128.e` + `Forge AI-128.d` (deferred)           |
| AWS Secrets Manager backing store (v1)                      | `src/store-aws.ts` + `test/unit-aws.mjs`          |
| Forge AI-36 audit sink (replace InMemoryAuditSink)              | `src/audit-fora.ts` + `test/unit-audit.mjs`      |
| Broker-side raw-use pattern (intent → action)               | `src/brokered.ts` + `test/unit-brokered.mjs`     |
| Memory-dump property test (no raw value in agent-observable surfaces) | `test/property/memory-dump.mjs` (200 fuzz runs) |
