---
draft: false
title: Onboarding Commands
description: The 4 onboarding commands — welcome a new tenant, detect the stack, bootstrap, resume.
---

The onboarding category has 4 commands that bring a new tenant or project from "blank slate" to "ready for SDLC workflows".

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-onboard-welcome` | user | no | Welcome a new project / tenant — render the welcome dashboard, seed default templates |
| `forge-onboard-detect-stack` | user | no | Auto-detect languages, frameworks, runtimes from a repo |
| `forge-onboard-bootstrap` | admin | yes | Scaffold the `.forge` config, initial telemetry, and connector credentials |
| `forge-onboard-resume` | user | no | Resume an interrupted onboarding session from its last checkpoint |

## What is this category for?

Onboarding is the first thing a new tenant does. It:

1. Greets the user with a dashboard tailored to their stack.
2. Detects what they're running so the system can configure itself.
3. Bootstraps the configuration that everything else depends on.
4. Can resume if interrupted.

## How to use

### Welcome a new tenant

```bash
pnpm forge:exec forge-onboard-welcome \
  --args '{"tenant_id":"new-corp","project_id":"new-app"}' \
  --tenant-id new-corp --project-id new-app --user-id admin@new-corp.com
```

### Detect the stack

Point Forge at a repo and it returns a stack report:

```bash
pnpm forge:exec forge-onboard-detect-stack \
  --args '{"repo_url":"https://github.com/new-corp/new-app.git"}' \
  --tenant-id new-corp --project-id new-app --user-id admin@new-corp.com
```

Output (excerpt):

```json
{
  "languages": ["python", "typescript"],
  "runtimes":  ["python3.13", "node20"],
  "frameworks": ["fastapi", "next.js"],
  "databases":  ["postgres"],
  "build_tools": ["poetry", "pnpm"],
  "ci": ["github-actions"]
}
```

The detection feeds the policy engine and the project intelligence scanner.

### Bootstrap (admin, requires approval)

```bash
pnpm forge:exec forge-onboard-bootstrap \
  --args '{"project_id":"new-app","policy_set":"standard"}' \
  --tenant-id new-corp --project-id new-app --user-id admin@new-corp.com
```

This is the destructive setup step — it writes the initial config, seeds telemetry, and registers the project in the audit ledger. It pauses at the HITL gate.

### Resume

If onboarding is interrupted (browser closed, network drop), `forge-onboard-resume` picks up at the last checkpoint:

```bash
pnpm forge:exec forge-onboard-resume \
  --args '{"session_id":"sess-2026-06-21-001"}' \
  --tenant-id new-corp --project-id new-app --user-id admin@new-corp.com
```

## When to use

| Scenario | Command |
|---|---|
| New tenant signs up | `forge-onboard-welcome` |
| Before first project scan | `forge-onboard-detect-stack` |
| First project needs config + telemetry | `forge-onboard-bootstrap` (admin) |
| Onboarding session dropped | `forge-onboard-resume` |

## Related

- [Project Intelligence commands](/commands/project-intelligence/)
- [First SDLC run](/guides/first-sdlc-run/)
- [Local setup](/guides/local-setup/)
