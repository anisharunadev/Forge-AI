# Runbook: GDPR Article 17 — Tenant Deletion Cascade

Phase 8 SC-8.3.

## When to use

A tenant or data-protection officer requests Article 17 (Right to
Erasure) deletion for a tenant. The cascade removes PII from every
table the tenant touched, anonymizes the rows LiteLLM/billing
retains, and best-effort drops the tenant's embeddings + object-storage
files.

## Endpoint

```
POST /api/v1/forge/compliance/gdpr/delete
{
  "user_id": "<UUID of the requesting user>",
  "justification": "Article 17 — tenant offboarded YYYY-MM-DD"
}
```

Caller must have role `org_admin` or `super_admin`. The endpoint
returns `202 Accepted` with:

- `user_id` — the requesting user
- `eta` — completion timestamp (now, since the cascade is synchronous)
- `job_id` — UUID identifying this cascade run
- `affected_tables` — list of `<table>.<action>=<row_count>`

## Per-table behavior

| Mode | Tables |
|---|---|
| **delete** | users, user_sessions, user_api_tokens, connectors, connector_credentials, rag_chunks, kg_nodes, kg_edges, ideation_ideas, ideation_approval_items, ideation_push_records, stories, lesson_entries, persona_memories, tenant_settings |
| **anonymize** | litellm_call_records, cost_entries, audit_events |

`anonymize` nulls PII columns but keeps the row:

- `litellm_call_records.actor_id` → NULL
- `cost_entries.metadata` → `'{}'::jsonb`
- `audit_events.actor_id`, `actor_email`, `subject_email`, `ip_address` → NULL

## Procedure

1. Confirm the request scope (tenant_id, requesting user_id, justification).
2. Capture pre-delete row counts (runbook operator step; use
   `SELECT count(*) FROM <table> WHERE tenant_id = '<uuid>'`).
3. Call `POST /api/v1/forge/compliance/gdpr/delete`.
4. Compare `affected_tables` row counts against the pre-delete counts.
5. If `errors` is non-empty, investigate before declaring done.

## Rollback

There is no rollback. GDPR Article 17 is one-way. Backups taken
before the cascade may still contain the PII; restore is not a
valid remediation.

## Test

`tests/security/test_gdpr_cascade.py` exercises the executor
against an in-memory SQLite engine. Run with:

```bash
PYTHONPATH=backend python3 -m pytest tests/security/test_gdpr_cascade.py -v
```

Expected: 1 passed, runtime < 300s.

## Known limitations

- Embeddings removal is a no-op hook; deployments must wire
  the vector-store-specific implementation.
- Object-storage file removal is a no-op hook; deployments must
  wire S3/MinIO.
- Audit events are anonymized but not deleted (legal retention).
