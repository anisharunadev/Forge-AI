# Sync Plane — Tier 1 / Tier 2 / Tier 3 conflict resolver

**Owner:** CTO (v0.1) — Architect (TBD hire) once onboarded
**Issue:** [FORA-254](/FORA/issues/FORA-254) (Sub-goal 11.4 of Epic 11)
**Status:** v0.1 — pure-Python, dependency-free, smoke-tested
**Reference:** [ADR-0010 §4](../../docs/architecture/adr-0010-cross-platform-sync-plane.md)

## Scope (FORA-254)

This module is the FORA-254 deliverable: a config-driven conflict
resolver that:

- ships the **field-ownership table** from ADR-0010 §4 as a single
  source of truth (AC #1, AC #2 — all 8 default-table fields
  covered);
- applies **Tier 1 (synchronous field-ownership rules)** before
  anything else;
- applies **Tier 2 (HLC + last-writer-wins)** for free-text fields,
  byte-exact on the canonical store, emitting the
  `event.divergence_resolved` audit row with `winner_hlc`,
  `loser_hlc`, `reason=hlc_lww` (AC #3);
- **auto-degrades to Tier 3** on >5s skew between two physical
  timestamps in the event log (AC #4) — the `ClockMonitor` does
  this with hysteresis to avoid flapping;
- supports **per-tenant overrides** as a config flag, not a code
  change (AC #5);
- ships a **smoke test** that uses forged HLCs to show resolution
  + audit row (AC #6).

The default precedence for state-machine fields is
`paperclip > jira > github > clickup` (ADR-0010 §4 closing
paragraph), overridable per tenant.

## Module map

| File | Purpose |
|------|---------|
| `hlc.py` | Hybrid Logical Clock (`<ms>.<laa>-<seq>`), per-node `Clock` |
| `field_owners.py` | The §4 ownership table; per-tenant override layer |
| `resolver.py` | Tier 1 / Tier 2 / Tier 3 dispatcher |
| `clock_monitor.py` | Skew detection + Tier 3 trigger |
| `audit.py` | `event.divergence_resolved` + `event.clock_skew` row shape |
| `__init__.py` | Public surface |
| `tests/test_smoke.py` | The AC #6 smoke test |

## Public API (entry points)

```python
from agents.sync_plane import (
    Clock,                     # the HLC ticking clock
    HLC, parse,                # HLC type + parser
    DEFAULT_FIELD_OWNERS,      # the §4 table
    Resolver, resolve,         # the conflict resolver
    ClockMonitor,              # the Tier 3 trigger
    SKEW_THRESHOLD_MS,         # 5000ms; from ADR-0010 §7.1
)

clock = Clock(node_id="sync-plane-1")
monitor = ClockMonitor(tenant_id="acme")
resolver = Resolver(
    clock=clock,
    tenant_id="acme",
    actor="agent:doc-agent",
    overrides=None,            # per-tenant override layer (AC #5)
)

result = resolve(
    resolver=resolver,
    field="title",             # free-text → Tier 2
    inbound_platform="github",
    inbound_value="Add OAuth2 PKCE",
    inbound_hlc="1718645112000.004-0042",
    canonical={"value": "old title", "hlc": "...", "platform": "jira"},
)

assert result.tier == Resolution.TIER2_LWW
assert result.reason == "hlc_lww"
assert result.audit_row is not None
```

## Tiering rules (cheat sheet)

| Field class | Tier | Audit reason | Action |
|-------------|------|--------------|--------|
| Paperclip-owned (`run_id`, `run_status`, `assignee_agent_id`, …) | 1 | `field_owner` | Reject inbound; mirror outbound |
| Remote-owned (`sprint`, `story_points`, `github_labels`, …) | 1 | `field_owner` | Accept; mirror to all other remotes |
| State-machine (`state`, `status`) | 1 | `field_owner` | Per-platform owner; precedence on tie |
| Free-text (`title`, `body`, `comment.body`, …) | 2 | `hlc_lww` | Highest HLC wins; emit divergence_resolved |
| Free-text + skew active | 3 | `clock_skew` | Park in `sync.divergence_queue`; human resolves |

## Running the smoke test

```bash
cd forge/0.7-platform/
python -m agents.sync_plane.tests.test_smoke
```

Expected output:

```
[PASS] HLC monotonicity + tick()/observe()
[PASS] Field ownership table (8 default fields)
[PASS] Tier 1 paperclip-owned reject
[PASS] Tier 1 remote-owned accept
[PASS] Tier 2 LWW: inbound beats canonical
[PASS] Tier 2 LWW: canonical beats inbound
[PASS] Tier 2 LWW: precedence on HLC tie
[PASS] Tier 3 auto-degrade on >5s skew
[PASS] Per-tenant override (config flag, not code change)
[PASS] Audit row carries winner_hlc, loser_hlc, reason=hlc_lww
[PASS] Forged-HLC end-to-end smoke (AC #6)
```

## Out of scope (deliberately, for FORA-254)

- The actual platform adapters (Jira, GitHub, ClickUp) — those are
  Epic 11.2 and not in this heartbeat.
- The divergence workbench UI — Epic 11.5.
- The Postgres / JetStream wiring — the v0.1 is dependency-free
  so the smoke test runs without infra; production wiring is a
  one-line substitution at the audit-store call site.
- The daily divergence-detection job — Epic 11.7.
