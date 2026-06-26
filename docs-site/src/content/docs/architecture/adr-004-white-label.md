---
draft: false
title: ADR-004 — White-labeling (DL-024)
description: All internal commands are exposed to users as forge-* names.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that all internal implementation actions are wrapped as `forge-<area>-<verb>` commands in user-facing surfaces. The internal name is opaque to users.

## Context

The platform uses a multi-runtime agent substrate to power spec-driven planning, durable project artifacts, and multi-runtime agent support. The substrate is the implementation; Forge is the brand. Exposing the substrate's brand in user-facing surfaces — Command Center panels, Terminal Center tabs, documentation, workflow headers — would confuse users, leak the underlying technology, and create licensing / branding concerns.

DL-024 in the PRD mandates that users never see the substrate's brand.

The forces at play:

- The substrate is the implementation; reusing it is faster than building parallel spec-driven execution.
- Forge is the user-facing brand; brand leakage is a long-term cost.
- Trademarks, logos, and naming are not user concerns but legal and marketing concerns.
- The mapping between Forge commands and substrate commands is stable (60+ commands across 13 categories).

## Decision drivers

- DL-024: White-label principle
- PRD F-019: Forge Command Map
- Implementation plan: Phase 1 substrate integration and white-labeling
- Brand consistency across Command Center, Terminal Center, and workflow panels
- Licensing clarity

## Considered options

- White-label all substrate commands as `forge-*` via `FORGE_COMMAND_MAP` — **chosen**
- Pass-through (show substrate names to users)
- Dual labeling (Forge- and substrate-visible side-by-side)
- Rename or fork the substrate to remove the brand

## Decision outcome

Chosen option: **All substrate commands are wrapped as `forge-*` commands via `FORGE_COMMAND_MAP`**.

The map is the single source of truth that translates user-facing `forge-<verb>` commands to internal actions. The internal name is opaque to users.

Specifically:

- `FORGE_COMMAND_MAP` lives in `backend/app/services/forge_commands.py` as a Python dict.
- The map covers all 63 commands across 13 categories: Onboarding, Project Intelligence, Ideation, Architecture, Development, Testing, Security, Code Review, Deployment, Milestones, Learning, Workflow, Environment.
- The Command Center UI displays only `forge-*` names.
- The Terminal Center displays only `forge-*` invocations; the agent's actual CLI is hidden behind a wrapper.
- All workflow panels (Architecture, Ideation, Deployment) reference `forge-*` commands only.
- Documentation, error messages, telemetry labels, and audit log entries use the `forge-*` name.
- Internal logs may include the underlying internal name for debugging, but no user-facing surface does.

## Runtime invariants

Three invariants are asserted at import time:

```python
# 1. Every forge-* name matches ^forge-[a-z][a-z0-9-]*$
_FORGE_NAME_RE = re.compile(r"^forge-[a-z][a-z0-9-]*$")

# 2. The map has at least 60 entries
assert len(FORGE_COMMAND_MAP) >= 60

# 3. Every internal name has a handler in the wrapper
```

## Map shape

```python
FORGE_COMMAND_MAP = {
    "forge-intel-scan-repo":    ("intel.scan_repo",     "user",   False),
    "forge-sec-incident":       ("sec.open_incident",   "system", True),
    "forge-deploy-prod":        ("deploy.promote_prod", "admin",  True),
    # ... 63 entries
}
```

Each entry carries: the user-facing name, the internal name, the tier (`user`, `admin`, `system`), and the `requires_approval` flag.

## Consequences

**Positive:**

- Clean user-facing brand; no substrate leakage.
- The substrate remains the implementation; we do not fork or rename upstream.
- The map is a single, reviewable artifact; command additions go through one diff.
- License and trademark boundaries are clear.

**Negative:**

- Requires careful map maintenance as the substrate adds or renames commands.
- Internal engineers must remember the mapping when debugging.
- A mismatch between map and substrate reality causes user-facing errors (e.g., a deprecated internal command still mapped).

**Neutral:**

- The map is small enough to be human-readable but large enough to need a regression test (every mapped command must be exercised in CI).

## Alternatives considered

### Pass-through (show substrate names to users)

Pros: No translation layer; easier debugging.

Cons: Brand leakage (DL-024 violation); long-term rebranding cost.

### Dual labeling

Pros: Internal engineers see both.

Cons: Brand leakage; UX confusion; defeats the white-label goal.

### Rename or fork

Pros: Removes the brand from the implementation.

Cons: Loses upstream compatibility; maintenance burden; legal exposure.

## Related

- [White-label commands](/concepts/white-label-commands/)
- [White-labeling guide](/guides/white-labeling/)
- [forge-* commands reference](/reference/forge-commands/)
- [Architecture overview](/architecture/overview/)
