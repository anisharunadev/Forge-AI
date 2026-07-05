#!/usr/bin/env python3
"""Phase 6 SC-6.7 — audit every LLM call site for guardrail enforcement.

Every chat completion must pass through ``ForgeLLMClient`` (which calls
``_enforce_pre_call_guardrails`` before the upstream call). This script
greps for direct ``LiteLLMClient`` / ``client.chat`` / ``httpx.post.*chat/completions``
callers outside the canonical wrapper, lists them, and exits 1 if any
are found in ``backend/app/`` (excluding the wrapper itself and tests).

Usage:
    python3 scripts/audit-guardrail-callsites.py            # exit 1 on hits
    python3 scripts/audit-guardrail-callsites.py --list     # show all hits
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "backend" / "app"

# Files that legitimately hold the chat wrapper or call sites for testing.
EXEMPT = {
    "backend/app/integrations/litellm/llm_client.py",  # the wrapper
    "backend/app/integrations/litellm/litellm_base_client.py",  # the transport
}

# Patterns: any direct upstream call OR direct LiteLLMClient instantiation.
PATTERNS = [
    re.compile(r"\.chat\(\s*messages\s*=", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*chat/completions", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*\/generate\b", re.MULTILINE),
    re.compile(r"from\s+app\.services\.litellm_client\s+import", re.MULTILINE),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    hits: list[tuple[str, int, str]] = []
    for py in sorted(APP.rglob("*.py")):
        rel = str(py.relative_to(REPO))
        if rel in EXEMPT:
            continue
        if "/tests/" in rel or rel.endswith("test_*.py"):
            continue
        try:
            text = py.read_text(encoding="utf-8")
        except Exception:
            continue
        for pat in PATTERNS:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append((rel, line, m.group(0).strip()[:80]))

    if args.list:
        for rel, line, snippet in hits:
            print(f"{rel}:{line}  {snippet}")
        return 0
    if hits:
        for rel, line, snippet in hits:
            print(f"::error::{rel}:{line} {snippet}", file=sys.stderr)
        print(
            f"\n{len(hits)} unguarded chat call sites. "
            "Migrate them to ForgeLLMClient.chat() — "
            "see docs/runbooks/guardrails.md.",
            file=sys.stderr,
        )
        return 1
    print("guardrail-audit: 0 hits — all chat calls go through the wrapper.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
