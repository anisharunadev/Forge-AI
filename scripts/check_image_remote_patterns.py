#!/usr/bin/env python3
"""Static guard for ``apps/forge/next.config.mjs`` ``images.remotePatterns``.

SPRINT 1 (docs/audit/implemenation/goal-1.md).

Rules
-----
1. Outside the ``// IF_DEV_ONLY`` ... ``// END_DEV_ONLY`` block:
   - No ``hostname: '**'`` wildcard is allowed.
   - No bare ``protocol: 'http'`` is allowed.
2. Wildcards are forbidden everywhere; only ``http://`` to explicit local
   development hostnames is permitted inside the dev-only block.

Exit codes
----------
0  = clean
1  = violations found
2  = invocation / IO error
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Marker comments that anchor the dev-only exception zone. The raw text
# of each line is checked (NOT the comment-stripped variant) because both
# markers live on comment lines themselves.
DEV_OPEN_TOKEN = "// IF_DEV_ONLY"
DEV_CLOSE_TOKEN = "// END_DEV_ONLY"

WILDCARD_HOSTNAME = re.compile(r"""hostname\s*:\s*['"]\*\*['"]""")
HTTP_PROTOCOL = re.compile(r"""protocol\s*:\s*['"]http['"]""")


def _dev_only_regions(raw_lines: list[str]) -> list[tuple[int, int]]:
    """Return half-open ``(start_line, end_line)`` ranges in raw line
    indices. A range is *fully* inside the file; nested opens raise."""
    open_idx: int | None = None
    regions: list[tuple[int, int]] = []
    for i, ln in enumerate(raw_lines):
        if DEV_OPEN_TOKEN in ln:
            if open_idx is not None:
                raise ValueError(
                    f"nested {DEV_OPEN_TOKEN!r} at line {i + 1} "
                    f"(previous at line {open_idx + 1})"
                )
            open_idx = i
        elif DEV_CLOSE_TOKEN in ln and open_idx is not None:
            regions.append((open_idx, i + 1))
            open_idx = None
    if open_idx is not None:
        raise ValueError(
            f"{DEV_OPEN_TOKEN!r} at line {open_idx + 1} has no "
            f"{DEV_CLOSE_TOKEN!r}"
        )
    return regions


def _in_dev_only(line_idx: int, regions: list[tuple[int, int]]) -> bool:
    return any(start <= line_idx < end for start, end in regions)


def _strip_js_line_comment(line: str) -> str:
    """Return the line with ``// ...`` comments removed.

    Strings inside the source line are not parsed; for our limited pattern
    set (which only matches properties that sit at the start of a JSX
    object literal entry on their own line) this is adequate.
    """
    return line.split("//", 1)[0]


def scan(path: Path) -> list[str]:
    raw_lines = path.read_text().splitlines()
    try:
        regions = _dev_only_regions(raw_lines)
    except ValueError as exc:
        raise SystemExit(f"config parse error in {path}: {exc}")

    violations: list[str] = []
    for i, raw_line in enumerate(raw_lines):
        # The wildcard protocol-hostname patterns don't appear inside
        # ``//`` comments, but defend against accidental matches anyway.
        scan_line = _strip_js_line_comment(raw_line)
        in_dev = _in_dev_only(i, regions)
        original_line_no = i + 1

        # Wildcards are NEVER allowed.
        if WILDCARD_HOSTNAME.search(scan_line):
            tag = " (inside dev-only block)" if in_dev else ""
            violations.append(
                f"{path}:{original_line_no}: forbidden wildcard "
                f"`hostname: '**'`{tag}."
            )
        # Bare `http` is only allowed inside the dev-only block.
        if HTTP_PROTOCOL.search(scan_line) and not in_dev:
            violations.append(
                f"{path}:{original_line_no}: `protocol: 'http'` is only "
                f"permitted between {DEV_OPEN_TOKEN!r} and "
                f"{DEV_CLOSE_TOKEN!r}."
            )
    return violations


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: check_image_remote_patterns.py "
            "<path/to/next.config.mjs>",
            file=sys.stderr,
        )
        return 2
    target = Path(argv[1])
    if not target.is_file():
        print(f"not a file: {target}", file=sys.stderr)
        return 2
    try:
        violations = scan(target)
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if violations:
        print("image-allow-list violations:", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1
    print(f"image-allow-list OK: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
