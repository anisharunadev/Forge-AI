---
title: White-label Commands
description: Why every internal action is exposed as a forge-* command, and how the FORGE_COMMAND_MAP works.
---

Forge never exposes its internal implementation to users. Every internal action is wrapped under a `forge-<area>-<verb>` name. This page explains why this is a constitutional rule, not a styling choice.

## What is this?

A **white-label command** is a user-facing command name that hides the underlying implementation. In Forge:

- Users see `forge-intel-scan-repo`.
- Internally, the orchestrator may dispatch to an Open GSD action, a custom agent, or a custom tool — none of which the user sees.

The single source of truth for the mapping is `FORGE_COMMAND_MAP` in `backend/app/services/forge_commands.py`.

## Why does it exist?

Brand leakage is a long-term cost. If users see "GSD" in the Command Center, in the Terminal Center, in workflow headers, in error messages, and in audit logs, you have created a parallel mental model that competes with Forge. Worse, you have licensed yourself to upstream trademark decisions.

DL-024 in the PRD mandates that users never see the implementation brand. The map is the enforcement.

## What problem does it solve?

| Problem | Without white-labeling | With white-labeling |
|---|---|---|
| Brand leakage in user surface | Visible everywhere | Hidden by the map |
| Upstream rename / deprecation | User-visible breakage | Internal-only diff |
| Vendor licensing concerns | Open | Closed by the map |
| Internal debugging | Hard — surface names everywhere | Easy — internal name in logs, user name in UI |

## How does it work?

`FORGE_COMMAND_MAP` is a Python dict mapping user-facing names to internal actions:

```python
FORGE_COMMAND_MAP = {
    "forge-intel-scan-repo": ("intel.scan_repo", "user", False),
    "forge-sec-incident":     ("sec.open_incident", "system", True),
    "forge-deploy-prod":      ("deploy.promote_prod", "admin", True),
    # ... 63 entries across 13 categories
}
```

The Command Center UI reads the map. It only ever displays the `forge-*` key. The Terminal Center invokes the `forge-*` command through the wrapper. Audit logs strip the internal name before projecting to customer-facing audit views.

Three runtime invariants are asserted on import:

```python
# 1. Every forge-* name matches ^forge-[a-z][a-z0-9-]*$
_FORGE_NAME_RE = re.compile(r"^forge-[a-z][a-z0-9-]*$")

# 2. The map has at least 60 entries
assert len(FORGE_COMMAND_MAP) >= 60

# 3. Every internal name has a handler in GSDWrapper.execute()
```

## How do I use it?

As a user, you don't — the map is invisible. You invoke `forge-*` commands.

As a developer extending the system, see [Reference → forge-* commands → How to extend](/reference/forge-commands/).

As an operator, the only thing you monitor is whether the map count drops below the threshold — that's a CI signal.

## When should I use it?

The white-label rule is unconditional for user-facing surfaces:

- UI panels (Command Center, Terminal Center, Knowledge Center)
- Documentation, error messages, telemetry labels
- Audit log entries shown to tenants

The internal name may appear in:

- Server logs (for debugging)
- Internal-only audit views (never projected to tenants)
- Incident response channels

## What "forge-*" looks like

```text
forge-<area>-<verb>

  area   = onboarding | intel | ideate | arch | dev
         | test | sec | review | deploy | milestone
         | learn | flow | env

  verb   = imperative, single word preferred
         (welcome, scan, brainstorm, diagram, scaffold,
          plan, scan, diff, approve, stage, cut,
          capture, run, list)
```

The regex enforces lowercase and a single dash separator. Names like `forgeIntelScan` or `forge_intel_scan` are rejected at import time.

## Related

- [Constitutional rules](/concepts/constitutional-rules/) — DL-024
- [ADR-004: White-labeling](/architecture/adr-004-white-label/)
- [Reference → forge-* commands](/reference/forge-commands/)
- [White-labeling guide](/guides/white-labeling/)
