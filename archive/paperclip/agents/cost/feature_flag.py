"""
Feature flag for the cost tracking system (FORA-75, 0.6).

`FORA_COST_ENABLED` controls whether the `TenantGate` enforces the
ceiling and whether the `CeilingMeter` fires alerts.  The `CostLedger`
itself is a pure read over the audit store, so it stays correct
either way; the flag is about whether enforcement is *active*.

Default: on.  A misconfigured flag must not silently let a tenant
blow through their ceiling in production.
"""

from __future__ import annotations

import os


def cost_enabled() -> bool:
    """True unless `FORA_COST_ENABLED` is set to a falsy value
    (`"0"`, `"false"`, `"no"`, `"off"` -- case-insensitive)."""
    val = os.environ.get("FORA_COST_ENABLED", "1").strip().lower()
    return val not in {"0", "false", "no", "off", ""}
