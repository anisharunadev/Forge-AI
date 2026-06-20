"""
CycloneDX 1.5 SBOM emitter for the Dependency Scanner (FORA-76 AC #4).

The dep scanner emits a CycloneDX 1.5 JSON SBOM on every run so
downstream compliance tooling (FORA-126.5 customer-cloud-broker
dispatch seam; the upcoming internal compliance gate) can
correlate a verdict with a precise package list. The SBOM is
content-addressed by SHA-256 so a replayed audit row proves the
same bytes — the AC #5 invariant (audit replay) is what makes
the SBOM trustworthy for compliance.

This module is the pure emitter: it takes a list of
`DependencyFinding`s and a lockfile-derived component list and
produces deterministic JSON bytes. The I/O seam (where those
bytes land — S3 in production, in-memory in tests) lives in
`writers.py`.

CycloneDX 1.5 schema reference:
  https://cyclonedx.org/docs/1.5/json/

We emit the minimum fields the FORA-76 contract needs:

  - bomFormat: "CycloneDX"
  - specVersion: "1.5"
  - version: 1
  - serialNumber: "urn:uuid:<deterministic>"
  - metadata.timestamp
  - metadata.tools (Trivy + Dependabot versions we ran)
  - metadata.component (the scanned repo as a root component)
  - components[] — one per package in the lockfile diff
  - vulnerabilities[] — one per finding (only the public fields)

The serialNumber is deterministic: it is derived from the
handoff_id so the same handoff always produces the same SBOM
serial. This makes the SHA-256 hash stable across re-emissions
of the same scan — required for the audit replay invariant.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from .schemas import (
    DependencyFinding,
    Ecosystem,
    HandoffInput,
    PackageRef,
    SbomRef,
    derive_sbom_hash,
)


# CycloneDX 1.5 PURL type per ecosystem. The list is the subset
# FORA-76 needs for the supported ecosystems; adding a new one
# is a minor bump.
_ECOSYSTEM_TO_PURL_TYPE: Dict[Ecosystem, str] = {
    Ecosystem.PYPI: "pypi",
    Ecosystem.NPM: "npm",
    Ecosystem.MAVEN: "maven",
    Ecosystem.GO: "golang",
    Ecosystem.NUGET: "nuget",
    Ecosystem.RUBYGEMS: "gem",
    Ecosystem.CARGO: "cargo",
    Ecosystem.COMPOSER: "composer",
    Ecosystem.GENERIC: "generic",
}


def _stable_timestamp(namespace: uuid.UUID) -> str:
    """Produce a stable RFC-3339 timestamp derived from a UUID.

    The timestamp is taken from the UUID's `time` field (UUID v1)
    so the same input UUID always produces the same string. We
    rebuild the UUID as v1 from the MD5 namespace to get a
    consistent time field across re-emissions.

    Required by the audit-replay invariant: same handoff_id → same
    SBOM bytes → same SHA-256.
    """
    # Build a v1 UUID by hand: 60 bits of timestamp + 14 bits of
    # clock_seq + 48 bits of node, derived deterministically from
    # the namespace bytes.
    import struct
    raw = namespace.bytes
    time_low = struct.unpack(">I", raw[0:4])[0]
    time_mid = struct.unpack(">H", raw[4:6])[0]
    time_hi = struct.unpack(">H", raw[6:8])[0] & 0x0FFF
    # Convert UUID v1 ticks (100-ns intervals since 1582-10-15) to a
    # Unix epoch second.
    ticks = ((time_hi << 48) | (time_mid << 32) | time_low)
    seconds_since_1582 = ticks / 10_000_000.0
    unix_seconds = seconds_since_1582 - 12_219_292_800  # offset 1582→1970
    return datetime.fromtimestamp(unix_seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _purl_for(package: PackageRef) -> str:
    """Build a Package URL (PURL) for a CycloneDX component.

    Format: `pkg:<type>/<name>@<version>` per the PURL spec.
    We omit the namespace qualifier for ecosystems that don't
    use it (pypi, npm, gem). Adding qualifiers (subpath, arch,
    distro) is a v1.1 concern.
    """
    ptype = _ECOSYSTEM_TO_PURL_TYPE.get(package.ecosystem, "generic")
    safe_name = package.name.replace(" ", "-")
    return f"pkg:{ptype}/{safe_name}@{package.installed_version}"


def _component_for(package: PackageRef, *, bom_ref: str) -> Dict[str, Any]:
    """Build the CycloneDX component dict for a single package."""
    return {
        "type": "library",
        "bom-ref": bom_ref,
        "name": package.name,
        "version": package.installed_version,
        "purl": _purl_for(package),
        "evidence": {
            "identity": [
                {"field": "purl", "confidence": 1.0},
            ],
        },
    }


def _vulnerability_for(f: DependencyFinding) -> Dict[str, Any]:
    """Build the CycloneDX vulnerability dict for a single finding.

    We surface only the fields the orchestrator needs to plan a
    fix: id, cve/advisory, severity, fixed version, and the
    affected component ref.
    """
    cve_id = f.cve_id or ""
    advisory = f.advisory_id or ""
    rid = cve_id or advisory or f.finding_id
    affects_bom_ref = (
        f"pkg:{_ECOSYSTEM_TO_PURL_TYPE.get(f.package.ecosystem, 'generic')}/"
        f"{f.package.name}@{f.package.installed_version}"
    )
    out: Dict[str, Any] = {
        "id": rid,
        "bom-ref": f"vuln-{f.finding_id}",
        "affects": [{"ref": affects_bom_ref}],
        "ratings": [
            {
                "source": {"name": "FORA-dep-scanner"},
                "severity": f.severity.value,
                "method": "CVSSv3" if f.cve_id else "qualitative",
            }
        ],
        "tools": [
            {"name": f.scanner.value, "version": ""},
        ],
    }
    if f.title:
        out["description"] = f.title
    if f.fixed_version or f.package.fixed_versions:
        out["recommendation"] = (
            f"Upgrade {f.package.name} to "
            f"{f.fixed_version or f.package.fixed_versions[0]} or later."
        )
    if cve_id:
        out["source"] = {"name": "NVD"}
    return out


@dataclass
class CycloneDxSbom:
    """Pure renderer for a CycloneDX 1.5 SBOM.

    `emit()` returns `(bytes, SbomRef)`. The bytes are
    canonical JSON (sorted keys, no whitespace) so the SHA-256
    hash is stable across re-emissions. The SbomRef carries the
    artifact_id + sha256 + component_count the orchestrator
    records in the HandoffOutput.
    """

    handoff: HandoffInput

    def component_list(
        self,
        findings: Sequence[DependencyFinding],
        *,
        extra_packages: Optional[Iterable[PackageRef]] = None,
    ) -> List[PackageRef]:
        """Collect every package that must appear in the SBOM.

        Components come from two sources:

          1. The findings (one component per vulnerable package).
          2. `extra_packages` — the orchestrator's package-list
             view of the lockfile diff (e.g. packages added with
             no known CVE; we still want them in the SBOM).

        The result is deduped by (ecosystem, name, version) so the
        components list is canonical.
        """
        seen = set()
        out: List[PackageRef] = []
        # Normalise findings to their package refs.
        all_pkgs: List[PackageRef] = [
            f.package for f in findings
        ] + list(extra_packages or [])
        for pkg in all_pkgs:
            key = (pkg.ecosystem, pkg.name, pkg.installed_version)
            if key in seen:
                continue
            seen.add(key)
            out.append(pkg)
        return out

    def emit(
        self,
        findings: Sequence[DependencyFinding],
        *,
        scanner_versions: Optional[Dict[str, str]] = None,
        extra_packages: Optional[Iterable[PackageRef]] = None,
    ) -> tuple:
        """Render the SBOM. Returns `(bytes, SbomRef)`.

        `scanner_versions` is the same dict the HandoffOutput
        carries; it's mirrored into the CycloneDX `metadata.tools`
        so a reviewer can correlate SBOM contents with the scanner
        that produced them.

        `extra_packages` lets the orchestrator pass the lockfile's
        full package list (not just the vulnerable subset). When
        None, the SBOM contains only the packages present in
        `findings` — that's the v0 minimum and what AC #4 requires.
        """
        components = self.component_list(findings, extra_packages=extra_packages)
        tools = [
            {"vendor": "FORA", "name": name, "version": ver}
            for name, ver in (scanner_versions or {}).items()
        ]
        # Stable serial number + timestamp — both derived from the
        # handoff_id so a replay produces byte-identical output
        # (and therefore the same SHA-256). The audit replay
        # invariant requires this (AC #4 / AC #5 — same SBOM hash
        # across re-emission of the same scan).
        namespace = uuid.UUID(
            hashlib.md5(self.handoff.handoff_id.encode("utf-8")).hexdigest()
        )
        serial = f"urn:uuid:{namespace}"
        # Timestamp: derive from the same MD5 digest so two
        # emissions agree. The fixed format keeps the SBOM
        # RFC-3339-valid without surfacing `datetime.now()`.
        timestamp = _stable_timestamp(namespace)

        bom: Dict[str, Any] = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.5",
            "version": 1,
            "serialNumber": serial,
            "metadata": {
                "timestamp": timestamp,
                "tools": tools,
                "component": {
                    "type": "application",
                    "bom-ref": f"repo:{self.handoff.repo}",
                    "name": self.handoff.repo,
                    "version": self.handoff.head_sha,
                },
            },
            "components": [
                _component_for(p, bom_ref=f"pkg:{p.name}@{p.installed_version}")
                for p in components
            ],
            "vulnerabilities": [_vulnerability_for(f) for f in findings],
        }
        # Canonical JSON — sorted keys, no whitespace. Two equal
        # inputs must produce byte-identical output (and therefore
        # the same SHA-256).
        bytes_ = json.dumps(
            bom, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")

        ref = SbomRef(
            artifact_id=f"sbom-{uuid.uuid5(namespace, 'sbom').hex[:12]}",
            format="CycloneDX",
            spec_version="1.5",
            sha256=derive_sbom_hash(bytes_),
            byte_size=len(bytes_),
            component_count=len(components),
            storage_key=f"memory://dep_scanner/{self.handoff.handoff_id}/sbom.cdx.json",
        )
        return bytes_, ref