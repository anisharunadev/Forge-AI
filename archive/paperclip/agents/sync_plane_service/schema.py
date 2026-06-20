"""
Canonical state schema for the Sync Plane (FORA-252 / 11.1).

The Sync Plane owns four Postgres tables per ADR-0010 §3:

  * `sync.entity`              — one row per synced logical entity
                                 (issue / PR / task), keyed on
                                 `(tenant_id, entity_id)`. The
                                 `entity_id` is Paperclip-issued and
                                 stable across platforms.
  * `sync.canonical_comment`   — the §6.1 canonical comment envelope
                                 (one row per Paperclip comment that
                                 has reached at least one remote).
  * `sync.hlc_clock`           — the last HLC the local node has
                                 observed, per `(tenant_id,
                                 consumer)`. Hydrated on boot to
                                 keep the HLC monotonic across
                                 process restarts.
  * `sync.divergence_queue`    — Tier-3 unresolved candidates per
                                 ADR-0010 §4 (the human workbench
                                 picks them up via the
                                 `DivergenceWorkbench` port).

The dataclasses here are the in-process representation. The
Postgres schema (production) lives in
`agents/sync_plane_service/migrations/0005_sync_plane.sql`; the
`InMemorySyncStore` (dev / smoke test) uses the same field names so
the contract is one source of truth.

The dataclasses are pure — no I/O, no thread state — so the smoke
test can round-trip them through the in-memory store without
spinning up Postgres. The service layer is responsible for
serialising them into the SQL row shape.
"""

from __future__ import annotations

import enum
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# The four table names. Production Postgres uses these; the
# in-memory store uses them as dict keys.
TABLE_ENTITY = "sync.entity"
TABLE_CANONICAL_COMMENT = "sync.canonical_comment"
TABLE_HLC_CLOCK = "sync.hlc_clock"
TABLE_DIVERGENCE_QUEUE = "sync.divergence_queue"


class EntityKind(str, enum.Enum):
    """The kind of canonical entity. The Sync Plane v0.1 handles
    three of these; future kinds (release, sprint, etc.) extend the
    enum without schema change. `INTERACTION` covers the
    `interaction.created.v1` subject; `RUN_STATUS` covers
    `run.status_changed.v1`; `ISSUE` covers `issue.updated.v1`."""
    ISSUE = "issue"
    RUN_STATUS = "run_status"
    INTERACTION = "interaction"
    COMMENT = "comment"           # not a Forge event subject; canonical envelope only


@dataclass
class SyncEntity:
    """One row of `sync.entity`.

    `entity_id` is Paperclip-issued and stable across all platforms
    (ADR-0010 §6.1). `remote_refs` is the per-platform id map (the
    same shape used in the canonical comment envelope). `last_hlc`
    is the HLC of the most recent accepted write; the Tier 2 LWW
    resolver compares incoming HLCs against this value.
    """
    tenant_id: str
    entity_id: str
    kind: EntityKind
    remote_refs: Dict[str, str] = field(default_factory=dict)
    last_hlc: str = ""            # canonical-form HLC string
    last_event_id: str = ""       # for idempotent replay
    created_hlc: str = ""
    updated_hlc: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value if isinstance(self.kind, EntityKind) else self.kind
        return d


@dataclass
class CanonicalComment:
    """One row of `sync.canonical_comment`. The §6.1 envelope, with
    Postgres-friendly fields.

    `comment_id` is Paperclip-issued and stable across all
    platforms; remote ids go in `remote_refs` keyed by platform
    (jira / github / clickup). `body_md` is the Markdown source of
    truth; per-platform rendered forms (ADF / GFM / ClickUp MD)
    are stored in `body_remote_rendered` and re-rendered on edit.

    `created_hlc` / `edited_hlc` / `deleted_hlc` are the canonical
    event timestamps; the HLC ordering is what the §6.3
    threading-reconstruction uses to flatten/rebuild threads.
    """
    tenant_id: str
    comment_id: str
    paperclip_issue_id: str
    author_kind: str              # "agent" | "user" | "board" | "system"
    author_id: str
    author_display_name: str
    body_md: str
    remote_refs: Dict[str, Dict[str, str]] = field(default_factory=dict)
    body_remote_rendered: Dict[str, Dict[str, str]] = field(default_factory=dict)
    created_hlc: str = ""
    edited_hlc: str = ""
    deleted_hlc: str = ""         # tombstone, not hard delete
    visibility: str = "tenant"    # "tenant" | "internal"
    in_reply_to: str = ""         # parent comment_id, for §6.3 threading
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class HLCClockRow:
    """One row of `sync.hlc_clock`. The `consumer` segment names the
    downstream consumer (e.g. `jira_mirror_writer`,
    `github_mirror_writer`); a service restart hydrates the local
    HLC from this row to keep the clock monotonic across
    processes."""
    tenant_id: str
    consumer: str
    last_hlc: str
    last_physical_ms: int = 0
    last_updated_at: str = ""     # ISO 8601 UTC, for observability

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DivergenceEntry:
    """One row of `sync.divergence_queue`. ADR-0010 §4 Tier 3: a
    conflict that would lose user-visible data on Tier 2 LWW and
    therefore needs a human. The workbench (sub-task 11.5) reads
    this table to render the resolution UI; the audit forwarder
    (sub-task 11.8) emits `event.divergence_detected` on insert
    and `event.divergence_resolved` on human resolution."""
    tenant_id: str
    entity_id: str
    field: str
    winner_platform: str          # "paperclip" / "jira" / "github" / "clickup"
    loser_platform: str
    winner_value: Any
    loser_value: Any
    winner_hlc: str
    loser_hlc: str
    reason: str                   # "clock_skew" | "free_text_diff" | "field_owner_conflict"
    detected_hlc: str = ""
    detected_at: str = ""
    resolved: bool = False
    resolution: str = ""          # "winner_kept" | "loser_kept" | "merged" | "discarded"
    resolver: str = ""            # "human:<user-id>" or "system:workbench"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReceivedEvent:
    """An event received from the bus. NOT a Postgres row — this is
    the in-process envelope the Subscriber produces and the
    Service applies. `event_id` is the Forge-issued idempotency
    key (per ADR-0006 §3.2); the store dedupes on it.

    `subject` is the bus subject (`fora.events.<tenant>.<type>.v1`).
    `payload` is the event body; `hlc` is the producer's HLC
    (Paperclip-issued). The service uses `hlc` to feed
    `Clock.observe` so the local clock stays monotonic.
    """
    event_id: str
    tenant_id: str
    subject: str
    event_type: str
    occurred_at: str              # ISO 8601 UTC
    hlc: str                      # canonical-form HLC string from producer
    payload: Dict[str, Any] = field(default_factory=dict)
    # The local HLC stamped when the subscriber accepts the event
    received_hlc: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def new_event_id() -> str:
        # Mirror ADR-0006 §3.2: uuid v4 hex, 16 chars after the prefix
        return f"evt-{uuid.uuid4().hex[:16]}"


def now_iso() -> str:
    """ISO 8601 UTC timestamp, ms precision. Used for observability
    fields; the HLC is the canonical time for ordering."""
    return time.strftime("%Y-%m-%dT%H:%M:%S.", time.gmtime()) + \
        f"{int((time.time() % 1) * 1000):03d}Z"


def canonical_json(obj: Any) -> str:
    """Stable JSON for hashing / round-trip tests. Same contract as
    `agents.audit.schema.canonical_json` — sort_keys, no
    whitespace, no NaN/Inf — so the audit forwarder and the
    in-memory store agree on byte form."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      default=str, ensure_ascii=False, allow_nan=False)
