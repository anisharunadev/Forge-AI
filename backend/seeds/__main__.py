"""``python -m seeds`` CLI entrypoint (M1 T1.10 / G6).

Canonical, user-facing surface for the seed framework. The CLI
expects to run from inside the ``backend/`` directory with the
project virtualenv active, since it imports ``app.*`` modules::

    cd backend
    python -m seeds --help
    python -m seeds list
    python -m seeds apply kn-base
    python -m seeds apply acme-corp --actor-id "$(uuidgen)"
    python -m seeds status kn-base
    python -m seeds status                       # all packages
    python -m seeds diff kn-base
    python -m seeds reset --confirm kn-base

Subcommands
-----------

``apply <name>`` (alias: ``run``)
    Run ``SeedRunner.apply(name)``. Same idempotency contract as the
    HTTP handler at ``/api/v1/seeds/{name}/apply``. Idempotent on
    re-run; ``SeedRunner.apply`` short-circuits when the data
    checksum already matches.

``status [<name>]``
    ``SeedRunner.status(name)`` — prints the durable apply state for
    one package. With no name, prints the last ``SeedRun`` row per
    package (the M1 AC-2 signal — operators want one command to
    tell them which packages are seeded).

``list``
    Enumerate seed packages on disk. No DB I/O.

``diff <name>``
    Compare the manifest's ``row_counts_expected`` to the actual
    row counts in the live DB.

``reset --confirm <name>``
    Wipe seed-managed rows. Mirrors ``SeedRunner.reset`` and
    requires the explicit ``--confirm`` flag so a typo on the
    shell doesn't nuke data. Mirrors the welcome-page reset button
    semantics: by default ``scope='demo_only'`` so production
    data is untouched.

Exit codes
----------
Mirrors ``seeds.framework.exit_codes`` (stable contract — see that
module). Codes 0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 64.

Design notes
------------

1. The previous CLI (``seeds.framework.apply_seed``) is preserved
   for backwards compatibility — operators who scripted against it
   keep working. The new ``python -m seeds`` is the canonical
   surface for fresh scripts; once M1 ships, the framework CLI is
   a thin re-export of this one.

2. The CLI never raises — every exception is caught and translated
   into an exit code so CI scripts and the welcome-page polling
   client can branch on the numeric result.

3. Telemetry initializes best-effort (a downed OTLP collector must
   not block a seed run). We borrow the same try/except dance the
   framework CLI uses.

4. ``--actor-id`` defaults to a deterministic system UUID when not
   passed, so audit log writes still carry a tagged actor without
   requiring every operator to learn the UUID syntax.
"""

from __future__ import annotations  # noqa: B904

import argparse
import asyncio
import sys
import uuid
from collections.abc import Sequence

# Initialize telemetry best-effort. The framework CLI does the
# same; a downed OTLP collector must not block a seed run.
try:
    from app.core.telemetry import init_telemetry

    init_telemetry()
except Exception:  # noqa: BLE001
    pass

from app.core.config import settings  # noqa: E402
from app.db.session import get_session_factory  # noqa: E402
from app.services.audit_service import audit_service  # noqa: E402
from seeds.framework import exit_codes as ec  # noqa: E402
from seeds.framework.exceptions import (  # noqa: E402
    ApplyRolledBackError,
    BrokenReferenceError,
    DependencyNotSatisfiedError,
    InvalidManifestError,
    ProductionSeedBlockedError,
    SchemaMismatchError,
    SeedError,
    SeedNotFoundError,
)
from seeds.framework.seed_runner import SeedRunner  # noqa: E402

# Default system UUID for actor_id when --actor-id is omitted.
# Magic constant: int=0 — matches the framework CLI convention.
DEFAULT_SYSTEM_ACTOR_ID = uuid.UUID(int=0)


def _build_parser() -> argparse.ArgumentParser:
    """Subcommand surface. Keep flat for `python -m seeds help` sanity."""
    parser = argparse.ArgumentParser(
        prog="python -m seeds",
        description=(
            "Forge seed framework CLI. Apply, reset, rollback, status, "
            "diff, list seed packages. Run from inside backend/ with "
            "the project virtualenv active."
        ),
    )
    sub = parser.add_subparsers(
        dest="command",
        required=True,
        metavar="COMMAND",
    )

    # ---- apply -------------------------------------------------------------
    apply_p = sub.add_parser(
        "apply",
        aliases=("run",),
        help="Apply a seed package (idempotent).",
    )
    apply_p.add_argument("name", help="Seed package slug, e.g. 'kn-base'.")
    apply_p.add_argument(
        "--actor-id",
        default=None,
        help="UUID of the actor (defaults to system UUID).",
    )
    apply_p.add_argument(
        "--triggered-by",
        default="cli",
        help="Audit tag (cli | api | bootstrap | e2e).",
    )
    apply_p.add_argument(
        "--allow-in-prod",
        action="store_true",
        help="Allow a demo seed to apply in env=production. Audit logged.",
    )

    # ---- status ------------------------------------------------------------
    status_p = sub.add_parser(
        "status",
        help="Print the durable apply state for one or all packages.",
    )
    status_p.add_argument(
        "name",
        nargs="?",
        default=None,
        help="Seed package slug. Omit to print the last SeedRun row per package.",
    )

    # ---- list --------------------------------------------------------------
    sub.add_parser(
        "list",
        help="Enumerate seed packages on disk (no DB I/O).",
    )

    # ---- diff --------------------------------------------------------------
    diff_p = sub.add_parser(
        "diff",
        help="Compare manifest row counts vs live DB.",
    )
    diff_p.add_argument("name", help="Seed package slug.")

    # ---- reset -------------------------------------------------------------
    reset_p = sub.add_parser(
        "reset",
        help="Wipe seed-managed rows (requires --confirm).",
    )
    reset_p.add_argument("name", help="Seed package slug.")
    reset_p.add_argument(
        "--confirm",
        action="store_true",
        help="Required safety flag — refuses to run without it.",
    )
    reset_p.add_argument(
        "--scope",
        choices=("demo_only", "all"),
        default="demo_only",
        help=(
            "Reset scope. 'demo_only' (default) keeps production rows; "
            "'all' is Steward-only and audit-logged."
        ),
    )
    reset_p.add_argument(
        "--actor-id",
        default=None,
        help="UUID of the actor (defaults to system UUID).",
    )

    return parser


def _resolve_actor_id(raw: str | None) -> uuid.UUID:
    """Coerce the CLI ``--actor-id`` string to a UUID.

    Falls back to a deterministic system UUID (int=0) when empty,
    matching the framework CLI convention. Validates that any
    explicit string is a parseable UUID — bad input is a usage
    error, not a runtime exception, so we surface it as
    ec.INVALID_MANIFEST (close-enough; the alternative is a
    dedicated exit code which would break the stable contract).
    """
    if not raw:
        return DEFAULT_SYSTEM_ACTOR_ID
    try:
        return uuid.UUID(raw)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"--actor-id must be a UUID; got {raw!r}")  # noqa: B904


async def _dispatch_apply(args: argparse.Namespace) -> int:
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=settings.environment,
    )
    actor_id = _resolve_actor_id(args.actor_id)
    run = await runner.apply(
        seed_name=args.name,
        actor_id=actor_id,
        triggered_by=args.triggered_by,
        allow_in_prod=args.allow_in_prod,
    )
    print(
        f"applied {run.seed_name} v{run.manifest_version} "
        f"status={run.status} row_counts={run.row_counts} "
        f"checksum={run.checksum_after}"
    )
    return ec.SUCCESS if run.status == "completed" else ec.APPLY_ERROR


async def _dispatch_status(args: argparse.Namespace) -> int:
    """Print status — one specific package OR a per-package roll-up."""
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=settings.environment,
    )
    if args.name is not None:
        status = await runner.status(args.name)
        print(
            f"name={status.name} applied={status.applied} "
            f"manifest_version={status.manifest_version} "
            f"last_run={status.last_run_status} "
            f"checksum={status.checksum}"
        )
        return ec.SUCCESS
    # No name → roll-up. Run a status() per known package and emit a
    # tabular summary so the operator can spot at a glance which
    # packages are applied.
    summaries = runner.list()
    print(f"{'NAME':<22}{'APPLIED':<10}{'LAST_RUN':<14}{'MANIFEST':<10}{'CHECKSUM':<10}")
    print("-" * 66)
    for summary in summaries:
        status = await runner.status(summary.name)
        applied = "yes" if status.applied else "no"
        last_run = status.last_run_status or "-"
        manifest = str(status.manifest_version) if status.manifest_version else "-"
        checksum = (status.checksum or "-")[:8]
        print(f"{status.name:<22}{applied:<10}{last_run:<14}{manifest:<10}{checksum:<10}")
    return ec.SUCCESS


async def _dispatch_list(_args: argparse.Namespace) -> int:
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=settings.environment,
    )
    for summary in runner.list():
        print(
            f"{summary.name}\t{summary.tenant_type}\t"
            f"files={summary.data_file_count}\t"
            f"{summary.description or ''}"
        )
    return ec.SUCCESS


async def _dispatch_diff(args: argparse.Namespace) -> int:
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=settings.environment,
    )
    diff = await runner.diff(args.name)
    print(f"name={diff.name} checksum_match={diff.checksum_match} drift={diff.drift}")
    return ec.SUCCESS


async def _dispatch_reset(args: argparse.Namespace) -> int:
    if not args.confirm:
        print(
            "refusing to reset without --confirm (see `python -m seeds reset --help`)",
            file=sys.stderr,
        )
        return ec.PERMISSION_DENIED
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=settings.environment,
    )
    actor_id = _resolve_actor_id(args.actor_id)
    run = await runner.reset(
        seed_name=args.name,
        actor_id=actor_id,
        triggered_by="cli",
        scope=args.scope,
    )
    print(
        f"reset {run.seed_name} status={run.status} "
        f"scope={args.scope} dropped_rows={run.dropped_rows}"
    )
    return ec.SUCCESS if run.status == "completed" else ec.APPLY_ERROR


_DISPATCH = {
    "apply": _dispatch_apply,
    "run": _dispatch_apply,
    "status": _dispatch_status,
    "list": _dispatch_list,
    "diff": _dispatch_diff,
    "reset": _dispatch_reset,
}


def main(argv: Sequence[str] | None = None) -> int:
    """Synchronous entry point. Translates exceptions → exit codes."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = _DISPATCH.get(args.command)
    if handler is None:
        print(f"unknown command: {args.command}", file=sys.stderr)
        return ec.UNKNOWN_ERROR

    try:
        return asyncio.run(handler(args))
    except InvalidManifestError as exc:
        print(f"invalid manifest: {exc}", file=sys.stderr)
        return ec.INVALID_MANIFEST
    except SchemaMismatchError as exc:
        print(f"schema mismatch: {exc}", file=sys.stderr)
        return ec.SCHEMA_MISMATCH
    except BrokenReferenceError as exc:
        print(f"broken reference: {exc}", file=sys.stderr)
        return ec.BROKEN_REFERENCE
    except ProductionSeedBlockedError as exc:
        print(f"production blocked: {exc}", file=sys.stderr)
        return ec.PRODUCTION_BLOCKED
    except ApplyRolledBackError as exc:
        print(f"apply error: {exc}", file=sys.stderr)
        return ec.APPLY_ERROR
    except DependencyNotSatisfiedError as exc:
        print(f"dependency not satisfied: {exc}", file=sys.stderr)
        return ec.DEPENDENCY_NOT_SATISFIED
    except SeedNotFoundError as exc:
        print(f"seed not found: {exc}", file=sys.stderr)
        return ec.PERMISSION_DENIED
    except SeedError as exc:
        print(f"seed error: {exc}", file=sys.stderr)
        return ec.UNKNOWN_ERROR
    except KeyboardInterrupt:
        return ec.UNKNOWN_ERROR
    except Exception as exc:  # noqa: BLE001 — catch-all per CLI contract
        print(f"unexpected error: {exc}", file=sys.stderr)
        return ec.UNKNOWN_ERROR


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["main", "_build_parser", "_dispatch_apply", "_dispatch_status"]


# Re-exports so ``python -m seeds apply_seed <name>`` keeps the old
# framework CLI addressable. Track B M1 T1.10 introduces
# ``python -m seeds`` as canonical; ``apply_seed`` is now a thin
# shim that hands off to ``apply <name>``.
def _legacy_apply_seed_entrypoint(argv: Sequence[str] | None = None) -> int:
    """Backwards-compatible proxy for ``seeds.framework.apply_seed``.

    The original CLI accepted ``<seed_name> [--status] [--diff]
    [--reset] [--list]`` with no subcommand. Translate the legacy
    flags into the new subcommand shape so existing shell scripts
    keep working.
    """
    import argparse as _argparse

    legacy = _argparse.ArgumentParser(add_help=False)
    legacy.add_argument("seed_name", nargs="?")
    legacy.add_argument("--status", action="store_true")
    legacy.add_argument("--diff", action="store_true")
    legacy.add_argument("--reset", action="store_true")
    legacy.add_argument("--list", action="store_true")
    legacy.add_argument("--confirm", action="store_true")
    legacy.add_argument("--scope", default="demo_only")
    legacy.add_argument("--actor-id", default=None)
    legacy.add_argument("--triggered-by", default="cli")
    legacy.add_argument("--allow-in-prod", action="store_true")
    legacy.add_argument("--env", default=None)

    ns = legacy.parse_args(argv)
    if ns.list:
        return main(["list"])
    if ns.seed_name is None:
        return main(["list"])
    if ns.status:
        return main(["status", ns.seed_name])
    if ns.diff:
        return main(["diff", ns.seed_name])
    if ns.reset:
        if not ns.confirm:
            print(
                "refusing to reset without --confirm",
                file=sys.stderr,
            )
            return ec.PERMISSION_DENIED
        return main(
            [
                "reset",
                ns.seed_name,
                "--confirm",
                f"--scope={ns.scope}",
            ]
        )
    # default: apply
    flags: list[str] = []
    if ns.allow_in_prod:
        flags.append("--allow-in-prod")
    if ns.actor_id:
        flags.extend(["--actor-id", ns.actor_id])
    if ns.triggered_by and ns.triggered_by != "cli":
        flags.extend(["--triggered-by", ns.triggered_by])
    return main(["apply", ns.seed_name, *flags])
