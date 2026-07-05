# Summary

<!-- One paragraph: what this PR does and why. Link the issue with `Closes FORA-XXX`. -->

## Problem

<!-- What is broken or missing? Why now? Reference the issue and any prior art. -->

## Acceptance criteria

<!-- Bulleted, testable. Each bullet must be verifiable from the diff or a test. -->

- [ ]
- [ ]
- [ ]

## Verification

<!-- The smallest command/script/log/screenshot that proves the change. Include the actual output, not "it works on my machine". -->

```bash
# command
# output
```

| Tier | Status | Evidence |
|------|--------|----------|
| Unit | ✅ / ❌ | link to CI run or local output |
| Integration | ✅ / ❌ | link to CI run |
| Contract | ✅ / ❌ | link to CI run |
| E2E (nightly / pre-release) | ⏭️ N/A | not a release gate for this PR |

## Risk and rollback

<!-- What could go wrong? How do we revert? Include the exact revert command or one-click path. -->

- **Risk:**
- **Blast radius:**
- **Rollback:** `git revert <sha>` | redeploy previous tag | disable flag

## Agent / prompt changes

<!-- Required if the PR changes an agent, a prompt template, or an MCP adapter's tool surface. Skip this section otherwise. -->

- **Sample input:**
- **Sample output:**
- **Token cost:** input / output / cached / total USD
- **Failure modes tested:**
- **Prompt-injection tested?** Yes / No / N/A

## Dependencies

<!-- Required if `package.json`, `pnpm-lock.yaml`, `requirements.txt`, `uv.lock`, or any Dockerfile changed. Skip otherwise. -->

- **Added:** `<pkg> <version>` — why we need it, what we evaluated
- **Removed:** `<pkg>` — why it is safe
- **Bumped:** `<pkg>: <from> → <to>` — release notes link

## Cost / observability

<!-- Required if the PR touches an LLM call, a token-metered surface, a billing path, or a user-facing log. Skip otherwise. -->

- **New metrics / logs / traces:**
- **Cost delta per request:** tokens, USD
- **Alerting updated:** yes / no

## Exceptions

<!-- Required if the PR knowingly violates a rule in docs/engineering/standards.md. Skip otherwise. Each exception needs a rule, a reason, an owner, and a follow-up issue. -->

- Rule violated:
- Reason:
- Owner:
- Follow-up:

## Schema changes

<!-- Required if this PR touches `backend/app/db/models/`, `backend/alembic/versions/`, or any service that issues SQL. Skip otherwise by removing the entire section. -->

- [ ] Migration adds `tenant_id` / `project_id` columns where missing
- [ ] Composite index `(tenant_id, project_id, ...)` added or updated
- [ ] Isolation test included (2-tenant, see `backend/tests/services/*_isolation.py`)
- [ ] Downgrade executed locally with `scripts/check-migrations.sh` (round-trip green)
- [ ] `EXPLAIN ANALYZE` captured on a representative query (attach output below)
- [ ] `python3 scripts/audit-tenancy.py --strict --require-composite-index` exits 0

EXPLAIN ANALYZE output:

```sql
-- paste here
```

## Checklist

- [ ] Problem and acceptance criteria filled in
- [ ] Verification evidence attached (command output, screenshot, log, or repro recipe)
- [ ] Risk and rollback documented
- [ ] Tests run at the *right* level (not the whole suite, not the wrong tier)
- [ ] No secrets, credentials, or customer data in the diff
- [ ] Docs updated if behavior, contract, or runbook changed (`docs/`, `agents/<agent>/tools.yaml`, runbook links)
- [ ] Linked the issue: `Closes FORA-XXX`
- [ ] Reviewer assigned (CTO for one-way doors; senior for two-way doors)
