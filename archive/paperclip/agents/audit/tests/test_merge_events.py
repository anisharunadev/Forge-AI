"""
AC for Phase 3 §D (FORA-495): the Audit reader exposes a chronological
block/clear log per run, and the new REJECTED_MERGE / CLEARED_MERGE event
types round-trip through the store with the merge-block metadata contract.

Both event kinds are emitted by the merge-block evaluator (the DevOps
stage owns the v1 evaluator per FORA-394 §8).  The Audit reader is the
join surface; this test pins the surface so a refactor cannot drop the
fields without a test failure.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.audit import (  # noqa: E402
    AuditReader,
    AuditEvent,
    InMemoryStore,
    MERGE_BLOCK_EVENT_TYPES,
    MERGE_BLOCK_METADATA_KEYS,
    merge_block_metadata,
)
from agents.audit.schema import AuditEventType  # noqa: E402


TENANT = "tenant-fora"
RUN_ID = "run-2026-06-20-001"


def _build_store() -> InMemoryStore:
    """Build a store with one REJECTED_MERGE and one CLEARED_MERGE event
    for the same run, plus a non-merge boundary event that must be
    filtered out by `merge_block_log`."""
    store = InMemoryStore()
    # boundary (not a merge event)
    store.append(
        AuditEvent(
            event_id="evt-boundary",
            run_id=RUN_ID,
            agent_id="agent:devops",
            tenant_id=TENANT,
            stage="devops",
            tool="noop",
            event_type=AuditEventType.RUN_STARTED,
        )
    )
    # REJECTED_MERGE for security.finding.high
    store.append(
        AuditEvent(
            event_id="evt-reject-1",
            run_id=RUN_ID,
            agent_id="agent:devops",
            tenant_id=TENANT,
            stage="devops",
            tool="merge_block_evaluator",
            event_type=AuditEventType.REJECTED_MERGE,
            metadata=merge_block_metadata(
                rule_id="security.finding.high",
                clear_url="https://paperclip.local/approvals/app-1",
                clear_role="security_lead",
                clear_sla_hours=4.0,
            ),
        )
    )
    # CLEARED_MERGE for the same rule
    store.append(
        AuditEvent(
            event_id="evt-clear-1",
            run_id=RUN_ID,
            agent_id="agent:devops",
            tenant_id=TENANT,
            stage="devops",
            tool="merge_block_clear",
            event_type=AuditEventType.CLEARED_MERGE,
            actor="user:cto",
            metadata=merge_block_metadata(
                rule_id="security.finding.high",
                clear_url="https://paperclip.local/approvals/app-1",
                clear_role="security_lead",
                clear_sla_hours=4.0,
            ),
        )
    )
    return store


# -- AC: enum surface --------------------------------------------------------

def test_merge_block_event_types_constant_covers_both_kinds() -> None:
    assert MERGE_BLOCK_EVENT_TYPES == (
        "artifact.rejected.merge",
        "artifact.cleared.merge",
    )


def test_metadata_keys_contract_is_stable() -> None:
    # The four metadata keys are the contract; do not rename without
    # bumping AUDIT_SCHEMA_VERSION and updating FORA-495.
    assert MERGE_BLOCK_METADATA_KEYS == (
        "ruleId", "clearUrl", "clearRole", "clearSlaHours",
    )


def test_enum_carries_both_merge_kinds() -> None:
    assert AuditEventType.REJECTED_MERGE.value == "artifact.rejected.merge"
    assert AuditEventType.CLEARED_MERGE.value == "artifact.cleared.merge"


# -- AC: helper builds the right shape ---------------------------------------

def test_merge_block_metadata_helper_uses_camelcase_keys() -> None:
    md = merge_block_metadata(
        rule_id="qa.test.verdict.fail",
        clear_url="https://paperclip.local/x",
        clear_role="qa_lead",
        clear_sla_hours=4,
    )
    assert md == {
        "ruleId": "qa.test.verdict.fail",
        "clearUrl": "https://paperclip.local/x",
        "clearRole": "qa_lead",
        "clearSlaHours": 4.0,
    }


# -- AC: round-trip through to_dict (canonical form) -------------------------

def test_rejected_merge_to_dict_carries_metadata() -> None:
    ev = AuditEvent(
        event_id="evt-r",
        run_id=RUN_ID,
        agent_id="agent:devops",
        tenant_id=TENANT,
        stage="devops",
        tool="merge_block_evaluator",
        event_type=AuditEventType.REJECTED_MERGE,
        metadata=merge_block_metadata(
            rule_id="secrets.detected",
            clear_url="https://paperclip.local/s",
            clear_role="security_lead",
            clear_sla_hours=0.0,
        ),
    )
    d = ev.to_dict()
    assert d["eventType"] == "artifact.rejected.merge"
    assert d["runId"] == RUN_ID
    assert d["metadata"]["ruleId"] == "secrets.detected"
    assert d["metadata"]["clearRole"] == "security_lead"
    assert d["metadata"]["clearSlaHours"] == 0.0


# -- AC: merge_block_log surfaces a chronological block/clear log ------------

def test_merge_block_log_returns_chronological_block_clear() -> None:
    store = _build_store()
    reader = AuditReader(store)
    log = reader.merge_block_log(TENANT, RUN_ID)
    assert len(log) == 2, f"expected 2 merge events, got {len(log)}"
    # chronological order — REJECTED then CLEARED
    assert log[0]["kind"] == "artifact.rejected.merge"
    assert log[1]["kind"] == "artifact.cleared.merge"
    assert log[0]["eventId"] == "evt-reject-1"
    assert log[1]["eventId"] == "evt-clear-1"
    # metadata surfaces
    assert log[0]["ruleId"] == "security.finding.high"
    assert log[0]["clearRole"] == "security_lead"
    assert log[0]["clearSlaHours"] == 4.0
    assert log[0]["runId"] == RUN_ID


def test_merge_block_log_filters_out_non_merge_events() -> None:
    store = _build_store()
    reader = AuditReader(store)
    log = reader.merge_block_log(TENANT, RUN_ID)
    # RUN_STARTED is in the store but must not appear
    assert all("RUN_STARTED" not in str(e) for e in log)
    assert all(entry["kind"] in MERGE_BLOCK_EVENT_TYPES for entry in log)


def test_merge_block_log_tenant_isolation() -> None:
    store = _build_store()
    reader = AuditReader(store)
    # Same run_id, different tenant → empty.
    assert reader.merge_block_log("tenant-other", RUN_ID) == []


def test_merge_block_log_empty_for_run_without_merge_events() -> None:
    store = InMemoryStore()
    store.append(
        AuditEvent(
            event_id="evt-only",
            run_id="run-without-merge",
            agent_id="agent:devops",
            tenant_id=TENANT,
            stage="devops",
            tool="noop",
            event_type=AuditEventType.RUN_STARTED,
        )
    )
    reader = AuditReader(store)
    assert reader.merge_block_log(TENANT, "run-without-merge") == []


# -- AC: persisted file round-trip keeps merge-block metadata --------------

def test_audit_file_roundtrip_preserves_merge_metadata() -> None:
    import tempfile
    import json
    from agents.audit.store import _from_dict  # type: ignore
    from agents.audit.schema import canonical_json  # type: ignore

    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "audit.jsonl")
        store = InMemoryStore(path=path)
        ev = AuditEvent(
            event_id="evt-roundtrip",
            run_id=RUN_ID,
            agent_id="agent:devops",
            tenant_id=TENANT,
            stage="devops",
            tool="merge_block_evaluator",
            event_type=AuditEventType.REJECTED_MERGE,
            metadata=merge_block_metadata(
                rule_id="dependency.high_cve",
                clear_url="https://paperclip.local/d",
                clear_role="security_lead",
                clear_sla_hours=4.0,
            ),
        )
        store.append(ev)
        store.flush()

        # Re-read the file as a fresh InMemoryStore
        store2 = InMemoryStore(path=path)
        rehydrated = store2.all()
        assert len(rehydrated) == 1
        r = rehydrated[0]
        assert r.event_type == AuditEventType.REJECTED_MERGE
        assert r.metadata["ruleId"] == "dependency.high_cve"
        assert r.metadata["clearRole"] == "security_lead"
        # canonical line on disk must include metadata
        with open(path, "r", encoding="utf-8") as fp:
            line = fp.readline().strip()
        d = json.loads(line)
        assert d["eventType"] == "artifact.rejected.merge"
        assert d["metadata"]["ruleId"] == "dependency.high_cve"