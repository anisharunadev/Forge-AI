---
name: FORA-579 detail panel shipped
description: FORA-393-5c per-connector detail panel shipped 2026-06-20; 21 vitest + 98/98 forge suite green; commit d07153fd
metadata:
  type: project
---

FORA-579 (per-connector detail panel) closed `done` 2026-06-20T18:14Z; commit `d07153fd`; 5 new files / +1132 lines:

- `apps/forge/app/connector-center/[id]/page.tsx` — server-rendered route, RBAC-gated (Eng Lead + CTO only).
- `apps/forge/components/ConnectorDetailPanel.tsx` — typed-artifact detail panel (header + status pill + "Open in audit" + health + scope + redacted envelope + rotation-deadline callout within 14d + last-100 audit entries + disabled rotate button).
- `apps/forge/lib/connectors/audit-feed.ts` + `audit-feed-types.ts` — typed mock for last-100 audit entries; mirrors FORA-505 AuditEntry.
- `apps/forge/tests/connector-detail.test.tsx` — 21 vitest cases including `assertNoRawCredential` regression for FORA-128.

**Verification:** 21/21 connector-detail tests + 98/98 forge vitest green. No new typecheck errors.

**Reconciles with:** FORA-128 (redacted envelope — no raw secret value in DOM), FORA-125 (IAM broker scope), FORA-505 (Audit Center v0.5.0 — "Open in audit" target). FORA-580 (rotate modal) unblocked.

**Why:** CTO's recovery disposition (comment 5c3a4a49) restored ownership to SeniorEngineer and named the explicit next-step.

**How to apply:** When building the next detail-page-style route in the forge app: use `getConnector` seam + `ConnectorDetailPanel` pattern; follow the `assertNoRawCredential` regression for any credential-display surface. The forge app does NOT depend on `@fora/forge-ui` (verified); mirror the typed shape locally.

**Parent FORA-504:** stays `in_progress` until FORA-581 (axe-core + e2e + README + closure) ships per the original decomposition.

See [[paperclip-cross-team-auth-boundary]] — auth-boundary discipline preserved; SeniorEngineer shipped the deliverable, didn't PATCH FORA-504 itself.