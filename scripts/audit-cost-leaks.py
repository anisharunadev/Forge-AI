#!/usr/bin/env python3
"""Phase 6 SC-6.9 — every LLM call must write to cost_ledger.

Greps for direct httpx POSTs to chat/completions or /generate endpoints
outside ``app/integrations/litellm/``. Exits 1 on any hit in app code.

Usage:
    python3 scripts/audit-cost-leaks.py            # exit 1 on hits
    python3 scripts/audit-cost-leaks.py --list     # print hits, exit 0
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "backend" / "app"

EXEMPT_PREFIXES = (
    "backend/app/integrations/litellm/",
    "backend/tests/",
)
EXEMPT_FILES = {
    "backend/app/integrations/litellm/litellm_base_client.py",  # the transport
    "backend/app/integrations/litellm/llm_client.py",  # the canonical wrapper
}

PATTERNS = [
    re.compile(r"httpx\.post\([^)]*chat/completions", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*\/generate\b", re.MULTILINE),
    re.compile(r"requests\.post\([^)]*chat/completions", re.MULTILINE),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--strict", action="store_true", help="exit 1 on hits")
    args = ap.parse_args()

    hits: list[tuple[str, int, str]] = []
    for py in sorted(APP.rglob("*.py")):
        rel = str(py.relative_to(REPO))
        if rel in EXEMPT_FILES:
            continue
        if any(rel.startswith(p) for p in EXEMPT_PREFIXES):
            continue
        if "test_" in py.name:
            continue
        try:
            text = py.read_text(encoding="utf-8")
        except Exception:
            continue
        for pat in PATTERNS:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append((rel, line, m.group(0).strip()[:100]))

    if args.list:
        for rel, line, snippet in hits:
            print(f"{rel}:{line}  {snippet}")
        return 0
    if hits:
        for rel, line, snippet in hits:
            print(f"::error::{rel}:{line} {snippet}", file=sys.stderr)
        print(
            f"\n{len(hits)} cost leaks. All chat calls must go through "
            "ForgeLLMClient (which writes to cost_ledger.record_actual).",
            file=sys.stderr,
        )
        return 1
    print("cost-leak-audit: 0 hits — all chat calls go through the wrapper.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
