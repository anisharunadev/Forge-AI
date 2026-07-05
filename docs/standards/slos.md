# Standard: SLOs (Service Level Objectives)

> **Status:** Canonical (Phase 5)
> **Doc owner:** Platform team
> **Source of truth:** this file is parsed by `scripts/check-slos.sh` in CI.
> **Last updated:** 2026-07-06

---

## Purpose

Every public surface of Forge carries an explicit SLO. Operators answer
"is it fast enough?" with a number, not a vibe. Each SLO row maps to a
specific OTel metric and a sustained-breach alert (see
`app/services/observability/slo_alerts.py`).

---

## Surfaces

| surface | metric | target | window |
|---------|--------|--------|--------|
| chat | latency_p95_ms | 1500 | 5 |
| chat | error_rate | 0.01 | 5 |
| chat | availability | 0.999 | 30 |
| kg | latency_p95_ms | 2000 | 5 |
| kg | error_rate | 0.01 | 5 |
| kg | availability | 0.999 | 30 |
| ideation | latency_p95_ms | 10000 | 5 |
| ideation | error_rate | 0.02 | 5 |
| ideation | availability | 0.995 | 30 |
| forge-models | latency_p95_ms | 3000 | 5 |
| forge-models | error_rate | 0.01 | 5 |
| forge-models | availability | 0.999 | 30 |
| terminal | latency_p95_ms | 500 | 5 |
| terminal | error_rate | 0.005 | 5 |
| terminal | availability | 0.999 | 30 |
| copilot | latency_p95_ms | 800 | 5 |
| copilot | error_rate | 0.01 | 5 |
| copilot | availability | 0.999 | 30 |

`window` is the breach window in minutes (sustained breach required before
the alert fires). `availability` windows are 30 days, the others 5 minutes.

---

## Measurement

| metric | OTel attribute / Prometheus name |
|--------|----------------------------------|
| latency_p95_ms | histogram `http.server.duration` p95 over `(surface=...)` |
| error_rate | ratio of `http.server.response` with `http.response.status_class="5xx"` to total, per `surface` |
| availability | 1 - error_rate over the window |

The `surface` label is set on every server span by the
`TenantContextMiddleware` (see `backend/app/core/middleware.py`).

---

## Alert linkage

Each row is consumed by `install_default_alerts()` in
`backend/app/services/observability/slo_alerts.py` and evaluated every
60s by the `slo_evaluator` scheduler job. Sustained breaches route to
the AlertManager webhook (`ALERTMANAGER_WEBHOOK_URL`).

---

## See also

- `docs/standards/observability.md` -- logging/sampling rules
- `docs/runbooks/observability.md` -- operator runbook
- `docs/runbooks/slo-degradation.md` -- degradation response
