---
name: Bug report
about: Report a defect, regression, or unexpected behavior in Forge AI
title: "[BUG] "
labels: ["bug", "triage"]
assignees: []
---

## Summary

<!-- One or two sentences describing the bug. -->

## Environment

- Component (check all that apply):
  - [ ] Backend (FastAPI)
  - [ ] Frontend (apps/forge)
  - [ ] Terminal Center (PTY)
  - [ ] Agent / LangGraph
  - [ ] MCP server
  - [ ] Auth / Keycloak
  - [ ] Database / RLS
  - [ ] Cost ledger
  - [ ] CI / CD
  - [ ] Docs

- Environment: `local` | `staging` | `production`
- Tenant (if known): `forge-default` | `acme-prod` | other
- Commit / build SHA: `_______________________`
- User / tenant ID (never PII): `_______________________`

## Steps to reproduce

```text
1.
2.
3.
```

## Expected behavior

<!-- What you expected to happen. -->

## Actual behavior

<!-- What actually happened. Include stack traces, screenshots, and console logs inline. -->

## Logs / traces

```text
paste logs here
```

## Severity

- [ ] Sev-1 (production down or data loss)
- [ ] Sev-2 (major feature broken)
- [ ] Sev-3 (minor feature broken)
- [ ] Sev-4 (cosmetic / docs)

## Linked items

- ADR: `ADR-____`
- NFR: `NFR-____`
- FR: `FR-____`
- Slack thread: `_______________________`
- Datadog / Sentry link: `_______________________`

## Acceptance criteria for the fix

- [ ] Repro steps no longer fail
- [ ] Regression test added at the correct tier (unit / integration / e2e)
- [ ] ADR / NFR referenced if behavior changed
- [ ] Owner: @___________
