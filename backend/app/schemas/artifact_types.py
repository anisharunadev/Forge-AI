"""Artifact type registry.

Centralizes the canonical list of `Artifact.type` strings recognized by
the platform so the artifact registry, the policy engine, and the
HTTP layer all agree on what's admissible.

F-010 (Artifacts) anchors the set; new typed artifacts register here
so subsequent lookups (e.g. `GET /artifacts?artifact_type=...`) remain
consistent. The list is intentionally module-level so it can be
imported without instantiating any service.
"""

from __future__ import annotations

# Core F-010 artifact types (per Rule 4 / DL-027):
#   adr | api_contract | task_breakdown | risk_register
#   security_report | deployment_plan
ARTIFACT_TYPES: tuple[str, ...] = (
    "adr",
    "api_contract",
    "task_breakdown",
    "risk_register",
    "security_report",
    "deployment_plan",
    # Architecture Center add-ons (F-308 etc.)
    "architecture_attestation",
    # Quality / Validation Center (F-502)
    "validation_report",
)


def is_known_artifact_type(artifact_type: str) -> bool:
    """Return True iff `artifact_type` is in the registry."""
    return artifact_type in ARTIFACT_TYPES


def all_artifact_types() -> tuple[str, ...]:
    """Return the full set of known artifact types."""
    return ARTIFACT_TYPES


__all__ = [
    "ARTIFACT_TYPES",
    "is_known_artifact_type",
    "all_artifact_types",
]
