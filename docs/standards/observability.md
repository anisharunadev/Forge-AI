# Standard: Observability

> **Status:** Canonical (Phase 5)
> **Doc owner:** Platform team
> **Source of truth:** `backend/app/core/telemetry.py`, `backend/app/core/logging.py`
> **Last updated:** 2026-07-06

---

## Purpose

Every request, trace, and log line in Forge carries the same minimum
context so on-call can find the tenant, project, request, and actor
without grep archaeology.

---

## Rules

- **O1.** Every span MUST carry `tenant.id`, `project.id`, `request.id`.
- **O2.** Sampling rate MUST be tenant-scoped via `tenant_settings.sampling_rate`.
- **O3.** Log lines MUST include `tenant_id`, `project_id`, `actor_id`, `request_id`.
- **O4.** SLO breach alerts MUST use a sustained-breach window (default 5 min).
- **O5.** Audit events MUST be delivered to live subscribers within 1s.

---

## Enforced by

| Rule | Mechanism |
|------|-----------|
| O1 | `TenantContextMiddleware` + `RequestIdMiddleware` (`backend/app/core/middleware.py`) |
| O2 | `TenantSampler` (`backend/app/core/tenant_sampler.py`) + `tenant_settings` table |
| O3 | structlog `_inject_context` processor in `backend/app/core/logging.py` |
| O4 | `_BreachWindow` in `backend/app/services/observability/slo_alerts.py` |
| O5 | `AuditService.record` XADDs to Redis Stream `audit:{tenant_id}`; `/ws/audit` consumer reads |

---

## See also

- `docs/standards/slos.md` -- per-surface targets
- `docs/runbooks/observability.md` -- operator runbook
