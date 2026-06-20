"""
Feature flag for the audit system (FORA-36 acceptance: "ship behind
a feature flag, default on for the dev environment").

`FORA_AUDIT_ENABLED` controls whether `emit_*` actually appends to
the store.  In production the default is `on` so a misconfigured
flag does not silently drop audit events.  In test the default is
`on` so the smoke test exercises the real path.
"""

from __future__ import annotations

import os
from typing import Optional

from .store import AuditStore


def audit_enabled() -> bool:
    """True unless `FORA_AUDIT_ENABLED` is set to a falsy value
    (`"0"`, `"false"`, `"no"`, `"off"` -- case-insensitive)."""
    val = os.environ.get("FORA_AUDIT_ENABLED", "1").strip().lower()
    return val not in {"0", "false", "no", "off", ""}


def noop_store() -> AuditStore:
    """An audit store that drops every event.  Used when the
    feature flag is off and we still need a non-None store to
    keep the runtime contract simple."""
    from .store import InMemoryStore
    return InMemoryStore()
