"""Per-tenant workspace materialization (FORA-409 / 0.8.3).

Cold-start a tenant by materializing the seed workspace into
``tenants/<slug>/workspace/`` and priming the 0.4 memory index for
that tenant. Pure-Python, no subprocess shell-outs, <60s for a
50-file seed on a developer laptop.

Public surface:

    MaterializeResult            -- the dataclass returned by ``materialize``
    MaterializeError             -- raised on bad input / partial write
    materialize(slug, ...)       -- top-level entry; copies + primes memory
    write_audit_row(result, ...) -- append one JSONL row to the audit log
    bootstrap_tenant(slug, ...)  -- cold-start entry (0.7 -> 0.8.3 hand-off)
    bootstrap_if_missing(slug)   -- idempotent cold-start variant
    CLI: ``python -m agents.workspace_materialize --tenant <slug>``

CLI usage:

    python -m agents.workspace_materialize --tenant acme
    python -m agents.workspace_materialize --tenant acme --no-prime-memory
    python -m agents.workspace_materialize \\
        --tenant acme --seed-root /opt/fora/workspace --tenants-root /opt/fora/tenants
"""

from .materialize import (
    MaterializeError,
    MaterializeResult,
    MaterializeResult as MaterializeReport,  # alias for readability
    materialize,
    write_audit_row,
)
from .cold_start import (
    DEFAULT_AUDIT_LOG,
    bootstrap_tenant,
    bootstrap_if_missing,
)

__all__ = [
    "MaterializeError",
    "MaterializeResult",
    "MaterializeReport",
    "materialize",
    "write_audit_row",
    "DEFAULT_AUDIT_LOG",
    "bootstrap_tenant",
    "bootstrap_if_missing",
]
