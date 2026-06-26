---
draft: false
title: forge-* Commands Reference
description: The executable reference for all 63 forge-* commands across 13 categories.
---

This page is the **executable reference** for every `forge-*` command. The single source of truth is `FORGE_COMMAND_MAP` in `backend/app/services/forge_commands.py`.

## What is this?

The full list of commands, grouped by category, with tier and approval posture. For the conceptual overview, see [Commands overview](/commands/). For the white-label rule, see [White-label commands](/concepts/white-label-commands/).

## Tiers

| Tier | Who | Examples |
|---|---|---|
| `user` | Any authenticated user | `forge-intel-scan-repo`, `forge-test-unit`, `forge-flow-status` |
| `admin` | Admin role | `forge-dev-hotfix`, `forge-deploy-prod`, `forge-learn-promote` |
| `system` | Internal — system actors only | `forge-sec-incident`, `forge-deploy-rollback`, `forge-env-sync` |

`requires_approval` commands pause at the HITL gate before they execute.

## How to run a command

### From the Command Center

Open `/forge-command-center`. Pick a category, pick a command, fill the args form, submit.

### From the CLI

```bash
pnpm forge:list
pnpm forge:list --category dev
pnpm forge:list --json | jq '.[0]'

pnpm forge:exec forge-intel-scan-repo \
  --args '{"repo_id":"acme-api"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

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

# Execute
result = route_to_gsd(
    "forge-intel-scan-repo",
    {"repo_id": "acme-api"},
    tenant_id="acme-corp",
    project_id="acme-api",
    user_id="dev@acme.com",
)
```

## All 63 commands

### 1. Onboarding (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-onboard-welcome` | user | no | Welcome a new project / tenant |
| `forge-onboard-detect-stack` | user | no | Auto-detect languages, frameworks, runtimes |
| `forge-onboard-bootstrap` | admin | yes | Scaffold config + initial telemetry |
| `forge-onboard-resume` | user | no | Resume an interrupted onboarding session |

### 2. Project Intelligence (6)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-intel-scan-repo` | user | no | Scan repo layout and entrypoints |
| `forge-intel-scan-deps` | user | no | Inventory direct and transitive dependencies |
| `forge-intel-scan-services` | user | no | Map services and their contracts |
| `forge-intel-scan-secrets` | admin | yes | Detect accidentally committed secrets |
| `forge-intel-summarize` | user | no | Generate a project-level executive summary |
| `forge-intel-trend` | user | no | Show velocity and quality trends |

### 3. Ideation (5)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-ideate-brainstorm` | user | no | Generate candidate approaches for a problem |
| `forge-ideate-refine` | user | no | Refine a chosen idea into concrete shape |
| `forge-ideate-compare` | user | no | Trade-off table for 2+ approaches |
| `forge-ideate-prune` | user | no | Discard rejected approaches with rationale |
| `forge-ideate-crystallize` | admin | yes | Freeze an approach into a recordable decision |

### 4. Architecture (6)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-arch-diagram` | user | no | Render a system diagram from the model |
| `forge-arch-component-map` | user | no | List components and their dependencies |
| `forge-arch-contract-spec` | admin | yes | Draft API/data contracts between components |
| `forge-arch-data-model` | admin | yes | Generate or update the data model |
| `forge-arch-adr` | admin | yes | Record an architectural decision record |
| `forge-arch-drift` | user | no | Detect drift between code and architecture |

### 5. Development (7)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-dev-scaffold` | user | no | Scaffold code from a contract spec |
| `forge-dev-implement` | user | no | Implement a feature end-to-end |
| `forge-dev-refactor` | user | no | Refactor while preserving behavior |
| `forge-dev-format` | user | no | Format the working tree |
| `forge-dev-lint` | user | no | Run project linters |
| `forge-dev-hotfix` | admin | yes | Emergency patch path with audit |
| `forge-dev-migrate` | admin | yes | Run data or schema migrations |

### 6. Testing (5)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-test-plan` | user | no | Generate a test plan from the diff |
| `forge-test-unit` | user | no | Run the unit test suite |
| `forge-test-integration` | user | no | Run the integration test suite |
| `forge-test-e2e` | admin | yes | Run the end-to-end test suite |
| `forge-test-coverage` | user | no | Report coverage deltas against baseline |

### 7. Security (5)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-sec-scan` | admin | yes | Run SAST/SCA scanners |
| `forge-sec-sbom` | admin | yes | Generate or refresh an SBOM |
| `forge-sec-policy-check` | admin | yes | Evaluate tenant policy against the repo |
| `forge-sec-incident` | system | yes | Open a security incident record |
| `forge-sec-audit-export` | admin | yes | Export a tenant-scoped audit bundle |

### 8. Code Review (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-review-diff` | user | no | Summarize a diff for reviewers |
| `forge-review-risk` | user | no | Score change risk across axes |
| `forge-review-approve` | admin | yes | Approve a change set |
| `forge-review-request-changes` | admin | yes | Block a change set with reviewer notes |

### 9. Deployment (5)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-deploy-plan` | admin | yes | Plan a deployment |
| `forge-deploy-stage` | admin | yes | Promote a build to staging |
| `forge-deploy-prod` | admin | yes | Promote a build to production |
| `forge-deploy-rollback` | system | yes | Roll back the most recent prod deploy |
| `forge-deploy-status` | user | no | Show current deploy state per environment |

### 10. Milestones (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-milestone-cut` | admin | yes | Cut a release branch + bump versions |
| `forge-milestone-tag` | admin | yes | Tag the release commit |
| `forge-milestone-changelog` | user | no | Render the changelog for a release |
| `forge-milestone-archive` | admin | yes | Archive artifacts and notes for a release |

### 11. Learning (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-learn-capture` | user | no | Capture a lesson from a session |
| `forge-learn-summarize` | user | no | Summarize captured lessons for review |
| `forge-learn-promote` | admin | yes | Promote a lesson to a durable rule |
| `forge-learn-search` | user | no | Search the org-wide lesson corpus |

### 12. Workflow (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-flow-plan` | user | no | Plan a multi-agent workflow run |
| `forge-flow-run` | user | no | Execute a workflow |
| `forge-flow-cancel` | admin | yes | Cancel a running workflow |
| `forge-flow-status` | user | no | Inspect a running or completed workflow |

### 13. Environment (4)

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-env-list` | user | no | List environments for the tenant |
| `forge-env-diff` | admin | yes | Diff two environments |
| `forge-env-sync` | system | yes | Sync env A to env B (destructive) |
| `forge-env-promote` | admin | yes | Promote a version between environments |

Total: **63 commands**.

## Naming rules

- `forge-<area>-<verb>`
- Regex: `^forge-[a-z][a-z0-9-]*$`
- The map asserts this on import; mismatches fail at startup.

## How to extend

This section is **developer-only**. Users should never read below this line.

### 1. Identify the category

Adding a command that doesn't fit an existing category is a design smell. Review the `CATEGORIES` tuple in `backend/app/services/forge_commands.py` first.

### 2. Choose the tier and approval posture

Default to `user` + `no approval`. Anything that mutates external state, triggers paid APIs, or crosses a tenant boundary should be `admin` + `requires_approval=True`.

### 3. Pick an internal name

The internal name is the opaque triple (e.g., `intel.scan_repo`). It never reaches a customer-facing surface.

### 4. Add the entry to `_ENTRIES`

```python
# backend/app/services/forge_commands.py
("forge-<area>-<verb>", "<internal>:<area>:<verb>", "<one-line description>", "<tier>", <requires_approval>),
```

### 5. Implement the wrapper handler

The bridge lives in `backend/app/agents/tools/gsd_wrapper.py`. Add a new branch to `execute()` for the internal name.

### 6. Register the tool

In the agent that owns the category (see `backend/app/agents/`).

### 7. Surface in the UI

The Command Center picks up the new entry automatically from `FORGE_COMMAND_MAP`. Ensure the description is one line and free of jargon.

### 8. Test

`backend/tests/test_forge_commands.py` must:

- Assert the entry is present.
- Assert `get_forge_command(name)` returns it.
- Assert the resolver raises `UnknownForgeCommand` for typos.

### 9. Bump the count assertion

`FORGE_COMMAND_MAP` must contain `>= 60` commands; the runtime asserts this on import.

## Safety properties

- **No `forge-*` command name is ever ambiguous.** The regex rejects anything else at import time.
- **No internal name leaks.** `route_to_gsd` returns `internal_cmd` only to the actor that owns the run; audit rows strip it before being projected to customer-facing audit views.
- **Approval is enforced at the orchestrator**, not at the CLI. The CLI returns the command descriptor; only the orchestrator can invoke the wrapper against `requires_approval=True` entries without a valid approval record.
- **Every execution is audited.** Even `user` / `no-approval` commands produce an `audit_log` row with `prompt_hash`, `result_hash`, `cost_usd`, and chain hash.

## Related

- [Commands overview](/commands/)
- [White-label commands](/concepts/white-label-commands/)
- [ADR-004: White-labeling](/architecture/adr-004-white-label/)
