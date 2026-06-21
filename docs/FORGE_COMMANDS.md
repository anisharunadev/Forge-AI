# `forge-*` Command Reference

Forge AI exposes every internal engine action under a `forge-*` command name. Users of Forge AI must NEVER see "GSD" anywhere — per [ADR-004 (DL-024)](architecture/decisions/0004-gsd-white-labeling.md), every internal `gsd:<area>:<verb>` triple is wrapped under a friendlier `forge-<area>-<verb>` name.

The single source of truth is [`backend/app/services/forge_commands.py`](../backend/app/services/forge_commands.py) (`FORGE_COMMAND_MAP`). This file is the executable reference; this document is the human reference.

## Tiers

| Tier | Who | Examples |
| --- | --- | --- |
| `user` | Any authenticated user | `forge-intel-scan-repo`, `forge-test-unit`, `forge-flow-status` |
| `admin` | Admin role | `forge-dev-hotfix`, `forge-deploy-prod`, `forge-learn-promote` |
| `system` | Internal — system actors only | `forge-sec-incident`, `forge-deploy-rollback`, `forge-env-sync` |

`requires_approval` commands pause at the HITL gate before they execute. The orchestrator resumes only after the approver decides; the decision is recorded in the audit ledger.

## How to run a command

### From the Command Center (UI)

Open `/forge-command-center`, pick a category, pick a command, fill the args form, submit.

### From the CLI (root)

The root `package.json` exposes two scripts that delegate to `backend/app/services/forge_commands.py`:

```bash
pnpm forge:list
pnpm forge:list --category dev
pnpm forge:list --json | jq '.[0]'

pnpm forge:exec forge-intel-scan-repo --args '{"repo_id":"acme-api"}'
pnpm forge:exec forge-deploy-prod \
  --args '{"build_id":"abc123","environment":"prod"}' \
  --tenant-id acme-corp --project-id acme-api --user-id cto@acme.com
```

### From Python

```python
from backend.app.services.forge_commands import (
    get_forge_command,
    list_forge_commands,
    route_to_gsd,
)

# List
for c in list_forge_commands(category="dev"):
    print(c.forge_cmd, c.tier, c.description)

# Resolve
cmd = get_forge_command("forge-dev-implement")
print(cmd.internal_cmd, cmd.requires_approval)

# Execute (hands off to GSDWrapper)
result = route_to_gsd(
    "forge-intel-scan-repo",
    {"repo_id": "acme-api"},
    tenant_id="acme-corp",
    project_id="acme-api",
    user_id="dev@acme.com",
)
```

## Categories

The map covers **13 categories**. Each command is keyed by `forge-<area>-<verb>`; the area is the category.

| # | Category | Count | Notes |
| --- | --- | --- | --- |
| 1 | onboarding | 4 | welcome, detect-stack, bootstrap, resume |
| 2 | intel (project intelligence) | 6 | scan-repo/deps/services/secrets, summarize, trend |
| 3 | ideate | 5 | brainstorm, refine, compare, prune, crystallize |
| 4 | arch | 6 | diagram, component-map, contract-spec, data-model, adr, drift |
| 5 | dev | 7 | scaffold, implement, refactor, format, lint, hotfix, migrate |
| 6 | test | 5 | plan, unit, integration, e2e, coverage |
| 7 | sec | 5 | scan, sbom, policy-check, incident, audit-export |
| 8 | review | 4 | diff, risk, approve, request-changes |
| 9 | deploy | 5 | plan, stage, prod, rollback, status |
| 10 | milestone | 4 | cut, tag, changelog, archive |
| 11 | learn | 4 | capture, summarize, promote, search |
| 12 | flow | 4 | plan, run, cancel, status |
| 13 | env | 4 | list, diff, sync, promote |

Total: **63 commands**.

## 1. Onboarding

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-onboard-welcome` | user | no | Welcome a new project / tenant. |
| `forge-onboard-detect-stack` | user | no | Auto-detect languages, frameworks, runtimes. |
| `forge-onboard-bootstrap` | admin | yes | Scaffold `.gsd` config + initial telemetry. |
| `forge-onboard-resume` | user | no | Resume an interrupted onboarding session. |

## 2. Project Intelligence (`intel`)

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-intel-scan-repo` | user | no | Scan repo layout and entrypoints. |
| `forge-intel-scan-deps` | user | no | Inventory direct and transitive dependencies. |
| `forge-intel-scan-services` | user | no | Map services and their contracts. |
| `forge-intel-scan-secrets` | admin | yes | Detect accidentally committed secrets. |
| `forge-intel-summarize` | user | no | Generate a project-level executive summary. |
| `forge-intel-trend` | user | no | Show velocity and quality trends. |

## 3. Ideation

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-ideate-brainstorm` | user | no | Generate candidate approaches for a problem. |
| `forge-ideate-refine` | user | no | Refine a chosen idea into concrete shape. |
| `forge-ideate-compare` | user | no | Trade-off table for 2+ approaches. |
| `forge-ideate-prune` | user | no | Discard rejected approaches with rationale. |
| `forge-ideate-crystallize` | admin | yes | Freeze an approach into a recordable decision. |

## 4. Architecture

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-arch-diagram` | user | no | Render a system diagram from the model. |
| `forge-arch-component-map` | user | no | List components and their dependencies. |
| `forge-arch-contract-spec` | admin | yes | Draft API/data contracts between components. |
| `forge-arch-data-model` | admin | yes | Generate or update the data model. |
| `forge-arch-adr` | admin | yes | Record an architectural decision record. |
| `forge-arch-drift` | user | no | Detect drift between code and architecture. |

## 5. Development

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-dev-scaffold` | user | no | Scaffold code from a contract spec. |
| `forge-dev-implement` | user | no | Implement a feature end-to-end. |
| `forge-dev-refactor` | user | no | Refactor while preserving behavior. |
| `forge-dev-format` | user | no | Format the working tree. |
| `forge-dev-lint` | user | no | Run project linters. |
| `forge-dev-hotfix` | admin | yes | Emergency patch path with audit. |
| `forge-dev-migrate` | admin | yes | Run data or schema migrations. |

## 6. Testing

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-test-plan` | user | no | Generate a test plan from the diff. |
| `forge-test-unit` | user | no | Run the unit test suite. |
| `forge-test-integration` | user | no | Run the integration test suite. |
| `forge-test-e2e` | admin | yes | Run the end-to-end test suite. |
| `forge-test-coverage` | user | no | Report coverage deltas against baseline. |

## 7. Security

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-sec-scan` | admin | yes | Run SAST/SCA scanners. |
| `forge-sec-sbom` | admin | yes | Generate or refresh an SBOM. |
| `forge-sec-policy-check` | admin | yes | Evaluate tenant policy against the repo. |
| `forge-sec-incident` | system | yes | Open a security incident record. |
| `forge-sec-audit-export` | admin | yes | Export a tenant-scoped audit bundle. |

## 8. Code Review

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-review-diff` | user | no | Summarize a diff for reviewers. |
| `forge-review-risk` | user | no | Score change risk across axes. |
| `forge-review-approve` | admin | yes | Approve a change set. |
| `forge-review-request-changes` | admin | yes | Block a change set with reviewer notes. |

## 9. Deployment

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-deploy-plan` | admin | yes | Plan a deployment (versions, blast radius). |
| `forge-deploy-stage` | admin | yes | Promote a build to staging. |
| `forge-deploy-prod` | admin | yes | Promote a build to production. |
| `forge-deploy-rollback` | system | yes | Roll back the most recent prod deploy. |
| `forge-deploy-status` | user | no | Show current deploy state per environment. |

## 10. Milestones

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-milestone-cut` | admin | yes | Cut a release branch + bump versions. |
| `forge-milestone-tag` | admin | yes | Tag the release commit. |
| `forge-milestone-changelog` | user | no | Render the changelog for a release. |
| `forge-milestone-archive` | admin | yes | Archive artifacts and notes for a release. |

## 11. Learning

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-learn-capture` | user | no | Capture a lesson from a session. |
| `forge-learn-summarize` | user | no | Summarize captured lessons for review. |
| `forge-learn-promote` | admin | yes | Promote a lesson to a durable rule. |
| `forge-learn-search` | user | no | Search the org-wide lesson corpus. |

## 12. Workflow (`flow`)

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-flow-plan` | user | no | Plan a multi-agent workflow run. |
| `forge-flow-run` | user | no | Execute a workflow. |
| `forge-flow-cancel` | admin | yes | Cancel a running workflow. |
| `forge-flow-status` | user | no | Inspect a running or completed workflow. |

## 13. Environment

| Command | Tier | Approval | Description |
| --- | --- | --- | --- |
| `forge-env-list` | user | no | List environments for the tenant. |
| `forge-env-diff` | admin | yes | Diff two environments. |
| `forge-env-sync` | system | yes | Sync env A to env B (destructive). |
| `forge-env-promote` | admin | yes | Promote a version between environments. |

## How to extend (add a new command)

1. **Identify the category.** Adding a command that does not fit an existing category is a design smell — review the `CATEGORIES` tuple in `backend/app/services/forge_commands.py` first.
2. **Choose the tier and approval posture.** Default to `user` + `no approval`. Anything that mutates external state, triggers paid APIs, or crosses a tenant boundary should be `admin` + `requires_approval=True`.
3. **Pick an internal name.** The internal name is the opaque `gsd:<area>:<verb>` triple; it never reaches a customer-facing surface.
4. **Add the entry** to the `_ENTRIES` tuple in `backend/app/services/forge_commands.py`:

   ```python
   ("forge-<area>-<verb>", "gsd:<area>:<verb>", "<one-line description>", "user", False),
   ```

5. **Implement the GSDWrapper handler.** The bridge lives in `backend/app/agents/tools/gsd_wrapper.py`. Add a new branch to `execute()` for the internal name.
6. **Register the tool** in the agent that owns the category (see `backend/app/agents/`).
7. **Surface in the UI.** The Command Center picks up the new entry automatically from `FORGE_COMMAND_MAP`; ensure the description is one line and free of jargon.
8. **Test.** `backend/tests/test_forge_commands.py` (or add one) must:
   - Assert the entry is present
   - Assert `get_forge_command(name)` returns it
   - Assert the resolver raises `UnknownForgeCommand` for typos
9. **Bump the count assertion.** `FORGE_COMMAND_MAP` must contain `>= 60` commands; the runtime asserts this on import.

## Safety properties

- **No `forge-*` command name is ever ambiguous.** `_FORGE_NAME_RE = ^forge-[a-z][a-z0-9-]*$` rejects anything else at import time.
- **No internal name leaks.** `route_to_gsd` returns `internal_cmd` only to the actor that owns the run; audit rows strip it before being projected to customer-facing audit views.
- **Approval is enforced at the orchestrator**, not at the CLI. The CLI returns the command descriptor; only the orchestrator can invoke `GSDWrapper.execute()` against `requires_approval=True` entries without a valid approval record.
- **Every execution is audited.** Even `user` / `no-approval` commands produce an `audit_log` row with `prompt_hash`, `result_hash`, `cost_usd`, and chain hash.
