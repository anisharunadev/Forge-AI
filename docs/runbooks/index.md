# Forge AI — Runbooks (index)

> **Purpose.** Single entry-point for every operator-facing runbook. The
> link-checker in `.github/workflows/operational-readiness.yml` runs
> against this file.

## Day-2 operations

- [oncall.md](./oncall.md) — quick severity/escalation reference (thin canonical)
- [../operations/oncall-runbook.md](../operations/oncall-runbook.md) — full remediation steps per alert

## Disaster recovery

- [disaster-recovery.md](./disaster-recovery.md) — 4-scenario playbook (region, DB, Redis, LiteLLM)
- [../operations/rollback-procedures.md](../operations/rollback-procedures.md) — rollback procedures

## Specific runbooks

- [budget-exhausted.md](./budget-exhausted.md) — tenant LLM budget exhausted (M6)
- [litellm-downtime.md](./litellm-downtime.md) — LiteLLM Proxy outage (M5)
- [incident-response.md](./incident-response.md) — security incident canonical (thin)
- [../operations/incident-response.md](../operations/incident-response.md) — full security incident response
- [../operations/seed-data.md](../operations/seed-data.md) — seed data refresh

## Cross-cutting

- [../operations/oncall-runbook.md](../operations/oncall-runbook.md)
- [../operations/dev-bootstrap.md](../operations/dev-bootstrap.md)
