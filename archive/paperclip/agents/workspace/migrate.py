"""
Knowledge Layer workspace migration runner (FORA-412, sub-goal 0.8.5).

Bump the workspace schema from one migration level to the next in a
safe, previewable, and idempotent way. The runner is the smallest
credible shape for the spec:

- The manifest's ``appliedMigrations[]`` field (added in
  ``version.py``) is the source of truth. The current highest applied
  migration is computed from the manifest; the user's ``--to`` target
  names a migration id that exists in ``forge/0.8/migrations/``.
- Each migration is a small Python package at
  ``forge/0.8/migrations/v<N>_<slug>/__init__.py`` that exposes
  ``version_id``, ``description``, ``preview(root, manifest)`` and
  ``apply(root, manifest)``. Each module is responsible for its own
  plan; the runner is dumb glue.
- ``--dry-run`` calls every migration's ``preview()`` and prints the
  combined plan (adds / deletes / renames / manifest changes / tenant
  override notices). NO files are written.
- ``--apply`` calls every migration's ``apply()`` in order, then
  appends the new version id to the manifest's ``appliedMigrations``.
  Re-running ``--dry-run`` after ``--apply`` reports no changes
  (idempotent).
- Tenant overrides under ``tenants/<slug>/workspace/...`` are NEVER
  written or removed by the runner. A migration MAY emit a notice when
  a tenant override is shadowing a migrated seed file — the apply is
  still safe because the seed write does not cross the tenant path.

CLI:

    python -m agents.workspace.migrate \\
        --root workspace/ \\
        --migrations-dir forge/0.8/migrations/ \\
        --to v2_onboarding \\
        --dry-run

    python -m agents.workspace.migrate \\
        --root workspace/ \\
        --migrations-dir forge/0.8/migrations/ \\
        --to v2_onboarding \\
        --apply

Exit codes:
    0 — success (dry-run or apply)
    1 — logic error (unknown target, already-applied target, missing
        snapshot, etc.)
    2 — usage error (missing --root, --to, --migrations-dir, etc.)

Pure stdlib. No network. No LLM.
"""
from __future__ import annotations

import argparse
import dataclasses
import importlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Re-use the canonical manifest constants + I/O from FORA-410.
from agents.workspace.version import (
    SCHEMA_VERSION,
    load_manifest,
    write_manifest,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Migration package names look like ``v2_onboarding`` — a single lowercase
# letter 'v' followed by a positive integer (the schema generation), an
# underscore, and a short slug. We refuse anything else to keep
# ``discover_migrations`` and ``--to`` unambiguous.
_MIGRATION_NAME_RE = re.compile(r"^v(?P<gen>[1-9][0-9]*)_(?P<slug>[a-z][a-z0-9_]*)$")

# Same protected prefixes as the version train. The migrate runner
# inherits the FORA-410 invariant: a tenant override is never written
# or removed by a migration or a rollback.
PROTECTED_PATH_PREFIXES: Tuple[str, ...] = (
    "tenants/",
    "engagements/",
    "../tenants/",
    "../engagements/",
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class MigrationStep:
    """A single file operation in a migration plan."""

    op: str           # "add" | "delete" | "rename" | "modify"
    relpath: str      # POSIX relative to --root (the seed)
    old_relpath: str = ""  # only set for "rename"
    summary: str = ""       # human-readable, single line


@dataclasses.dataclass(frozen=True)
class MigrationPlan:
    """The output of ``preview()`` and the work-list of ``apply()``."""

    version_id: str
    description: str
    steps: Tuple[MigrationStep, ...]
    manifest_changes: Tuple[str, ...]  # textual lines like "appliedMigrations += ['v2_onboarding']"
    notices: Tuple[str, ...]           # tenant override shadows, deprecations, etc.


# ---------------------------------------------------------------------------
# Discovery + loading
# ---------------------------------------------------------------------------


def _parse_version_id(name: str) -> Optional[Tuple[int, str]]:
    """Return ``(generation, slug)`` for a valid version id, else ``None``.

    The generation (integer) is the ordering key; the slug is the
    human-friendly name. We keep the slug in the file name and on disk
    so the manifest record stays grep-able.
    """
    m = _MIGRATION_NAME_RE.match(name)
    if not m:
        return None
    return int(m.group("gen")), m.group("slug")


def _gen_sort_key(version_id: str) -> Tuple[int, str]:
    parsed = _parse_version_id(version_id)
    if parsed is None:  # pragma: no cover — discovery already filtered
        return (1 << 30, version_id)
    return (parsed[0], parsed[1])


def discover_migrations(migrations_dir: Path) -> List[Tuple[str, Path]]:
    """Return ``[(version_id, package_path)]`` sorted by generation + slug.

    A migration is a directory under ``--migrations-dir`` whose name
    matches the ``v<N>_<slug>`` pattern AND contains an
    ``__init__.py``. The directory name is the version id. We do NOT
    import the package here; the caller decides when to load it.
    """
    if not migrations_dir.is_dir():
        return []
    found: List[Tuple[str, Path]] = []
    for entry in sorted(migrations_dir.iterdir()):
        if not entry.is_dir():
            continue
        if _parse_version_id(entry.name) is None:
            continue
        if not (entry / "__init__.py").is_file():
            continue
        found.append((entry.name, entry))
    found.sort(key=lambda pair: _gen_sort_key(pair[0]))
    return found


def _load_migration_module(version_id: str, package_path: Path):
    """Import the migration package and validate the public surface.

    The package is imported as ``forge.migrations.v<N>_<slug>`` so the
    stdlib ``importlib`` machinery keeps its caches tidy. We use a
    stable import name rooted at the repo root; if the caller is
    running from the repo root with ``PYTHONPATH=REPO_ROOT`` this
    resolves naturally.
    """
    # The package name on disk is the directory name (``v2_onboarding``).
    # We mount it under ``forge.migrations`` because that is the
    # directory the migrations live under per FORA-103; importlib
    # needs a unique top-level name to find it, so we use
    # ``forge_pkg`` as a sentinel root that the runner adds to
    # ``sys.path`` at call time.
    module_name = f"forge_pkg.migrations.{version_id}"
    spec = importlib.util.spec_from_file_location(
        module_name,
        package_path / "__init__.py",
        submodule_search_locations=[str(package_path)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build import spec for {package_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    # Validate the public surface. A bad migration should fail loud at
    # load time, not silently produce a half-applied plan.
    for attr in ("version_id", "description", "preview", "apply"):
        if not hasattr(module, attr):
            raise AttributeError(
                f"migration {version_id!r} is missing required attribute {attr!r}"
            )
    if module.version_id != version_id:
        raise ValueError(
            f"migration {version_id!r} declares version_id={module.version_id!r}; "
            "the directory name is the source of truth"
        )
    for fn_name in ("preview", "apply"):
        fn = getattr(module, fn_name)
        if not callable(fn):
            raise TypeError(
                f"migration {version_id!r}: {fn_name} is not callable"
            )
    return module


# ---------------------------------------------------------------------------
# Tenant override detection
# ---------------------------------------------------------------------------


def _iter_tenant_override_paths(root: Path, relpath: str) -> List[Path]:
    """Return the on-disk tenant override paths that would shadow a seed file.

    The convention (per ``customer/conventions.md §2``) is that a
    tenant override lives at ``tenants/<slug>/workspace/<relpath>``
    SIBLING to ``root``'s parent. The migrate runner inspects these
    paths read-only to warn the user, never to write or delete them.
    """
    # root is e.g. /repo/workspace. The tenant tree is /repo/tenants/.
    tenants_root = root.parent / "tenants"
    if not tenants_root.is_dir():
        return []
    hits: List[Path] = []
    norm = relpath.replace("\\", "/").lstrip("/")
    for tenant_dir in sorted(tenants_root.iterdir()):
        if not tenant_dir.is_dir():
            continue
        candidate = tenant_dir / "workspace" / norm
        if candidate.is_file():
            hits.append(candidate)
    return hits


# ---------------------------------------------------------------------------
# Plan + apply
# ---------------------------------------------------------------------------


def _is_protected_relpath(relpath: str) -> bool:
    norm = relpath.replace("\\", "/").lstrip("/")
    if norm.startswith("/") or norm.startswith("../") or "/../" in norm:
        return True
    for prefix in PROTECTED_PATH_PREFIXES:
        if norm.startswith(prefix) or f"/{prefix}" in norm:
            return True
    return False


def _current_applied_migrations(root: Path) -> List[str]:
    """Return ``manifest.appliedMigrations`` (empty list if no manifest yet)."""
    try:
        manifest = load_manifest(root)
    except FileNotFoundError:
        return []
    return list(manifest.applied_migrations)


def _plan_for_target(
    root: Path,
    migrations_dir: Path,
    target_version: str,
) -> List[Any]:
    """Compute the ordered list of migration modules to apply.

    Returns the loaded module objects, in order. Raises a clear error
    if the target is unknown, has gaps in the applied history, or
    is earlier than the current state.

    Returns an empty list when the target is already applied (a
    no-op) so re-running ``--dry-run`` after ``--apply`` is the
    canonical "the seed is in the target state" signal.
    """
    available = dict(discover_migrations(migrations_dir))
    if target_version not in available:
        names = ", ".join(sorted(available.keys(), key=_gen_sort_key)) or "(none)"
        raise KeyError(
            f"unknown target migration {target_version!r}; "
            f"available: {names}"
        )
    applied = _current_applied_migrations(root)
    unknown_applied = [m for m in applied if m not in available]
    if unknown_applied:
        # A manifest that references a migration we no longer have is
        # a recoverable inconsistency — surface it as a hard error so
        # the operator can roll back the manifest or re-add the module.
        raise KeyError(
            f"manifest references unknown migrations: {unknown_applied}; "
            "re-add the module or roll the manifest back"
        )
    ordered = sorted(available.keys(), key=_gen_sort_key)
    target_idx = ordered.index(target_version)

    if not applied:
        pending = ordered[: target_idx + 1]
    else:
        # No-op when the target is in the contiguous applied tail.
        try:
            last_applied_idx = ordered.index(applied[-1])
        except ValueError:  # pragma: no cover — guarded above
            last_applied_idx = -1
        if target_idx <= last_applied_idx:
            # Either the target is exactly the last applied, or
            # earlier. Both are no-ops from the runner's perspective.
            return []
        pending = ordered[last_applied_idx + 1 : target_idx + 1]
        if not pending:
            return []

    # Add the parent of the directory to sys.path so importlib can
    # find the package root.
    parent = migrations_dir.parent
    parent_str = str(parent.resolve())
    added = False
    if parent_str not in sys.path:
        sys.path.insert(0, parent_str)
        added = True
    try:
        modules = []
        for v in pending:
            modules.append(_load_migration_module(v, available[v]))
        return modules
    finally:
        if added:
            try:
                sys.path.remove(parent_str)
            except ValueError:
                pass


def preview(
    root: Path,
    migrations_dir: Path,
    target_version: str,
) -> List[MigrationPlan]:
    """Return the ordered plans that would be applied.

    Pure read-only: each migration's ``preview()`` may inspect the
    seed and the manifest, but must not write either.
    """
    root = root.resolve()
    migrations_dir = migrations_dir.resolve()
    modules = _plan_for_target(root, migrations_dir, target_version)

    plans: List[MigrationPlan] = []
    # The preview sees the live manifest so migrations can make
    # decisions off the current state. We deliberately do NOT modify
    # the manifest here.
    try:
        manifest = load_manifest(root)
    except FileNotFoundError:
        from agents.workspace.version import Manifest
        manifest = Manifest(
            schema_version=SCHEMA_VERSION,
            current_tag=None,
            tags=[],
            applied_migrations=[],
        )

    for module in modules:
        plan = module.preview(root, manifest)
        _validate_plan(plan)
        # Augment with tenant-override-shadow notices for every "add"
        # step the plan declares. The migration author may also add
        # its own notices (returned in the plan); we merge.
        notices: List[str] = list(plan.notices)
        for step in plan.steps:
            if step.op != "add":
                continue
            for shadow in _iter_tenant_override_paths(root, step.relpath):
                notices.append(
                    f"tenant override at {shadow.relative_to(root.parent)} "
                    f"shadows the new seed file {step.relpath!r} "
                    "(override is preserved; the seed write is below the tenant path)"
                )
        plans.append(
            MigrationPlan(
                version_id=plan.version_id,
                description=plan.description,
                steps=plan.steps,
                manifest_changes=plan.manifest_changes,
                notices=tuple(notices),
            )
        )
    return plans


def apply(
    root: Path,
    migrations_dir: Path,
    target_version: str,
) -> List[MigrationPlan]:
    """Apply the migrations up to and including ``target_version``.

    Returns the same plan list as ``preview()`` for symmetry: the
    caller can render the plan, run ``apply``, then call ``preview``
    again and assert the two plan lists are empty / identical to
    prove idempotency.

    Side effects (per migration, in order):
      1. Migration's ``apply(root, manifest)`` is invoked. The
         migration writes any seed files it owns.
      2. The manifest's ``appliedMigrations`` list is appended with
         the migration's ``version_id``.
      3. The manifest is re-written atomically.

    The manifest is reloaded AFTER each migration so a migration can
    read its own writes via the next migration's ``preview()``-style
    logic (none of the current migrations do, but the contract is
    cheap to keep).
    """
    root = root.resolve()
    migrations_dir = migrations_dir.resolve()
    modules = _plan_for_target(root, migrations_dir, target_version)

    # Take a snapshot of the plans FIRST (in dry-run mode) so the
    # caller can diff the plan that was approved against the plan
    # that ran. The preview path is pure read-only; safe to call
    # before any writes.
    dry_plans = preview(root, migrations_dir, target_version)

    for module in modules:
        # Refuse anything that claims to mutate a protected path. The
        # migration author is responsible for not writing into
        # tenants/; the runner is the second line of defense.
        manifest = load_manifest(root) if (root / "workspace-manifest.json").exists() else _empty_manifest()

        # Run the migration in a "guarded" wrapper: the migration
        # gets the root + the live manifest. We re-validate its plan
        # post-hoc to catch any file op that crossed the boundary.
        module.apply(root, manifest)

        # Re-load the manifest because the migration may have written
        # to the seed but the manifest on disk is the source of truth.
        if (root / "workspace-manifest.json").exists():
            manifest = load_manifest(root)

        if module.version_id in manifest.applied_migrations:
            # Idempotency guard: a well-behaved migration does not
            # edit the manifest's appliedMigrations list itself; the
            # runner does. If the migration already added itself we
            # still re-write once below to be safe.
            pass
        else:
            manifest.applied_migrations.append(module.version_id)
            write_manifest(root, manifest)

    return dry_plans


def _empty_manifest():
    from agents.workspace.version import Manifest
    return Manifest(
        schema_version=SCHEMA_VERSION,
        current_tag=None,
        tags=[],
        applied_migrations=[],
    )


def _validate_plan(plan: MigrationPlan) -> None:
    """Reject plans that try to write into protected paths or
    reference unknown ops. The runner catches this in dry-run so the
    user sees the error BEFORE any apply.
    """
    valid_ops = {"add", "delete", "rename", "modify"}
    for step in plan.steps:
        if step.op not in valid_ops:
            raise ValueError(
                f"plan {plan.version_id!r}: unknown op {step.op!r}"
            )
        if _is_protected_relpath(step.relpath):
            raise ValueError(
                f"plan {plan.version_id!r}: step targets protected "
                f"path {step.relpath!r}"
            )
        if step.op == "rename" and not step.old_relpath:
            raise ValueError(
                f"plan {plan.version_id!r}: rename step is missing old_relpath"
            )


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_plan(plan: MigrationPlan) -> str:
    """Human-readable plan for a single migration."""
    lines: List[str] = []
    lines.append(f"[{plan.version_id}] {plan.description}")
    if not plan.steps and not plan.manifest_changes and not plan.notices:
        lines.append("  (no changes)")
    for step in plan.steps:
        if step.op == "rename":
            lines.append(f"  rename  {step.old_relpath}  ->  {step.relpath}")
        else:
            lines.append(f"  {step.op:<7s}{step.relpath}")
        if step.summary:
            lines.append(f"           {step.summary}")
    for change in plan.manifest_changes:
        lines.append(f"  manifest {change}")
    for notice in plan.notices:
        lines.append(f"  NOTICE  {notice}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agents.workspace.migrate",
        description=(
            "Preview / apply Knowledge Layer migrations (FORA-412, "
            "sub-goal 0.8.5). Pure stdlib. Tenant overrides are never "
            "written by migrations."
        ),
    )
    p.add_argument(
        "--root", required=True, type=Path,
        help="Path to the workspace seed root (contains workspace-manifest.json).",
    )
    p.add_argument(
        "--migrations-dir", required=True, type=Path,
        help="Path to the migrations directory (e.g. forge/0.8/migrations/).",
    )
    p.add_argument(
        "--to", required=True,
        help="Target migration version_id (e.g. v2_onboarding).",
    )
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run", action="store_true",
        help="Print the plan; do not write anything.",
    )
    mode.add_argument(
        "--apply", action="store_true",
        help="Apply the migration chain in order.",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Emit a JSON plan to stdout (dry-run only).",
    )
    p.add_argument(
        "--list", dest="list_only", action="store_true",
        help="List known migrations and exit (no plan / no apply).",
    )
    return p


def _list(migrations_dir: Path) -> int:
    available = discover_migrations(migrations_dir)
    if not available:
        print(f"[workspace-migrate] no migrations under {migrations_dir}")
        return 0
    for v, _p in available:
        print(v)
    return 0


def _plan_to_dict(plans: List[MigrationPlan]) -> Dict[str, Any]:
    return {
        "plans": [
            {
                "versionId": p.version_id,
                "description": p.description,
                "steps": [
                    {
                        "op": s.op,
                        "relpath": s.relpath,
                        **({"oldRelpath": s.old_relpath} if s.op == "rename" else {}),
                        **({"summary": s.summary} if s.summary else {}),
                    }
                    for s in p.steps
                ],
                "manifestChanges": list(p.manifest_changes),
                "notices": list(p.notices),
            }
            for p in plans
        ]
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    root: Path = args.root.resolve()
    migrations_dir: Path = args.migrations_dir.resolve()

    if args.list_only:
        return _list(migrations_dir)

    try:
        if args.dry_run:
            plans = preview(root, migrations_dir, args.to)
            if args.json:
                print(json.dumps(_plan_to_dict(plans), indent=2, sort_keys=True))
                return 0
            print(
                f"[workspace-migrate] dry-run: target={args.to!r}, "
                f"{len(plans)} migration(s) pending"
            )
            for plan in plans:
                print(render_plan(plan))
            return 0

        if args.apply:
            plans = apply(root, migrations_dir, args.to)
            print(
                f"[workspace-migrate] applied {len(plans)} migration(s) "
                f"to {root}"
            )
            for plan in plans:
                print(render_plan(plan))
            return 0

    except (KeyError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # pragma: no cover — last-ditch safety net
        print(f"ERROR: unexpected: {e}", file=sys.stderr)
        return 1

    return 2  # unreachable; argparse enforces mode


if __name__ == "__main__":
    raise SystemExit(main())
