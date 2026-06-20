"""CLI entry point for ``python -m agents.workspace_resolve``.

Invocations:

    # Resolve a path (default: print the absolute path + source)
    python -m agents.workspace_resolve --tenant acme --path customer/standards.md

    # Resolve and print the file contents
    python -m agents.workspace_resolve --tenant acme --path customer/standards.md --read

    # Write a tenant override (refuses memory/ + audit row)
    python -m agents.workspace_resolve \\
        --tenant acme --path customer/standards.md \\
        --write --body "..." --actor identity-broker

    # Read body from a file
    python -m agents.workspace_resolve --tenant acme --path customer/standards.md \\
        --write --body-file /tmp/standards.md --actor identity-broker

    # Drop the in-process cache
    python -m agents.workspace_resolve --clear-cache

Exit codes:
    0 — success (resolved / written / cache-cleared)
    1 — not found (resolve or read returned None)
    2 — bad input (bad slug, bad relpath, denied write, usage error)
    3 — partial / unexpected I/O error
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in os.sys.path:
    sys.path.insert(0, ROOT)

from .resolver import (  # noqa: E402
    DEFAULT_AUDIT_LOG,
    PROTECTED_RELPATH_PREFIXES,
    ResolverError,
    clear_cache,
    exists,
    read_text,
    resolve,
    write_to_tenant,
)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="workspace:resolve",
        description=(
            "Resolve a tenant workspace path with override-then-seed "
            "fallthrough (FORA-411, sub-goal 0.8.4). Pure-Python, "
            "cache-friendly, no per-request filesystem walk on the hot path."
        ),
    )
    p.add_argument(
        "--tenant", required=True,
        help="Tenant slug (lowercase, dash/underscore allowed).",
    )
    p.add_argument(
        "--path", required=False,
        help="Workspace-relative POSIX path (e.g. customer/standards.md).",
    )
    p.add_argument(
        "--seed-root", default=None,
        help="Seed workspace root (default: ./workspace).",
    )
    p.add_argument(
        "--tenants-root", default=None,
        help="Tenants root (default: ./tenants).",
    )
    p.add_argument(
        "--audit-log", default=None,
        help=(
            "JSONL audit log path (default: $FORA_WORKSPACE_RESOLVE_AUDIT or "
            "./var/workspace-resolve-audit.jsonl)."
        ),
    )
    p.add_argument(
        "--read", action="store_true",
        help="Print the resolved file contents to stdout (after --json report).",
    )
    p.add_argument(
        "--write", action="store_true",
        help="Write the tenant override at the resolved path. Refuses memory/.",
    )
    p.add_argument(
        "--body", default=None,
        help="Body string for --write. Mutually exclusive with --body-file.",
    )
    p.add_argument(
        "--body-file", default=None,
        help="Read body from this file path for --write.",
    )
    p.add_argument(
        "--actor", default="workspace:resolve-cli",
        help="Actor name to record on the audit row (default: this CLI).",
    )
    p.add_argument(
        "--clear-cache", action="store_true",
        help="Drop the in-process resolver cache and exit.",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Emit a one-line JSON report on stdout (default: True if stdout is not a TTY).",
    )
    p.add_argument(
        "--quiet", action="store_true",
        help="Suppress the human-readable summary; emit only the JSON report.",
    )
    return p


def _resolve_payload(rp, requested_path: str) -> dict:
    return {
        "slug": rp.slug,
        "relpath": requested_path,
        "path": rp.path,
        "source": rp.source,
        "size": rp.size,
        "mtime_ns": rp.mtime_ns,
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.clear_cache:
        clear_cache()
        if args.json:
            sys.stdout.write(json.dumps({"cache": "cleared"}) + "\n")
        elif not args.quiet:
            sys.stdout.write("cache: cleared\n")
        return 0

    if not args.path:
        sys.stderr.write("workspace:resolve: --path is required (unless --clear-cache)\n")
        return 2

    # --write path
    if args.write:
        if args.body is not None and args.body_file is not None:
            sys.stderr.write("workspace:resolve: --body and --body-file are mutually exclusive\n")
            return 2
        if args.body is None and args.body_file is None:
            sys.stderr.write(
                "workspace:resolve: --write requires --body or --body-file\n"
            )
            return 2
        body: str
        if args.body_file:
            with open(args.body_file, "r", encoding="utf-8") as fh:
                body = fh.read()
        else:
            body = args.body or ""
        try:
            rp = write_to_tenant(
                args.tenant,
                args.path,
                body,
                actor=args.actor,
                tenants_root=args.tenants_root,
                audit_log=args.audit_log,
            )
        except ResolverError as exc:
            sys.stderr.write(f"workspace:resolve: denied: {exc}\n")
            return 2
        except OSError as exc:
            sys.stderr.write(f"workspace:resolve: write failed: {exc}\n")
            return 3
        payload = _resolve_payload(rp, args.path)
        payload["operation"] = "write"
        payload["bytes"] = rp.size
        payload["actor"] = args.actor
        want_json = args.json or not sys.stdout.isatty()
        if want_json:
            sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
        if not args.quiet and not want_json:
            sys.stdout.write(
                f"slug:     {rp.slug}\n"
                f"path:     {rp.path}\n"
                f"source:   {rp.source}\n"
                f"bytes:    {rp.size}\n"
            )
        return 0

    # --read path (resolve + print contents)
    try:
        rp = resolve(
            args.tenant,
            args.path,
            seed_root=args.seed_root,
            tenants_root=args.tenants_root,
        )
    except ResolverError as exc:
        sys.stderr.write(f"workspace:resolve: bad input: {exc}\n")
        return 2

    if rp is None:
        sys.stderr.write(
            f"workspace:resolve: '{args.path}' not found in tenant "
            f"{args.tenant!r} or seed\n"
        )
        return 1

    body_text: Optional[str] = None
    if args.read:
        body_text = read_text(
            args.tenant,
            args.path,
            seed_root=args.seed_root,
            tenants_root=args.tenants_root,
        )
        if body_text is None:
            sys.stderr.write(
                f"workspace:resolve: '{args.path}' resolved but disappeared on read\n"
            )
            return 3

    want_json = args.json or not sys.stdout.isatty()
    if want_json:
        payload = _resolve_payload(rp, args.path)
        if body_text is not None:
            payload["body"] = body_text
        sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    elif not args.quiet:
        sys.stdout.write(
            f"slug:    {rp.slug}\n"
            f"path:    {rp.path}\n"
            f"source:  {rp.source}\n"
            f"size:    {rp.size}\n"
        )
        if body_text is not None:
            sys.stdout.write("--- body ---\n")
            sys.stdout.write(body_text)
            if not body_text.endswith("\n"):
                sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())