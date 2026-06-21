# ADR-004: GSD white-labeling (DL-024)

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group

## Context and Problem Statement

The Forge platform uses Open GSD (gsd-core and gsd-pi) as the development execution engine for spec-driven planning, durable project artifacts, and multi-runtime agent support. GSD is the implementation; Forge is the brand. Exposing "GSD" in user-facing surfaces - Command Center panels, Terminal Center tabs, documentation, workflow headers - would confuse users, leak the underlying technology, and create licensing/branding concerns.

DL-024 in the PRD mandates that users never see "GSD."

The forces at play:

- GSD is the implementation; reusing it is faster than building parallel spec-driven execution.
- Forge is the user-facing brand; brand leakage is a long-term cost.
- Trademarks, logos, and naming are not user concerns but legal and marketing concerns.
- The mapping between Forge commands and GSD commands is stable (60+ commands across 13 categories per the implementation plan).

## Decision Drivers

- DL-024: White-label principle
- PRD F-019: Forge Command Map
- Implementation plan Section "Phase 1: GSD Integration & White-Labeling"
- Brand consistency across Command Center, Terminal Center, and workflow panels
- Licensing clarity

## Considered Options

- White-label all GSD commands as `forge-*` via FORGE_COMMAND_MAP (chosen)
- Pass-through (show GSD names to users)
- Dual labeling (Forge- and GSD-visible side-by-side)
- Rename GSD or fork GSD to remove the brand

## Decision Outcome

Chosen option: **All GSD commands are wrapped as `forge-*` commands via `FORGE_COMMAND_MAP`**. The map is the single source of truth that translates user-facing `forge-<verb>` commands to internal `gsd-<verb>` invocations. The internal command name is opaque to users.

Specifically:

- `FORGE_COMMAND_MAP` lives in `backend/app/services/forge_commands.py` as a Python dict.
- The map covers all 60+ GSD commands across 13 categories: Onboarding, Project Intelligence, Ideation, Architecture, Development, Testing, Security, Code Review, Deployment, Milestones, Learning, Workflow, Environment.
- The Command Center UI displays only `forge-*` names.
- The Terminal Center displays only `forge-*` invocations; the agent's actual GSD CLI is hidden behind a wrapper.
- All workflow panels (Architecture, Ideation, Deployment) reference `forge-*` commands only.
- Documentation, error messages, telemetry labels, and audit log entries use the `forge-*` name.
- Internal logs may include the underlying `gsd-*` name for debugging, but no user-facing surface does.

### Consequences

Positive:

- Clean user-facing brand; no GSD leakage.
- GSD remains the implementation; we do not fork or rename upstream.
- Map is a single, reviewable artifact; command additions go through one diff.
- License and trademark boundaries are clear.

Negative:

- Requires careful map maintenance as GSD adds or renames commands.
- Internal engineers must remember the mapping when debugging.
- A mismatch between map and GSD reality causes user-facing errors (e.g., a deprecated GSD command still mapped).

Neutral:

- The map is small enough to be human-readable but large enough to need a regression test (every mapped command must be exercised in CI).

## Alternatives Considered

### Pass-through (show GSD names to users)

Pros:

- No translation layer.
- Easier debugging.

Cons:

- Brand leakage (DL-024 violation).
- Long-term cost: rebranding later is more expensive than a translation layer now.
- Rejected: directly violates the white-label principle.

### Dual labeling (Forge- and GSD-visible side-by-side)

Pros:

- Users see the brand AND know what is under the hood.
- Useful for engineers debugging GSD behavior.

Cons:

- UI clutter.
- Confusing for non-engineer users.
- Violates the spirit of DL-024 even if a literal reading passes.
- Rejected: clutter and brand confusion.

### Rename GSD or fork to remove the brand

Pros:

- No translation layer needed.

Cons:

- Trademark issues with Open GSD.
- Forks diverge from upstream over time.
- Maintenance burden of running a fork.
- Rejected: legal and operational cost is unjustified.

## Pros and Cons of the Chosen Option

Pros:

- Clean separation between user-facing brand and implementation.
- Single map is testable and reviewable.
- GSD upgrades do not require UI changes as long as the map is kept current.

Cons:

- Map must be updated when GSD adds or renames commands.
- Map must be regression-tested against a GSD reference install.

## References

- Implementation plan v2.0, "Phase 1: GSD Integration & White-Labeling"
- PRD F-019 (Forge Command Map), DL-024 (white-label principle)
- ADR-007: LangGraph as SDLC agent orchestrator (orchestrator invokes `forge-*` via the map)
- ADR-006: Terminal Center via xterm.js + native PTY (terminal UI displays `forge-*` only)