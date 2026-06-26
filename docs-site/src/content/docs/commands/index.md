---
draft: false
title: Forge Commands Overview
description: The 63 forge-* commands across 13 categories — the executable surface of Forge AI.
---

Every internal action on the Forge platform is exposed as a `forge-<area>-<verb>` command. The single source of truth is `FORGE_COMMAND_MAP` in `backend/app/services/forge_commands.py`. This section documents all **63 commands across 13 categories**.

## What is this?

The `forge-*` commands are the executable surface of Forge. They are white-labeled — users see only the `forge-*` name, never the underlying implementation. The Command Center UI, the CLI (`pnpm forge:exec`), and the Python API all dispatch through the same map.

## Categories

| # | Category | Commands | Typical approver |
|---|---|---|---|
| 1 | [Onboarding](/commands/onboarding/) | 4 | admin for `forge-onboard-bootstrap` |
| 2 | [Project Intelligence](/commands/project-intelligence/) | 6 | admin for `forge-intel-scan-secrets` |
| 3 | [Ideation](/commands/ideation/) | 5 | admin for `forge-ideate-crystallize` |
| 4 | [Architecture](/commands/architecture/) | 6 | admin + approval for `forge-arch-contract-spec`, `forge-arch-data-model`, `forge-arch-adr` |
| 5 | [Development](/commands/development/) | 7 | admin + approval for `forge-dev-hotfix`, `forge-dev-migrate` |
| 6 | [Testing](/commands/testing/) | 5 | admin + approval for `forge-test-e2e` |
| 7 | [Security](/commands/security/) | 5 | admin + approval for most |
| 8 | [Code Review](/commands/code-review/) | 4 | admin + approval for `forge-review-approve`, `forge-review-request-changes` |
| 9 | [Deployment](/commands/deployment/) | 5 | admin + approval for `forge-deploy-plan`, `stage`, `prod`, `rollback` |
| 10 | [Milestones](/commands/milestones/) | 4 | admin + approval for `forge-milestone-cut`, `tag`, `archive` |
| 11 | [Learning](/commands/learning/) | 4 | admin + approval for `forge-learn-promote` |
| 12 | [Workflow](/commands/workflow/) | 4 | admin + approval for `forge-flow-cancel` |
| 13 | [Environment](/commands/environment/) | 4 | admin + approval for `forge-env-diff`, `sync`, `promote` |

Total: **63 commands**.

## Tiers

| Tier | Who | Notes |
|---|---|---|
| `user` | Any authenticated user | Read-mostly and non-mutating commands |
| `admin` | Admin role | Mutating commands; typically `requires_approval=True` |
| `system` | Internal — system actors only | Background jobs, automated deploys, rollback |

The `requires_approval` flag pauses execution at the HITL gate before the command runs. The orchestrator resumes only after the approver decides; the decision is recorded in the audit ledger.

## How to run a command

### From the Command Center

Open `/forge-command-center`. Pick a category, pick a command, fill the args form, submit.

### From the CLI

```bash
pnpm forge:list                                # list all 63 commands
pnpm forge:list --category dev                 # filter by category

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

## Naming rules

- `forge-<area>-<verb>`
- `area` ∈ {onboarding, intel, ideate, arch, dev, test, sec, review, deploy, milestone, learn, flow, env}
- `verb` is imperative, lowercase, single word preferred
- Regex enforced at import time: `^forge-[a-z][a-z0-9-]*$`

## How to extend

See [Reference → forge-* commands → How to extend](/reference/forge-commands/).

## Related

- [White-label commands](/concepts/white-label-commands/)
- [Approval gates](/concepts/approval-gates/)
- [ADR-004: White-labeling](/architecture/adr-004-white-label/)
