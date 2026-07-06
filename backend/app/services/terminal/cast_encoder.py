"""Asciinema ``.cast`` encoder (F-415 helper).

The .cast format is line-delimited JSON: each line is ``[time, type, data]``
where ``type`` is ``"o"`` for output and ``"i"`` for input. The first
line is a header:

    {"version": 2, "width": 80, "height": 24, "timestamp": ..., "title": ..., "env": {...}}

Encoding rule
-------------
For each command/output pair we emit:

* an ``i`` frame with the command text (the user typed it)
* an ``o`` frame with the output text

We validate that every command in the source audit log has a
non-empty output stream; mismatches are returned as
:class:`CastValidationError` so callers can decide whether to fail
the export or surface a warning.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass
class CastFrame:
    """One input or output frame."""

    t: float
    type: str  # "o" or "i"
    data: str

    def to_json(self) -> str:
        return json.dumps([round(self.t, 6), self.type, self.data], ensure_ascii=False)


class CastValidationError(ValueError):
    """Raised when an audit log doesn't satisfy .cast invariants."""


def encode_header(
    *,
    width: int,
    height: int,
    title: str,
    timestamp: float,
    env: dict[str, str] | None = None,
) -> str:
    """Render the first line of a .cast file."""
    payload = {
        "version": 2,
        "width": int(width),
        "height": int(height),
        "timestamp": float(timestamp),
        "title": title,
        "env": dict(env or {"SHELL": "/bin/sh", "TERM": "xterm-256color"}),
    }
    return json.dumps(payload, ensure_ascii=False)


def encode_frame(t: float, type_: str, data: str) -> str:
    """Render one frame line. ``type_`` must be 'o' or 'i'."""
    if type_ not in {"o", "i"}:
        raise ValueError(f"invalid frame type: {type_!r}")
    if not isinstance(data, str):
        raise TypeError("frame data must be a str")
    return CastFrame(t=float(t), type=type_, data=data).to_json()


def encode_session(
    frames: Iterable[CastFrame],
    *,
    width: int = 80,
    height: int = 24,
    title: str = "forge-terminal",
    timestamp: float | None = None,
    env: dict[str, str] | None = None,
) -> str:
    """Serialize an entire session as a .cast string."""
    if timestamp is None:
        ts = datetime.now(UTC).timestamp()
    else:
        ts = float(timestamp)
    lines = [encode_header(width=width, height=height, title=title, timestamp=ts, env=env)]
    for f in frames:
        lines.append(encode_frame(f.t, f.type, f.data))
    return "\n".join(lines) + "\n"


def validate_audit_chain(
    commands: list[dict[str, Any]],
    *,
    require_output: bool = True,
) -> None:
    """Sanity-check a list of audit command records before encoding.

    Each record must have ``command`` (str) and either ``output`` (str/bytes)
    or ``output_hash`` (str). When ``require_output`` is True, the output
    must be present and non-empty; otherwise an empty output is allowed
    (e.g. for commands like ``clear``).
    """
    seen: set[str] = set()
    for idx, cmd in enumerate(commands):
        if not isinstance(cmd, dict):
            raise CastValidationError(f"record {idx}: not a dict")
        command = cmd.get("command")
        if not isinstance(command, str) or not command:
            raise CastValidationError(f"record {idx}: missing command")
        if command in seen:
            raise CastValidationError(f"record {idx}: duplicate command {command!r}")
        seen.add(command)
        output = cmd.get("output", b"")
        if isinstance(output, bytes):
            output_present = len(output) > 0
        else:
            output_present = bool(output)
        if require_output and not output_present and not cmd.get("output_hash"):
            raise CastValidationError(f"record {idx}: command {command!r} missing output bytes")


def frames_from_audit(
    commands: list[dict[str, Any]],
    *,
    started_at: datetime,
) -> list[CastFrame]:
    """Project audit records into ordered CastFrames.

    ``started_at`` is the wall-clock time of the first command; each
    subsequent command's ``occurred_at`` is converted into a relative
    offset in seconds.
    """
    frames: list[CastFrame] = []
    last_t = 0.0
    for cmd in commands:
        occurred_at = cmd.get("occurred_at") or started_at
        if isinstance(occurred_at, datetime):
            t = max(0.0, (occurred_at - started_at).total_seconds())
        else:
            t = float(occurred_at)
        # Ensure strictly monotonic time so the asciinema player doesn't choke.
        t = max(t, last_t + 1e-3)
        last_t = t
        command = cmd.get("command") or ""
        frames.append(CastFrame(t=t, type="i", data=command + "\n"))
        output = cmd.get("output", b"")
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        frames.append(CastFrame(t=t + 1e-3, type="o", data=output))
    return frames


__all__ = [
    "CastFrame",
    "CastValidationError",
    "encode_header",
    "encode_frame",
    "encode_session",
    "frames_from_audit",
    "validate_audit_chain",
]
