"""Per-stage injection table from workspace/README.md §2.

The table maps a stage name to a list of file paths under
``workspace/{memory,customer,project}/*.md`` that the Master
Orchestrator injects into that stage's prompt window. The Memory
service resolves the table to facts in the requested tenant scope.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

# Faithful copy of the injection table in [workspace/README.md §2]
# (FORA-15 / FORA-32). Keep in sync with the source.
INJECTION_TABLE: Dict[str, Dict[str, Any]] = {
    "ideation": {
        "default_namespaces": ["customer", "project", "memory"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": [],
        "files": [
            "memory/architecture.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/PRD.md",
        ],
    },
    "architect": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 10,
        "default_max_tokens": 3000,
        "default_deny_kinds": ["gotcha"],
        "files": [
            "memory/architecture.md",
            "memory/security.md",
            "customer/standards.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/PRD.md",
            "project/tech-stack.md",
        ],
    },
    "dev": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 12,
        "default_max_tokens": 4000,
        "default_deny_kinds": [],
        "files": [
            "memory/coding.md",
            "memory/architecture.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "qa": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": ["gotcha"],
        "files": [
            "memory/coding.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "security": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 10,
        "default_max_tokens": 3000,
        "default_deny_kinds": [],
        "files": [
            "memory/security.md",
            "memory/architecture.md",
            "customer/standards.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "devops": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 10,
        "default_max_tokens": 3000,
        "default_deny_kinds": [],
        "files": [
            "memory/devops.md",
            "memory/coding.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "documentation": {
        "default_namespaces": ["customer", "project", "memory"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": ["gotcha"],
        "files": [
            "customer/standards.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/PRD.md",
            "project/roadmap.md",
        ],
    },
    "refactor": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": [],
        "files": [
            "memory/coding.md",
            "memory/architecture.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "cost": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": [],
        "files": [
            "memory/devops.md",
            "memory/architecture.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/tech-stack.md",
            "project/roadmap.md",
        ],
    },
    "audit": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": [],
        "files": [
            "memory/security.md",
            "memory/architecture.md",
            "customer/standards.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "evaluation": {
        "default_namespaces": ["memory", "customer", "project"],
        "default_k": 8,
        "default_max_tokens": 2000,
        "default_deny_kinds": [],
        "files": [
            "memory/coding.md",
            "memory/security.md",
            "customer/standards.md",
            "customer/glossary.md",
            "project/tech-stack.md",
        ],
    },
    "memory": {
        "default_namespaces": ["memory", "customer", "project", "codebase", "execution"],
        "default_k": 12,
        "default_max_tokens": 4000,
        "default_deny_kinds": [],
        "files": [
            "memory/architecture.md",
            "memory/coding.md",
            "memory/security.md",
            "memory/devops.md",
            "customer/standards.md",
            "customer/conventions.md",
            "customer/glossary.md",
            "project/PRD.md",
            "project/roadmap.md",
            "project/tech-stack.md",
        ],
    },
}


def get_stage(stage: str) -> Dict[str, Any]:
    """Return the injection table entry for *stage*.

    Unknown stages return a permissive default (memory only, no file
    constraints) so the Master Orchestrator can pass through stages
    we have not catalogued yet.
    """
    s = (stage or "").strip().lower()
    if s in INJECTION_TABLE:
        return dict(INJECTION_TABLE[s])
    return {
        "default_namespaces": ["memory"],
        "default_k": 5,
        "default_max_tokens": 1500,
        "default_deny_kinds": [],
        "files": [],
    }


def list_stages() -> List[str]:
    return sorted(INJECTION_TABLE.keys())


# ---------------------------------------------------------------------------
# Tenant-aware file resolution (FORA-411 / 0.8.4)
# ---------------------------------------------------------------------------
#
# After a tenant has been materialized (FORA-409 / 0.8.3), the orchestrator
# read path must consult ``tenants/<slug>/workspace/<rel>`` BEFORE the
# seed so a tenant override (or extension) wins. The lookup goes through
# :mod:`agents.workspace_resolve` so the override contract (memory/
# read-only; customer/+project/ overridable) is enforced in one place.
#
# The integration here is intentionally small: ``resolve_stage_files``
# returns the on-disk paths the orchestrator / sub-agent should read
# for a given stage + tenant. The Memory MCP continues to serve facts
# from the SQLite index (which is also tenant-scoped — see the
# materializer's prime step), and the file-content read is what
# changes.


def resolve_stage_files(
    stage: str,
    *,
    slug: Optional[str] = None,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Resolve every file in *stage*'s injection table to its on-disk path.

    For each entry in ``INJECTION_TABLE[stage]["files"]``, return
    ``{"relpath", "path", "source"}`` where ``source`` is ``"tenant"``
    if the tenant override exists, ``"seed"`` if only the seed has
    the file, or the entry is dropped if neither side has it.

    If *slug* is ``None`` or empty, the seed is consulted directly
    (pre-materialization behavior — preserved so legacy callers and
    unit tests keep working).
    """
    from agents.workspace_resolve import resolve  # late import: avoid a hard dep

    entry = get_stage(stage)
    files = entry.get("files", []) or []
    out: List[Dict[str, Any]] = []
    for rel in files:
        if not slug:
            # Pre-materialization behavior: no tenant context, just
            # build the seed path. We deliberately do NOT call
            # ``resolve`` here so a missing tenant_id never accidentally
            # touches the tenants/ tree.
            seed_path = os.path.join(seed_root or "workspace", rel) if seed_root else os.path.join("workspace", rel)
            out.append({"relpath": rel, "path": seed_path, "source": "seed"})
            continue
        rp = resolve(
            slug,
            rel,
            seed_root=seed_root,
            tenants_root=tenants_root,
        )
        if rp is None:
            # Neither side has the file. Skip — the orchestrator can
            # decide whether to surface the gap.
            continue
        out.append({"relpath": rel, "path": rp.path, "source": rp.source})
    return out
