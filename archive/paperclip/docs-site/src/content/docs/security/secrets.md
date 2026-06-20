---
title: Secrets
description: AWS Secrets Manager, Doppler, per-tenant scoping, rotation, audit.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

The **secrets** pillar of the Forge AI security posture. The bar is [`memory/security.md` §3](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).

## The principle

> Secrets never go in env. Secrets never go in prompts. Secrets never go in code. Secrets come from a vault, are scoped per tenant, and are rotated on a schedule.

A leaked secret is a P0.

## The vault

| Env | Vault | Setup |
| --- | --- | --- |
| **Dev** | Doppler | <https://www.doppler.com/> |
| **Staging** | Doppler | same |
| **Prod** | **AWS Secrets Manager** | the default for self-hosted production |

Secrets Manager integrates with the **Secrets Store CSI Driver** in EKS. Pods mount secrets as volumes; pods never read raw secret values at rest in etcd.

## The path scheme

Every secret has a stable path:

```
fora/<env>/<tenant-slug>/<purpose>
```

Examples:

- `fora/prod/acme-corp/jira-api-token`
- `fora/prod/acme-corp/github-app`
- `fora/prod/acme-corp/anthropic`
- `fora/prod/_shared/anthropic` (the shared model key, used when per-tenant override is absent)

The `_shared` namespace holds secrets that are not tenant-scoped (e.g., the platform's own LLM key).

## Rotation

| Secret class | Rotation | Window |
| --- | --- | --- |
| **API tokens** (Jira, GitHub, etc.) | 30 days | 1 h grace (old + new valid) |
| **OAuth refresh tokens** | 7 days | n/a (auto-refresh) |
| **LLM API keys** | 90 days | 1 h grace |
| **Customer SSO secrets** | on IdP rotation | n/a |
| **Database passwords** | 30 days | automatic (Secrets Manager rotation Lambda) |
| **TLS private keys** | on cert renewal | n/a (managed by ACM) |

A secret that fails to rotate triggers a PagerDuty alert within 15 min.

## The per-tenant scoping

A secret in `fora/prod/acme-corp/...` is bound to the `acme-corp` IAM role. The orchestrator assumes the role at the start of a run; the role grants access to that tenant's secrets only.

A request for `fora/prod/other-corp/...` from the `acme-corp` role is **refused**, not warned.

## The audit

Every secret read is captured in the audit log:

```json
{
  "id": "01HXYZ...",
  "tenant_id": "acme-corp",
  "run_id": "01HXYZ...",
  "stage": "dev",
  "tool": "secrets.read",
  "actor": "agent:developer",
  "input_sha": "sha256:...",
  "metadata": {
    "secret_path": "fora/prod/acme-corp/github-app",
    "secret_version": "01HXYZ..."
  }
}
```

The secret value is **never** captured. The audit row carries the path + version, not the value.

## The gitleaks scan

`gitleaks` runs:

- **Pre-commit** — every commit
- **CI** — every PR
- **Scheduled** — daily full-repo scan via TruffleHog

A leaked secret in a PR is a P1. A leaked secret in `main` is a P0 and triggers an immediate rotation.

## Where to next

- **[Identity & access →](/security/iam/)** — RBAC, agent identity.
- **[Compliance →](/security/compliance/)** — SOC 2 / ISO 27001.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> §3</dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
