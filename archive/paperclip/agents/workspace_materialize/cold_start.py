"""Cold-start hook for the 0.7 -> 0.8.3 hand-off (FORA-409).

The 0.7 cold-start path is the identity-broker's first session mint
for a previously-unseen tenant. Today the broker writes a
``tenants/<slug>/policy.yaml`` and an empty ``tenants/<slug>/`` (or
nothing, depending on the deployment). The 0.8 layer is what makes
that tenant *operational*: the Knowledge Layer has to live under
``tenants/<slug>/workspace/`` and the 0.4 memory index has to have
that tenant's seed facts loaded.

This module is the single entry point the broker calls. It is
idempotent — re-running with the same slug is a no-op on the memory
side (deterministic ``fact_id``) and a clean re-materialization on
the file side (the prior tree is wiped and re-copied). The audit
log records every call so the Audit agent (0.5) has a trail.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in os.sys.path:
    os.sys.path.insert(0, ROOT)

from .materialize import (  # noqa: E402
    MaterializeError,
    MaterializeResult,
    materialize,
    write_audit_row,
)


# Default audit log path. The broker / DevOps agent can override.
DEFAULT_AUDIT_LOG = os.path.join(ROOT, "var", "materialize-audit.jsonl")


def bootstrap_tenant(
    slug: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    memory_db_path: Optional[str] = None,
    audit_log: Optional[str] = None,
) -> MaterializeResult:
    """Bootstrap a freshly-provisioned tenant.

    Called from the identity-broker's first-login / first-token path
    for a previously-unseen tenant (FORA-38 §0.7 -> FORA-103 §0.8.3
    hand-off). Returns the same ``MaterializeResult`` as
    :func:`materialize`; raises :class:`MaterializeError` on bad
    input so the broker can surface the error to the audit log and
    refuse the session mint.
    """
    result = materialize(
        slug,
        seed_root=seed_root,
        tenants_root=tenants_root,
        memory_db_path=memory_db_path,
        prime_memory=True,
        refit_idf=True,
    )
    write_audit_row(result, audit_log or DEFAULT_AUDIT_LOG)
    return result


def bootstrap_if_missing(
    slug: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    memory_db_path: Optional[str] = None,
    audit_log: Optional[str] = None,
) -> Dict[str, Any]:
    """Idempotent variant: only bootstrap if the tenant is unseen.

    Returns a small dict so the broker can branch on the result::

        {"status": "bootstrapped", "result": MaterializeResult(...)} on miss
        {"status": "already_materialized", "tenant_workspace": "..."} on hit

    The "seen" check is the existence of
    ``tenants/<slug>/workspace/<seed_subdir>/<any_file>`` — the seed
    always copies the SEED_SUBDIRS subdirs (memory/, customer/,
    project/), so a non-empty subdir means the seed has been
    materialized. We don't gate on README.md because a future seed
    may be a sparse fixture (e.g. a smoke test that copies only
    memory/). (The memory index is always checked too: even if the
    workspace exists, a missing memory prime is remediated.)
    """
    tenants_root = tenants_root or os.path.join(ROOT, "tenants")
    tenant_workspace = os.path.join(tenants_root, slug, "workspace")
    # The "have we materialized this tenant?" marker is the existence of
    # the tenant workspace tree AND at least one file copied from the
    # seed. The seed always copies the SEED_SUBDIRS subdirs (memory/,
    # customer/, project/); if any of those is present and non-empty,
    # we've already materialized. We don't gate on README.md because
    # a future seed may be a sparse memory-only fixture (e.g. a
    # smoke test that copies only memory/) and the marker needs to
    # be robust to that.
    if os.path.isdir(tenant_workspace):
        for sub in ("memory", "customer", "project"):
            d = os.path.join(tenant_workspace, sub)
            if os.path.isdir(d) and os.listdir(d):
                return {
                    "status": "already_materialized",
                    "tenant_workspace": tenant_workspace,
                }
    try:
        result = bootstrap_tenant(
            slug,
            seed_root=seed_root,
            tenants_root=tenants_root,
            memory_db_path=memory_db_path,
            audit_log=audit_log,
        )
    except MaterializeError:
        raise
    return {"status": "bootstrapped", "result": result}
