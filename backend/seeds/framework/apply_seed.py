#!/usr/bin/env python3
"""CLI entry point for the Forge seed framework (F-821).

Usage::

    python -m backend.seeds.framework.apply_seed kn-base \
        [--env=dev|test|pilot|prod] [--allow-in-prod] \
        [--reset] [--rollback] [--status] [--diff] [--list]

Each subcommand maps 1:1 onto a :class:`SeedRunner` method. Exit codes
come from ``backend.seeds.framework.exit_codes``; see that module's
table for the contract.

Design notes
------------

1. The first executable line of ``main`` initializes OpenTelemetry.
   Failures here are tolerated (we proceed without spans) so the CLI
   keeps working in environments where the OTLP collector is down.
2. The CLI never raises; every exception is caught and translated into
   an exit code so CI scripts can branch on the numeric result.
3. ``--env`` is informational only — the runner reads the environment
   from the ``Settings`` instance and the CLI's value is logged for
   audit traceability.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from typing import Any, Sequence

# Initialize telemetry as early as possible. Failure here must NOT
# prevent the CLI from running — the runner is useful even without
# spans (local dev, CI, offline laptops).
try:
    from backend.app.core.telemetry import init_telemetry

    init_telemetry()
except Exception:  # noqa: BLE001
    pass

from backend.app.core.config import settings  # noqa: E402
from backend.app.db.session import get_session_factory  # noqa: E402
from backend.app.services.audit_service import audit_service  # noqa: E402

from backend.seeds.framework import exit_codes as ec  # noqa: E402
from backend.seeds.framework.exceptions import (  # noqa: E402
    ApplyRolledBackError,
    BrokenReferenceError,
    DependencyNotSatisfiedError,
    InvalidManifestError,
    ProductionSeedBlockedError,
    SchemaMismatchError,
    SeedError,
    SeedNotFoundError,
)
from backend.seeds.framework.seed_runner import SeedRunner  # noqa: E402


def _build_parser() -> argparse.ArgumentParser:
    """Argparse surface for the CLI."""
    parser = argparse.ArgumentParser(
        prog="apply_seed",
        description="Apply, reset, rollback, or inspect a Forge seed package.",
    )
    parser.add_argument(
        "seed_name",
        nargs="?",
        help="Slug of the seed package (e.g. 'kn-base', 'acme-corp').",
    )
    parser.add_argument(
        "--env",
        choices=("dev", "test", "pilot", "prod", "development", "staging", "production"),
        default=None,
        help=(
            "Environment label for audit. Maps dev->development, "
            "test->test, pilot->staging, prod->production."
        ),
    )
    parser.add_argument(
        "--allow-in-prod",
        action="store_true",
        help="Allow a demo seed to apply in env=production. Audit logged.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Run the seed's reset path instead of apply.",
    )
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="Rollback the seed's last apply (alias for reset).",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print the current applied state and exit.",
    )
    parser.add_argument(
        "--diff",
        action="store_true",
        help="Compare manifest row counts vs live DB and print a diff.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Enumerate available seed packages and exit.",
    )
    parser.add_argument(
        "--scope",
        choices=("demo_only", "all"),
        default="demo_only",
        help="Reset scope; only meaningful with --reset.",
    )
    parser.add_argument(
        "--actor-id",
        default=None,
        help="UUID of the actor; defaults to a CLI system UUID.",
    )
    parser.add_argument(
        "--triggered-by",
        default="cli",
        help="Audit tag (cli | api | bootstrap | e2e).",
    )
    return parser


def _resolve_env(env_arg: str | None) -> str:
    """Map CLI env aliases onto Settings.environment literals."""
    if env_arg is None:
        return settings.environment
    aliases = {
        "dev": "development",
        "test": "test",
        "pilot": "staging",
        "prod": "production",
        "development": "development",
        "staging": "staging",
        "production": "production",
    }
    return aliases[env_arg]


async def _dispatch(args: argparse.Namespace) -> int:
    """Run the requested subcommand and return a process exit code."""
    runner = SeedRunner(
        session_factory=get_session_factory(),
        audit_service=audit_service,
        env=_resolve_env(args.env),
    )

    actor_id = (
        uuid.UUID(args.actor_id) if args.actor_id else uuid.UUID(int=0)
    )

    # --list does not require a seed_name.
    if args.list:
        for summary in runner.list():
            print(
                f"{summary.name}\t{summary.tenant_type}\t"
                f"files={summary.data_file_count}\t"
                f"{summary.description or ''}"
            )
        return ec.SUCCESS

    if args.seed_name is None:
        print("error: seed_name is required (or pass --list)", file=sys.stderr)
        return ec.PERMISSION_DENIED

    if args.status:
        status = await runner.status(args.seed_name)
        print(
            f"name={status.name} applied={status.applied} "
            f"manifest_version={status.manifest_version} "
            f"last_run={status.last_run_status} "
            f"checksum={status.checksum}"
        )
        return ec.SUCCESS

    if args.diff:
        diff = await runner.diff(args.seed_name)
        print(
            f"name={diff.name} checksum_match={diff.checksum_match} "
            f"drift={diff.drift}"
        )
        return ec.SUCCESS

    if args.reset:
        run = await runner.reset(
            seed_name=args.seed_name,
            actor_id=actor_id,
            triggered_by=args.triggered_by,
            scope=args.scope,
        )
        print(
            f"reset {run.seed_name} status={run.status} "
            f"dropped_rows={run.dropped_rows}"
        )
        return (
            ec.SUCCESS
            if run.status == "completed"
            else ec.APPLY_ERROR
        )

    if args.rollback:
        run = await runner.rollback(
            seed_name=args.seed_name,
            actor_id=actor_id,
        )
        print(
            f"rollback {run.seed_name} status={run.status} "
            f"dropped_rows={run.dropped_rows}"
        )
        return (
            ec.SUCCESS
            if run.status == "completed"
            else ec.APPLY_ERROR
        )

    # Default: apply.
    run = await runner.apply(
        seed_name=args.seed_name,
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


def main(argv: Sequence[str] | None = None) -> int:
    """Synchronous entry point. Translates exceptions to exit codes."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        return asyncio.run(_dispatch(args))
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


__all__ = ["main", "_build_parser", "_dispatch", "_resolve_env"]