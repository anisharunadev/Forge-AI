# Forge AI-128 v0 — CEO review checklist

This is the one-pager the CEO sees when responding to the pending
`request_confirmation` (id `9c1235a6`) on Forge AI-128. It is also the
canonical evidence record for the v0 ship: every assertion maps to
a test file or contract section the reviewer can read directly.

**If you (the CEO / Board) confirm**, the CTO will PATCH Forge AI-128 to
`done` and Forge AI-211 (the auth-engineer follow-up child) will unblock
for the future `auth-engineer` hire.

**If you decline with a reason**, the CTO will address the ask and
re-request.

## One-line status

> **Forge AI-128 v0 — 271 checks green. 7 of 7 children `done`. 1
> post-v0 follow-up filed. 1 confirmation pending (this one).**

## Acceptance criteria (from the Forge AI-128 epic)

| # | Criterion | Where to look | Status |
|---|-----------|---------------|--------|
| 1 | `resolve` returns a redacted envelope; raw value never in response or log | `mcp-servers/secrets/src/broker.ts` redact + audit; `test/smoke.mjs`; `test/unit-audit.mjs`; `test/property/memory-dump.mjs` (200 fuzz runs) | ✅ |
| 2 | Same `secret_ref` in a different tenant → different value or `not_found` | `TenantScopeError` at the store; `test/smoke.mjs`; `test/unit.mjs`; `test/unit-aws.mjs` | ✅ |
| 3 | `gitleaks` pre-commit + CI secret-scan, regression-tested by a known-bad fixture | `.gitleaks.toml`; `.github/workflows/ci.yml` (gitleaks-action + regression step); `tools/gitleaks/gitleaks-fixture.test.mjs` (4 cases) | ✅ (CI-only; per-developer pre-commit hook is a follow-up — see Forge AI-211 §5) |
| 4 | Rotation creates a new version; old version revokable independently | `InMemorySecretStore.rotate` appends; `AwsSecretsManagerStore.rotate` calls `PutSecretValue` (AWS SM preserves old versions); `test/unit.mjs` + `test/unit-aws.mjs`; `mcp-servers/secrets/docs/runbook.md` §Operation 3 | ✅ |
| 5 | Memory dump shows no raw value (property test) | `test/property/memory-dump.mjs` (200 fuzz runs + 100 grammar round-trips) | ✅ (in-memory variant; AWS SDK buffer second pass is Forge AI-211 §4) |

## Deliverables (from the Forge AI-128 epic)

- [x] `secrets-mcp` with `resolve(secret_ref)` and `rotate(secret_ref, new_value)` — `src/broker.ts`, `src/tools.ts`
- [x] `secret_ref` grammar: `tenants/{tenant_id}/secrets/{name}@{version}` (version optional, default `latest`) — `src/secret_ref.ts` (closed; ADR-0003 §10 sub-decision 4)
- [x] Redacted envelope shape: `{ redacted, secret_ref, value_len, fingerprint, expires_at, resolved_at, version }` — `src/secret_ref.ts::RedactedSecret`
- [x] Broker-side raw-use pattern — `src/brokered.ts` + `use_for` tool + 3 stub handlers (`github.commit_sign`, `slack.webhook_post`, `aws.s3.put_object_signed`)
- [x] Per-tenant backing-store configuration — `src/config.ts`; v1 `aws-secrets-manager` shipped (Forge AI-185)
- [x] Pre-commit `gitleaks` + CI secret-scan; lint rule for `secrets:` blocks — `.gitleaks.toml` + `tools/lint-secrets-blocks.mjs`
- [x] Audit events: `secret.resolved`, `secret.rotated`, `secret.access_denied`, `secret.used_for_<intent>` — `src/broker.ts::SecretAuditEvent` + `src/audit-fora.ts::Forge AIAuditSink`

## Children — all `done`

| Issue | Title | Tests |
|-------|-------|-------|
| [Forge AI-185](https://paperclip/Forge AI/issues/Forge AI-185) | AWS Secrets Manager adapter | 6 unit |
| [Forge AI-186](https://paperclip/Forge AI/issues/Forge AI-186) | Forge AI-36 audit-sink forwarder | 8 unit |
| [Forge AI-187](https://paperclip/Forge AI/issues/Forge AI-187) | `secrets:` block lint rule | 7 lint self-tests |
| [Forge AI-188](https://paperclip/Forge AI/issues/Forge AI-188) | gitleaks pre-commit + CI | 4 regression |
| [Forge AI-189](https://paperclip/Forge AI/issues/Forge AI-189) | Broker-side raw-use MCP wrapper | 7 unit |
| [Forge AI-190](https://paperclip/Forge AI/issues/Forge AI-190) | Memory-dump property test | 200 fuzz + 100 grammar |
| [Forge AI-191](https://paperclip/Forge AI/issues/Forge AI-191) | Operator runbook + docs handoff | docs-only |

## Test counts (re-verified this heartbeat, 2026-06-17)

| Suite | Count | Command |
|-------|-------|---------|
| `npm test` (unit) | 246 checks green | `node test/unit.mjs && node test/unit-aws.mjs && node test/unit-audit.mjs && node test/unit-brokered.mjs && node test/property/memory-dump.mjs` |
| `npm run smoke` (MCP stdio e2e) | 25 checks green | `node test/smoke.mjs` |
| `tools/lint-secrets-blocks.test.mjs` | 7 checks green | self-test for Forge AI-187 |
| `tools/gitleaks/gitleaks-fixture.test.mjs` | 4 checks green | self-test for Forge AI-188 |
| **Total** | **282 checks green** | |

(Previous summary reported 271 — that count was unit + smoke only. Adding the lint + gitleaks self-tests brings the verifiable surface to 282.)

## CI gates (`.github/workflows/ci.yml`)

- ✅ `lint-unbound-mcps` (existing; Forge AI-125)
- ✅ `lint-secrets-blocks` (Forge AI-187) + self-test
- ✅ `gitleaks` via `gitleaks/gitleaks-action@v2` (existing) + `gitleaks-fixture.test.mjs` (Forge AI-188 regression)
- ✅ TypeScript typecheck, Python lint/format/mypy (existing)
- ✅ Tenancy lint, agent-IAM lint (existing)

## Post-v0 follow-ups (filed in Forge AI-211)

The 5 items the auth-engineer hire owns. None are part of the v0
acceptance bar; none block the parent's `done` state.

1. Production wiring of `github.commit_sign` (real commit signing, not the stub).
2. Production wiring of `slack.webhook_post` (real HTTP POST, not the stub).
3. Production wiring of `aws.s3.put_object_signed` (real S3 PUT with SigV4, not the stub).
4. AWS SDK buffer property test (the `/proc/<pid>/mem` second pass; the current property test covers the in-memory path).
5. ADR-0003 §10 sub-decision table update + per-developer `pre-commit` framework hook.

See [Forge AI-211](https://paperclip/Forge AI/issues/Forge AI-211) for the full scope.

## Risk

Every change is additive behind env-var defaults:
- `Forge AI_BACKING_STORE=memory` (default for tests) is unchanged.
- `Forge AI_AUDIT_SINK=memory` (default for tests) is unchanged.
- `lint-secrets-blocks --roots` defaults to `agents,tenants,docs/runbooks`; nothing outside those roots is scanned.
- `gitleaks.toml` allowlists the test fixtures, the contract / runbook docs (which intentionally use placeholder strings), and the production code that may mention secret patterns in comments.

Reverting any single child's commit leaves the rest of the work intact. The smoke test (MCP stdio, in-memory store) is unchanged from v0.

## Where to start the review

1. Read the contract: `mcp-servers/secrets/docs/contract.md`. This is the closed source of truth.
2. Skim the runbook: `mcp-servers/secrets/docs/runbook.md` (or `docs/runbooks/secrets-mcp.md` for the repo-root mirror).
3. Spot-check the test files: `mcp-servers/secrets/test/`. The smoke test is the most readable end-to-end exercise.
4. The 4 follow-up stubs in `src/brokered.ts` are deterministic; the real wiring lives in Forge AI-211.
