# Forge AI secrets-mcp

`forge-ai/mcp-secrets` — the secrets-mcp adapter for the Forge AI Enterprise
AI SDLC Operating System. Resolves `secret_ref`s at call time from a
tenant-scoped secret manager, returns a redacted envelope to the
agent, and emits an audit event per resolution. v1 backing store
is in-memory (dev/test); the AWS Secrets Manager adapter is a
follow-up child issue (`Forge AI-128.b`).

This package implements [ADR-0003 §7](https://example.invalid/Forge AI/docs/architecture/adr-0003-auth-tenancy) and the [Forge AI-128](https://example.invalid/Forge AI/issues/Forge AI-128) deliverable list.

## Surface

| Tool      | Input                                              | Output (always)                                    |
|-----------|----------------------------------------------------|----------------------------------------------------|
| `resolve` | `{ secret_ref: "tenants/{tid}/secrets/{n}@{v}" }`  | `{ ok, envelope: { redacted, secret_ref, value_len, fingerprint, expires_at, resolved_at, version } }` |
| `rotate`  | `{ secret_ref, new_value }`                        | `{ ok, secret_ref, version, created_at }`          |

The **redacted envelope** never carries the raw value. The agent
sees only the byte length (`value_len`) and a 16-char hex
`fingerprint` of the resolved value.

The `secret_ref` grammar is **closed**:

```
tenants/{tenant_id}/secrets/{name}@{version}
```

`version` is optional and defaults to `latest`. Versions are
positive integers (1, 2, 3, …) or the literal `latest`. Changing
the grammar is a one-way door and requires an ADR.

## Why a broker, not a direct call

Per ADR-0003 §7.1, the agent never sees the raw value. The
`secrets-mcp` *resolves* the value inside the broker, and the
broker materialises the value at the last hop for any downstream
MCP that needs it (the "broker-side raw-use" pattern). The agent's
prompt and memory are never in the data path of the raw value.

## Backlog

The following are tracked as child issues of Forge AI-128, not
landed in v0:

- `Forge AI-128.b` — AWS Secrets Manager adapter (production backing store)
- `Forge AI-128.c` — Forge AI-36 audit-sink forwarder (replace `InMemoryAuditSink`)
- `Forge AI-128.d` — `secrets:` block lint rule for agent prompts
- `Forge AI-128.e` — gitleaks pre-commit + CI secret-scan wiring
- `Forge AI-128.f` — broker-side raw-use MCP wrapper for the
  "intent → brokered action" pattern
- `Forge AI-128.g` — property test: agent process memory dump after
  `resolve` shows no raw value
- `Forge AI-128.h` — runbook + docs handoff (operator playbook)

## Local dev

```bash
cd mcp-servers/secrets
npm install
npm run typecheck
npm run build
npm test     # unit tests
npm run smoke
```

The smoke test boots the compiled server as a child process and
exercises every contract over MCP/stdio.
