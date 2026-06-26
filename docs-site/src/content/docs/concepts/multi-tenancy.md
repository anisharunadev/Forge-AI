---
draft: false
title: Multi-tenancy
description: How Forge isolates tenants — RLS, per-tenant KMS keys, isolated audit topology.
---

Multi-tenancy is a constitutional rule in Forge, not an opt-in feature. Every record carries `tenant_id`; every table has RLS; every encryption key is scoped to a tenant; the audit log lives in a separate AWS account.

## What is this?

Three concrete mechanisms, layered:

1. **Row-level security (RLS)** on every PostgreSQL table — `tenant_id` + `project_id` are predicates, not application-level filters.
2. **Per-tenant KMS customer-managed keys (CMK)** for S3, RDS encryption at rest, and Secrets Manager.
3. **Isolated audit topology** — the append-only audit database lives in a separate AWS account, mirrored from the primary via CloudTrail + S3 Object Lock.

## Why does it exist?

The cost of retrofitting multi-tenancy is enormous. Once application code filters by `tenant_id` in the WHERE clause, you have a leaky abstraction that needs constant auditing. Once data is encrypted with a single key, you cannot delete a tenant's data on demand (the "right to be forgotten" problem).

Forge makes multi-tenancy the default. RLS predicates are not optional. CMK isolation is not a "Premium" tier.

## What problem does it solve?

| Problem | Without Forge | With Forge |
|---|---|---|
| "Tenant A reads tenant B's data" | Application bug = data breach | RLS denies at the database |
| "Tenant leaves — we need their data deleted" | Cross-tenant encryption makes this hard | Per-tenant CMK can be revoked and re-encrypted |
| "Auditor wants tamper-evident logs" | Logs are mutable in the same DB as the data | Audit DB in a separate AWS account, hash-chained |
| "We need per-tenant cost attribution" | Tagged by application code | LiteLLM virtual keys per tenant, ledger attributed |

## How does it work?

```text
+-----------------------------+        +-----------------------------+
|  Primary AWS Account        |        |  Audit AWS Account          |
|                             |        |                             |
|  RDS PostgreSQL 17          |        |  RDS PostgreSQL 17          |
|   - RLS: tenant_id          |  --->  |   - audit_log (no RLS)      |
|   - CMK: per-tenant         | mirror |   - hash chain anchors      |
|   - audit_log table local   |        |   - S3 Object Lock          |
|                             |        |   - KMS separate            |
|  ElastiCache Redis          |        |                             |
|   - keys per tenant         |        |                             |
|                             |        |                             |
|  S3 buckets                 |        |                             |
|   - SSE-KMS, per-tenant CMK |        |                             |
+-----------------------------+        +-----------------------------+
```

The RLS predicate is set on every table:

```sql
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artifacts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

The application sets `app.tenant_id` at the start of every transaction. There is no path that bypasses the policy — the connection pool resets the setting between tenants.

## How do I use it?

As a developer, you don't write RLS policies for new tables directly — Alembic migrations emit them. You do:

- Set `tenant_id` and `project_id` on every record you create.
- Never write `SELECT * FROM x` without a tenant filter in the application layer — RLS is the safety net, not the primary mechanism.
- Use the per-tenant CMK by reading the secret from Secrets Manager using the tenant-scoped IAM role.

As an operator, you:

- Provision a new tenant by creating a CMK, an IAM role, and a row in the `tenants` table.
- Mirror the audit log to the audit account with a daily CloudTrail export.

## When should I use it?

Always. Multi-tenancy is the default. The only time you bypass it is in system-tasked workflows (`system` tier in the command map) that operate across tenants, and even those audit to a dedicated namespace.

## Related

- [Layer isolation](/concepts/) (also: `concepts/` index covers layer isolation more broadly) — Organization Knowledge vs Project Intelligence
- [Auditability](/concepts/auditability/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
