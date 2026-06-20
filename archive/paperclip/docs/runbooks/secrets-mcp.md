# Runbook — `secrets-mcp` (Forge AI-128)

> **Mirror of [`mcp-servers/secrets/docs/runbook.md`](../../mcp-servers/secrets/docs/runbook.md).**
> The source of truth lives next to the code; this file is the
> repo-root entry point so a new operator finds the runbook from
> `docs/runbooks/` without needing to know the package layout.

The `secrets-mcp` is the per-tenant server that exposes
`resolve(secret_ref)`, `rotate(secret_ref, new_value)`, and
`use_for(secret_ref, intent, payload)` over MCP/stdio. It enforces
the redacted-envelope contract: a raw value never crosses the
broker boundary; the agent sees a `{ redacted, secret_ref,
value_len, fingerprint, expires_at, resolved_at, version }`
envelope. The full operator playbook — boot, rotate, revoke,
force-rotate, observability, troubleshooting — is in the
package-level runbook.

## The four operations

| Operation        | What it does                                                                 | Runbook section                |
|------------------|------------------------------------------------------------------------------|--------------------------------|
| Boot             | Start a per-tenant process with the right env vars and a known-good boot line | [§ Operation 1 — Boot](../../mcp-servers/secrets/docs/runbook.md#operation-1--boot) |
| `rotate`         | Write a new version; the old version stays resolvable until revoked          | [§ Operation 2 — `rotate`](../../mcp-servers/secrets/docs/runbook.md#operation-2--rotate) |
| Revoke           | Move the AWSCURRENT staging label to the new version; old version becomes inaccessible via `@latest` | [§ Operation 3 — Revoke](../../mcp-servers/secrets/docs/runbook.md#operation-3--revoke) |
| Force-rotate     | Rotate + revoke + audit the blast radius (for a confirmed compromise)        | [§ Operation 4 — Force-rotate](../../mcp-servers/secrets/docs/runbook.md#operation-4--force-rotate-compromised-secret) |

## Cross-links

- **Contract** — [`mcp-servers/secrets/docs/contract.md`](../../mcp-servers/secrets/docs/contract.md) is the closed source of truth. Changing the `secret_ref` grammar, the redacted envelope shape, or the audit event names requires an ADR.
- **ADR** — [`docs/architecture/adr-0003-auth-tenancy.md` §7](../../architecture/adr-0003-auth-tenancy.md) defines the secrets-manager hook pattern (the `secret_ref` contract, the redacted envelope, the broker-side raw-use pattern).
- **Engineering standards** — [`docs/engineering/standards.md` §5.1](../../engineering/standards.md) is the "secrets never in code" rule. The `secrets-mcp` is the mechanism that makes the rule enforceable at runtime.
- **v0 README** — [`mcp-servers/secrets/README.md`](../../mcp-servers/secrets/README.md) is the developer-facing quick start.
- **Child issues** (Forge AI-128 work breakdown):
  - [Forge AI-185](/Forge AI/issues/Forge AI-185) — AWS Secrets Manager adapter (production backing store).
  - [Forge AI-186](/Forge AI/issues/Forge AI-186) — Forge AI-36 audit-sink forwarder (production audit pipeline).
  - [Forge AI-189](/Forge AI/issues/Forge AI-189) — broker-side raw-use MCP wrapper (intent → action).
  - [Forge AI-187](/Forge AI/issues/Forge AI-187) — `secrets:` block lint rule (catches agents that try to write raw values into their own context).
  - [Forge AI-188](/Forge AI/issues/Forge AI-188) — gitleaks pre-commit + CI secret-scan.
  - [Forge AI-190](/Forge AI/issues/Forge AI-190) — property test: agent process memory has no raw value.
  - [Forge AI-191](/Forge AI/issues/Forge AI-191) — this runbook.
