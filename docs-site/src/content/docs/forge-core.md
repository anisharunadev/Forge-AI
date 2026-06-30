---
title: "forge-core — Forge Core Workflow"
description: "Workflow methodology, spec-driven development, skills, agents, and commands that drive the 7 GSD phases."
---

# `@forge-ai/forge-core` — Forge Core Workflow

`forge-core` is the **methodology package** of the Forge AI Agent OS. It
defines _how_ an AI agent reasons through a phase: capture → explore →
plan → execute → verify → ship. Every other Forge package plugs into the
shape `forge-core` defines.

> _Based on the open-gsd spec-driven methodology, branded and extended for the Forge AI platform._

## Capabilities

| Function | Returns |
|---|---|
| `runForgeCommand(ctx, name, args)` | `CommandRun` — typed execution record |
| `listCommands(ctx, filter?)` | `Command[]` from the vendored catalog |
| `resolveSkill(ctx, name)` | `Skill` with phase, requires, argument-hint |
| `nextPhase(currentPhase)` | `PhaseId` for the linear GSD phase loop |

`forge-core` also ships the **Phase Loop**, **Discussion Capture**,
**Roadmap Generation**, and **Audit Timeline** primitives used by every
Forge surface.

## Skills included (excerpt)

`forge-capture`, `forge-discuss-phase`, `forge-new-project`, `forge-plan-phase`,
`forge-execute-phase`, `forge-verify-work`, `forge-ship`, `forge-audit-milestone`,
`forge-debug`, `forge-ui-phase`, `forge-secure-phase`, `forge-add-tests`,
… 60+ total across the spec-driven workflow.

## Agents included

`gsd-advisor-researcher`, `gsd-roadmapper`, `gsd-planner`, `gsd-executor`,
`gsd-verifier`, `gsd-code-reviewer`, `gsd-security-auditor`, `gsd-ui-researcher`,
… 30+ specialists that participate in milestone-scoped workflows.

## Where it lives in the app

- **Command Center** — every workflow starts here
- **Agent Center** — `forge-core`-backed agents appear in the "Core workflow" tab
- **Co-pilot** — `@phase`, `@workflow` mention resolution
- **Audit Center** — every phase produces an auditable artifact

## Always installed

`forge-core` is the only **required** package. `forge-pi` and `forge-browser`
are optional and degrade gracefully when missing.

## See also

- [The 3-Package Spec-Driven Stack](/architecture/three-package-stack/)
- [Forge Product Intelligence](/forge-pi/)
- [Forge Browser](/forge-browser/)
