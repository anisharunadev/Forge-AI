"""Append-only audit mirror for the memory store.

ADR-0002 §7 mandates a single append-only audit log mirrored to every
memory.* call. The store's relational `memory_audit` table is the
authoritative mirror; this JSONL file is the wire-level mirror a future
Audit system 0.5 can subscribe to. Every `memory.*` call goes through
`record(...)` which writes one line and is best-effort: a failure to
write the JSONL is logged to stderr but does not break the write
(the relational audit is the source of truth).
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


class JsonlAuditMirror:
    """Append-only JSONL audit log. One line per `memory.*` call."""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path
        self._fh = None
        if path:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Append mode so a restart does not truncate.
            self._fh = open(path, "a", encoding="utf-8")
            try:
                self._fh.seek(0, os.SEEK_END)
            except OSError:
                pass

    def record(
        self,
        *,
        actor: Dict[str, Any],
        operation: str,
        target: Dict[str, Any],
        result: str,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_cents: int = 0,
    ) -> None:
        if self._fh is None:
            return
        row = {
            "id": "aud-" + uuid.uuid4().hex,
            "ts": _now_iso(),
            "actor": dict(actor),
            "operation": operation,
            "target": dict(target),
            "result": result,
            "tokensIn": int(tokens_in),
            "tokensOut": int(tokens_out),
            "costCents": int(cost_cents),
        }
        try:
            self._fh.write(json.dumps(row, default=str) + "\n")
            self._fh.flush()
        except OSError as exc:  # noqa: BLE001
            sys.stderr.write(f"[memory_mcp.audit] failed to write JSONL: {exc}\n")

    def close(self) -> None:
        if self._fh is not None:
            try:
                self._fh.close()
            except OSError:
                pass
            self._fh = None
