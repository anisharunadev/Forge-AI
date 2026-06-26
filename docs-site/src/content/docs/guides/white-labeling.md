---
draft: false
title: White-labeling
description: Enforce the forge-* namespace in user-facing surfaces.
---

White-labeling is a constitutional rule. Users must never see internal implementation names. This guide describes the rules and how to enforce them in code, docs, telemetry, and UI.

## What is this?

White-labeling is the discipline of exposing every internal action under a `forge-<area>-<verb>` name and stripping internal identifiers from user-facing surfaces. It is enforced by:

1. The `FORGE_COMMAND_MAP` as the single source of truth.
2. A runtime regex assertion on every command name.
3. Audit log projection that strips internal names.
4. Documentation and telemetry labels that use the `forge-*` form.

## Why does it exist?

See [White-label commands](/concepts/white-label-commands/) and [ADR-004](/architecture/adr-004-white-label/). The short version: brand leakage is a long-term cost.

## Rules

### 1. Names must match the regex

```text
^forge-[a-z][a-z0-9-]*$
```

Examples of valid names: `forge-intel-scan-repo`, `forge-dev-hotfix`, `forge-milestone-cut`.
Examples of invalid names: `forgeIntelScan`, `forge_intel_scan`, `ForgeIntelScan`.

The regex is asserted at import time of `forge_commands.py`.

### 2. Internal names never reach user-facing surfaces

| Surface | Rule |
|---|---|
| Command Center UI | Show only `forge-*` names |
| Terminal Center | Invoke `forge-*` only |
| Documentation | Reference `forge-*` only |
| Error messages | `forge-*` in user-visible text; internal name only in trace context |
| Telemetry labels | `forge.command` attribute carries the `forge-*` name |
| Audit log (tenant projection) | Strip internal name; show `forge-*` only |

### 3. Audit log preserves both

The raw `audit_log` table keeps the internal name (in a column not projected to tenants) for forensic use. The tenant-facing projection hides it.

## How to enforce in code

### Adding a new command

```python
# backend/app/services/forge_commands.py
("forge-<area>-<verb>", "<internal>:<area>:<verb>", "<description>", "<tier>", <requires_approval>),
```

The internal name is opaque. The `forge-*` name is the user-facing form. Code review rejects PRs that add a new command without going through this map.

### Logging

```python
# DO
log.info("forge-command-invoked", extra={"forge_command": "forge-intel-scan-repo"})

# DON'T
log.info("command-invoked", extra={"internal": "intel.scan_repo"})
```

### Errors

```python
# DO — user-facing error
raise UserFacingError(f"Command {forge_cmd} requires approval before execution.")

# DON'T — leaks internal name
raise UserFacingError(f"Command {internal_cmd} requires approval before execution.")
```

Internal names are fine in server logs that aren't surfaced to users.

### Telemetry

OTel attributes:

```python
span.set_attribute("forge.command", "forge-intel-scan-repo")   # always forge-*
# never set "internal.command" on user-facing spans
```

## How to enforce in docs

Every page in this site uses `forge-*` names. The CI grep check is:

```bash
grep -rn "intel.scan_repo\|gsd:\|@opengsd" docs-site/
# Must return 0 hits in user-facing docs.
```

If you find a violation, replace it with the `forge-*` form. The internal name is documented only in [Reference → forge-* commands → How to extend](/reference/forge-commands/#how-to-extend) (in the developer section, never in user-facing prose).

## How to enforce in the UI

The Command Center reads `FORGE_COMMAND_MAP` and renders only the `forge-*` keys. The Terminal Center invokes through the `forge-*` wrapper. Search filters use the `forge-*` form.

Any PR that adds a UI element showing an internal name fails review.

## Verification

Run the grep check before merging any docs or UI change:

```bash
grep -rn "intel.scan_repo\|gsd:\|@opengsd\|gsd-core\|gsd-pi" docs-site/ apps/ 2>&1
```

Expected: zero hits outside the developer-only "How to extend" section.

## Related

- [White-label commands](/concepts/white-label-commands/)
- [ADR-004: White-labeling](/architecture/adr-004-white-label/)
- [forge-* commands reference](/reference/forge-commands/)
