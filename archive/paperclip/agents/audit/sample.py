"""
FORA-210 — Daily audit sample (R-X2 of the sync-plane risk register).

The sample picks `n` random `(run_id, target_platform)` pairs from
the last 24 h for a tenant and verifies, for each pair, that every
mirror event the run emitted has a matching downstream platform
record **and** that every downstream platform record has a matching
audit row.  A divergence is a P0 — the on-call page fires within
5 min via the injected `on_p0` callback (production wires this to
the paging service; tests inject a recorder).

The five verifier invariants are normative (see
`forge/sync-plane/risk_register.md` §7.2):

  1. Completeness — AuditEvent count for (tenant, run, target_platform)
     equals downstream platform record count for the same pair.
  2. Schema — every sampled row has all required `metadata.sync.*`
     keys per §6 of the register.
  3. Per-tenant namespace — `tenantId == metadata.sync.authored_for_tenant`.
  4. Actor — `metadata.sync.actor_type ∈ {agent, user, system}` and
     the four-field actor invariant from §6 holds.
  5. Credential — `metadata.sync.platform_credential_ref` resolves
     to a credential in the tenant's inventory and is within its
     rotation window.

The sample code is unit-testable today against a stub mirror plane
and a stub credential inventory.  Production scheduling is a separate
Lambda wired to `daily_audit_sample()`; the prod wiring lands with
the sync-plane S1–S5 work (FORA-199 + successors).

Boundaries:
  - `store`        — `AuditStore` (the audit event store; here we read events)
  - `mirror`       — `MirrorPlane` (downstream platform record lookup; abstract)
  - `credentials`  — `CredentialInventory` (per-tenant credential lookup)
  - `on_p0`        — callback fired for every P0 finding (the prod wiring
                     pages on-call within 5 min; the test wiring records
                     findings to assert against)

The sample is itself emitted as a `sample_run_complete` `AuditEvent`.
The boundary event is built directly via `AuditEvent(...) + store.append(...)`
here, mirroring the existing `emit_run_started` / `emit_run_finished`
helpers in `agents/audit/emit.py` but kept inline so the sample module
is the single owner of the daily-sample schema (the `metadata.sync.*`
shape and the `audit.daily_sample` tool name).
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol, Sequence, Tuple

from .schema import AuditEvent, AuditEventType, digest_of
from .store import AuditStore


_log = logging.getLogger("fora.audit.sample")


# --- the seam contracts ----------------------------------------------------


# Required `metadata.sync.*` keys per `forge/sync-plane/risk_register.md` §6.
# The sample's schema invariant checks every sampled row carries all of these.
SYNC_REQUIRED_KEYS: Tuple[str, ...] = (
    "sync.target_platform",
    "sync.mirror_event_type",
    "sync.query_hash",
    "sync.response_hash",
    "sync.latency_ms",
    "sync.cost_usd",
    "sync.actor_type",
    "sync.actor_id",
    "sync.authored_for_tenant",
    "sync.rendered_as",
    "sync.idempotency_key",
    "sync.platform_region",
    "sync.platform_credential_ref",
    "sync.platform_response_code",
)

# Allowed values for `sync.actor_type` (R5.1 invariant).
ALLOWED_ACTOR_TYPES: Tuple[str, ...] = ("agent", "user", "system")

# Default credential rotation window in days (the sample flags
# credentials whose rotation is overdue by more than this).
DEFAULT_ROTATION_WINDOW_DAYS = 30

# Default sample size; AC says n=10.
DEFAULT_SAMPLE_SIZE = 10

# Lookback window for selecting the run pool (24h per §7).
DEFAULT_LOOKBACK_HOURS = 24

# Small-tenant cohort threshold (R-X2: sample exhaustively if the
# tenant emitted fewer mirror events than `n` in the window).
SMALL_TENANT_THRESHOLD = DEFAULT_SAMPLE_SIZE


# --- finding shape ---------------------------------------------------------


@dataclass
class Finding:
    """One verifier finding.  `severity` is "P0" (page) or "P1"
    (ticket); `invariant` names which §7.2 invariant fired.
    `detail` is the human-readable explanation — never the raw
    audit body (that's a digests-only audit store)."""
    severity: str
    invariant: str
    run_id: str
    target_platform: str
    detail: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity,
            "invariant": self.invariant,
            "runId": self.run_id,
            "targetPlatform": self.target_platform,
            "detail": self.detail,
        }


# --- the report ------------------------------------------------------------


@dataclass
class SampleReport:
    """The result of one sample run.

    `completeness_rate` is the fraction of `(run_id, target_platform)`
    pairs that passed invariant #1; per AC, 100% is the target.
    `p0_count` is the number of P0 findings; a P0 pages on-call
    within 5 min via the `on_p0` callback.  `findings` lists every
    P0 + P1 finding the sample produced."""
    tenant_id: str
    n: int
    sampled_pairs: int
    completeness_rate: float
    findings: List[Finding] = field(default_factory=list)
    small_tenant: bool = False

    @property
    def p0_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "P0")

    @property
    def p1_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "P1")

    @property
    def is_complete(self) -> bool:
        """True iff completeness == 1.0 AND no P0 findings.  This is
        the AC #4 condition: a missing entry is a P0, and 100%
        completeness is the bar."""
        return self.completeness_rate == 1.0 and self.p0_count == 0

    def to_metadata_sync(self) -> Dict[str, Any]:
        """The summary block the sample emits onto its own
        `sample_run_complete` event.  Per §7, the keys live under
        `metadata.sync.*`; the audit-emit helper threads these
        through as top-level `metadata`."""
        return {
            "sync.tool": "audit.daily_sample",
            "sync.target_platform": "audit",
            "sync.target_platforms_sampled": sorted(
                {tp for _, tp in getattr(self, "_sampled_pairs_list", [])}
            ),
            "sync.sample_n": self.n,
            "sync.sampled_pairs": self.sampled_pairs,
            "sync.completeness_rate": self.completeness_rate,
            "sync.p0_count": self.p0_count,
            "sync.p1_count": self.p1_count,
            "sync.is_complete": self.is_complete,
            "sync.small_tenant": self.small_tenant,
            "sync.findings": [f.to_dict() for f in self.findings],
        }


# --- seam contracts --------------------------------------------------------


class MirrorPlane(Protocol):
    """The downstream-platform record store.  The production wiring
    talks to per-platform MCPs (Jira / GitHub / ClipUp); the test
    wiring uses `InMemoryMirrorPlane`."""

    def list_recent_runs(self, tenant_id: str, hours: int = DEFAULT_LOOKBACK_HOURS) -> List[Tuple[str, str]]:
        """Return `(run_id, target_platform)` pairs the tenant
        emitted in the last `hours` hours.  Pairs may repeat across
        runs; the sample dedupes by `(run_id, target_platform)`."""

    def list_platform_records(self, tenant_id: str, run_id: str, target_platform: str) -> List[Dict[str, Any]]:
        """Return the downstream platform records for a `(tenant,
        run, target_platform)` triple.  Each record is opaque to
        the sample — what matters is the count, not the body."""


class CredentialInventory(Protocol):
    """The tenant's credential store.  The production wiring is
    `mcp-servers/secrets/` (FORA-128); the test wiring is
    `InMemoryCredentialInventory`."""

    def is_known(self, tenant_id: str, credential_ref: str) -> bool:
        """True iff `credential_ref` is registered for the tenant."""

    def rotation_due_within(self, tenant_id: str, credential_ref: str, days: int = DEFAULT_ROTATION_WINDOW_DAYS) -> bool:
        """True iff `credential_ref`'s rotation is overdue or due
        within `days` days for the tenant.  A True here means the
        credential is acceptable; False means overdue and a P0."""


# --- stub implementations for tests ---------------------------------------


class InMemoryMirrorPlane:
    """Stub mirror plane: backed by a dict in process.  The test
    suite uses this to simulate both well-formed and divergent
    downstream records without standing up real MCPs."""

    def __init__(self) -> None:
        # run_pool: tenant_id -> [(run_id, target_platform), ...]
        self._runs: Dict[str, List[Tuple[str, str]]] = {}
        # platform_records: (tenant_id, run_id, target_platform) -> [record, ...]
        self._records: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}

    def add_run(self, tenant_id: str, run_id: str, target_platform: str) -> None:
        self._runs.setdefault(tenant_id, []).append((run_id, target_platform))

    def add_record(self, tenant_id: str, run_id: str, target_platform: str, record: Dict[str, Any]) -> None:
        self._records.setdefault((tenant_id, run_id, target_platform), []).append(record)

    def list_recent_runs(self, tenant_id: str, hours: int = DEFAULT_LOOKBACK_HOURS) -> List[Tuple[str, str]]:
        return list(self._runs.get(tenant_id, []))

    def list_platform_records(self, tenant_id: str, run_id: str, target_platform: str) -> List[Dict[str, Any]]:
        return list(self._records.get((tenant_id, run_id, target_platform), []))


class InMemoryCredentialInventory:
    """Stub credential inventory: maps `(tenant_id, credential_ref)`
    to a `(rotation_due, last_rotated_iso)` tuple.  Tests populate
    this to exercise the rotation invariant."""

    def __init__(self) -> None:
        # (tenant_id, ref) -> {"rotation_due": bool, "last_rotated": iso}
        self._creds: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add(self, tenant_id: str, credential_ref: str, *, rotation_due: bool = True, last_rotated: str = "") -> None:
        self._creds[(tenant_id, credential_ref)] = {
            "rotation_due": rotation_due,
            "last_rotated": last_rotated,
        }

    def is_known(self, tenant_id: str, credential_ref: str) -> bool:
        return (tenant_id, credential_ref) in self._creds

    def rotation_due_within(self, tenant_id: str, credential_ref: str, days: int = DEFAULT_ROTATION_WINDOW_DAYS) -> bool:
        return self._creds.get((tenant_id, credential_ref), {}).get("rotation_due", True)


# --- the verifier ----------------------------------------------------------


def _select_pairs(
    pool: Sequence[Tuple[str, str]],
    n: int,
    rng: random.Random,
) -> Tuple[List[Tuple[str, str]], bool]:
    """Pick up to `n` unique `(run_id, target_platform)` pairs from
    `pool`.  Returns `(picked, small_tenant)` — `small_tenant` is
    True when the pool is smaller than `n` (exhaustive sample, per
    §7 out-of-scope #3)."""
    deduped = list(dict.fromkeys(pool))  # preserve order, drop dupes
    if len(deduped) <= n:
        return deduped, True
    return rng.sample(deduped, n), False


def _get_sync_metadata(event_metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract the `metadata.sync.*` keys (flattened) from an
    `AuditEvent.metadata` dict.  The actual storage shape is the
    dotted key path; tests may pass either dotted or nested form,
    so we accept both."""
    out: Dict[str, Any] = {}
    for k, v in event_metadata.items():
        if k.startswith("sync."):
            out[k] = v
        elif isinstance(v, dict) and k == "sync":
            out.update({f"sync.{kk}": vv for kk, vv in v.items()})
    return out


def _check_completeness(
    audit_count: int,
    platform_count: int,
    run_id: str,
    target_platform: str,
) -> Optional[Finding]:
    """Invariant #1: completeness.  AuditEvent count for (tenant,
    run, target_platform) must equal downstream platform record
    count.  Either side missing is a P0 (R-X2 / R7.1)."""
    if audit_count == platform_count:
        return None
    if audit_count == 0:
        detail = f"no AuditEvents for ({run_id}, {target_platform}); downstream has {platform_count}"
    elif platform_count == 0:
        detail = f"{audit_count} AuditEvents for ({run_id}, {target_platform}); downstream has 0 (missing entries — P0)"
    else:
        detail = f"AuditEvent count {audit_count} != platform record count {platform_count} for ({run_id}, {target_platform})"
    return Finding(severity="P0", invariant="completeness",
                   run_id=run_id, target_platform=target_platform,
                   detail=detail)


def _check_schema(
    sync: Dict[str, Any],
    run_id: str,
    target_platform: str,
) -> List[Finding]:
    """Invariant #2: schema.  Every required `metadata.sync.*` key
    must be present.  A missing key is a P0 (R6.1 / R6.2)."""
    out: List[Finding] = []
    missing = [k for k in SYNC_REQUIRED_KEYS if k not in sync or sync[k] in ("", None)]
    for k in missing:
        out.append(Finding(
            severity="P0", invariant="schema",
            run_id=run_id, target_platform=target_platform,
            detail=f"missing required metadata key {k!r}",
        ))
    return out


def _check_tenant_namespace(
    tenant_id: str,
    sync: Dict[str, Any],
    run_id: str,
    target_platform: str,
) -> Optional[Finding]:
    """Invariant #3: per-tenant namespace.  `tenantId` must equal
    `metadata.sync.authored_for_tenant`.  A mismatch is a P0
    cross-tenant leak (R6.3 + R8.1)."""
    authored_for = sync.get("sync.authored_for_tenant")
    if authored_for is None:
        return Finding(
            severity="P0", invariant="per_tenant_namespace",
            run_id=run_id, target_platform=target_platform,
            detail="missing metadata.sync.authored_for_tenant",
        )
    if authored_for != tenant_id:
        return Finding(
            severity="P0", invariant="per_tenant_namespace",
            run_id=run_id, target_platform=target_platform,
            detail=f"authored_for_tenant={authored_for!r} != tenantId={tenant_id!r} (cross-tenant leak)",
        )
    return None


def _check_actor(
    sync: Dict[str, Any],
    run_id: str,
    target_platform: str,
) -> List[Finding]:
    """Invariant #4: actor.  `sync.actor_type` must be one of
    `agent`/`user`/`system`, and the four-field actor invariant
    from §6 (actor_type, actor_id, authored_for_tenant, rendered_as)
    must be populated.  A violation is a P0 (R5.1)."""
    out: List[Finding] = []
    actor_type = sync.get("sync.actor_type")
    if actor_type not in ALLOWED_ACTOR_TYPES:
        out.append(Finding(
            severity="P0", invariant="actor",
            run_id=run_id, target_platform=target_platform,
            detail=f"sync.actor_type={actor_type!r} not in {list(ALLOWED_ACTOR_TYPES)}",
        ))
    for required in ("sync.actor_type", "sync.actor_id", "sync.authored_for_tenant", "sync.rendered_as"):
        if not sync.get(required):
            out.append(Finding(
                severity="P0", invariant="actor",
                run_id=run_id, target_platform=target_platform,
                detail=f"actor invariant: missing {required!r}",
            ))
    return out


def _check_credential(
    sync: Dict[str, Any],
    credentials: CredentialInventory,
    tenant_id: str,
    run_id: str,
    target_platform: str,
    rotation_window_days: int = DEFAULT_ROTATION_WINDOW_DAYS,
) -> List[Finding]:
    """Invariant #5: credential.  `sync.platform_credential_ref`
    must resolve to a credential in the tenant's inventory and be
    within its rotation window.  A violation is a P0 (R-X1)."""
    out: List[Finding] = []
    ref = sync.get("sync.platform_credential_ref")
    if not ref:
        out.append(Finding(
            severity="P0", invariant="credential",
            run_id=run_id, target_platform=target_platform,
            detail="missing metadata.sync.platform_credential_ref",
        ))
        return out
    if not credentials.is_known(tenant_id, ref):
        out.append(Finding(
            severity="P0", invariant="credential",
            run_id=run_id, target_platform=target_platform,
            detail=f"credential {ref!r} not in tenant {tenant_id!r} inventory (R-X1)",
        ))
        return out
    if not credentials.rotation_due_within(tenant_id, ref, days=rotation_window_days):
        out.append(Finding(
            severity="P0", invariant="credential",
            run_id=run_id, target_platform=target_platform,
            detail=f"credential {ref!r} rotation overdue (>{rotation_window_days}d) for tenant {tenant_id!r}",
        ))
    return out


# --- the emit helper (self-contained for FORA-210) ------------------------


def _emit_sample_run_complete(
    store: AuditStore,
    *,
    sample_run_id: str,
    agent_id: str,
    tenant_id: str,
    sample_n: int,
    completeness_rate: float,
    p0_count: int,
    finding_count: int,
    sampled_pairs: int,
    metadata: Dict[str, Any],
    actor: str = "system:audit.daily_sample",
) -> AuditEvent:
    """FORA-210 boundary event: the daily audit sample finished.

    Per `forge/sync-plane/risk_register.md` §7, the sample result is
    itself an `AuditEvent` with `eventType = "sample_run_complete"`,
    `tool = "audit.daily_sample"`, and a `metadata.sync.*` block
    summarising n, completeness rate, and any P0s raised.

    Inlined here (rather than going through `emit.py`) so this
    module owns the daily-sample schema — the `metadata.sync.*`
    shape and the `audit.daily_sample` tool name are part of the
    sample contract, not the runtime emit contract.
    """
    event = AuditEvent(
        event_id="",
        event_type=AuditEventType.SAMPLE_RUN_COMPLETE,
        run_id=sample_run_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        stage="audit",
        tool="audit.daily_sample",
        input_digest=digest_of({"sample_n": sample_n, "tenant_id": tenant_id}),
        output_digest=digest_of({
            "completeness_rate": completeness_rate,
            "p0_count": p0_count,
            "finding_count": finding_count,
            "sampled_pairs": sampled_pairs,
        }),
        actor=actor,
        metadata=metadata,
    )
    return store.append(event)


# --- the main entry point --------------------------------------------------


# Type for the `on_p0` callback.  Production wires this to the
# paging service; tests inject a recorder to assert on findings.
P0Callback = Callable[[Finding], None]


def daily_audit_sample(
    tenant_id: str,
    n: int = DEFAULT_SAMPLE_SIZE,
    *,
    store: AuditStore,
    mirror: MirrorPlane,
    credentials: CredentialInventory,
    on_p0: Optional[P0Callback] = None,
    rotation_window_days: int = DEFAULT_ROTATION_WINDOW_DAYS,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    rng: Optional[random.Random] = None,
    sample_run_id: Optional[str] = None,
    sample_agent_id: str = "system:audit.daily_sample",
) -> SampleReport:
    """The FORA-210 daily sample.

    Picks `n` random `(run_id, target_platform)` pairs from the
    last `lookback_hours` (default 24 h), runs the 5 verifier
    invariants from `forge/sync-plane/risk_register.md` §7.2, and
    emits the result as a `sample_run_complete` `AuditEvent`.

    P0 findings fire `on_p0(finding)` synchronously — production
    wires this to paging (the AC: "P0 raised by the sample pages
    on-call within 5 min").  The callback is sync because the
    sample itself is the audit boundary; any fire-and-forget
    indirection is the paged service's job.

    `sample_run_id` is normally generated; tests pass a stable id
    for assertion.  `rng` is injectable for deterministic tests.
    """
    if n < 1:
        raise ValueError(f"sample size must be >= 1, got {n}")
    rng = rng or random.Random()
    sample_run_id = sample_run_id or f"sample-{tenant_id}-{rng.randint(0, 1 << 30):08x}"

    # Build the pool from the mirror plane (the source of truth for
    # "what runs we expected to see").  Audit-event-side sampling
    # would miss pairs that emitted zero events — completeness
    # invariant #1 needs both sides.
    pool = mirror.list_recent_runs(tenant_id, hours=lookback_hours)
    picked, small_tenant = _select_pairs(pool, n, rng)

    findings: List[Finding] = []
    complete_pairs = 0

    for run_id, target_platform in picked:
        # Pull both sides for the invariant checks.
        audit_events = [
            ev for ev in store.list_for_tenant(tenant_id, limit=10_000)
            if ev.run_id == run_id
            and ev.stage == "sync_plane"
            and ev.metadata.get("sync.target_platform") == target_platform
        ]
        platform_records = mirror.list_platform_records(tenant_id, run_id, target_platform)

        # Invariant #1 — completeness
        c = _check_completeness(len(audit_events), len(platform_records), run_id, target_platform)
        if c is None:
            complete_pairs += 1
        else:
            findings.append(c)
            if on_p0 is not None:
                on_p0(c)

        # Per-event invariants (#2–#5) walk every audit row in the
        # pair.  Production would batch this; for v1 we walk.
        for ev in audit_events:
            sync = _get_sync_metadata(ev.metadata or {})
            for f in _check_schema(sync, run_id, target_platform):
                findings.append(f)
                if on_p0 is not None:
                    on_p0(f)
            n_finding = _check_tenant_namespace(tenant_id, sync, run_id, target_platform)
            if n_finding is not None:
                findings.append(n_finding)
                if on_p0 is not None:
                    on_p0(n_finding)
            for f in _check_actor(sync, run_id, target_platform):
                findings.append(f)
                if on_p0 is not None:
                    on_p0(f)
            for f in _check_credential(sync, credentials, tenant_id, run_id, target_platform,
                                       rotation_window_days=rotation_window_days):
                findings.append(f)
                if on_p0 is not None:
                    on_p0(f)

    completeness_rate = (complete_pairs / len(picked)) if picked else 1.0
    report = SampleReport(
        tenant_id=tenant_id,
        n=n,
        sampled_pairs=len(picked),
        completeness_rate=completeness_rate,
        findings=findings,
        small_tenant=small_tenant,
    )
    # Stash the picked pairs list so `to_metadata_sync()` can
    # surface the touched platforms in the sample event's
    # `metadata.sync.target_platforms_sampled` field.  Not part of
    # the dataclass because it's a derived summary field, not a
    # first-class report attribute.
    report._sampled_pairs_list = list(picked)  # type: ignore[attr-defined]  # noqa: SLF001

    # Emit the sample result as an audit event.  Per §7, this is
    # itself an `AuditEvent` with `eventType = "sample_run_complete"`
    # and `tool = "audit.daily_sample"` — the board read view and
    # the §6 sync.* dashboards filter on these.
    summary_metadata = report.to_metadata_sync()
    _emit_sample_run_complete(
        store,
        sample_run_id=sample_run_id,
        agent_id=sample_agent_id,
        tenant_id=tenant_id,
        sample_n=n,
        completeness_rate=completeness_rate,
        p0_count=report.p0_count,
        finding_count=len(findings),
        sampled_pairs=len(picked),
        metadata=summary_metadata,
    )

    _log.info(
        "audit.daily_sample tenant=%s n=%d sampled=%d completeness=%.3f p0=%d p1=%d",
        tenant_id, n, len(picked), completeness_rate, report.p0_count, report.p1_count,
    )
    return report


# --- scheduled run helper (Lambda seam) ------------------------------------


def compute_sample_schedule(tenant_id: str, jitter_minutes: int = 15) -> str:
    """The cron expression for a tenant's daily sample.  Default
    02:00 UTC + `jitter_minutes` minutes of jitter so a fleet of
    tenants doesn't page-on-call at the same instant.  Returned
    as an AWS EventBridge cron string (the prod scheduler)."""
    # The jitter is a deterministic offset derived from the
    # tenant id so re-runs are stable for the same tenant; tests
    # pass a fixed seed-equivalent if they need determinism.
    seed = sum(ord(c) for c in tenant_id)
    offset = seed % max(1, jitter_minutes)
    minute = (2 * 60 + offset) % 60
    hour = (2 + (2 * 60 + offset) // 60) % 24
    return f"cron({minute} {hour} * * ? *)"
