# Operator runbook — `secrets-mcp` (Forge AI-128)

This runbook walks an SRE through the four operations that matter
in production: **boot**, **`rotate`**, **revoke**, and **force-rotate**.
It assumes the v0 contract at `mcp-servers/secrets/docs/contract.md`
is the source of truth and the agent-of-agents orchestrator is
already routing ToolCalls to a per-tenant `secrets-mcp` process.

## Why this runbook exists

The `secrets-mcp` is the seam where the redacted-envelope contract
(`mcp-servers/secrets/docs/contract.md` §2) is enforced. A
misconfiguration here leaks the raw value into the agent's prompt
or the audit log — a P0 incident. The four operations below are
the only paths that change tenant state at the secret layer;
every other call is a `resolve` that returns a redacted envelope.

## Pre-conditions

- Node.js ≥ 18.17 (the `secrets-mcp` is published as
  `forge-ai/mcp-secrets`).
- AWS Secrets Manager access for the production account(s) the
  broker routes to. The MCP uses the SDK's default credential
  chain — the operator does not need to mint STS credentials by
  hand; the per-tenant backing store is configured at deploy time
  (see "Per-tenant configuration" below).
- The Forge AI-36 audit service reachable at `Forge AI_AUDIT_URL`. The
  forwarder is fire-and-forget; 5xx is retried 3× and then
  dropped with a stderr log.

## Per-tenant configuration

The server is per-tenant at runtime. The orchestrator (kubernetes
in production, a systemd unit per tenant in dev) is responsible
for the fan-out. The relevant env vars, per tenant process:

| Env var                   | Required            | Default | Purpose                                  |
|---------------------------|---------------------|---------|------------------------------------------|
| `Forge AI_TENANT_ID`          | **yes**             | —       | The broker's tenant claim                |
| `Forge AI_BACKING_STORE`      | no                  | `memory` | `memory` (dev/test) or `aws-secrets-manager` (prod) |
| `Forge AI_AWS_REGION`         | if backing=aws-sm   | —       | AWS region for the secrets-mcp           |
| `Forge AI_AWS_SM_PREFIX`      | no                  | `fora`  | Name prefix in AWS SM (`{prefix}/{tid}/{name}`) |
| `Forge AI_AUDIT_SINK`         | no                  | `memory` | `memory` (test) or `fora` (prod)         |
| `Forge AI_AUDIT_URL`          | if audit=fora       | —       | Base URL of the Forge AI-36 audit service    |
| `Forge AI_AUDIT_TOKEN`        | no                  | —       | Bearer token for the Forge AI-36 service     |
| `Forge AI_TRACE_ID`           | no (orchestrator sets) | `trace-unknown` | The trace id of the parent ToolCall |
| `Forge AI_ACTOR`              | no (orchestrator sets) | `agent:unknown` | The agent's principal                  |
| `Forge AI_AGENT_TYPE`         | no (orchestrator sets) | `unknown` | The agent type (developer, security-engineer, etc.) |

The `Forge AI_TRACE_ID`, `Forge AI_ACTOR`, and `Forge AI_AGENT_TYPE` env vars
are placeholders for the v0 entry point. The production path passes
these through the ToolCall envelope directly.

## Operation 1 — Boot

**Goal**: bring a per-tenant `secrets-mcp` process online.

```bash
export Forge AI_TENANT_ID="tnt_acme"
export Forge AI_BACKING_STORE="aws-secrets-manager"
export Forge AI_AWS_REGION="us-east-1"
export Forge AI_AWS_SM_PREFIX="fora"
export Forge AI_AUDIT_SINK="fora"
export Forge AI_AUDIT_URL="https://audit.fora.example.com"
export Forge AI_AUDIT_TOKEN="<bearer>"

node node_modules/forge-ai/mcp-secrets/dist/index.js
```

Verify the boot by reading the stderr line:

```
[fora-mcp-secrets] starting — tenant='tnt_acme', backing_store='aws-secrets-manager', region='us-east-1', audit_sink='fora'
```

If the server refuses to boot with `Invalid secrets-mcp configuration`,
the missing env var is in the error message. The most common cause
is `Forge AI_AWS_REGION` not set when `Forge AI_BACKING_STORE=aws-secrets-manager`,
or `Forge AI_AUDIT_URL` not set when `Forge AI_AUDIT_SINK=fora`.

**Smoke test from the operator shell** (no agent in the loop):

```bash
# Send a JSON-RPC request over stdio. This requires the
# `@modelcontextprotocol/sdk` client or the `mcpc` CLI.
echo '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "resolve",
    "arguments": { "secret_ref": "tenants/tnt_acme/secrets/sanity_check" }
  }
}' | node node_modules/forge-ai/mcp-secrets/dist/index.js
```

A `not_found` envelope is the expected response for a sanity-check
secret that does not exist. The redacted envelope shape is
documented in `contract.md` §2.

## Operation 2 — `rotate`

**Goal**: write a new version of a secret; the old version stays
resolvable (Forge AI-128 acceptance: "Rotation creates a new version;
old version revokable independently").

```bash
echo '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "rotate",
    "arguments": {
      "secret_ref": "tenants/tnt_acme/secrets/gh_pat",
      "new_value": "ghp_<the-new-value>"
    }
  }
}' | node node_modules/forge-ai/mcp-secrets/dist/index.js
```

The response carries `{ ok: true, secret_ref, version, created_at }`
— the new integer version (e.g. `2`) and a timestamp. The
`new_value` is **never** echoed back, even on success. The
`version` is the integer counter the broker pins to the AWS
`VersionId`; the audit log records the new integer in
`metadata.version`.

**Verify the rotation**:

```bash
# Resolve the @latest — should return the new value's fingerprint.
echo '...' | node node_modules/forge-ai/mcp-secrets/dist/index.js

# Resolve @1 — should return the old value's fingerprint.
# Confirms the old version is still resolvable.
```

**Verify in AWS SM directly** (out-of-band):

```bash
aws secretsmanager list-secret-version-ids \
  --secret-id "fora/tnt_acme/gh_pat" \
  --query 'Versions[*].[VersionId,CreatedDate,VersionStages]' \
  --output table
```

You should see two versions (or `N` versions, one per rotation).
The broker's integer version is a 1-based counter; the AWS
`VersionId` is a UUID.

## Operation 3 — Revoke

**Goal**: disable a specific version of a secret. The broker's
contract guarantees that the old version is still resolvable
after a `rotate`. Revoke is the operation that breaks that
guarantee for one specific version.

```bash
aws secretsmanager update-secret-version-stage \
  --secret-id "fora/tnt_acme/gh_pat" \
  --version-stage "AWSCURRENT" \
  --remove-from-version-id "<the-old-VersionId>" \
  --move-to-version-id "<the-new-VersionId>"
```

After the AWSCURRENT staging label is moved, a `resolve(@latest)`
returns the new version. `resolve(@<old-n>)` will fail with
`not_found` (the AWS API returns `ResourceNotFoundException` for
non-staged versions; the adapter maps that to `SecretNotFoundError`).

**Important**: AWS Secrets Manager does not actually DELETE the
old version. To permanently remove the value (e.g. for a
confirmed-compromise scenario), use `remove-versions-from-replication`
or schedule a deletion via the AWS console. Revocation via the
broker is a *logical* revoke — the value still exists in AWS SM
but is no longer staged as AWSCURRENT.

## Operation 4 — Force-rotate (compromised secret)

**Goal**: rotate a secret that is known or strongly suspected to
be compromised. The audit log is the source of truth for "who saw
it last" — pull the Forge AI-36 events for `secret_ref` and check the
`fingerprint` of the resolved values against the new rotation.

**Step 4.1 — Identify the blast radius**:

```bash
# Find every resolve of the compromised secret_ref in the last 7 days.
# Forge AI-36 is the append-only store; the query API is a board-level
# endpoint behind the same OAuth scope as the board dashboard.
fora audit query \
  --tenant "tnt_acme" \
  --action "secret.resolved" \
  --secret-ref "tenants/tnt_acme/secrets/gh_pat" \
  --since "7d" \
  --output json
```

The `fingerprint` field is the SHA-256 prefix of the raw value.
Compare against the new value's fingerprint to confirm the
compromise vector.

**Step 4.2 — Rotate immediately**:

```bash
# Use the rotate operation above with a brand-new value.
# This writes a new AWS SM version and emits a `secret.rotated`
# audit event.
```

**Step 4.3 — Revoke the old version** (see Operation 3).

**Step 4.4 — Audit the resolution path**:

```bash
# Find every `secret.used_for_github.commit_sign` against the
# compromised ref. These are the agents that consumed the value
# in a brokered action.
fora audit query \
  --tenant "tnt_acme" \
  --action-prefix "secret.used_for_" \
  --secret-ref "tenants/tnt_acme/secrets/gh_pat" \
  --since "7d" \
  --output json
```

**Step 4.5 — Notify the security team**:
- Forward the `secret_ref` + rotation timestamp + blast-radius
  query output to `#sec-ir`.
- Open a P0 incident if the `used_for_` actions include a
  `github.commit_sign` (the value was used to sign git commits —
  the agent's recent commits may need to be re-signed or
  considered untrusted).

## Observability

The `secrets-mcp` does not emit Prometheus metrics directly. The
production observability surface is the Forge AI-36 audit feed:

- `secret.resolved` — counter of successful resolutions, scoped
  per `(tenant_id, secret_ref, fingerprint)`.
- `secret.rotated` — counter of rotations, scoped per
  `(tenant_id, secret_ref)`.
- `secret.access_denied` — counter of denials, scoped per
  `(tenant_id, reason)`. A spike in `tenant_scope` denials is a
  signal of a misconfigured cross-tenant routing layer; a spike
  in `not_found` denials is a signal of a missing provisioning.
- `secret.used_for_<intent>` — counter of brokered actions,
  scoped per `(tenant_id, secret_ref, intent)`.

The forwarder logs to stderr on failure
(`[fora-mcp-secrets] audit-forwarder <reason> ...`). Pipe stderr
to the platform log aggregator (CloudWatch / Datadog / Loki) so
5xx-exhaust and credential-shape-detected events are visible to
the SRE on-call.

## Troubleshooting

| Symptom                                              | Likely cause                              | Fix                                                                                            |
|------------------------------------------------------|-------------------------------------------|------------------------------------------------------------------------------------------------|
| Server refuses to boot with `Forge AI_AWS_REGION` required | `Forge AI_BACKING_STORE=aws-secrets-manager` but `Forge AI_AWS_REGION` unset | Set `Forge AI_AWS_REGION` (e.g. `us-east-1`) and restart.                                       |
| Server refuses to boot with `Forge AI_AUDIT_URL` required  | `Forge AI_AUDIT_SINK=fora` but `Forge AI_AUDIT_URL` unset | Set `Forge AI_AUDIT_URL` and restart.                                                            |
| `resolve` returns `not_found` for a known secret      | Wrong tenant or wrong prefix              | Confirm `Forge AI_TENANT_ID` matches the ref's `tenants/{tid}/...` segment; confirm `Forge AI_AWS_SM_PREFIX`. |
| `resolve` returns `tenant_scope`                      | Orchestrator routed a ToolCall for tenant X to the tenant-Y process | The orchestrator is the single source of truth for routing. Restart the wrong-tenant process. |
| `use_for` returns `unknown_intent`                   | The intent is not in the registry         | Add a handler via `BrokeredActionRegistry.register(intent, handler)` at boot. Production wiring is the `auth-engineer` hire. |
| `use_for` returns `invalid_payload`                  | The payload is not a plain object         | The MCP tool schema requires `payload: object`; arrays / null / primitives are rejected.       |
| Audit forwarder logs `retry-exhaust-3`                | Forge AI-36 is down or unreachable           | The forwarder drops the event. The MCP keeps serving. Alert the platform team on the Forge AI-36 side. |
| Audit forwarder logs `credential-shape-detected`     | A regression leaked a raw value into a metadata field | P0 incident. Pull the event details from the stderr log; the broker must not put the raw value anywhere. Open a PR that adds the regression to `test/unit-audit.mjs` first. |

## Related docs

- `mcp-servers/secrets/docs/contract.md` — the closed contract.
- `mcp-servers/secrets/README.md` — the developer-facing README.
- `docs/runbooks/secrets-mcp.md` — the cross-linked repo-root runbook (mirror).
- `docs/architecture/adr-0003-auth-tenancy.md` §7 — the ADR that defines the pattern.
- `docs/engineering/standards.md` §5.1 — the "secrets never in code" rule.
- Forge AI-128 epic and the 7 child issues (Forge AI-185 / Forge AI-186 / Forge AI-187 / Forge AI-188 / Forge AI-189 / Forge AI-190 / Forge AI-191).
