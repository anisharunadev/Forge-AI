"""
AC1: every tool call emits exactly one audit event with the
correct schema (issue body, verbatim field names).

The test exercises the emit helpers directly against an
`InMemoryStore`, plus a round-trip through the on-disk JSONL
file to prove the persistence contract.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.audit import (  # noqa: E402
    AUDIT_SCHEMA_VERSION,
    InMemoryStore,
    canonical_json,
    digest_of,
    emit_run_finished,
    emit_run_started,
    emit_tool_call,
)
from agents.audit.schema import AuditEventType  # noqa: E402


REQUIRED_FIELDS = (
    "runId", "agentId", "tenantId", "stage", "tool",
    "inputDigest", "outputDigest", "costCents",
    "promptTokens", "completionTokens", "wallMs",
)


def _scenario_one_tool_call_emits_one_event() -> tuple[dict, list[str]]:
    """AC1 (single tool call): one emit, one event, all required
    fields populated."""
    store = InMemoryStore()
    ev = emit_tool_call(
        store,
        run_id="run-1", agent_id="agent-1", tenant_id="tenant-1",
        stage="act", tool="noop",
        arguments={"i": 1},
        output={"result": "ok"},
        cost_cents=4,
        prompt_tokens=10, completion_tokens=5,
        wall_ms=42.0,
        call_id="call-abc",
        step_id="s1",
        idempotency_key="idem-1",
    )
    failures: list[str] = []
    if len(store.all()) != 1:
        failures.append(f"expected 1 event, got {len(store.all())}")
    d = ev.to_dict()
    for field in REQUIRED_FIELDS:
        if field not in d:
            failures.append(f"required field {field!r} missing from event")
    # Spot-check a few values.
    if d.get("runId") != "run-1":
        failures.append(f"runId={d.get('runId')!r}, expected 'run-1'")
    if d.get("agentId") != "agent-1":
        failures.append(f"agentId={d.get('agentId')!r}, expected 'agent-1'")
    if d.get("tenantId") != "tenant-1":
        failures.append(f"tenantId={d.get('tenantId')!r}, expected 'tenant-1'")
    if d.get("costCents") != 4:
        failures.append(f"costCents={d.get('costCents')!r}, expected 4")
    if d.get("promptTokens") != 10 or d.get("completionTokens") != 5:
        failures.append("token counts not preserved")
    if d.get("wallMs") != 42.0:
        failures.append(f"wallMs={d.get('wallMs')!r}, expected 42.0")
    # Digests must be 64-char hex SHA-256.
    if not (isinstance(d.get("inputDigest"), str) and len(d["inputDigest"]) == 64):
        failures.append(f"inputDigest not a hex sha256: {d.get('inputDigest')!r}")
    if not (isinstance(d.get("outputDigest"), str) and len(d["outputDigest"]) == 64):
        failures.append(f"outputDigest not a hex sha256: {d.get('outputDigest')!r}")
    if d.get("schemaVersion") != AUDIT_SCHEMA_VERSION:
        failures.append(f"schemaVersion={d.get('schemaVersion')!r}, expected {AUDIT_SCHEMA_VERSION!r}")
    if d.get("eventType") != "tool_call":
        failures.append(f"eventType={d.get('eventType')!r}, expected 'tool_call'")
    return d, failures


def _scenario_boundary_events_chain() -> tuple[dict, list[str]]:
    """AC1 (boundaries): a run-started and run-finished bracket a
    tool call, all three on the same (tenant, run) chain."""
    store = InMemoryStore()
    rs = emit_run_started(
        store, run_id="run-2", agent_id="agent-2", tenant_id="tenant-2",
        actor="user:alice",
    )
    ev = emit_tool_call(
        store, run_id="run-2", agent_id="agent-2", tenant_id="tenant-2",
        stage="act", tool="noop", arguments={}, output={},
        cost_cents=1, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
    )
    rf = emit_run_finished(
        store, run_id="run-2", agent_id="agent-2", tenant_id="tenant-2",
        status="succeeded", cost_cents=1, prompt_tokens=1,
        completion_tokens=1, wall_ms=1.0,
    )
    failures: list[str] = []
    if len(store.all()) != 3:
        failures.append(f"expected 3 events, got {len(store.all())}")
    if rs.event_type != AuditEventType.RUN_STARTED:
        failures.append(f"first event type {rs.event_type.value!r}, expected 'run_started'")
    if ev.event_type != AuditEventType.TOOL_CALL:
        failures.append(f"middle event type {ev.event_type.value!r}, expected 'tool_call'")
    if rf.event_type != AuditEventType.RUN_FINISHED:
        failures.append(f"last event type {rf.event_type.value!r}, expected 'run_finished'")
    # Each event must reference the same run_id.
    for i, e in enumerate(store.all()):
        if e.run_id != "run-2":
            failures.append(f"event {i} run_id={e.run_id!r}, expected 'run-2'")
    return {"eventCount": len(store.all())}, failures


def _scenario_disk_persistence_roundtrip() -> tuple[dict, list[str]]:
    """AC1 (persistence): events written to the JSONL file can be
    reloaded into a fresh store and the chain head is restored."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "audit.jsonl")
        s1 = InMemoryStore(path=path)
        for i in range(5):
            emit_tool_call(
                s1, run_id="run-3", agent_id="agent-3", tenant_id="tenant-3",
                stage="act", tool=f"tool_{i}", arguments={"i": i},
                output={"ok": i}, cost_cents=i, prompt_tokens=i,
                completion_tokens=i, wall_ms=float(i),
            )
        s1.flush()
        # Replay into a fresh store.
        s2 = InMemoryStore(path=path)
        evs = s2.list_for_run("tenant-3", "run-3")
        failures: list[str] = []
        if len(evs) != 5:
            failures.append(f"replay returned {len(evs)} events, expected 5")
        # Chain head must be preserved.
        if s2._heads.get(("tenant-3", "run-3"), "") != evs[-1].record_hash:
            failures.append("chain head not restored on reload")
        return {"replayed": len(evs)}, failures


def _scenario_canonical_json_is_stable() -> tuple[dict, list[str]]:
    """AC1 (canonical form): the same logical payload serialises to
    the same bytes regardless of insertion order.  This is the
    property the hash chain depends on.  We compare `canonical_json`
    on dicts (which is what the chain actually hashes) rather than
    on full events (which carry time-dependent event_id and
    timestamp that are not part of the canonical content)."""
    failures: list[str] = []
    if canonical_json({"b": 2, "a": 1}) != canonical_json({"a": 1, "b": 2}):
        failures.append("canonical_json not stable across key orderings")
    if digest_of({"a": 1}) != digest_of({"a": 1}):
        failures.append("digest_of not stable")
    if digest_of({"a": 1}) == digest_of({"a": 2}):
        failures.append("digest_of collides on different payloads")
    return {"stable": True}, failures


def main() -> int:
    print("=" * 72)
    print("Audit system — test_emit (FORA-36 AC1: schema, one-event-per-call)")
    print("=" * 72)
    scenarios = [
        ("AC1 one tool call emits one event with the correct schema",
         _scenario_one_tool_call_emits_one_event),
        ("AC1 boundary events chain on the (tenant, run) pair",
         _scenario_boundary_events_chain),
        ("AC1 disk persistence round-trip preserves the chain head",
         _scenario_disk_persistence_roundtrip),
        ("AC1 canonical JSON is stable across key orderings",
         _scenario_canonical_json_is_stable),
    ]
    evidence: dict = {"scenarios": {}}
    all_failures: list[str] = []
    for name, fn in scenarios:
        print(f"\n[{name}]")
        try:
            data, failures = fn()
        except Exception as exc:  # noqa: BLE001
            failures = [f"scenario raised: {exc!r}"]
            data = {"error": str(exc)}
        evidence["scenarios"][name] = data
        if failures:
            for f in failures:
                print(f"  FAIL: {f}")
                all_failures.append(f"{name}: {f}")
        else:
            print("  OK")
    out_dir = os.path.join(ROOT, "agents", "audit", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "test_emit.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2, default=str)
    print(f"\nEvidence: {out_path}")
    print("=" * 72)
    if all_failures:
        print("FAIL")
        return 1
    print("OK: emit contract holds (schema, one-per-call, boundaries, persistence, canonical form)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
