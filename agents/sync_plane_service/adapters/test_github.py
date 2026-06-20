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
from agents.sync_plane_service.adapters._test_transport import (  # noqa: E402
    InMemoryGitHubTransport,
)
from agents.sync_plane_service.schema import (  # noqa: E402
    CanonicalComment,
    EntityKind,
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


# -- Runner ----------------------------------------------------------------


SCENARIOS: List[Callable[[], Dict[str, Any]]] = [
    scenario_create,
    scenario_comment_round_trip,
    scenario_status_mapping,
    scenario_rate_limit_health,
    scenario_divergence_signal,
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
