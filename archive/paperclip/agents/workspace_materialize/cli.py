"""CLI entry point for ``python -m agents.workspace_materialize``.

Invocations:

    # Default: project-root ./workspace -> ./tenants/<slug>/workspace/
    python -m agents.workspace_materialize --tenant acme

    # Skip the memory index prime (file copy only)
    python -m agents.workspace_materialize --tenant acme --no-prime-memory

    # Custom seed / tenants / memory db paths
    python -m agents.workspace_materialize \\
        --tenant acme \\
        --seed-root /opt/fora/workspace \\
        --tenants-root /opt/fora/tenants \\
        --memory-db /opt/fora/var/memory.db

The CLI returns a JSON document on stdout (one line, no trailing
whitespace) so it composes with shell pipelines and a future HTTP
trigger. Exit code is 0 on success, 2 on bad input, 1 on partial
write / unexpected error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from .materialize import (  # noqa: E402
    MaterializeError,
    materialize,
    write_audit_row,
)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="workspace:materialize",
        description=(
            "Materialize a tenant workspace: copy the seed into "
            "tenants/<slug>/workspace/ and prime the 0.4 memory index."
        ),
    )
    p.add_argument(
        "--tenant",
        required=True,
        help="Tenant slug (lowercase, dash/underscore allowed).",
    )
    p.add_argument(
        "--seed-root",
        default=None,
        help="Seed workspace root (default: ./workspace).",
    )
    p.add_argument(
        "--tenants-root",
        default=None,
        help="Tenants root (default: ./tenants).",
    )
    p.add_argument(
        "--memory-db",
        default=None,
        help="SQLite path for the 0.4 memory index "
        "(default: $FORA_MEMORY_DB or ./var/memory.db). Ignored if --no-prime-memory.",
    )
    p.add_argument(
        "--no-prime-memory",
        action="store_true",
        help="Skip the memory index prime; only copy files.",
    )
    p.add_argument(
        "--no-refit-idf",
        action="store_true",
        help="Skip the IDF refit after seeding (default: refit).",
    )
    p.add_argument(
        "--audit-log",
        default=None,
        help="JSONL audit log path (default: $FORA_MATERIALIZE_AUDIT or ./var/materialize-audit.jsonl).",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit a one-line JSON report on stdout (default: True if stdout is not a TTY).",
    )
    p.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress the human-readable summary; emit only the JSON report.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = materialize(
            args.tenant,
            seed_root=args.seed_root,
            tenants_root=args.tenants_root,
            memory_db_path=args.memory_db,
            prime_memory=not args.no_prime_memory,
            refit_idf=not args.no_refit_idf,
        )
    except MaterializeError as exc:
        sys.stderr.write(f"workspace:materialize: error: {exc}\n")
        return 2
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"workspace:materialize: unexpected error: {exc}\n")
        return 1

    audit_path = args.audit_log or os.environ.get(
        "FORA_MATERIALIZE_AUDIT", os.path.join(ROOT, "var", "materialize-audit.jsonl")
    )
    write_audit_row(result, audit_path)

    want_json = args.json or not sys.stdout.isatty()
    if want_json:
        sys.stdout.write(json.dumps(result.to_dict(), separators=(",", ":")) + "\n")
    if not args.quiet and not want_json:
        mem = result.memory
        mem_line = (
            f"memory: {mem.written} written, {mem.updated} updated, {mem.chunks} chunks, "
            f"{mem.duration_ms:.1f} ms"
            if mem is not None
            else "memory: (skipped)"
        )
        sys.stdout.write(
            "\n".join(
                [
                    f"slug:              {result.slug}",
                    f"workspace_root:    {result.workspace_root}",
                    f"tenant_workspace:  {result.tenant_workspace}",
                    f"files:             {len(result.files)}",
                    f"bytes:             {result.total_bytes}",
                    f"copy_ms:           {result.copy_ms:.1f}",
                    mem_line,
                    f"duration_ms:       {result.duration_ms:.1f}",
                ]
            )
            + "\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
