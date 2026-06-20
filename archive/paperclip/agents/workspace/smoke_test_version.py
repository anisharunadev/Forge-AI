#!/usr/bin/env python3
"""
Smoke test for the Knowledge Layer version train (FORA-410, sub-goal 0.8.2).

Acceptance contract (mirroring the FORA-410 AC bullets):

    1. ``workspace:tag`` on the clean real seed succeeds and writes a
       plain-file snapshot under ``.tags/<name>/`` plus a schemaVersion=1
       manifest with monotonic ``seq``.

    2. After editing a seed file and tagging a second time, the manifest
       records two tags, the new tag's SHA-256 differs from the old one
       only for the edited file, and the rest are bit-identical.

    3. CRITICAL INVARIANT: a rollback to the first tag restores the
       edited file AND leaves an existing tenant override at
       ``tenants/acme/workspace/customer/standards.md`` byte-identical.

    4. The manifest is stable JSON: same input → same bytes; the
       snapshots under ``.tags/<name>/`` are plain files (git
       diff-able, no opaque blobs).

    5. Monotonic + safe failure: a second ``tag`` with the same name
       is rejected; ``rollback --to <unknown>`` is rejected; both exit 1.

The smoke test writes evidence to ``agents/workspace/evidence/<ts>/``:

    - result.json  (machine-readable summary of every AC)
    - README.md    (human-readable transcript of the same)

The test runs against a temp copy of the workspace so it never mutates
the real seed. The ``scripts/smoke.sh`` health gate invokes this script
via ``run_check``.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def _ts() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> "None":  # type: ignore[name-defined]
    print(f"[version-smoke] FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def _run_version(args: List[str], root: Path) -> subprocess.CompletedProcess:
    """Invoke the CLI under test as a subprocess so we exercise the real
    ``__main__`` boundary (including argparse, exit codes, and JSON output)
    rather than the in-process API."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, "-m", "agents.workspace.version", *args, "--root", str(root)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def _copy_seed(src_root: Path, dst_root: Path) -> None:
    """Mirror the real ``workspace/`` seed into ``dst_root``.

    Strips anything we don't want tagged (the lint report, OMC state) by
    relying on the version module's own ignore-list (.tags/, manifest).
    The seed copy IS the test root.
    """
    if dst_root.exists():
        shutil.rmtree(dst_root)
    shutil.copytree(src_root, dst_root)


# ---------------------------------------------------------------------------
# Acceptance scenarios
# ---------------------------------------------------------------------------


def ac_tag_on_clean_seed(root: Path) -> Dict[str, object]:
    """AC1 — `workspace:tag` works on a clean seed and writes a manifest."""
    proc = _run_version(["init"], root)
    if proc.returncode != 0:
        _fail(f"init failed: {proc.stderr}")
    proc = _run_version(["tag", "--message", "v0 baseline"], root)
    if proc.returncode != 0:
        _fail(f"first tag failed: {proc.stderr}")

    manifest = json.loads((root / "workspace-manifest.json").read_text())
    if manifest["schemaVersion"] != 1:
        _fail(f"schemaVersion expected 1, got {manifest['schemaVersion']}")
    if len(manifest["tags"]) != 1:
        _fail(f"expected 1 tag, got {len(manifest['tags'])}")
    first = manifest["tags"][0]
    if int(first["seq"]) != 0:
        _fail(f"first tag seq expected 0, got {first['seq']}")
    if not first["files"]:
        _fail("first tag has empty files map")

    snapshot = root / ".tags" / first["name"]
    if not snapshot.is_dir():
        _fail(f"snapshot dir missing: {snapshot}")
    snapshots = sorted(p.relative_to(snapshot).as_posix() for p in snapshot.rglob("*") if p.is_file())
    if not snapshots:
        _fail("snapshot directory is empty")

    return {
        "tagName": first["name"],
        "tagSeq": first["seq"],
        "taggedFiles": len(first["files"]),
        "snapshotsOnDisk": snapshots,
        "manifestBytes": len((root / "workspace-manifest.json").read_bytes()),
    }


def ac_second_tag_after_edit(root: Path) -> Dict[str, object]:
    """AC2 — edit a seed file, tag a second time; manifest captures both."""
    target = root / "memory" / "coding.md"
    backup = target.read_bytes()
    new_content = backup + b"\n\n## smoke-test edit\n\nAppended by smoke_test_version at " + _ts().encode() + b"\n"
    target.write_bytes(new_content)

    proc = _run_version(["tag", "--message", "v1 edited coding.md"], root)
    if proc.returncode != 0:
        _fail(f"second tag failed: {proc.stderr}")

    manifest = json.loads((root / "workspace-manifest.json").read_text())
    if len(manifest["tags"]) != 2:
        _fail(f"expected 2 tags, got {len(manifest['tags'])}")
    v0, v1 = manifest["tags"]
    if int(v0["seq"]) >= int(v1["seq"]):
        _fail(f"tags not monotonic: v0.seq={v0['seq']}, v1.seq={v1['seq']}")

    diff_files = {
        path for path, entry in v1["files"].items()
        if v0["files"].get(path, {}).get("sha256") != entry["sha256"]
    }
    if diff_files != {"memory/coding.md"}:
        _fail(f"expected only memory/coding.md to differ; got {diff_files}")

    return {
        "v0Name": v0["name"], "v1Name": v1["name"],
        "v0Seq": v0["seq"], "v1Seq": v1["seq"],
        "filesChanged": sorted(diff_files),
        "manifestTags": len(manifest["tags"]),
    }


def ac_rollback_preserves_tenant_override(root: Path) -> Dict[str, object]:
    """AC3 — CRITICAL INVARIANT.

    Set up a tenant override at ``tenants/acme/workspace/customer/standards.md``
    SIBLING to the workspace root (the rollback path must never touch
    paths outside the seed). After rollback, the override is byte-identical.
    """
    tenant_path = root.parent / "tenants" / "acme" / "workspace" / "customer" / "standards.md"
    tenant_path.parent.mkdir(parents=True, exist_ok=True)
    tenant_override = (
        "# ACME override\n\nThis file is owned by the tenant. "
        "Rollback MUST NOT touch it.\n"
    )
    tenant_path.write_text(tenant_override)
    tenant_hash_before = __import__("hashlib").sha256(tenant_path.read_bytes()).hexdigest()

    manifest = json.loads((root / "workspace-manifest.json").read_text())
    target_name = manifest["tags"][0]["name"]  # roll back to the very first tag

    proc = _run_version(["rollback", "--to", target_name], root)
    if proc.returncode != 0:
        _fail(f"rollback to {target_name} failed: {proc.stderr}")

    if not tenant_path.exists():
        _fail("tenant override file was deleted by rollback — INVARIANT VIOLATED")
    tenant_content_after = tenant_path.read_text()
    tenant_hash_after = __import__("hashlib").sha256(tenant_path.read_bytes()).hexdigest()
    if tenant_hash_after != tenant_hash_before:
        _fail(
            "tenant override content changed across rollback — INVARIANT VIOLATED "
            f"(before={tenant_hash_before}, after={tenant_hash_after})"
        )

    # And the seed file should be back to its v0 state.
    coding = (root / "memory" / "coding.md").read_text()
    if "## smoke-test edit" in coding:
        _fail("rollback did not revert the edit on memory/coding.md")

    # Tenant path itself should NEVER be read by the CLI. Verify by
    # checking it doesn't show up in the manifest.
    manifest_after = json.loads((root / "workspace-manifest.json").read_text())
    leaked = [
        path for tag in manifest_after["tags"]
        for path in tag["files"]
        if "tenants/" in path or "engagements/" in path
    ]
    if leaked:
        _fail(f"manifest leaks tenant/engagement paths: {leaked}")

    # Clean up so the next scenario starts from a known state.
    shutil.rmtree(tenant_path.parent.parent.parent)

    return {
        "rolledBackTo": target_name,
        "tenantPath": str(tenant_path),
        "tenantHashBefore": tenant_hash_before,
        "tenantHashAfter": tenant_hash_after,
        "tenantUnchanged": tenant_hash_before == tenant_hash_after,
        "manifestLeak": leaked,
    }


def ac_manifest_is_stable_and_diffable(root: Path) -> Dict[str, object]:
    """AC4 — manifest is stable JSON; snapshots are plain files (no blobs)."""
    m1 = (root / "workspace-manifest.json").read_text()
    # Re-emit via write_manifest to confirm round-trip.
    from agents.workspace.version import (  # noqa: WPS433 — intentional import inside test
        load_manifest, write_manifest, SCHEMA_VERSION,
    )
    m = load_manifest(root)
    write_manifest(root, m)
    m2 = (root / "workspace-manifest.json").read_text()
    if m1 != m2:
        _fail("manifest round-trip is not stable")

    # All snapshot files must be plain text or binary seed files — never
    # opaque blobs (no JSON-encoded content blobs).
    snapshot_files = list((root / ".tags").rglob("*"))
    blob_markers = []
    for p in snapshot_files:
        if not p.is_file():
            continue
        if p.suffix == ".blob":
            blob_markers.append(str(p))
    if blob_markers:
        _fail(f"opaque blob files detected: {blob_markers}")

    # Snapshot file count == manifest file count (per-tag).
    for tag in m.tags:
        snap_root = root / ".tags" / tag.name
        snap_files = [q for q in snap_root.rglob("*") if q.is_file()]
        if len(snap_files) != len(tag.files):
            _fail(
                f"snapshot file count mismatch for tag {tag.name}: "
                f"disk={len(snap_files)}, manifest={len(tag.files)}"
            )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "manifestStable": m1 == m2,
        "manifestBytes": len(m1),
        "tagCount": len(m.tags),
        "snapshotFileCount": sum(1 for p in snapshot_files if p.is_file()),
        "opaqueBlobs": len(blob_markers),
    }


def ac_monotonic_and_safe_failures(root: Path) -> Dict[str, object]:
    """AC5 — duplicate tag rejected; rollback to unknown tag rejected."""
    manifest = json.loads((root / "workspace-manifest.json").read_text())
    existing = manifest["tags"][0]["name"]

    # Duplicate tag → exit 1.
    dup = _run_version(["tag", "--message", "dup", "--name", existing], root)
    if dup.returncode != 1:
        _fail(
            f"duplicate tag should exit 1, got {dup.returncode}: {dup.stdout} {dup.stderr}"
        )

    # Rollback to unknown → exit 1.
    unk = _run_version(["rollback", "--to", "no-such-tag"], root)
    if unk.returncode != 1:
        _fail(
            f"unknown tag rollback should exit 1, got {unk.returncode}: {unk.stdout} {unk.stderr}"
        )

    return {
        "duplicateTagExitCode": dup.returncode,
        "unknownTagExitCode": unk.returncode,
        "duplicateTagErrorContains": "already exists" in dup.stderr.lower(),
        "unknownTagErrorContains": "not found" in unk.stderr.lower(),
    }


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main() -> int:
    started_at = _ts()
    real_seed = REPO_ROOT / "workspace"
    if not (real_seed / "workspace-manifest.json").exists():
        # The real seed never gets a manifest from this test — we work on
        # a temp copy so the smoke is repeatable and never mutates the
        # git-tracked seed.
        pass

    with tempfile.TemporaryDirectory(prefix="fora-version-smoke-") as raw_tmp:
        tmp_root = Path(raw_tmp)
        seed_copy = tmp_root / "ws"
        _copy_seed(real_seed, seed_copy)

        t0 = time.perf_counter()
        results: Dict[str, Dict[str, object]] = {}
        results["ac1_tag_on_clean_seed"] = ac_tag_on_clean_seed(seed_copy)
        results["ac2_second_tag_after_edit"] = ac_second_tag_after_edit(seed_copy)
        results["ac3_rollback_preserves_tenant_override"] = ac_rollback_preserves_tenant_override(seed_copy)
        results["ac4_manifest_is_stable_and_diffable"] = ac_manifest_is_stable_and_diffable(seed_copy)
        results["ac5_monotonic_and_safe_failures"] = ac_monotonic_and_safe_failures(seed_copy)
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)

    # Evidence: write to repo so the run is auditable.
    evidence_dir = REPO_ROOT / "agents" / "workspace" / "evidence" / f"smoke_version_{started_at}"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    summary = {
        "startedAt": started_at,
        "finishedAt": _ts(),
        "elapsedMs": elapsed_ms,
        "module": "agents.workspace.version",
        "issue": "FORA-410",
        "results": results,
        "exitCode": 0,
    }
    (evidence_dir / "result.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n"
    )

    readme = ["# Workspace version train smoke (FORA-410)\n"]
    readme.append(f"- started: `{summary['startedAt']}`")
    readme.append(f"- finished: `{summary['finishedAt']}`")
    readme.append(f"- elapsed: `{elapsed_ms} ms`")
    readme.append("")
    for name, payload in results.items():
        readme.append(f"## {name}\n")
        readme.append("```json")
        readme.append(json.dumps(payload, indent=2, sort_keys=True))
        readme.append("```\n")
    (evidence_dir / "README.md").write_text("\n".join(readme))

    print(f"[version-smoke] {len(results)} ACs green in {elapsed_ms} ms; evidence at {evidence_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
