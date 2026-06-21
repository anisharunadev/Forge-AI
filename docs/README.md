# `docs/` — Documentation Index

This directory is the canonical home for every architectural, operational, planning, testing, and status document. The Knowledge Layer (`docs/CHARTER.md`, `docs/architecture/`, `docs/operations/`) is the **source of truth**; the per-package READMEs and the root `README.md` are derived from it.

## Structure

```text
docs/
├── README.md                       # this file
├── ARCHITECTURE.md                 # system architecture summary
├── GETTING_STARTED.md              # new-developer onboarding
├── FORGE_COMMANDS.md               # 60+ forge-* command reference
├── openapi.json                    # generated backend API spec (204 operations)
├── CHARTER.md                      # master development charter
├── project-context.md              # project context (sources for README + ADRs)
├── research-forge-architecture-decisions-2026-06-20.md
│                                   # research that grounds the locked ADRs
├── architecture/
│   ├── overview.md                 # single-page architecture summary
│   └── decisions/
│       ├── README.md               # ADR index + cross-reference map
│       ├── 0001-cloud-only-aws-deployment.md
│       ├── 0002-postgresql-17-apache-age-pgvector.md
│       ├── 0003-hybrid-mdm-steward-priority.md
│       ├── 0004-gsd-white-labeling.md
│       ├── 0005-litellm-proxy-provider-abstraction.md
│       ├── 0006-terminal-center-xterm-native-pty.md
│       ├── 0007-langgraph-sdlc-agent-orchestrator.md
│       └── 0008-append-only-worm-audit-trail.md
├── operations/
│   ├── README.md                   # operations index
│   ├── incident-response.md        # P0/P1/P2 process
│   ├── oncall-runbook.md           # oncall rotation
│   ├── rollback-procedures.md      # environment rollback playbook
│   ├── success-metrics.md          # pilot KPIs
│   ├── pilot-p0-pre-pilot.md       # pre-pilot readiness gate
│   ├── pilot-p1-kickoff.md         # kickoff workshop
│   ├── pilot-p2-execution.md       # execution phase
│   ├── pilot-p3-evaluation.md      # evaluation gate
│   ├── pilot-p4-expansion.md       # expansion path
│   └── pilot-p15-validation.md     # production validation
├── planning-artifacts/
│   ├── briefs/                     # design briefs
│   └── prds/                       # product requirement docs
├── status/
│   └── 2026-06-21-mid-execution.md # most recent status snapshot
└── testing/
    ├── test-strategy.md
    ├── test-naming.md
    ├── langgraph-integration-tests.md
    ├── terminal-center-tests.md
    └── security-pen-test.md
```

## Where to find what

| If you want to ... | Read |
| --- | --- |
| Understand the system at a glance | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| Bring up the stack locally | [`docs/GETTING_STARTED.md`](GETTING_STARTED.md) |
| Find a `forge-*` command | [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md) |
| Generate a client from the API | [`docs/openapi.json`](openapi.json) |
| Read the master charter | [`docs/CHARTER.md`](CHARTER.md) |
| Understand the constitutional rules | [`docs/architecture/overview.md`](architecture/overview.md) (table near the top) |
| Read a single ADR | [`docs/architecture/decisions/`](architecture/decisions/README.md) |
| Understand the research behind an ADR | [`docs/research-forge-architecture-decisions-2026-06-20.md`](research-forge-architecture-decisions-2026-06-20.md) |
| Onboard onto oncall | [`docs/operations/oncall-runbook.md`](operations/oncall-runbook.md) |
| Handle a P0 | [`docs/operations/incident-response.md`](operations/incident-response.md) |
| Roll back an environment | [`docs/operations/rollback-procedures.md`](operations/rollback-procedures.md) |
| Track pilot KPIs | [`docs/operations/success-metrics.md`](operations/success-metrics.md) |
| Walk a pilot forward | [`docs/operations/pilot-p0-pre-pilot.md`](operations/pilot-p0-pre-pilot.md) → ... → `pilot-p15-validation.md` |
| Read a PRD | [`docs/planning-artifacts/prds/`](planning-artifacts/prds/) |
| Read a design brief | [`docs/planning-artifacts/briefs/`](planning-artifacts/briefs/) |
| Check current status | [`docs/status/`](status/) |
| Write tests the right way | [`docs/testing/test-strategy.md`](testing/test-strategy.md), [`docs/testing/test-naming.md`](testing/test-naming.md) |

## Authoring conventions

- **Source of truth** lives here, not in code comments. If a fact changes, update the doc first, then propagate to code.
- **ADRs are append-only.** New ADRs continue the numeric sequence (next is ADR-009). Status changes are recorded in-place with a dated note; the original decision is preserved.
- **Pilot docs are versioned by pilot number**, not by date. `pilot-p15-validation.md` is the production-validation gate.
- **Status snapshots** are dated (`YYYY-MM-DD-<phase>.md`) and overwritten only by a newer snapshot in the same phase.
- **The Documentation Agent** regenerates the OpenAPI spec and the README indexes on every doc run; this README is produced from that pipeline.

## Cross-references

- Root README: [`../README.md`](../README.md)
- Backend: [`../backend/README.md`](../backend/README.md)
- Frontend: [`../apps/forge/README.md`](../apps/forge/README.md)
- MCP servers: [`../mcp-servers/README.md`](../mcp-servers/README.md)
