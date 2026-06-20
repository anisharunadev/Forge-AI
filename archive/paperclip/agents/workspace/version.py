"""
Knowledge Layer version train + rollback (FORA-410, sub-goal 0.8.2).

The Knowledge Layer is a customer-owned source of truth and every change
must be tagged, diff-able, and rollbackable. Rollbacks must NEVER destroy
tenant overrides under ``tenants/<slug>/workspace/...`` or
``engagements/<slug>/...`` — those belong to the tenant.

The implementation works entirely on the seed:

- ``workspace/workspace-manifest.json`` — single source of truth.
  schemaVersion=1, monotonic tag history, per-file SHA-256 manifest.
- ``workspace/.tags/<name>/<relpath>`` — full file snapshots stored as
  plain files (no opaque blobs). Git diff-able out of the box.
- ``workspace:tag``     → capture current state, write snapshot, append tag.
- ``workspace:rollback`` → restore seed files from the named tag's
  snapshot. NEVER touches ``tenants/`` or ``engagements/``.

CLI:

    python -m agents.workspace.version tag --root workspace/ --message "..."
    python -m agents.workspace.version rollback --root workspace/ --to v1
    python -m agents.workspace.version list --root workspace/
    python -m agents.workspace.version status --root workspace/
    python -m agents.workspace.version init --root workspace/

Exit codes:
    0 — success
    1 — logic error (tag not found, schema mismatch, file count drift)
    2 — usage error (missing --root, missing --message, etc.)

Pure stdlib. No network. No LLM.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as _dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants — change requires a schemaVersion bump.
# ---------------------------------------------------------------------------

SCHEMA_VERSION: int = 1
MANIFEST_FILENAME: str = "workspace-manifest.json"
TAGS_DIRNAME: str = ".tags"

# Paths that the rollback operation must NEVER touch. These belong to the
# tenant (per FORA-103 / README §6): a rollback of the seed is not a
# rollback of the tenant's overrides.
#
# The invariant is checked at every rollback step. Any attempt to write
# to a path that resolves under one of these prefixes is a hard error.
PROTECTED_PATH_PREFIXES: Tuple[str, ...] = (
    "../tenants/",
    "../engagements/",
    "tenants/",
    "engagements/",
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class FileEntry:
    """SHA-256 + size of a single file at a single tag."""

    sha256: str
    size: int

    def to_dict(self) -> dict:
        return {"sha256": self.sha256, "size": self.size}


@dataclasses.dataclass(frozen=True)
class Tag:
    """A monotonic, append-only record of the seed at a point in time."""

    name: str
    message: str
    created_at: str  # ISO-8601 UTC
    seq: int
    files: Dict[str, FileEntry]  # relpath (POSIX) → entry

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "message": self.message,
            "createdAt": self.created_at,
            "seq": self.seq,
            "files": {p: e.to_dict() for p, e in sorted(self.files.items())},
        }


@dataclasses.dataclass
class Manifest:
    """The workspace manifest. Schema version 1.

    ``applied_migrations`` records the ordered list of migration module
    version_ids (e.g. ``["v2_onboarding"]``) that have been applied to
    the seed. It is the source of truth for the migration tool
    (FORA-412, sub-goal 0.8.5): the runner computes the gap between
    this list and the user's ``--to`` target and applies the missing
    migrations in order. Older manifests that pre-date this field
    load with an empty list.
    """

    schema_version: int
    current_tag: Optional[str]
    tags: List[Tag]
    applied_migrations: List[str] = dataclasses.field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schemaVersion": self.schema_version,
            "currentTag": self.current_tag,
            "tags": [t.to_dict() for t in self.tags],
            "appliedMigrations": list(self.applied_migrations),
        }


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------


def _utc_now_iso() -> str:
    """ISO-8601 UTC with second precision and trailing Z."""
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256_of_file(path: Path) -> FileEntry:
    """Hash a file in 64 KiB chunks; safe for the seed's largest files."""
    h = hashlib.sha256()
    total = 0
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
            total += len(chunk)
    return FileEntry(sha256=h.hexdigest(), size=total)


def _is_protected(relpath: str) -> bool:
    """True if ``relpath`` would cross a tenant / engagement boundary.

    A tag snapshot file lives at ``.tags/<name>/<relpath>``. We accept
    relpaths that resolve to seed files only. Anything that begins with
    ``..`` or contains ``../tenants`` / ``../engagements`` is rejected.
    """
    norm = relpath.replace("\\", "/")
    if norm.startswith("/") or norm.startswith("../") or "/../" in norm:
        return True
    for prefix in PROTECTED_PATH_PREFIXES:
        if norm.startswith(prefix) or f"/{prefix}" in norm:
            return True
    return False


def _iter_seed_files(root: Path) -> Iterable[Tuple[Path, str]]:
    """Yield (absolute_path, relpath_posix) for every file under ``root``
    except the manifest and the .tags/ directory itself.

    We walk deterministically (sorted) so two captures of the same seed
    produce identical manifests.
    """
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel == MANIFEST_FILENAME:
            continue
        if rel == TAGS_DIRNAME or rel.startswith(TAGS_DIRNAME + "/"):
            continue
        yield path, rel


# ---------------------------------------------------------------------------
# Manifest I/O
# ---------------------------------------------------------------------------


def manifest_path(root: Path) -> Path:
    return root / MANIFEST_FILENAME


def tags_root(root: Path) -> Path:
    return root / TAGS_DIRNAME


def load_manifest(root: Path) -> Manifest:
    """Load the manifest from ``root``. Raise FileNotFoundError if absent."""
    p = manifest_path(root)
    data = json.loads(p.read_text())
    if int(data.get("schemaVersion", -1)) != SCHEMA_VERSION:
        raise ValueError(
            f"manifest schemaVersion={data.get('schemaVersion')} is not "
            f"supported by this build (expected {SCHEMA_VERSION})."
        )
    tags: List[Tag] = []
    for raw in data.get("tags", []):
        files = {
            rel: FileEntry(sha256=entry["sha256"], size=int(entry["size"]))
            for rel, entry in raw.get("files", {}).items()
        }
        tags.append(
            Tag(
                name=raw["name"],
                message=raw.get("message", ""),
                created_at=raw.get("createdAt", ""),
                seq=int(raw.get("seq", len(tags))),
                files=files,
            )
        )
    return Manifest(
        schema_version=SCHEMA_VERSION,
        current_tag=data.get("currentTag"),
        tags=tags,
        applied_migrations=list(data.get("appliedMigrations", []) or []),
    )


def write_manifest(root: Path, manifest: Manifest) -> None:
    """Atomically write the manifest (write-then-rename) so a crash mid-write
    can never produce a partial manifest on disk."""
    p = manifest_path(root)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(
        json.dumps(manifest.to_dict(), indent=2, sort_keys=True) + "\n"
    )
    tmp.replace(p)


# ---------------------------------------------------------------------------
# Core operations
# ---------------------------------------------------------------------------


def capture_tag(root: Path, name: str, message: str) -> Tag:
    """Capture the current seed into a new tag.

    - Computes SHA-256 for every seed file.
    - Writes a full file snapshot under ``.tags/<name>/<relpath>``.
    - Appends a new ``Tag`` (with monotonic ``seq``) to the manifest.

    Returns the new ``Tag``. Raises FileExistsError if ``name`` is taken.
    """
    root = root.resolve()
    snapshot_dir = tags_root(root) / name
    if snapshot_dir.exists():
        raise FileExistsError(
            f"tag {name!r} already exists at {snapshot_dir}; "
            "rollback to it or pick a different name"
        )

    files: Dict[str, FileEntry] = {}
    for abs_path, rel in _iter_seed_files(root):
        if _is_protected(rel):
            # Should be impossible — we only walk files under ``root`` —
            # but the invariant is enforced here as a defense in depth.
            raise ValueError(
                f"refusing to capture protected path: {rel!r}"
            )
        entry = _sha256_of_file(abs_path)
        files[rel] = entry
        # Snapshot. Plain file copy (not a hash-only record) so the
        # snapshot is git diff-able and rollback does not need a
        # separate blob store.
        dst = snapshot_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(abs_path.read_bytes())

    manifest = (
        load_manifest(root)
        if manifest_path(root).exists()
        else Manifest(
            schema_version=SCHEMA_VERSION,
            current_tag=None,
            tags=[],
        )
    )
    if any(t.name == name for t in manifest.tags):
        # Race window: another caller added the same name between our
        # check and now. Refuse to silently overwrite.
        raise FileExistsError(
            f"tag {name!r} already exists in manifest"
        )
    seq = (max((t.seq for t in manifest.tags), default=-1)) + 1
    tag = Tag(
        name=name,
        message=message,
        created_at=_utc_now_iso(),
        seq=seq,
        files=files,
    )
    manifest.tags.append(tag)
    manifest.current_tag = name
    write_manifest(root, manifest)
    return tag


def find_tag(manifest: Manifest, name: str) -> Tag:
    for t in manifest.tags:
        if t.name == name:
            return t
    raise KeyError(f"tag {name!r} not found in manifest")


def rollback_to(root: Path, name: str) -> Tag:
    """Restore the seed to ``name``.

    Invariants:
      - Target tag MUST exist in the manifest.
      - Files in the snapshot are restored byte-for-byte.
      - Files in the snapshot that do not currently exist on disk are
        created (handles the "added then removed" case).
      - Files that currently exist on disk but are NOT in the snapshot
        are LEFT ALONE (we do not silently delete new content the user
        has not yet tagged).
      - The ``tenants/`` and ``engagements/`` paths are NEVER inspected,
        read, or written by this function. A rollback of the seed does
        not touch the tenant.

    Returns the restored ``Tag``.
    """
    root = root.resolve()
    manifest = load_manifest(root)
    tag = find_tag(manifest, name)

    snapshot_root = tags_root(root) / tag.name
    if not snapshot_root.is_dir():
        raise FileNotFoundError(
            f"snapshot directory missing for tag {name!r}: {snapshot_root}"
        )

    # Step 1 — restore every file the tag recorded.
    for rel, expected in tag.files.items():
        if _is_protected(rel):
            raise ValueError(
                f"refusing to rollback protected path: {rel!r} "
                f"(tag {name!r})"
            )
        src = snapshot_root / rel
        if not src.exists():
            raise FileNotFoundError(
                f"snapshot for tag {name!r} missing file: {rel}"
            )
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        # Self-check: hash must match the manifest entry.
        actual = _sha256_of_file(dst)
        if actual.sha256 != expected.sha256:
            raise RuntimeError(
                f"post-rollback hash mismatch for {rel}: "
                f"expected {expected.sha256}, got {actual.sha256}"
            )

    # Step 2 — record the rollback in the manifest (current_tag moves).
    manifest.current_tag = name
    write_manifest(root, manifest)
    return tag


def list_tags(root: Path) -> List[Tag]:
    if not manifest_path(root).exists():
        return []
    return load_manifest(root).tags


def current_tag(root: Path) -> Optional[str]:
    if not manifest_path(root).exists():
        return None
    return load_manifest(root).current_tag


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agents.workspace.version",
        description=(
            "Tag, rollback, and inspect the FORA Knowledge Layer "
            "version train (FORA-410)."
        ),
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--root", required=True, type=Path,
        help="Path to the workspace root (contains workspace-manifest.json).",
    )

    p_tag = sub.add_parser("tag", parents=[common], help="Capture current seed as a tag.")
    p_tag.add_argument("--message", required=True, help="Tag commit message.")
    p_tag.add_argument(
        "--name", default=None,
        help="Optional tag name. Defaults to v<seq> (monotonic).",
    )

    p_rb = sub.add_parser("rollback", parents=[common], help="Restore seed to a tag.")
    p_rb.add_argument("--to", required=True, help="Tag name to restore.")

    sub.add_parser("list", parents=[common], help="List all tags.")

    p_status = sub.add_parser("status", parents=[common], help="Show current tag + seed summary.")
    p_status.add_argument("--json", action="store_true", help="Emit JSON on stdout.")

    sub.add_parser("init", parents=[common], help="Create an empty manifest.")

    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    root: Path = args.root.resolve()

    try:
        if args.cmd == "init":
            if manifest_path(root).exists():
                print(
                    f"manifest already exists at {manifest_path(root)}",
                    file=sys.stderr,
                )
                return 1
            write_manifest(
                root,
                Manifest(
                    schema_version=SCHEMA_VERSION,
                    current_tag=None,
                    tags=[],
                    applied_migrations=[],
                ),
            )
            print(f"[workspace-version] initialized {manifest_path(root)}")
            return 0

        if args.cmd == "tag":
            name = args.name
            if name is None:
                existing = list_tags(root)
                seq = (max((t.seq for t in existing), default=-1)) + 1
                name = f"v{seq}"
            tag = capture_tag(root, name=name, message=args.message)
            print(
                f"[workspace-version] tagged {tag.name} "
                f"({len(tag.files)} files, seq={tag.seq})"
            )
            return 0

        if args.cmd == "rollback":
            if not manifest_path(root).exists():
                print(
                    f"ERROR: no manifest at {manifest_path(root)}; "
                    "run `init` first",
                    file=sys.stderr,
                )
                return 1
            tag = rollback_to(root, name=args.to)
            print(
                f"[workspace-version] rolled back to {tag.name} "
                f"({len(tag.files)} files restored)"
            )
            return 0

        if args.cmd == "list":
            for tag in list_tags(root):
                current = (
                    " (current)" if tag.name == current_tag(root) else ""
                )
                print(
                    f"{tag.name}\tseq={tag.seq}\t{tag.created_at}\t"
                    f"{len(tag.files)} files\t{tag.message}{current}"
                )
            return 0

        if args.cmd == "status":
            if not manifest_path(root).exists():
                print("[workspace-version] no manifest", file=sys.stderr)
                return 1
            manifest = load_manifest(root)
            file_count = sum(1 for _ in _iter_seed_files(root))
            payload = {
                "root": str(root),
                "manifest": manifest_path(root).as_posix(),
                "currentTag": manifest.current_tag,
                "tagCount": len(manifest.tags),
                "currentSeedFiles": file_count,
            }
            if args.json:
                print(json.dumps(payload, indent=2, sort_keys=True))
            else:
                print(
                    f"root={payload['root']}\n"
                    f"manifest={payload['manifest']}\n"
                    f"currentTag={payload['currentTag']}\n"
                    f"tagCount={payload['tagCount']}\n"
                    f"currentSeedFiles={payload['currentSeedFiles']}"
                )
            return 0

    except FileExistsError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except (KeyError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # pragma: no cover — last-ditch safety net
        print(f"ERROR: unexpected: {e}", file=sys.stderr)
        return 1

    return 2  # unreachable; argparse ``required=True`` enforces a subcmd


if __name__ == "__main__":
    raise SystemExit(main())
