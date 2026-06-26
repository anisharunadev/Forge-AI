---
draft: false
title: Troubleshooting
description: Common Forge AI issues and how to resolve them.
---

This page collects the most common issues encountered while running Forge and how to resolve them.

## Setup

### `pnpm install` fails on a fresh checkout

Likely cause: Node version mismatch.

Fix:

```bash
node --version    # must be >= 20
nvm install 20
nvm use 20
pnpm install
```

### `docker compose up -d` fails with port collisions

Likely cause: another service holds `:5432`, `:6379`, or `:4566`.

Fix: edit `docker-compose.yml` and remap, or stop the conflicting service.

### Backend can't reach Postgres

Symptom: `connection refused` on `localhost:5432`.

Check:

```bash
docker compose ps                 # is postgres up?
docker compose logs postgres      # any errors?
psql -h localhost -U forge -d forge   # direct connection
```

The default credentials are in `.env.example`. Don't commit overrides to git.

## Backend

### 401 Unauthorized from a `forge-*` command

Cause: missing or invalid JWT.

Check:

- `KEYCLOAK_ISSUER` is set and reachable.
- The token has not expired.
- The token's `tenant_id` claim matches the `--tenant-id` argument.

### 403 Forbidden — wrong tier

Cause: the user doesn't have the tier required for the command.

Example: a `user`-tier user invoking `forge-deploy-prod` (admin tier).

Fix: use an admin user, or have an admin elevate the role.

### Command requires approval but no approver is set

Cause: `requires_approval=True` but no role has the approval permission for this command type.

Fix: in the policy file, assign the approval role to a user or group.

### RLS denies everything

Symptom: `SELECT` returns 0 rows even though the data exists.

Cause: `app.tenant_id` is not set for the connection.

Fix: in scripts, set the GUC manually:

```sql
SET app.tenant_id = 'acme-corp';
SET app.project_id = 'acme-api';
```

In FastAPI, the middleware sets this from the request context. If it's empty, the JWT likely lacks the `tenant_id` claim.

## LLM calls

### LiteLLM Proxy returns 503

Cause: no virtual key configured for the tenant, or the key has no budget left.

Fix:

- Provision a virtual key in `litellm_config.yaml`.
- Increase the budget envelope for the tenant.
- Check `forge-flow-status` for the last successful invocation.

### High latency on LLM calls

Cause: model provider throttling, or a long prompt.

Fix:

- Check `litellm_latency_seconds` metric for the tenant.
- Trim the prompt.
- Switch to a faster model for the workflow.

## Audit ledger

### Hash chain anchor failure

Symptom: alert `anchor_ref mismatch`.

Cause: a row was tampered with, or the anchor Lambda failed.

Fix:

1. Compare `audit_log` in primary vs audit account.
2. Identify the divergence point.
3. Treat all rows after the divergence as suspect.
4. Open an incident.

### Audit export fails

Symptom: `forge-sec-audit-export` errors out.

Cause: tenant-scoped secrets missing, or S3 bucket policy blocks the export.

Fix:

- Check Secrets Manager has the audit-export role's credentials.
- Check the destination bucket's policy allows the audit account to write.

## Connectors

### Connector stuck on `pending`

Cause: per-tenant secret not configured.

Fix: provision the secret in Secrets Manager and the connector health check will move to `live` within 60 seconds.

### Connector flips between `live` and `degraded`

Cause: rate limit hit, or partial failure of the external system.

Fix:

- Check the connector's metric for `requests_throttled_total`.
- Back off; increase quota if appropriate.
- Check the external status page.

### Connector `down`

Cause: auth invalid or external outage.

Fix:

- Rotate the per-tenant secret.
- Verify the external system is up.
- Check the connector's last error in the audit log.

## Workflows

### Workflow paused at a gate for too long

Symptom: `forge-flow-status` shows the workflow paused for > 24 hours.

Cause: approver unavailable, or notification missed.

Fix:

- The Command Center surfaces pending approvals on the dashboard.
- Use `forge-flow-cancel` (admin) if the workflow is no longer relevant.
- Reassign the approval role to a backup reviewer.

### Workflow fails at the implementation node

Cause: agent run error, code generation failure, test failure.

Fix:

- Inspect the trace by `workflow.id`.
- Read the agent's audit rows for the failure context.
- Re-run from the failed node (`forge-flow-run` supports resumption from a checkpoint).

## UI

### Command Center shows "no commands"

Cause: the `FORGE_COMMAND_MAP` failed to import (missing dependency or syntax error).

Fix:

- Check `backend` logs for the import error.
- The CI asserts `len(FORGE_COMMAND_MAP) >= 60`; if the import fails, the backend won't start.

### Terminal Center shows a blank pane

Cause: PTY not allocated, or browser blocked the WebSocket.

Fix:

- Check browser console for WebSocket errors.
- Verify the backend's `/api/v1/terminal/ws` endpoint is reachable.
- Check the browser's network tab for blocked frames.

## Related

- [Local setup](/guides/local-setup/)
- [Production deployment](/guides/production-deploy/)
- [Oncall runbook](/operations/oncall/)
- [Incident response](/operations/incident-response/)
