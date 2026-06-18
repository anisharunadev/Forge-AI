"""
Sync Plane — Cross-Platform Sync Plane (Epic 11 / FORA-249).

Public surface:

  # 11.3 — Canonical comment envelope + author mapping (FORA-253 / FORA-275)
  envelope         — Pydantic-style dataclass for the §6.1 envelope
                     (comment_id UUIDv7, remote_refs, author, body_md,
                     body_remote_rendered, HLC timestamps, visibility)
  author_mapping   — per-(tenant, paperclip_id, platform) mapping rows
  attribution      — first-line rendered block + canonical machine prefix
  threading        — flatten + reconstruct (Paperclip <-> Jira/GitHub/ClickUp)
  renderers        — Markdown -> ADF / GFM / ClickUp-flavored (pure)

  # 11.4 — Tier 1 / Tier 2 / Tier 3 conflict resolver (FORA-254)
  hlc            — Hybrid Logical Clock (HLC = "<ms>.<laa>-<seq>")
  field_owners   — config-driven field-ownership table (ADR-0010 §4)
  resolver       — Tier 1 + Tier 2 dispatcher with Tier 3 auto-degrade
  clock_monitor  — Tier 3 trigger when HLC skew > SKEW_THRESHOLD_MS
  audit          — divergence_resolved / clock_skew audit row shape
                   + the §8.1 event-type registry

  # 11.7 — Polling backstop + divergence-detection daily job (FORA-257)
  cursor         — per-(tenant, platform) cursor store (5-min tick)
  polling        — PollingBackstop orchestrator (ADR-0010 §7.1)
  divergence     — DivergenceDetector daily job (ADR-0010 §7.2)
  alerting       — AlertChannel port (R-SYNC-05 P0 pager)

Built dependency-free so the smoke tests run without Postgres /
JetStream.  The production wiring is a one-line substitution of
the InMemory* ports for their Postgres counterparts; see
`agents/sync_plane/README.md`.

Reference: ADR-0010 §4 (conflict resolution), §6 (comment
envelope + threading + attribution), §7.1 (failure modes +
polling), §7.2 (divergence detection), §8.1 (audit events),
§8.2 R-SYNC-01..08.
"""

from .hlc import GENESIS_HLC, Clock, HLC, parse, wall_ms
from .field_owners import (
    DEFAULT_FIELD_OWNERS,
    FieldOwner,
    FieldOwnershipRule,
    resolve_field_owner,
)
from .resolver import (
    Resolution,
    Resolver,
    ResolverResult,
    SKEW_THRESHOLD_MS,
    resolve,
)
from .clock_monitor import ClockMonitor, SkewReport
from .audit import (
    DIVERGENCE_RESOLVED_EVENT,
    CLOCK_SKEW_EVENT,
    EVENT_RECEIVED,
    EVENT_APPLIED,
    DIVERGENCE_DETECTED,
    PLATFORM_DEGRADED,
    BACKFILL_COMPLETED,
    COMMENT_ATTRIBUTION_WRITTEN,
    AuditRow,
    build_audit_row,
)

# 11.7 — Polling backstop + divergence-detection daily job (FORA-257)
from .cursor import (
    DEFAULT_TICK_SECONDS,
    Cursor,
    CursorStore,
    InMemoryCursorStore,
    Platform,
    PLATFORMS,
    TickStatus,
    advance_cursor_value,
    compute_backoff_seconds,
)
from .alerting import (
    AlertChannel,
    InMemoryAlertChannel,
    PagePayload,
    PagerDutyAlertChannel,
    Severity,
)
from .polling import (
    AuditLog,
    BackpressureGate,
    Fetcher,
    FetcherError,
    FetcherErrorKind,
    InMemoryAuditLog,
    InMemoryIdempotentReconciler,
    PollingBackstop,
    PollingTick,
    Reconciler,
    ReconcilerResult,
    RemoteEvent,
)
from .divergence import (
    DivergenceDetector,
    DivergenceFinding,
    DivergenceKind,
    DivergenceReport,
    InMemoryMirrorState,
    InMemorySyncLog,
    MirrorEntity,
    MirrorState,
    SyncLog,
    run_clean_streak,
)

# 11.3 — Canonical comment envelope + author mapping (FORA-253, FORA-275)
from .envelope import (
    AUTHOR_KINDS,
    REMOTE_FORMATS,
    REMOTE_PLATFORMS,
    VISIBILITY,
    Author,
    CommentEnvelope,
    RemoteRef,
    RemoteRendered,
    envelope_from_dict,
    envelope_from_json,
    envelope_with_delete,
    envelope_with_edit,
    envelope_with_remote_ref,
    envelope_with_rendered,
    is_uuidv7,
    new_envelope,
)
from .author_mapping import (
    AUTHOR_KINDS as _AM_AUTHOR_KINDS,
    LEGAL_REASONS_FOR_KIND,
    REASONS,
    REMOTE_PLATFORMS as _AM_REMOTE_PLATFORMS,
    AuthorMappingRow,
    AuthorMappingTable,
)
from .attribution import (
    # Rendered human-readable block (ADR-0010 §6.2 / FORA-275)
    ATTRIBUTION_EMOJI,
    ATTRIBUTION_ROLE_LABEL,
    attribution_for_envelope,
    detect_and_strip_attribution,
    format_attribution_block,
    prepend_attribution,
    prepend_attribution_for_envelope,
    # Canonical machine-parseable prefix (FORA-264)
    Attribution,
    is_actor_kind_allowed_to_post,
    prepend as prepend_machine_prefix,
    strip as strip_machine_prefix,
    strip_round_trip,
)
from .threading import (
    FlatNode,
    POINTER_PREFIX,
    TreeNode,
    flatten_to_clickup,
    flatten_to_github,
    flatten_to_jira,
    reconstruct_from_clickup,
    reconstruct_from_github,
    reconstruct_from_jira,
)
from .renderers import (
    ADF_VERSION,
    CLICKUP_MENTION_PATTERN,
    KNOWN_FORMATS,
    KNOWN_INLINE_MARKS,
    RENDERERS,
    adf_to_markdown,
    clickup_normalise,
    gfm_normalise,
    normalise_markdown,
    render_to_adf,
    render_to_clickup,
    render_to_gfm,
    strip_raw_html,
)


__all__ = [
    # 11.4 — conflict resolver
    "GENESIS_HLC",
    "Clock",
    "HLC",
    "parse",
    "wall_ms",
    "DEFAULT_FIELD_OWNERS",
    "FieldOwner",
    "FieldOwnershipRule",
    "resolve_field_owner",
    "Resolution",
    "Resolver",
    "ResolverResult",
    "SKEW_THRESHOLD_MS",
    "resolve",
    "ClockMonitor",
    "SkewReport",
    "DIVERGENCE_RESOLVED_EVENT",
    "CLOCK_SKEW_EVENT",
    "EVENT_RECEIVED",
    "EVENT_APPLIED",
    "DIVERGENCE_DETECTED",
    "PLATFORM_DEGRADED",
    "BACKFILL_COMPLETED",
    "COMMENT_ATTRIBUTION_WRITTEN",
    "AuditRow",
    "build_audit_row",
    # 11.7 — polling backstop + divergence detector
    "DEFAULT_TICK_SECONDS",
    "Cursor",
    "CursorStore",
    "InMemoryCursorStore",
    "Platform",
    "PLATFORMS",
    "TickStatus",
    "advance_cursor_value",
    "compute_backoff_seconds",
    "AlertChannel",
    "InMemoryAlertChannel",
    "PagePayload",
    "PagerDutyAlertChannel",
    "Severity",
    "AuditLog",
    "BackpressureGate",
    "Fetcher",
    "FetcherError",
    "FetcherErrorKind",
    "InMemoryAuditLog",
    "InMemoryIdempotentReconciler",
    "PollingBackstop",
    "PollingTick",
    "Reconciler",
    "ReconcilerResult",
    "RemoteEvent",
    "DivergenceDetector",
    "DivergenceFinding",
    "DivergenceKind",
    "DivergenceReport",
    "InMemoryMirrorState",
    "InMemorySyncLog",
    "MirrorEntity",
    "MirrorState",
    "SyncLog",
    "run_clean_streak",
    # 11.3 — canonical comment envelope + author mapping
    "AUTHOR_KINDS",
    "REMOTE_FORMATS",
    "REMOTE_PLATFORMS",
    "VISIBILITY",
    "Author",
    "CommentEnvelope",
    "RemoteRef",
    "RemoteRendered",
    "envelope_from_dict",
    "envelope_from_json",
    "envelope_with_delete",
    "envelope_with_edit",
    "envelope_with_remote_ref",
    "envelope_with_rendered",
    "is_uuidv7",
    "new_envelope",
    "AuthorMappingRow",
    "AuthorMappingTable",
    "REASONS",
    "LEGAL_REASONS_FOR_KIND",
    "ATTRIBUTION_EMOJI",
    "ATTRIBUTION_ROLE_LABEL",
    "attribution_for_envelope",
    "detect_and_strip_attribution",
    "format_attribution_block",
    "prepend_attribution",
    "prepend_attribution_for_envelope",
    "Attribution",
    "is_actor_kind_allowed_to_post",
    "prepend_machine_prefix",
    "strip_machine_prefix",
    "strip_round_trip",
    "FlatNode",
    "POINTER_PREFIX",
    "TreeNode",
    "flatten_to_clickup",
    "flatten_to_github",
    "flatten_to_jira",
    "reconstruct_from_clickup",
    "reconstruct_from_github",
    "reconstruct_from_jira",
    "ADF_VERSION",
    "CLICKUP_MENTION_PATTERN",
    "KNOWN_FORMATS",
    "KNOWN_INLINE_MARKS",
    "RENDERERS",
    "adf_to_markdown",
    "clickup_normalise",
    "gfm_normalise",
    "normalise_markdown",
    "render_to_adf",
    "render_to_clickup",
    "render_to_gfm",
    "strip_raw_html",
]
