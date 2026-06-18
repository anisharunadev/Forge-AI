"""Per-stage injection table from workspace/README.md §2.

The table maps a stage name to a list of file paths under
``workspace/{memory,customer,project}/*.md`` that the Master
Orchestrator injects into that stage's prompt window. The Memory
service resolves the table to facts in the requested tenant scope.
"""

from __future__ import annotations

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
