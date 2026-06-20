"""
I/O seams for the Dependency Scanner (FORA-76).

The scanner writes four artefacts during a scan:

  1. Scan evidence       — an audit row keyed by `evidence_id`.
  2. SBOM                — CycloneDX 1.5 JSON bytes (AC #4).
  3. Handoff artefact    — the v1.0.0 envelope, persisted so the
                           orchestrator can hand it to DevOps without
                           re-running.
  4. PR comment          — posted via the GitHub MCP on `block`.

In production these writers are wired to:

  1. Audit store adapter (FORA-36, agents/audit/store.py)
  2. S3-backed object store (FORA-126.5 dispatch seam)
  3. GitHub MCP (`mcp-servers/github/`)

For v0, the **default** writers are in-memory implementations
that capture the artefacts for the smoke test to assert against.
Production wires the system adapters via constructor injection
on `DepScanner.__init__` or `DepScannerInputs`.

This file deliberately defines Protocol-style seams so adding a
new writer is a one-line constructor change. The smoke test uses
the in-memory default; production passes the S3/MCP adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

from .schemas import HandoffOutput, ScanResult, SbomRef, Verdict
from .pr_comment import PRComment


# ---------------------------------------------------------------------------
# Protocols — what every writer must do
# ---------------------------------------------------------------------------


class EvidenceWriter(Protocol):
    """Append one scan-evidence row.

    Production: an `AuditStore` adapter (FORA-36).
    Test: an in-memory list (default).
    """

    def write_evidence(
        self,
        *,
        evidence_id: str,
        handoff_id: str,
        run_id: str,
        tenant_id: str,
        decision: Verdict,
        scan_results: List[ScanResult],
        audit_records: List[Any],
        sbom: Optional[SbomRef],
    ) -> str:
        ...


class SbomWriter(Protocol):
    """Persist the CycloneDX 1.5 SBOM bytes.

    Production: S3-backed object store (FORA-126.5 dispatch seam).
    Test: an in-memory dict keyed by storage_key (default).
    """

    def write_sbom(self, sbom_bytes: bytes, sbom: SbomRef) -> str:
        """Return the storage_key (URI, path, or key)."""
        ...


class HandoffArtifactWriter(Protocol):
    """Persist the v1.0.0 handoff envelope.

    Production: S3-backed object store (FORA-126.5 dispatch seam).
    Test: an in-memory dict keyed by handoff_id (default).
    """

    def write_artifact(self, handoff_output: HandoffOutput) -> str:
        """Return a storage identifier (URI, path, or key)."""
        ...


class PRCommentPoster(Protocol):
    """Post a PR comment via the GitHub MCP.

    Production: GitHub MCP client (`mcp-servers/github/`).
    Test: an in-memory list (default).
    """

    def post_comment(
        self,
        *,
        pr_url: str,
        comment: PRComment,
    ) -> bool:
        """Return True iff the post was accepted by GitHub."""
        ...


# ---------------------------------------------------------------------------
# Default in-memory writers — the smoke test uses these
# ---------------------------------------------------------------------------


@dataclass
class InMemoryEvidenceWriter:
    rows: List[Dict[str, Any]] = field(default_factory=list)

    def write_evidence(
        self,
        *,
        evidence_id: str,
        handoff_id: str,
        run_id: str,
        tenant_id: str,
        decision: Verdict,
        scan_results: List[ScanResult],
        audit_records: List[Any],
        sbom: Optional[SbomRef],
    ) -> str:
        self.rows.append({
            "evidence_id": evidence_id,
            "handoff_id": handoff_id,
            "run_id": run_id,
            "tenant_id": tenant_id,
            "decision": decision.value,
            "scanners": [r.scanner.value for r in scan_results],
            "scanner_versions": {r.scanner.value: r.scanner_version for r in scan_results},
            "finding_count": sum(r.finding_count for r in scan_results),
            "audit_record_count": len(audit_records),
            "sbom_artifact_id": sbom.artifact_id if sbom else None,
            "sbom_sha256": sbom.sha256 if sbom else None,
            "sbom_byte_size": sbom.byte_size if sbom else 0,
            "sbom_component_count": sbom.component_count if sbom else 0,
        })
        return evidence_id


@dataclass
class InMemorySbomWriter:
    blobs: Dict[str, bytes] = field(default_factory=dict)
    refs: Dict[str, SbomRef] = field(default_factory=dict)

    def write_sbom(self, sbom_bytes: bytes, sbom: SbomRef) -> str:
        self.blobs[sbom.storage_key] = sbom_bytes
        self.refs[sbom.storage_key] = sbom
        return sbom.storage_key


@dataclass
class InMemoryHandoffArtifactWriter:
    artifacts: Dict[str, HandoffOutput] = field(default_factory=dict)
    storage_keys: List[str] = field(default_factory=list)

    def write_artifact(self, handoff_output: HandoffOutput) -> str:
        key = f"memory://dep_scanner/{handoff_output.handoff_id}.json"
        self.artifacts[key] = handoff_output
        self.storage_keys.append(key)
        return key


@dataclass
class InMemoryPRCommentPoster:
    comments: List[Dict[str, Any]] = field(default_factory=list)

    def post_comment(self, *, pr_url: str, comment: PRComment) -> bool:
        # Defence in depth — the scanner also asserts no-leak; the
        # poster enforces the same invariant before accepting the post.
        from .pr_comment import assert_comment_has_no_secret
        assert_comment_has_no_secret(comment)
        self.comments.append({
            "pr_url": pr_url,
            "body": comment.body,
            "summary": comment.summary,
            "finding_count": comment.finding_count,
        })
        return True


# ---------------------------------------------------------------------------
# Factory: build a coherent default bundle
# ---------------------------------------------------------------------------


def default_writers() -> Dict[str, Any]:
    """Return a fresh bundle of in-memory writers.

    Used by the smoke test and as the production default until
    FORA-76's S3 + GitHub MCP adapters land.
    """
    return {
        "evidence": InMemoryEvidenceWriter(),
        "sbom": InMemorySbomWriter(),
        "artifact": InMemoryHandoffArtifactWriter(),
        "comment": InMemoryPRCommentPoster(),
    }