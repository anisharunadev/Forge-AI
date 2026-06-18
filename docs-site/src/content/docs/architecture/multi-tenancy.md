---
title: Multi-tenancy
description: How Forge AI isolates customers — physical boundaries, account separation, and tenant-scoped queries.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

Forge AI's tenant isolation is **physical, not aspirational**. The principle (per [`memory/architecture.md` §2.6](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)) is:

> Sub-agents run in separate processes. MCP servers live behind a per-tenant proxy. The DB, the secrets store, and the audit log are in separate accounts.

A bug in the router that crosses tenants is a **P0**.

## The three-account model

```
                      your-corp-org (AWS Organization)
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
  ┌─────▼──────┐          ┌──────▼──────┐           ┌──────▼──────┐
  │  Platform  │          │    Audit    │           │  Customer   │
  │  account   │          │   account   │           │  accounts   │
  │ (prod)     │          │ (separate)  │           │  (per-slug) │
  └────────────┘          └─────────────┘           └─────────────┘
        │                         ▲                         │
        │  ──── cross-account ────┘                         │
        │     IAM role (write-only to SQS)                  │
        │                                                   │
        └──────── per-tenant IAM role ─────────────────────► ┘
```

| Account | Owns | Forge AI can read? |
| --- | --- | --- |
| **Platform** | EKS, RDS, ElastiCache, KMS, Secrets Manager, app code, CloudWatch | yes (full ops) |
| **Audit** | SQS + S3 (append-only, object lock), KMS CMK | **no** — one-way only |
| **Customer** *(per-tenant)* | Customer IAM, customer Secrets Manager entries, customer EKS namespace | yes (for ops) |

The **audit account boundary is non-negotiable**. Forge AI cannot read the audit log; only the customer (and the customer's auditor) can.

## The data layer

Every row in the primary OLTP database has:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id text not null` — kebab-case stable identifier (e.g., `acme-corp`)

Postgres Row-Level Security (RLS) enforces `tenant_id = current_setting('app.tenant_id')` on every table. A query that does not filter by `tenant_id` is a **bug, not a feature**.

```sql
-- example policy
CREATE POLICY tenant_isolation ON runs
  USING (tenant_id = current_setting('app.tenant_id')::text);
```

## The MCP namespace

Each tenant has a dedicated MCP namespace, e.g., `mcp-acme-corp`. The MCP router enforces:

- A tenant's agents can only call tools in their namespace.
- Auth tokens are tenant-scoped (OAuth 2.0 per-tenant, or per-tenant GitHub App).
- Per-tenant RPS limits and circuit breakers.
- Per-tenant secrets (e.g., `fora/prod/acme-corp/jira-api-token`).

A tool call that would cross tenants is **refused**, not warned.

## The audit account

Every tool call is buffered and flushed to the audit-account SQS every 1 s (configurable via `AUDIT_FLUSH_MS`). The audit-account SQS feeds a Lambda that writes to S3 with **object lock** (compliance mode, 365-day retention).

```json
{
  "id": "01HXYZ...",
  "tenant_id": "acme-corp",
  "run_id": "01HXYZ...",
  "stage": "dev",
  "tool": "github.create_pr",
  "actor": "agent:developer",
  "input_sha": "sha256:...",
  "output_sha": "sha256:...",
  "args_hash": "sha256:...",
  "started_at": "2026-06-18T00:00:00Z",
  "ended_at": "2026-06-18T00:00:01Z",
  "tokens_in": 1234,
  "tokens_out": 567,
  "usd": 0.04,
  "result": "ok"
}
```

## Disaster recovery

| Component | RPO | RTO | Backup |
| --- | --- | --- | --- |
| Platform account | 5 min | 30 min | RDS automated + S3 cross-region |
| Audit account | 1 min | 60 min | S3 cross-region replication, object lock |
| Customer accounts | 5 min | 30 min | per-tenant RDS automated + S3 cross-region |

A regional outage of `us-east-1` fails over to `us-west-2` within 30 minutes. The audit-account S3 bucket has cross-region replication enabled by default.

## Where to next

- **[Security overview →](/security/)** — the threat model, IAM, secrets.
- **[Audit log →](/architecture/audit/)** — the audit schema.
- **[Self-host on AWS →](/self-host/aws/)** — the three-account Terraform.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> + <code>workspace/memory/architecture.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
