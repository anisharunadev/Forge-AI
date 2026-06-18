## FORA-254 — v0.1 shipped (CTO-authored, Architect TBD)

Shipped the Tier 1 / Tier 2 / Tier 3 conflict resolver per
[ADR-0010 §4](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md).
CTO-built v0.1 because the Architect hire (sub-goal 11.x) is
TBD; the architect will inherit the package on hire.

### Code

- `agents/sync_plane/hlc.py` — HLC = `<physical_ms>.<laa>-<seq>`,
  thread-safe `Clock.tick()` / `Clock.observe()` (Kulkarni §3.2).
- `agents/sync_plane/field_owners.py` — `DEFAULT_FIELD_OWNERS`:
  the 11-field §4 table; per-tenant override layer.
- `agents/sync_plane/resolver.py` — Tier 1 (synchronous
  field-ownership rules) → Tier 2 (HLC LWW) → Tier 3 (park
  for human) dispatcher.
- `agents/sync_plane/clock_monitor.py` — sliding-window skew
  detector; `SKEW_THRESHOLD_MS = 5000` with hysteresis at
  `threshold / 2` to avoid flapping.
- `agents/sync_plane/audit.py` — `event.divergence_resolved`
  (Tier 1 + Tier 2) and `event.divergence_detected` (Tier 3)
  audit row shape per ADR §8.1.
- `agents/sync_plane/tests/test_smoke.py` — 13 assertions
  covering all three tiers + per-tenant override + forged-HLC
  end-to-end.
- `agents/sync_plane/README.md` — public API + tiering cheat
  sheet.

### Acceptance criteria (per issue body)

- [x] **AC #1** — field-ownership table is the single source
  of truth (`DEFAULT_FIELD_OWNERS` in the config; per-tenant
  layer via `Resolver(overrides=...)`).
- [x] **AC #2** — Tier 1 resolves the 11 §4 default fields
  (the 8 named + 3 state-machine: `state` / `status` /
  `run_events`).
- [x] **AC #3** — Tier 2 LWW is byte-exact on the canonical
  store; `event.divergence_resolved` audit row carries
  `winner_hlc`, `loser_hlc`, `reason=hlc_lww`.
- [x] **AC #4** — clock monitor auto-degrades Tier 2 → Tier 3
  on >5s skew; hysteresis at 2.5s; Tier 3 emits
  `event.divergence_detected` and parks the event in
  `sync.divergence_queue` (no LWW data loss).
- [x] **AC #5** — per-tenant override is a config flag
  (`Resolver(overrides=...)`), not a code change.
- [x] **AC #6** — smoke test with forged HLCs: 13/13 PASS in
  0.9 ms; evidence JSON written to
  `forge/11.4/evidence/smoke_20260617T211935Z.json`
  (sha256 `400f603c2e056850e5902f8edb437c242db33090147d084fe69ad9f67cfba387`).

### Tiering cheat sheet

| Field class | Tier | Audit event | Reason |
|-------------|------|-------------|--------|
| Paperclip-owned (`run_id`, `run_status`, `assignee_agent_id`, …) | 1 | `event.divergence_resolved` | `field_owner` (reject inbound) |
| Remote-owned (`sprint`, `github_labels`, …) | 1 | `event.divergence_resolved` | `field_owner` (accept if owner matches) |
| State-machine (`state`, `status`) | 1 | `event.divergence_resolved` | `field_owner` (per-platform owner; precedence on tie) |
| Free-text (`title`, `body`, `comment.body`, …) | 2 | `event.divergence_resolved` | `hlc_lww` |
| Free-text + clock skew active | 3 | `event.divergence_detected` | `clock_skew` (park for human) |

### What's NOT shipped in v0.1 (deliberate, per FORA-254 scope)

- The Postgres / JetStream wiring — the v0.1 is dependency-free
  so the smoke runs without infra; production wiring is a
  one-line substitution of the `Clock` and the audit-store call
  site.
- The platform adapters (Jira / GitHub / ClickUp) — those are
  Epic 11.2 (out of scope for 11.4).
- The divergence workbench UI — Epic 11.5.

### Verification

`python3 forge/11.4/run_smoke.py` — 13/13 PASS in 0.9 ms;
evidence JSON at `forge/11.4/evidence/smoke_<ts>.json`.

### Disposition

PATCHing `FORA-254` → `in_review` with a `request_confirmation`
interaction so the parent epic owner can verify and accept.
The Architect (TBD hire) will own this on hire; CTO is
informational until then.