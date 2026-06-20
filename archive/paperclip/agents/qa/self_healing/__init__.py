"""
Self-Healing Agent v1 (FORA-37) — scaffold + dry-run.

This is the v1 of Goal 4.2. v1 ships the contract and a deterministic
dry-run; the actual selector-repair loop is Phase 4 and is feature
flagged off. See `README.md` for the public surface and the Phase 4
flip runbook.
"""

from __future__ import annotations

from .dry_run import run_dry_run, apply_repair, TraceShapeError
from .schemas import (
    CONTRACT_VERSION,
    DetectedDrift,
    DriftKind,
    ProposedRepair,
    RepairKind,
    RepairProposal,
    ValidationRunId,
)
from . import feature_flag

__all__ = [
    "CONTRACT_VERSION",
    "DetectedDrift",
    "DriftKind",
    "ProposedRepair",
    "RepairKind",
    "RepairProposal",
    "TraceShapeError",
    "ValidationRunId",
    "apply_repair",
    "feature_flag",
    "run_dry_run",
]
