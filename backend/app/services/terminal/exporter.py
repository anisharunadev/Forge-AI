"""Session Export (F-415).

Reconstruct a session's transcript for record-keeping, handoff, or
audit. Supports five output formats:

- ``txt``  — plain text with timestamps.
- ``json`` — structured (metadata + commands + outputs + audit hash).
- ``md``   — markdown with fenced code blocks per command.
- ``cast`` — asciinema v2 file (see :mod:`cast_encoder`).
- ``html`` — self-contained HTML using xterm.js for replay.

Audit hash chain
----------------
Every export includes an audit ``prev_hash`` -> ``hash`` chain over
the command records (sha256 over canonical JSON). The chain can be
re-verified later to prove the session wasn't tampered with after
export.
"""

from __future__ import annotations

import hashlib
import html
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory
from app.services.terminal.cast_encoder import (
    CastValidationError,
    encode_session,
    frames_from_audit,
    validate_audit_chain,
)
from app.terminal.session_manager import (
    AgentType,
    TerminalSession,
    session_manager,
)

logger = get_logger(__name__)


ExportFormat = Literal["txt", "json", "md", "cast", "html"]


@dataclass
class ExportedFile:
    """A rendered export."""

    session_id: str
    format: ExportFormat
    filename: str
    mime_type: str
    content: str
    audit_hash_chain: list[dict[str, Any]] = field(default_factory=list)
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "format": self.format,
            "filename": self.filename,
            "mime_type": self.mime_type,
            "content": self.content,
            "audit_hash_chain": list(self.audit_hash_chain),
            "generated_at": self.generated_at.isoformat(),
            "metadata": dict(self.metadata),
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _audit_chain(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build a tamper-evident chain over the records.

    Each record gets ``hash`` = sha256(canonical({prev_hash, ...record})).
    The first record's ``prev_hash`` is the well-known genesis
    sentinel ``"0" * 64``.
    """
    genesis = "0" * 64
    chain: list[dict[str, Any]] = []
    prev = genesis
    for record in records:
        record = dict(record)
        record.pop("hash", None)
        record.pop("prev_hash", None)
        canonical = _canonical({"prev_hash": prev, **record})
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        chain.append({**record, "prev_hash": prev, "hash": digest})
        prev = digest
    return chain


def verify_audit_hash_chain(chain: list[dict[str, Any]]) -> bool:
    """Recompute the chain from a serialized form; return True iff valid."""
    prev = "0" * 64
    for record in chain:
        record = dict(record)
        declared = record.pop("hash", None)
        declared_prev = record.pop("prev_hash", None)
        if declared_prev != prev:
            return False
        canonical = _canonical({"prev_hash": prev, **record})
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if digest != declared:
            return False
        prev = digest
    return True


# ---------------------------------------------------------------------------
# Exporter
# ---------------------------------------------------------------------------

class SessionExporter:
    """Renders a session to the requested format."""

    def __init__(self) -> None:
        # In-memory upload history. The ``/export/history`` endpoint
        # reads from here; for multi-instance deployments this would
        # live in Redis but for now the per-process map is fine.
        self._history: list[dict[str, Any]] = []

    # -- public surface --------------------------------------------------

    async def export_session(
        self,
        session_id: str,
        *,
        format: ExportFormat = "md",
    ) -> ExportedFile:
        """Render a session transcript in the chosen format."""
        session = await session_manager.get_session(session_id)
        if session is None:
            raise LookupError(f"session_not_found:{session_id}")
        records = await self._collect_audit_records(session)
        chain = _audit_chain(records)
        renderer = _RENDERERS[format]
        return renderer(self, session, records, chain)

    async def list_history(self, session_id: str) -> list[dict[str, Any]]:
        return [h for h in self._history if h.get("session_id") == session_id]

    def record_upload(self, session_id: str, url: str, format: ExportFormat) -> None:
        self._history.append(
            {
                "upload_id": str(uuid.uuid4()),
                "session_id": session_id,
                "url": url,
                "format": format,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # -- record collection -----------------------------------------------

    async def _collect_audit_records(self, session: TerminalSession) -> list[dict[str, Any]]:
        """Pull every ``terminal.command`` audit event for the session."""
        factory = get_session_factory()
        async with factory() as db_session:
            stmt = (
                select(AuditEvent)
                .where(
                    AuditEvent.tenant_id == session.tenant_id,
                    AuditEvent.target_type == "terminal_session",
                    AuditEvent.target_id == session.id,
                    AuditEvent.action == "terminal.command",
                )
                .order_by(AuditEvent.occurred_at.asc())
            )
            rows = list((await db_session.execute(stmt)).scalars().all())
        out: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row.payload or {})
            out.append(
                {
                    "audit_id": str(row.id),
                    "command": payload.get("command", ""),
                    "output_hash": payload.get("output_hash"),
                    "output": payload.get("output", b""),
                    "duration_ms": payload.get("duration_ms", 0),
                    "cost_estimate_usd": payload.get("cost_estimate_usd", 0.0),
                    "occurred_at": row.occurred_at,
                }
            )
        return out

    # -- format helpers --------------------------------------------------

    def _metadata(self, session: TerminalSession) -> dict[str, Any]:
        return {
            "session_id": session.id,
            "tenant_id": session.tenant_id,
            "project_id": session.project_id,
            "user_id": session.user_id,
            "agent_type": session.agent_type.value,
            "workspace_path": session.workspace_path,
            "created_at": session.created_at.isoformat(),
            "last_activity_at": session.last_activity_at.isoformat(),
            "status": session.status.value,
            "metadata": dict(session.metadata or {}),
        }

    def _render_txt(
        self,
        session: TerminalSession,
        records: list[dict[str, Any]],
        chain: list[dict[str, Any]],
    ) -> ExportedFile:
        lines: list[str] = [
            f"Forge Terminal Session {session.id}",
            f"Agent: {session.agent_type.value}",
            f"Workspace: {session.workspace_path}",
            f"User: {session.user_id}",
            f"Started: {session.created_at.isoformat()}",
            f"Ended:   {session.last_activity_at.isoformat()}",
            "",
            "=" * 80,
        ]
        for idx, rec in enumerate(records):
            ts = rec["occurred_at"]
            ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            lines.append(f"[{ts_str}] $ {rec['command']}")
            output = rec.get("output") or b""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            lines.append(output.rstrip("\n"))
            lines.append(f"  (output_sha256={rec.get('output_hash')}, ms={rec.get('duration_ms', 0)})")
            lines.append("-" * 80)
        lines.append("")
        lines.append("Audit hash chain:")
        for entry in chain:
            lines.append(f"  {entry['prev_hash'][:12]}... -> {entry['hash'][:12]}...")
        content = "\n".join(lines)
        return ExportedFile(
            session_id=session.id,
            format="txt",
            filename=f"forge-session-{session.id}.txt",
            mime_type="text/plain",
            content=content,
            audit_hash_chain=chain,
            metadata=self._metadata(session),
        )

    def _render_json(
        self,
        session: TerminalSession,
        records: list[dict[str, Any]],
        chain: list[dict[str, Any]],
    ) -> ExportedFile:
        serializable_records = []
        for rec in records:
            r = dict(rec)
            ts = r.get("occurred_at")
            if isinstance(ts, datetime):
                r["occurred_at"] = ts.isoformat()
            output = r.get("output")
            if isinstance(output, bytes):
                r["output"] = output.decode("utf-8", errors="replace")
            serializable_records.append(r)
        body = {
            "metadata": self._metadata(session),
            "records": serializable_records,
            "audit_hash_chain": chain,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        return ExportedFile(
            session_id=session.id,
            format="json",
            filename=f"forge-session-{session.id}.json",
            mime_type="application/json",
            content=json.dumps(body, indent=2, default=str),
            audit_hash_chain=chain,
            metadata=self._metadata(session),
        )

    def _render_md(
        self,
        session: TerminalSession,
        records: list[dict[str, Any]],
        chain: list[dict[str, Any]],
    ) -> ExportedFile:
        lines: list[str] = [
            f"# Forge Terminal Session `{session.id}`",
            "",
            f"- **Agent**: `{session.agent_type.value}`",
            f"- **Workspace**: `{session.workspace_path}`",
            f"- **User**: `{session.user_id}`",
            f"- **Started**: {session.created_at.isoformat()}",
            f"- **Last activity**: {session.last_activity_at.isoformat()}",
            "",
            "## Transcript",
            "",
        ]
        for rec in records:
            ts = rec["occurred_at"]
            ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            lines.append(f"### `{ts_str}` — `{rec['command']}`")
            lines.append("")
            output = rec.get("output") or b""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            lang = _detect_lang(rec.get("command", ""))
            lines.append(f"```{lang}")
            lines.append(output.rstrip("\n"))
            lines.append("```")
            lines.append("")
        lines.append("## Audit Hash Chain")
        lines.append("")
        lines.append("| # | prev | hash |")
        lines.append("|---|------|------|")
        for idx, entry in enumerate(chain):
            lines.append(
                f"| {idx} | `{entry['prev_hash'][:16]}...` | `{entry['hash'][:16]}...` |"
            )
        return ExportedFile(
            session_id=session.id,
            format="md",
            filename=f"forge-session-{session.id}.md",
            mime_type="text/markdown",
            content="\n".join(lines),
            audit_hash_chain=chain,
            metadata=self._metadata(session),
        )

    def _render_cast(
        self,
        session: TerminalSession,
        records: list[dict[str, Any]],
        chain: list[dict[str, Any]],
    ) -> ExportedFile:
        # Validate the audit chain so the .cast is faithful.
        try:
            validate_audit_chain(records, require_output=False)
        except CastValidationError:
            # Don't fail the export — the chain integrity is informational.
            logger.warning("terminal.export.cast_validation_partial", session_id=session.id)
        cast_records = [
            {k: v for k, v in rec.items() if k != "output"}
            | (
                {"output": rec["output"].decode("utf-8", errors="replace")}
                if isinstance(rec.get("output"), bytes)
                else {}
            )
            for rec in records
        ]
        frames = frames_from_audit(
            cast_records,
            started_at=session.created_at,
        )
        content = encode_session(
            frames,
            width=120,
            height=40,
            title=f"forge-session-{session.id}",
            env={"SHELL": "/bin/sh", "TERM": "xterm-256color"},
        )
        return ExportedFile(
            session_id=session.id,
            format="cast",
            filename=f"forge-session-{session.id}.cast",
            mime_type="application/x-asciinema",
            content=content,
            audit_hash_chain=chain,
            metadata=self._metadata(session),
        )

    def _render_html(
        self,
        session: TerminalSession,
        records: list[dict[str, Any]],
        chain: list[dict[str, Any]],
    ) -> ExportedFile:
        # Build an HTML replay using xterm.js loaded from CDN.
        # Frames are JSON-encoded for the embedded JS to replay.
        cast_records = []
        for rec in records:
            output = rec.get("output") or b""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            cast_records.append(
                {
                    "t": (
                        rec["occurred_at"] - session.created_at
                    ).total_seconds()
                    if isinstance(rec.get("occurred_at"), datetime)
                    else 0.0,
                    "type": "i",
                    "data": rec.get("command", "") + "\n",
                }
            )
            cast_records.append({"t": 0.0, "type": "o", "data": output})
        frames_json = json.dumps(cast_records, default=str)
        body = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Forge Session {html.escape(session.id)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css"/>
<style>body{{margin:0;background:#1e1e1e;color:#fff;font-family:system-ui}}.h{{padding:8px 16px;border-bottom:1px solid #333}}#t{{padding:8px 16px}}</style>
</head><body><div class="h"><strong>Forge Terminal Session</strong> {html.escape(session.id)}<br/>agent={html.escape(session.agent_type.value)} workspace={html.escape(session.workspace_path)}</div><div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script>
const FRAMES = {frames_json};
const term = new Terminal({{cols: 120, rows: 40, theme: {{background: '#1e1e1e'}}}});
term.open(document.getElementById('t'));
for (const f of FRAMES) {{ term.write(f.data); }}
</script>
</body></html>"""
        return ExportedFile(
            session_id=session.id,
            format="html",
            filename=f"forge-session-{session.id}.html",
            mime_type="text/html",
            content=body,
            audit_hash_chain=chain,
            metadata=self._metadata(session),
        )


def _detect_lang(command: str) -> str:
    """Cheap language hint for fenced code blocks in markdown."""
    cmd = command.strip().split()
    if not cmd:
        return "text"
    head = cmd[0].lower()
    if head in {"python", "python3"}:
        return "python"
    if head in {"node", "deno", "ts-node"}:
        return "javascript"
    if head in {"go", "cargo", "rustc"}:
        return "rust"
    if head in {"bash", "sh", "zsh"}:
        return "bash"
    if head in {"sql", "psql", "mysql"}:
        return "sql"
    if head == "kubectl":
        return "yaml"
    return "text"


_RENDERERS = {
    "txt": lambda self, session, records, chain: self._render_txt(session, records, chain),
    "json": lambda self, session, records, chain: self._render_json(session, records, chain),
    "md": lambda self, session, records, chain: self._render_md(session, records, chain),
    "cast": lambda self, session, records, chain: self._render_cast(session, records, chain),
    "html": lambda self, session, records, chain: self._render_html(session, records, chain),
}


session_exporter = SessionExporter()


__all__ = [
    "SessionExporter",
    "ExportedFile",
    "ExportFormat",
    "verify_audit_hash_chain",
    "session_exporter",
]
