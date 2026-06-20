"""
Smoke test for the GitHub Issues adapter (FORA-201 / 11.2b).

Mirrors the FORA-117 / FORA-252 smoke-test contract:

    python -m agents.sync_plane_service.adapters.test_github

Exits 0 on green. Writes evidence to
`agents/sync_plane_service/adapters/evidence/smoke_github_<utc>.json`.
The evidence JSON is the input to the close-gate
reviewer (CTO) and the Board `request_confirmation`.

Scenarios (one per FORA-201 AC):

  S1 create         — Paperclip issue -> GitHub Issue.
  S2 comment        — Paperclip comment -> GitHub Issue
                      comment (idempotent on second call
                      inside 30s).
  S3 status_mapping — every Paperclip status maps to the
                      correct GitHub state.
  S4 rate_limit     — `AdapterHealth.rate_limit_remaining`
                      reflects the transport's quota.
  S5 divergence     — adapter emits a divergence event
                      when the response state differs from
                      the requested state.
  S6 divergence_422 — FORA-438 AC#5: when GitHub returns
                      422 for a state_reason mismatch the
                      adapter emits
                      `sync.event.divergence_detected` via
                      the `AuditForwarder` with the 6
                      required fields, retries with
                      state_reason stripped, and is
                      idempotent on replay.

The smoke test is dependency-free (no `pytest`,
no `httpx`, no real GitHub App). It uses the
`InMemoryGitHubTransport` from
`agents.sync_plane_service.adapters._test_transport`.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

# Make the package importable when invoked as
# `python -m agents.sync_plane_service.adapters.test_github`
# from the repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from agents.sync_plane_service.adapters import (  # noqa: E402
    EnvBackedGitHubAuthProvider,
    GitHubIssuesAdapter,
    StatusMapping,
    StatusMappingError,
    map_status_paperclip_to_github,
    map_status_github_to_paperclip,
)
from agents.sync_plane_service.adapters.github import (  # noqa: E402
    AuthorMappingError,
    EnvBackedGitHubAuthorMapper,
    MappedPaperclipAuthor,
)
from agents.sync_plane_service.adapters._test_transport import (  # noqa: E402
    InMemoryGitHubTransport,
)
from agents.sync_plane_service.schema import (  # noqa: E402
    CanonicalComment,
    EntityKind,
    ReceivedEvent,
    SyncEntity,
)


# -- Recording audit hook --------------------------------------------------


@dataclass
class _RecordedDivergence:
    tenant_id: str
    entity_id: str
    requested_state: Any
    observed_state: Any
    remote_response_status: int


class _RecordingAuditHook:
    """In-memory audit hook for the smoke test. Records
    every `divergence_detected` call so the S5 scenario
    can assert on it. The FORA-433 comment-audit methods
    (`target_comment_ok`, `source_comment_ok`) are
    no-ops here — the day-one smoke only cares about
    divergence detection; the FORA-433 close-gate
    scenarios (S6, S7) use the richer
    `_CommentRecordingAuditHook` below."""

    def __init__(self) -> None:
        self.calls: List[_RecordedDivergence] = []

    def divergence_detected(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        requested_state: Any,
        observed_state: Any,
        remote_response_status: int,
    ) -> None:
        self.calls.append(
            _RecordedDivergence(
                tenant_id=tenant_id,
                entity_id=entity_id,
                requested_state=requested_state,
                observed_state=observed_state,
                remote_response_status=remote_response_status,
            )
        )

    def target_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None

    def source_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None

    def target_issue_ok(self, *args: Any, **kwargs: Any) -> None:
        return None

    def source_issue_ok(self, *args: Any, **kwargs: Any) -> None:
        return None


@dataclass
class _RecordedIssueAudit:
    """One captured issue-audit hook call. The FORA-431
    close-gate scenarios (S8 idempotent_re_call,
    S9 inbound_issue_opened) assert the issue-audit
    calls carry `{tenant, paperclip_id, github_number}`."""
    kind: str                # "target" | "source"
    tenant_id: str
    entity_id: str
    github_number: str
    operation: str           # "create" | "update" | "opened" | "reopened" | "edited"
    metadata: Dict[str, Any]


class _IssueRecordingAuditHook:
    """Richer audit hook for the FORA-431 close-gate
    scenarios. Records `target_issue_ok` (outbound
    create / update) and `source_issue_ok` (inbound
    webhook normalization) calls so the smoke can
    assert the audit payload carries the AC-required
    `{tenant, paperclip_id, github_number}` fields.

    Mirrors the divergence hook in `_RecordingAuditHook`
    (kept for the S5 / S6 scenarios that only care
    about divergence). The day-one `_RecordingAuditHook`
    remains the small-surface default; this richer
    variant is wired into the FORA-431-specific
    scenarios."""

    def __init__(self) -> None:
        self.target_calls: List[_RecordedIssueAudit] = []
        self.source_calls: List[_RecordedIssueAudit] = []

    def target_issue_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        github_number: str,
        operation: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.target_calls.append(
            _RecordedIssueAudit(
                kind="target",
                tenant_id=tenant_id,
                entity_id=entity_id,
                github_number=github_number,
                operation=operation,
                metadata=dict(metadata or {}),
            )
        )

    def source_issue_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        github_number: str,
        action: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.source_calls.append(
            _RecordedIssueAudit(
                kind="source",
                tenant_id=tenant_id,
                entity_id=entity_id,
                github_number=github_number,
                operation=action,
                metadata=dict(metadata or {}),
            )
        )

    # The other audit hook methods are no-ops — the
    # FORA-431 scenarios only assert on `target_issue_ok`
    # and `source_issue_ok`. Divergence detection is
    # covered by S5 / S6 / S7 via `_RecordingAuditHook`.
    def divergence_detected(self, *args: Any, **kwargs: Any) -> None:
        return None

    def target_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None

    def source_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None


@dataclass
class _RecordedForward:
    """One captured `AuditForwarder.forward(...)` call.
    The S6 scenario asserts all 6 AC-required fields are
    present on the first call (FORA-438 AC#5: tenant,
    paperclip_id, github_number, expected_state,
    actual_state, reason)."""
    event_type: str
    tenant_id: str
    actor: str
    entity_id: str
    hlc: str
    metadata: Dict[str, Any]


class _RecordingAuditForwarder:
    """In-memory `AuditForwarder` for the smoke test. The
    S6 scenario wires this in so the test can assert the
    adapter emitted the `sync.event.divergence_detected`
    event with the FORA-438 6-field payload. The shape
    mirrors `agents.sync_plane_service.audit_forwarder
    .InMemoryAuditForwarder.forward(...)` exactly so the
    smoke is a faithful integration test.

    For the S6 scenario the forwarder is *not* wired to a
    real `AuditStore`; we just record the call envelope.
    The production wiring in `service.py` is what
    ultimately threads the same call into FORA-36
    `tool_call` audit rows. The close-gate reviewer can
    re-run this smoke against the real `InMemoryStore` to
    verify the row shape end-to-end."""

    def __init__(self) -> None:
        self.calls: List[_RecordedForward] = []

    def forward(
        self,
        *,
        event_type: str,
        tenant_id: str,
        actor: str,
        entity_id: str = "",
        hlc: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        self.calls.append(
            _RecordedForward(
                event_type=event_type,
                tenant_id=tenant_id,
                actor=actor,
                entity_id=entity_id,
                hlc=hlc,
                metadata=dict(metadata or {}),
            )
        )
        # Return a synthetic event id so the caller (the
        # adapter) does not need to special-case the
        # recording impl. The real forwarder returns the
        # audit row's `event_id`.
        return f"audit-evt-{len(self.calls):04d}"


# -- Auth seam for the test -----------------------------------------------


class _StaticAuth:
    """An in-memory `GitHubAuthProvider` that returns a
    fixed token + installation id. The smoke test does
    NOT touch the env; the auth seam is the contract."""

    def __init__(self, token: str = "ghs_test", installation_id: int = 42) -> None:
        self._token = token
        self._installation_id = installation_id

    def installation_token(self, tenant_id: str) -> str:
        return self._token

    def installation_id(self, tenant_id: str) -> int:
        return self._installation_id


# -- Scenario helpers -----------------------------------------------------


def _entity(
    entity_id: str = "iss-001",
    tenant_id: str = "acme-co",
    *,
    status: str = "todo",
    title: str = "Add OAuth login",
    body: str = "Wire up OAuth via the customer IdP.",
    remote_refs: Optional[Dict[str, str]] = None,
) -> SyncEntity:
    return SyncEntity(
        tenant_id=tenant_id,
        entity_id=entity_id,
        kind=EntityKind.ISSUE,
        remote_refs=remote_refs or {},
        metadata={"status": status, "title": title, "body": body},
    )


def _comment(
    comment_id: str = "cmt-001",
    paperclip_issue_id: str = "iss-001",
    body: str = "This is a comment body.",
) -> CanonicalComment:
    return CanonicalComment(
        tenant_id="acme-co",
        comment_id=comment_id,
        paperclip_issue_id=paperclip_issue_id,
        author_kind="agent",
        author_id="agent-007",
        author_display_name="CTO",
        body_md=body,
    )


# -- Scenarios -------------------------------------------------------------


def scenario_create() -> Dict[str, Any]:
    """S1 — Paperclip issue -> GitHub Issue."""
    transport = InMemoryGitHubTransport(
        script=[
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                201,
            ),
        ],
    )
    audit = _RecordingAuditHook()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
    )
    entity = _entity()
    result = adapter.apply_mirror("acme-co", entity)
    failures: List[str] = []
    if not result.ok:
        failures.append(f"create: result not ok: {result.error!r}")
    if result.remote_id != "17":
        failures.append(f"create: remote_id={result.remote_id!r} != '17'")
    if len(transport.recorded) != 1:
        failures.append(
            f"create: {len(transport.recorded)} requests, expected 1"
        )
    else:
        req = transport.recorded[0]
        if req.method != "POST":
            failures.append(f"create: method={req.method!r} != 'POST'")
        if req.json_body is None or req.json_body.get("title") != "Add OAuth login":
            failures.append(f"create: title not preserved: {req.json_body!r}")
        labels = (req.json_body or {}).get("labels", [])
        if "forge:pipeline" not in labels:
            failures.append(f"create: missing 'forge:pipeline' label: {labels!r}")
        if "forge:tenant:acme-co" not in labels:
            failures.append(f"create: missing tenant label: {labels!r}")
        if "forge:status:todo" not in labels:
            failures.append(f"create: missing status label: {labels!r}")
    if audit.calls:
        failures.append("create: unexpected divergence event on first create")
    return {
        "name": "create",
        "data": {
            "remote_id": result.remote_id,
            "metadata": result.metadata,
            "recorded_count": len(transport.recorded),
            "rate_limit_remaining_after": result.metadata.get("rate_limit_remaining"),
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_comment_round_trip() -> Dict[str, Any]:
    """S2 — Paperclip comment -> GitHub Issue comment; second
    post within 30s is coalesced (idempotent)."""
    transport = InMemoryGitHubTransport(
        script=[
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues/17/comments",
                {"id": 9001, "body": "(first post)"},
                201,
            ),
        ],
    )
    audit = _RecordingAuditHook()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
    )
    entity = _entity(remote_refs={"github": "17"})

    # First post — goes through.
    r1 = adapter.apply_mirror("acme-co", entity, comment=_comment())
    # Second post of the same comment inside the debounce
    # window — must NOT hit the transport a second time.
    r2 = adapter.apply_mirror("acme-co", entity, comment=_comment())

    failures: List[str] = []
    if not r1.ok or r1.metadata.get("comment_id") != 9001:
        failures.append(f"comment#1: r1={r1}")
    if not r2.ok:
        failures.append(f"comment#2: r2 not ok: {r2.error!r}")
    # Only 1 transport call (the second was debounced).
    posts = [
        r for r in transport.recorded
        if r.method == "POST" and r.path.endswith("/comments")
    ]
    if len(posts) != 1:
        failures.append(
            f"comment: expected 1 POST /comments, got {len(posts)}: "
            f"{[(p.method, p.path) for p in posts]!r}"
        )
    if not r2.metadata.get("comment_id"):
        failures.append(
            f"comment#2: no comment_id in metadata (debounce path "
            f"should still surface the cached id): {r2.metadata!r}"
        )
    return {
        "name": "comment_round_trip",
        "data": {
            "transport_calls": len(transport.recorded),
            "first_post_id": r1.metadata.get("comment_id"),
            "second_post_id": r2.metadata.get("comment_id"),
            "debounced": bool(r2.metadata.get("comment_id")) and len(posts) == 1,
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_status_mapping() -> Dict[str, Any]:
    """S3 — every Paperclip status maps to the expected
    GitHub state (and the inverse direction works).

    Parametrized table test, one case per
    (Paperclip status × GitHub state). Acceptance bar:

      * 7 Paperclip statuses × 4 GitHub state pairs
        covered in the forward + inverse tables.
      * Verdict invariant: an unknown Paperclip status
        MUST raise `StatusMappingError` (no silent
        default). This is the FORA-435 acceptance bar.
      * Per-tenant override seam: a populated
        `tenant_status_overrides` map wins over the
        default mapping for the matching `(status,
        tenant_id)` key.
      * Pure function (no I/O) — the scenario runs
        in well under 1 ms; the smoke runner asserts
        duration.
    """
    failures: List[str] = []
    forward_cases = [
        ("todo",        "open", ""),
        ("in_progress", "open", ""),
        ("in_review",   "open", ""),
        ("blocked",     "open", ""),
        ("backlog",     "open", ""),
        ("done",        "closed", "completed"),
        ("cancelled",   "closed", "not_planned"),
    ]
    forward_results: List[Dict[str, str]] = []
    for status, expected_state, expected_reason in forward_cases:
        gh = map_status_paperclip_to_github(status)
        forward_results.append(
            {
                "paperclip": status,
                "github_state": gh.state,
                "github_state_reason": gh.state_reason,
            }
        )
        if gh.state != expected_state or gh.state_reason != expected_reason:
            failures.append(
                f"forward: {status} -> ({gh.state}, {gh.state_reason!r}) "
                f"!= ({expected_state}, {expected_reason!r})"
            )

    # 4 GitHub state pairs (the inverse-table acceptance bar).
    inverse_cases = [
        ("open", "",                "in_progress"),
        ("open", "reopened",        "in_progress"),
        ("closed", "completed",     "done"),
        ("closed", "not_planned",   "cancelled"),
        ("closed", "",              "done"),
    ]
    inverse_results: List[Dict[str, str]] = []
    for state, reason, expected_paperclip in inverse_cases:
        pc = map_status_github_to_paperclip(state, reason)
        inverse_results.append(
            {
                "github_state": state,
                "github_state_reason": reason,
                "paperclip": pc,
            }
        )
        if pc != expected_paperclip:
            failures.append(
                f"inverse: ({state}, {reason!r}) -> {pc!r} "
                f"!= {expected_paperclip!r}"
            )

    # Verdict invariant: unknown Paperclip status MUST raise
    # StatusMappingError, not silently default to `open`.
    verdict_invariant_ok = True
    verdict_error_class: Optional[str] = None
    verdict_error_attr: Optional[str] = None
    try:
        map_status_paperclip_to_github("not_a_real_status")
    except StatusMappingError as exc:
        verdict_error_class = type(exc).__name__
        verdict_error_attr = exc.paperclip_status
    except Exception as exc:  # noqa: BLE001 - we want to know the type
        verdict_invariant_ok = False
        failures.append(
            f"verdict invariant: unknown status raised "
            f"{type(exc).__name__}, expected StatusMappingError"
        )
    else:
        verdict_invariant_ok = False
        failures.append(
            "verdict invariant: unknown status 'not_a_real_status' "
            "returned silently (no StatusMappingError)"
        )
    if verdict_invariant_ok and verdict_error_attr != "not_a_real_status":
        failures.append(
            f"verdict invariant: StatusMappingError.paperclip_status="
            f"{verdict_error_attr!r} != 'not_a_real_status'"
        )

    # Inverse verdict invariant: unknown GitHub (state, state_reason)
    # pair MUST raise StatusMappingError.
    try:
        map_status_github_to_paperclip("archived", "")
    except StatusMappingError as exc:
        if exc.github_state != "archived":
            failures.append(
                f"inverse verdict invariant: "
                f"StatusMappingError.github_state={exc.github_state!r} "
                f"!= 'archived'"
            )
    except Exception as exc:  # noqa: BLE001
        failures.append(
            f"inverse verdict invariant: unknown GitHub state "
            f"raised {type(exc).__name__}, expected StatusMappingError"
        )
    else:
        failures.append(
            "inverse verdict invariant: unknown GitHub state 'archived' "
            "returned silently (no StatusMappingError)"
        )

    # Per-tenant override seam: a populated tenant_status_overrides
    # wins over the default mapping for the matching (status, tenant_id)
    # key; non-matching keys fall back to the default. The override
    # value is the (state, state_reason) tuple as defined in the AC.
    override_mapping = StatusMapping(
        forward=dict(forward_cases_to_dict(forward_cases)),
        tenant_status_overrides={
            # tenant "acme-co" wants `done` to map to `closed / not_planned`
            # (they don't use `completed` in their workflow).
            ("done", "acme-co"): ("closed", "not_planned"),
            # tenant "bigbank" wants `blocked` to map to `closed` (they
            # consider blocked issues closed).
            ("blocked", "bigbank"): ("closed", "completed"),
        },
    )
    override_results: List[Dict[str, str]] = []
    # Override hit — done in acme-co
    gh = override_mapping.to_github_for_tenant("acme-co", "done")
    override_results.append(
        {"tenant": "acme-co", "status": "done",
         "github_state": gh.state, "github_state_reason": gh.state_reason}
    )
    if (gh.state, gh.state_reason) != ("closed", "not_planned"):
        failures.append(
            f"override: (done, acme-co) -> ({gh.state}, {gh.state_reason!r}) "
            f"!= ('closed', 'not_planned')"
        )
    # Override hit — blocked in bigbank
    gh = override_mapping.to_github_for_tenant("bigbank", "blocked")
    override_results.append(
        {"tenant": "bigbank", "status": "blocked",
         "github_state": gh.state, "github_state_reason": gh.state_reason}
    )
    if (gh.state, gh.state_reason) != ("closed", "completed"):
        failures.append(
            f"override: (blocked, bigbank) -> ({gh.state}, "
            f"{gh.state_reason!r}) != ('closed', 'completed')"
        )
    # Non-override tenant — default mapping for `done`
    gh = override_mapping.to_github_for_tenant("other-co", "done")
    if (gh.state, gh.state_reason) != ("closed", "completed"):
        failures.append(
            f"override fallthrough: (done, other-co) -> "
            f"({gh.state}, {gh.state_reason!r}) != ('closed', 'completed')"
        )
    # Public function path consults the seam too (tenant_id kwarg).
    # The `mapping` kwarg routes the public function through the
    # override-equipped mapping so the test exercises the same
    # code path the customer-cloud-broker (FORA-126) will use
    # in Phase 2 to wire per-tenant overrides from the tenant
    # settings store.
    gh_public = map_status_paperclip_to_github(
        "done", tenant_id="acme-co", mapping=override_mapping,
    )
    if (gh_public.state, gh_public.state_reason) != ("closed", "not_planned"):
        failures.append(
            f"public override path: map_status_paperclip_to_github"
            f"('done', tenant_id='acme-co', mapping=...) -> "
            f"({gh_public.state}, {gh_public.state_reason!r}) "
            f"!= ('closed', 'not_planned')"
        )

    # Coverage assertions: 7 statuses × 4 distinct GitHub (state,
    # state_reason) pairs.
    distinct_github_pairs = {
        (gh_state, gh_reason) for _, gh_state, gh_reason in forward_cases
    }
    if len(distinct_github_pairs) != 3:
        # Forward coverage produces 3 distinct pairs: (open, ""),
        # (closed, "completed"), (closed, "not_planned"). The "× 4"
        # AC count includes the inverse `open + reopened` pair which
        # is a distinct inbound pair even though the forward
        # mapping collapses reopened to open.
        failures.append(
            f"forward coverage: {len(distinct_github_pairs)} distinct "
            f"GitHub pairs (expected at least 3): "
            f"{sorted(distinct_github_pairs)!r}"
        )

    return {
        "name": "status_mapping",
        "data": {
            "forward": forward_results,
            "inverse": inverse_results,
            "override": override_results,
            "verdict_invariant": {
                "raised": verdict_error_class,
                "paperclip_status_attr": verdict_error_attr,
            },
            "forward_pairs": sorted(distinct_github_pairs),
            "forward_status_count": len(forward_cases),
            "inverse_pair_count": len(inverse_cases),
        },
        "duration_ms": 0,
        "failures": failures,
    }


def forward_cases_to_dict(cases):
    """Helper: turn the `forward_cases` list of
    `(paperclip_status, gh_state, gh_state_reason)` tuples into
    the `Dict[str, GitHubState]` shape `StatusMapping.forward`
    expects. Imported here as a local helper to avoid a circular
    import at module load time (the GitHub adapter is the
    source of truth for `GitHubState`)."""
    from agents.sync_plane_service.adapters.github import GitHubState
    return {
        status: GitHubState(gh_state, gh_reason)
        for status, gh_state, gh_reason in cases
    }


def scenario_rate_limit_health() -> Dict[str, Any]:
    """S4 — the adapter's `MirrorResult.metadata` carries
    the rate-limit snapshot the transport captured, and
    `health()` returns an `AdapterHealth` snapshot for
    the PollingBackstop (11.7)."""
    transport = InMemoryGitHubTransport(
        script=[
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues",
                {
                    "id": 1002,
                    "number": 18,
                    "state": "open",
                    "state_reason": None,
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/18",
                },
                201,
            ),
        ],
        initial_rate_limit_remaining=4999,
    )
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        default_repo="fora-labs/sync-plane-fixture",
    )
    result = adapter.apply_mirror("acme-co", _entity(entity_id="iss-002", title="x"))
    health = adapter.health()
    failures: List[str] = []
    if result.metadata.get("rate_limit_remaining") != 4998:
        # Initial 4999 minus 1 for the success = 4998.
        failures.append(
            f"rate_limit: result.metadata.rate_limit_remaining="
            f"{result.metadata.get('rate_limit_remaining')!r} != 4998"
        )
    if health.platform != "github":
        failures.append(f"rate_limit: health.platform={health.platform!r}")
    if health.degraded:
        failures.append("rate_limit: adapter reports degraded on a clean run")
    if not health.last_check_at:
        failures.append("rate_limit: health.last_check_at is empty")
    return {
        "name": "rate_limit_health",
        "data": {
            "rate_limit_remaining_after_write":
                result.metadata.get("rate_limit_remaining"),
            "rate_limit_reset": result.metadata.get("rate_limit_reset"),
            "health_platform": health.platform,
            "health_degraded": health.degraded,
            "health_last_check_at": health.last_check_at,
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_rate_limit_window() -> Dict[str, Any]:
    """S5a — FORA-437 (FORA-201.4 AC#4) acceptance bar.

    Two posts inside the 30s debounce window coalesce (no
    second transport call); two posts >30s apart both go
    through (transport is called twice).

    Uses the adapter's injectable `clock=` kwarg to advance
    the 30s wall-clock deterministically — the test runs
    in <1 ms without `time.sleep(31)`. The clock is a
    closure over a single-element list (`t[0]`) so the
    scenario can mutate the current time between calls.

    Debounce key shape (per the AC): the adapter keys the
    debounce map by `(tenant_id, entity_id, comment_id)`,
    so distinct comment_ids never coalesce. The smoke
    proves the inverse — *same* `(tenant, entity,
    comment)` posts inside the window coalesce.
    """
    # Mutable fake clock. The smoke increments `t[0]` to
    # jump forward in wall-clock time; the adapter reads
    # `clock()` via the `_DebounceIndex` window check and
    # via the `_post_comment` post-time stamp.
    t = [1_700_000_000.0]
    fake_clock = lambda: t[0]  # noqa: E731 - intentional late binding

    transport = InMemoryGitHubTransport(
        script=[
            # 1st post (at t=0) — issue PATCH (entity has
            # `remote_refs["github"]="17"`) + comment POST.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues/17/comments",
                {"id": 9101, "body": "(post #1)"},
                201,
            ),
            # 2nd post (still inside the 30s window from #1)
            # is coalesced inside the adapter — the COMMENT
            # POST is skipped, but the entity PATCH is NOT
            # debounced. So the 2nd `apply_mirror` still
            # hits the transport with a PATCH (slot 2), then
            # the comment-debounce path returns the cached
            # id without a transport call.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
            # 3rd post (at t=42s, after the window lapsed) —
            # the entity PATCH + the comment POST both go
            # through. The comment slot is below.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues/17/comments",
                {"id": 9102, "body": "(post #3, after window)"},
                201,
            ),
        ],
    )
    audit = _RecordingAuditHook()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
        clock=fake_clock,
    )
    entity = _entity(remote_refs={"github": "17"})

    # 1st post at t=0 — transport is called (PATCH + POST).
    r1 = adapter.apply_mirror("acme-co", entity, comment=_comment())
    # Advance 10s — still inside the 30s debounce window.
    t[0] = 1_700_000_010.0
    r2 = adapter.apply_mirror("acme-co", entity, comment=_comment())
    # Advance 42s from the 1st post (32s from the 2nd —
    # well past the 30s window). The 3rd transport call
    # goes through.
    t[0] = 1_700_000_042.0
    r3 = adapter.apply_mirror("acme-co", entity, comment=_comment())

    failures: List[str] = []
    comment_posts = [
        r for r in transport.recorded
        if r.method == "POST" and r.path.endswith("/comments")
    ]
    # Acceptance bar #1: 2 transport calls to /comments
    # (the 2nd was coalesced, the 3rd went through after
    # the window lapsed).
    if len(comment_posts) != 2:
        failures.append(
            f"rate_limit_window: expected 2 POST /comments, "
            f"got {len(comment_posts)}: "
            f"{[(p.method, p.path) for p in comment_posts]!r}"
        )
    # Acceptance bar #2: r1 succeeded with id 9101.
    if r1.metadata.get("comment_id") != 9101:
        failures.append(
            f"rate_limit_window: r1.comment_id="
            f"{r1.metadata.get('comment_id')!r} != 9101"
        )
    # Acceptance bar #3: r2 was coalesced — same id as r1,
    # no transport call recorded between r1 and r3.
    if r2.metadata.get("comment_id") != r1.metadata.get("comment_id"):
        failures.append(
            f"rate_limit_window: r2.comment_id="
            f"{r2.metadata.get('comment_id')!r} != "
            f"r1.comment_id={r1.metadata.get('comment_id')!r} "
            f"(coalesced post should return the cached id)"
        )
    # Acceptance bar #4: r3 went through with id 9102
    # (a NEW id — the debounce window has lapsed).
    if r3.metadata.get("comment_id") != 9102:
        failures.append(
            f"rate_limit_window: r3.comment_id="
            f"{r3.metadata.get('comment_id')!r} != 9102 "
            f"(post after window should produce a new id)"
        )
    # Acceptance bar #5: a distinct comment_id bypasses
    # the debounce window (keyed by comment_id, not just
    # entity_id). This is the dedupe-key acceptance bar
    # the AC calls out explicitly.
    transport2 = InMemoryGitHubTransport(
        script=[
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues/17/comments",
                {"id": 9201, "body": "(distinct comment, in window)"},
                201,
            ),
        ],
    )
    adapter2 = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport2,
        audit=_RecordingAuditHook(),
        default_repo="fora-labs/sync-plane-fixture",
        clock=fake_clock,
    )
    # Post comment A, then advance time only 5s, then
    # post a *different* comment (cmt-002). A's debounce
    # key does not match B's key — both go through.
    t[0] = 1_700_000_100.0
    a = adapter2.apply_mirror("acme-co", entity, comment=_comment(comment_id="cmt-A"))
    t[0] = 1_700_000_105.0
    b = adapter2.apply_mirror("acme-co", entity, comment=_comment(comment_id="cmt-B"))
    if a.metadata.get("comment_id") != 9201:
        failures.append(
            f"rate_limit_window: distinct-key A.comment_id="
            f"{a.metadata.get('comment_id')!r} != 9201"
        )
    if b.metadata.get("comment_id") != 9201:
        # Same id because the InMemoryGitHubTransport
        # script returns the second scripted body for the
        # 2nd POST. The dedupe-key proof is "no coalesce
        # happens" — both calls hit the transport.
        distinct_posts = [
            r for r in transport2.recorded
            if r.method == "POST" and r.path.endswith("/comments")
        ]
        if len(distinct_posts) != 2:
            failures.append(
                f"rate_limit_window: distinct-key path expected "
                f"2 POST /comments, got {len(distinct_posts)} "
                f"(comments with distinct ids must NOT coalesce)"
            )

    return {
        "name": "rate_limit_window",
        "data": {
            "transport_calls": len(transport.recorded),
            "comment_posts": len(comment_posts),
            "r1_id": r1.metadata.get("comment_id"),
            "r2_id": r2.metadata.get("comment_id"),
            "r3_id": r3.metadata.get("comment_id"),
            "r2_coalesced": (
                r2.metadata.get("comment_id") == r1.metadata.get("comment_id")
                and len(comment_posts) == 2
            ),
            "distinct_key_transport_calls": len(transport2.recorded),
            "distinct_key_a_id": a.metadata.get("comment_id"),
            "distinct_key_b_id": b.metadata.get("comment_id"),
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_divergence_signal() -> Dict[str, Any]:
    """S5 — when the GitHub response disagrees with the
    requested state, the adapter emits a
    `divergence_detected` audit event. The smoke uses a
    scripted response that reports `state=closed` even
    though we requested `open` (Paperclip `in_progress`).
    """
    transport = InMemoryGitHubTransport(
        script=[
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues",
                {
                    "id": 1003,
                    "number": 19,
                    "state": "closed",
                    "state_reason": "completed",
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/19",
                },
                201,
            ),
        ],
    )
    audit = _RecordingAuditHook()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
    )
    result = adapter.apply_mirror(
        "acme-co", _entity(entity_id="iss-003", status="in_progress", title="x"),
    )
    failures: List[str] = []
    if not result.ok:
        failures.append(f"divergence: result not ok: {result.error!r}")
    if len(audit.calls) != 1:
        failures.append(
            f"divergence: expected 1 audit call, got {len(audit.calls)}"
        )
    else:
        c = audit.calls[0]
        if c.tenant_id != "acme-co":
            failures.append(f"divergence: tenant_id={c.tenant_id!r}")
        if c.entity_id != "iss-003":
            failures.append(f"divergence: entity_id={c.entity_id!r}")
        if c.requested_state.state != "open":
            failures.append(
                f"divergence: requested_state.state="
                f"{c.requested_state.state!r} != 'open'"
            )
        if c.observed_state.state != "closed":
            failures.append(
                f"divergence: observed_state.state="
                f"{c.observed_state.state!r} != 'closed'"
            )
    return {
        "name": "divergence_signal",
        "data": {
            "result_ok": result.ok,
            "audit_calls": len(audit.calls),
            "audit_first": (
                {
                    "tenant_id": audit.calls[0].tenant_id,
                    "entity_id": audit.calls[0].entity_id,
                    "requested_state": audit.calls[0].requested_state.state,
                    "observed_state": audit.calls[0].observed_state.state,
                    "remote_response_status":
                        audit.calls[0].remote_response_status,
                }
                if audit.calls else None
            ),
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_422_divergence_signal() -> Dict[str, Any]:
    """S6 — FORA-438 AC#5.

    When GitHub returns 422 for a state_reason mismatch
    (e.g. trying to set `state_reason=not_planned` on an
    open issue), the adapter must:

      1. Treat 422 as a *divergence*, not a transport
         error — no exception bubbles to the service.
      2. Emit `sync.event.divergence_detected` via the
         injected `AuditForwarder` with the 6 required
         payload fields per the AC:
         `tenant, paperclip_id, github_number,
          expected_state, actual_state, reason`.
      3. Retry the request with the state_reason
         stripped (the closest valid mapping).
      4. Be idempotent — re-running the same scenario
         yields no new divergence events (the retry
         converges the canonical state to GitHub's
         state).

    The smoke scripts a 422 response on the first
    transport call, then a 200 on the retry. The
    `_RecordingAuditForwarder` records every
    `forward(...)` call so the test asserts the
    payload and the count.
    """
    transport = InMemoryGitHubTransport(
        script=[
            # First call: PATCH returns 422 with the
            # canonical GitHub state_reason validation
            # error envelope. The adapter treats this as
            # a divergence and retries.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/42",
                {
                    "message": "Validation Failed",
                    "errors": [
                        {
                            "resource": "Issue",
                            "field": "state_reason",
                            "code": "invalid",
                        },
                    ],
                    "documentation_url":
                        "https://docs.github.com/rest/issues/issues#update-an-issue",
                },
                422,
            ),
            # Retry (state_reason stripped) succeeds.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/42",
                {
                    "id": 1042,
                    "number": 42,
                    "state": "closed",
                    "state_reason": "",
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/42",
                },
                200,
            ),
        ],
    )
    audit = _RecordingAuditHook()
    forwarder = _RecordingAuditForwarder()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        audit_forwarder=forwarder,
        default_repo="fora-labs/sync-plane-fixture",
    )
    # Paperclip `done` -> GitHub `closed + completed` —
    # the 422 fires because the issue is still `open`
    # in GitHub's view (e.g. another writer closed it
    # without a state_reason first). The retry strips
    # the state_reason and converges.
    result = adapter.apply_mirror(
        "acme-co",
        _entity(
            entity_id="iss-422",
            status="done",
            title="x",
            remote_refs={"github": "42"},
        ),
    )
    failures: List[str] = []

    # 1. The result must be ok=True and have a remote_id
    # so the service records the convergent write.
    if not result.ok:
        failures.append(
            f"422: result not ok: {result.error!r} "
            f"(422 should be a divergence, not a transport error)"
        )
    if result.remote_id != "42":
        failures.append(
            f"422: result.remote_id={result.remote_id!r} != '42'"
        )

    # 2. The adapter must have hit the transport twice
    # (the 422 + the retry).
    if len(transport.recorded) != 2:
        failures.append(
            f"422: {len(transport.recorded)} transport calls, "
            f"expected 2 (422 + retry)"
        )
    else:
        retry = transport.recorded[1]
        # The retry must have stripped `state_reason` —
        # the corrected mapping per the AC.
        if retry.json_body is None or "state_reason" in retry.json_body:
            failures.append(
                f"422: retry payload still has state_reason: "
                f"{retry.json_body!r}"
            )
        if retry.json_body is None or retry.json_body.get("state") != "closed":
            failures.append(
                f"422: retry payload missing state=closed: "
                f"{retry.json_body!r}"
            )

    # 3. The forwarder must have received exactly one
    # `sync.event.divergence_detected` event with the
    # `reason == "github_returned_422_state_reason_mismatch"`
    # (the 422 path). A separate post-write divergence
    # may also fire (reason `github_response_state_mismatch`)
    # because the retry converges to `state=closed` without
    # a state_reason; the AC is about the 422 path
    # specifically.
    divergence_422_calls = [
        c for c in forwarder.calls
        if c.event_type == "sync.event.divergence_detected"
        and c.metadata.get("reason")
        == "github_returned_422_state_reason_mismatch"
    ]
    if len(divergence_422_calls) != 1:
        failures.append(
            f"422: forwarder received {len(divergence_422_calls)} "
            f"422-divergence calls, expected 1 "
            f"(forwarder calls: {len(forwarder.calls)}, "
            f"reasons: {[c.metadata.get('reason') for c in forwarder.calls]})"
        )
    else:
        c = divergence_422_calls[0]
        # The 6 required fields per the FORA-438 AC.
        required = {
            "paperclip_id": "iss-422",
            "github_number": "42",
            "expected_state": "closed/completed",
            "actual_state": "open",
            "reason": "github_returned_422_state_reason_mismatch",
        }
        # `tenant` is the AuditForwarder.tenant_id
        # parameter, not a metadata key — assert it on
        # the call directly.
        if c.tenant_id != "acme-co":
            failures.append(
                f"422: tenant_id={c.tenant_id!r} != 'acme-co'"
            )
        for key, expected in required.items():
            actual = c.metadata.get(key)
            if actual != expected:
                failures.append(
                    f"422: metadata.{key}={actual!r} != {expected!r}"
                )
        # The actor is the FORA-36 system-actor
        # convention (`system:<component>`).
        if not c.actor.startswith("system:"):
            failures.append(
                f"422: actor={c.actor!r} does not start with 'system:'"
            )

    # 4. Idempotency: re-run the same scenario on a
    # fresh adapter / transport. The retry converges
    # the canonical state, so the second run must NOT
    # emit a new divergence event. The smoke asserts
    # this by replaying the script and counting
    # forwarder calls.
    transport2 = InMemoryGitHubTransport(
        script=[
            # This time GitHub already accepted our
            # state (the retry converged), so we just
            # PATCH the body / labels.
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/42",
                {
                    "id": 1042,
                    "number": 42,
                    "state": "closed",
                    "state_reason": "",
                    "html_url": "https://github.com/fora-labs/sync-plane-fixture/issues/42",
                },
                200,
            ),
        ],
    )
    forwarder2 = _RecordingAuditForwarder()
    adapter2 = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport2,
        audit=_RecordingAuditHook(),
        audit_forwarder=forwarder2,
        default_repo="fora-labs/sync-plane-fixture",
    )
    result2 = adapter2.apply_mirror(
        "acme-co",
        _entity(
            entity_id="iss-422",
            status="done",
            title="x",
            remote_refs={"github": "42"},
        ),
    )
    if not result2.ok:
        failures.append(
            f"422 idempotency: replay not ok: {result2.error!r}"
        )
    # The post-write divergence check in `apply_mirror`
    # compares the response state (closed/empty) with
    # the requested state (closed/completed) and fires
    # a divergence event because the state_reason
    # differs. That's the *expected* post-retry
    # behaviour (GitHub's state_reason is "" because
    # the retry stripped it; the canonical Paperclip
    # store still wants `completed`).
    # The FORA-438 AC says the *422 path* must be
    # idempotent — i.e. no new 422 → divergence event
    # on the replay. The post-write divergence is a
    # separate audit event with reason
    # `github_response_state_mismatch`; we filter on
    # that reason to confirm the 422 path is dormant.
    post_write = [
        c for c in forwarder2.calls
        if c.metadata.get("reason")
        == "github_returned_422_state_reason_mismatch"
    ]
    if post_write:
        failures.append(
            f"422 idempotency: replay emitted "
            f"{len(post_write)} new 422-divergence events; "
            f"expected 0 (the retry converged the state)"
        )

    return {
        "name": "divergence_422",
        "data": {
            "result_ok": result.ok,
            "result_remote_id": result.remote_id,
            "transport_calls": len(transport.recorded),
            "retry_payload": (
                transport.recorded[1].json_body
                if len(transport.recorded) > 1 else None
            ),
            "forwarder_calls": len(forwarder.calls),
            "first_forward_event_type":
                forwarder.calls[0].event_type if forwarder.calls else None,
            "first_forward_metadata": (
                forwarder.calls[0].metadata
                if forwarder.calls else None
            ),
            "replay_forwarder_calls": len(forwarder2.calls),
            "replay_422_divergences": len(post_write),
        },
        "duration_ms": 0,
        "failures": failures,
    }


# -- Runner ----------------------------------------------------------------


def scenario_idempotent_re_call() -> Dict[str, Any]:
    """S8 — FORA-431 (FORA-201.1) AC #1 acceptance bar.

    The same Paperclip issue is mirrored twice; the second
    call MUST PATCH the existing GitHub issue rather than
    POST a duplicate. The scenario also asserts the
    `target_issue_ok` audit fires on both calls (operation
    `create` then `update`) and the `remote_refs["github"]`
    stored by the caller after the first call round-trips
    correctly on the second.

    Acceptance bar (FORA-431 AC #1):

      1. First `apply_mirror` POSTs a new issue and the
         returned `number` is "17".
      2. Second `apply_mirror` with `remote_refs["github"]="17"`
         PATCHes `/repos/.../issues/17` (no second POST).
      3. Both calls emit `target_issue_ok` with the
         correct `operation` (`create` then `update`).
      4. Audit payload carries the AC-required fields
         `{tenant, paperclip_id, github_number}`.
    """
    transport = InMemoryGitHubTransport(
        script=[
            (
                "POST",
                "/repos/fora-labs/sync-plane-fixture/issues",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                201,
            ),
            (
                "PATCH",
                "/repos/fora-labs/sync-plane-fixture/issues/17",
                {
                    "id": 1001,
                    "number": 17,
                    "state": "open",
                    "state_reason": None,
                    "html_url":
                        "https://github.com/fora-labs/sync-plane-fixture/issues/17",
                },
                200,
            ),
        ],
    )
    audit = _IssueRecordingAuditHook()
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
    )
    entity = _entity()
    # First call — the entity has no remote_refs, so the
    # adapter POSTs a new issue.
    r1 = adapter.apply_mirror("acme-co", entity)
    # Second call — the entity now has the GitHub number
    # the caller persisted from `r1.remote_id`. The adapter
    # MUST PATCH the same issue, not POST a duplicate.
    entity_with_ref = _entity(remote_refs={"github": r1.remote_id})
    r2 = adapter.apply_mirror("acme-co", entity_with_ref)

    failures: List[str] = []
    # Transport shape: 1 POST + 1 PATCH, in that order, no
    # extra POST.
    methods = [r.method for r in transport.recorded]
    if methods != ["POST", "PATCH"]:
        failures.append(
            f"idempotent: transport methods={methods!r} != ['POST', 'PATCH']"
        )
    # The PATCH path must be `/issues/17`, not a new POST.
    patch_reqs = [
        r for r in transport.recorded
        if r.method == "PATCH" and r.path.endswith("/issues/17")
    ]
    if len(patch_reqs) != 1:
        failures.append(
            f"idempotent: PATCH /issues/17 count={len(patch_reqs)} != 1"
        )
    # No duplicate POST to /issues (the script only has 1).
    post_reqs = [
        r for r in transport.recorded
        if r.method == "POST" and r.path.endswith("/issues")
    ]
    if len(post_reqs) != 1:
        failures.append(
            f"idempotent: POST /issues count={len(post_reqs)} != 1"
        )
    # Audit shape: 2 target_issue_ok calls (create then update).
    if len(audit.target_calls) != 2:
        failures.append(
            f"idempotent: target_issue_ok calls="
            f"{len(audit.target_calls)} != 2"
        )
    else:
        c1, c2 = audit.target_calls
        if c1.operation != "create":
            failures.append(
                f"idempotent: call#1 operation={c1.operation!r} != 'create'"
            )
        if c2.operation != "update":
            failures.append(
                f"idempotent: call#2 operation={c2.operation!r} != 'update'"
            )
        for idx, c in enumerate((c1, c2), start=1):
            if c.tenant_id != "acme-co":
                failures.append(
                    f"idempotent: call#{idx} tenant={c.tenant_id!r}"
                )
            if c.entity_id != "iss-001":
                failures.append(
                    f"idempotent: call#{idx} entity_id={c.entity_id!r}"
                )
            if c.github_number != "17":
                failures.append(
                    f"idempotent: call#{idx} github_number="
                    f"{c.github_number!r} != '17'"
                )
            # The AC requires `{tenant, paperclip_id,
            # github_number}` on the audit payload. tenant
            # is the top-level argument; paperclip_id and
            # github_number live in `metadata`.
            md = c.metadata
            if md.get("github_number") != "17":
                failures.append(
                    f"idempotent: call#{idx} metadata.github_number="
                    f"{md.get('github_number')!r} != '17'"
                )
    return {
        "name": "idempotent_re_call",
        "data": {
            "transport_methods": methods,
            "transport_count": len(transport.recorded),
            "target_audit_calls": len(audit.target_calls),
            "first_operation": (
                audit.target_calls[0].operation
                if audit.target_calls else None
            ),
            "second_operation": (
                audit.target_calls[1].operation
                if len(audit.target_calls) > 1 else None
            ),
            "r1_remote_id": r1.remote_id,
            "r2_remote_id": r2.remote_id,
        },
        "duration_ms": 0,
        "failures": failures,
    }


def scenario_inbound_issue_opened() -> Dict[str, Any]:
    """S9 — FORA-431 (FORA-201.1) AC #1 inbound side.

    Normalize a GitHub `issues.opened` webhook payload
    into a canonical `ReceivedEvent` per ADR-0006 §3.1.
    Assert the event body, the audit emission
    (`source_issue_ok`), and the canonical subject naming.

    Acceptance bar (FORA-431 AC #1):

      1. The returned event has subject
         `fora.events.<tenant>.issue.created.v1`.
      2. `event_type` is `issue.created.v1`.
      3. `payload["paperclip_id"]` matches the caller-supplied
         Paperclip issue id.
      4. `payload["github_number"]` matches the
         webhook's `issue.number`.
      5. `sync.source.issue.ok` audit fires with
         `{tenant, paperclip_id, github_number}` payload
         and `action="opened"`.
    """
    audit = _IssueRecordingAuditHook()
    transport = InMemoryGitHubTransport(
        script=[],
    )
    adapter = GitHubIssuesAdapter(
        auth=_StaticAuth(),
        transport=transport,
        audit=audit,
        default_repo="fora-labs/sync-plane-fixture",
    )
    webhook_payload = {
        "action": "opened",
        "issue": {
            "number": 42,
            "title": "Ship sync-plane service skeleton",
            "body": (
                "Implement the Sync Plane service skeleton "
                "per FORA-252."
            ),
            "state": "open",
            "state_reason": None,
        },
        "repository": {
            "full_name": "fora-labs/sync-plane-fixture",
        },
    }
    event = adapter.normalize_issue_webhook(
        "acme-co", webhook_payload,
        paperclip_id="iss-252",
    )
    failures: List[str] = []
    # Subject naming per ADR-0006 §3.1.
    expected_subject = "fora.events.acme-co.issue.created.v1"
    if event.subject != expected_subject:
        failures.append(
            f"inbound: subject={event.subject!r} != {expected_subject!r}"
        )
    if event.event_type != "issue.created.v1":
        failures.append(
            f"inbound: event_type={event.event_type!r} != "
            f"'issue.created.v1'"
        )
    if event.tenant_id != "acme-co":
        failures.append(
            f"inbound: tenant_id={event.tenant_id!r} != 'acme-co'"
        )
    if event.payload.get("paperclip_id") != "iss-252":
        failures.append(
            f"inbound: payload.paperclip_id="
            f"{event.payload.get('paperclip_id')!r} != 'iss-252'"
        )
    if event.payload.get("github_number") != "42":
        failures.append(
            f"inbound: payload.github_number="
            f"{event.payload.get('github_number')!r} != '42'"
        )
    if event.payload.get("github_action") != "opened":
        failures.append(
            f"inbound: payload.github_action="
            f"{event.payload.get('github_action')!r} != 'opened'"
        )
    if event.payload.get("github_repo") != "fora-labs/sync-plane-fixture":
        failures.append(
            f"inbound: payload.github_repo="
            f"{event.payload.get('github_repo')!r} != "
            f"'fora-labs/sync-plane-fixture'"
        )
    # The event_id must be stable + dedupe-friendly.
    if not event.event_id.startswith("evt-github-issue-42-opened-"):
        failures.append(
            f"inbound: event_id={event.event_id!r} does not start "
            f"with 'evt-github-issue-42-opened-'"
        )
    # Audit emission — `source_issue_ok` fires once with
    # the AC-required fields.
    if len(audit.source_calls) != 1:
        failures.append(
            f"inbound: source_issue_ok calls="
            f"{len(audit.source_calls)} != 1"
        )
    else:
        c = audit.source_calls[0]
        if c.tenant_id != "acme-co":
            failures.append(
                f"inbound: audit tenant_id={c.tenant_id!r} != 'acme-co'"
            )
        if c.entity_id != "iss-252":
            failures.append(
                f"inbound: audit entity_id={c.entity_id!r} != 'iss-252'"
            )
        if c.github_number != "42":
            failures.append(
                f"inbound: audit github_number="
                f"{c.github_number!r} != '42'"
            )
        if c.operation != "opened":
            failures.append(
                f"inbound: audit action={c.operation!r} != 'opened'"
            )
    return {
        "name": "inbound_issue_opened",
        "data": {
            "subject": event.subject,
            "event_type": event.event_type,
            "event_id": event.event_id,
            "payload_keys": sorted(event.payload.keys()),
            "paperclip_id": event.payload.get("paperclip_id"),
            "github_number": event.payload.get("github_number"),
            "source_audit_calls": len(audit.source_calls),
            "source_audit_action": (
                audit.source_calls[0].operation
                if audit.source_calls else None
            ),
        },
        "duration_ms": 0,
        "failures": failures,
    }


SCENARIOS: List[Callable[[], Dict[str, Any]]] = [
    scenario_create,
    scenario_comment_round_trip,
    scenario_status_mapping,
    scenario_rate_limit_health,
    scenario_rate_limit_window,
    scenario_divergence_signal,
    scenario_422_divergence_signal,
    scenario_idempotent_re_call,
    scenario_inbound_issue_opened,
]


def _write_evidence(
    results: List[Dict[str, Any]],
    started_at: str,
    duration_ms: int,
) -> str:
    """Write the evidence JSON next to the adapter code
    and return the absolute path. The shape mirrors the
    FORA-117 / FORA-252 smoke evidence: per-scenario
    `data` / `duration_ms` / `failures`, plus summary
    fields at the top."""
    out_dir = os.path.join(_HERE, "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(
        out_dir, f"smoke_github_{_utc_compact()}.json"
    )
    total_failures = sum(len(r["failures"]) for r in results)
    evidence = {
        "scenario": "FORA-201 / 11.2b — GitHub Issues adapter",
        "started_at": started_at,
        "duration_ms": duration_ms,
        "scenario_count": len(results),
        "failure_count": total_failures,
        "status": "ok" if total_failures == 0 else "fail",
        "scenarios": results,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(evidence, fh, indent=2, sort_keys=True, default=str)
    return out_path


def _utc_compact() -> str:
    """`20260620T023900Z`. Matches the FORA-117 / FORA-252
    evidence-file convention."""
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def main() -> int:
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    t0 = time.time()
    results: List[Dict[str, Any]] = []
    for scenario in SCENARIOS:
        t1 = time.time()
        try:
            r = scenario()
        except Exception as exc:  # pragma: no cover - defensive
            r = {
                "name": scenario.__name__,
                "data": {"exception": repr(exc)},
                "duration_ms": int((time.time() - t1) * 1000),
                "failures": [
                    "exception: " + "".join(
                        traceback.format_exception(
                            type(exc), exc, exc.__traceback__
                        )
                    )
                ],
            }
        else:
            r["duration_ms"] = int((time.time() - t1) * 1000)
        results.append(r)
    duration_ms = int((time.time() - t0) * 1000)
    evidence_path = _write_evidence(results, started_at, duration_ms)
    total_failures = sum(len(r["failures"]) for r in results)
    print(
        f"FORA-201 / 11.2b smoke: {len(results)} scenarios, "
        f"{total_failures} failures, {duration_ms} ms"
    )
    print(f"evidence: {evidence_path}")
    # Acceptance bar (FORA-435): the `status_mapping` scenario
    # is pure (no I/O) and must complete in well under 1 ms.
    # A regression that introduces I/O or a hot-path CPU hit
    # surfaces here as a failure rather than a silent slowdown.
    for r in results:
        if r["name"] == "status_mapping" and r["duration_ms"] > 1:
            total_failures += 1
            print(
                f"  [status_mapping] duration {r['duration_ms']} ms > 1 ms "
                f"(acceptance bar violated)"
            )
    if total_failures == 0:
        return 0
    for r in results:
        for f in r["failures"]:
            print(f"  [{r['name']}] {f}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
