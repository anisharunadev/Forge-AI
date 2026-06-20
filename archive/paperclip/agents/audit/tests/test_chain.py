"""
Hash chain tests (FORA-36 AC: "Hash-chained records so tampering
is detectable.").

Acceptance: a clean chain verifies; any post-hoc edit to a
historical event surfaces as a `ChainBreak` with the right
reason.  The admin path emits a synthetic `event_redacted` event
so the head continues to advance.
"""

from __future__ import annotations

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.audit import (  # noqa: E402
    AuditAdmin,
    GENESIS_HASH,
    HashChain,
    InMemoryStore,
    emit_tool_call,
)
from agents.audit.schema import AuditEvent  # noqa: E402


def _chain_of(n: int, *, tenant: str = "t", run: str = "r",
              agent: str = "a") -> list[AuditEvent]:
    store = InMemoryStore()
    for i in range(n):
        emit_tool_call(
            store, run_id=run, agent_id=agent, tenant_id=tenant,
            stage="act", tool=f"tool_{i}",
            arguments={"i": i}, output={"ok": i},
            cost_cents=i, prompt_tokens=i, completion_tokens=i,
            wall_ms=float(i),
        )
    return store.list_for_run(tenant, run)


def _scenario_clean_chain_verifies() -> tuple[dict, list[str]]:
    events = _chain_of(5)
    ok, breaks = HashChain.verify(events)
    failures: list[str] = []
    if not ok:
        failures.append(f"clean chain failed verification: {breaks}")
    if breaks:
        failures.append(f"clean chain reported {len(breaks)} breaks")
    return {"events": len(events), "ok": ok}, failures


def _scenario_first_event_uses_genesis() -> tuple[dict, list[str]]:
    events = _chain_of(3)
    failures: list[str] = []
    if events[0].prev_hash != GENESIS_HASH:
        failures.append(
            f"first event prev_hash={events[0].prev_hash!r}, expected GENESIS_HASH"
        )
    for i in range(1, len(events)):
        if events[i].prev_hash != events[i-1].record_hash:
            failures.append(
                f"event {i} prev_hash={events[i].prev_hash!r}, "
                f"expected {events[i-1].record_hash!r}"
            )
    return {"genesis_used": events[0].prev_hash == GENESIS_HASH}, failures


def _scenario_tamper_digest_detected() -> tuple[dict, list[str]]:
    """AC: tampering is detectable.  Mutating an event's
    `prompt_tokens` (a content field) must surface as a
    `self_hash_mismatch` break, because the recomputed hash no
    longer matches the stored `record_hash`."""
    events = _chain_of(4)
    # Tamper with event 2 (third event).
    tampered = copy.deepcopy(events[2])
    tampered.prompt_tokens += 1
    # Re-compute its prev_hash from event 1 (unchanged), but the
    # record_hash on `tampered` is the original; the verifier must
    # notice the self-hash mismatch.
    tampered.prev_hash = events[1].record_hash
    events[2] = tampered
    ok, breaks = HashChain.verify(events)
    failures: list[str] = []
    if ok:
        failures.append("verification passed despite tampered content")
    if not any(b.reason == "self_hash_mismatch" and b.index == 2 for b in breaks):
        failures.append(
            f"expected self_hash_mismatch at index 2, got {[(b.reason, b.index) for b in breaks]}"
        )
    return {"breaks": len(breaks), "ok": ok}, failures


def _scenario_tamper_chain_link_detected() -> tuple[dict, list[str]]:
    """AC: reordering or rewiring the chain is detected.  Swapping
    the `prev_hash` of an event surfaces as a
    `prev_hash_mismatch` break."""
    events = _chain_of(4)
    swapped = copy.deepcopy(events[2])
    swapped.prev_hash = GENESIS_HASH  # wrong; the real prev is events[1].record_hash
    events[2] = swapped
    ok, breaks = HashChain.verify(events)
    failures: list[str] = []
    if ok:
        failures.append("verification passed despite broken chain link")
    if not any(b.reason == "prev_hash_mismatch" and b.index == 2 for b in breaks):
        failures.append(
            f"expected prev_hash_mismatch at index 2, got {[(b.reason, b.index) for b in breaks]}"
        )
    return {"breaks": len(breaks), "ok": ok}, failures


def _scenario_admin_redaction_continues_chain() -> tuple[dict, list[str]]:
    """AC: "Deleting/editing an audit record requires explicit
    admin override and itself emits an audit record."  The admin
    path appends synthetic events so the head always advances."""
    store = InMemoryStore()
    for i in range(3):
        emit_tool_call(
            store, run_id="r", agent_id="a", tenant_id="t",
            stage="act", tool=f"t{i}", arguments={}, output={},
            cost_cents=0, prompt_tokens=0, completion_tokens=0, wall_ms=0.0,
        )
    target = store.list_for_run("t", "r")[1].event_id
    admin = AuditAdmin(store)
    override = admin.redact(
        tenant_id="t", run_id="r", target_event_id=target,
        actor="admin:alice@example.com",
        reason="PII mistakenly logged in tool arguments",
    )
    events = store.list_for_run("t", "r")
    ok, breaks = HashChain.verify(events)
    failures: list[str] = []
    if not ok:
        failures.append(f"chain broken after admin override: {breaks}")
    if len(events) != 5:  # 3 original + redacted-synth + admin-override-synth
        failures.append(f"expected 5 events after override, got {len(events)}")
    if override.event.metadata.get("action") != "redact":
        failures.append("admin override event missing 'action' metadata")
    if override.event.metadata.get("targetEventId") != target:
        failures.append("admin override event missing targetEventId")
    # The synthetic event_redacted must carry the target id.
    redacted = [e for e in events if e.event_type.value == "event_redacted"]
    if len(redacted) != 1:
        failures.append(f"expected 1 event_redacted, got {len(redacted)}")
    if redacted and redacted[0].metadata.get("redactedEventId") != target:
        failures.append("event_redacted missing redactedEventId")
    return {"afterOverride": len(events), "ok": ok}, failures


def main() -> int:
    print("=" * 72)
    print("Audit system — test_chain (FORA-36: hash chain + tamper detection)")
    print("=" * 72)
    scenarios = [
        ("AC clean chain verifies end-to-end", _scenario_clean_chain_verifies),
        ("AC first event prev_hash is GENESIS, links are valid",
         _scenario_first_event_uses_genesis),
        ("AC tampered content -> self_hash_mismatch break",
         _scenario_tamper_digest_detected),
        ("AC broken chain link -> prev_hash_mismatch break",
         _scenario_tamper_chain_link_detected),
        ("AC admin override continues the chain (redact + admin_override events)",
         _scenario_admin_redaction_continues_chain),
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
    out_path = os.path.join(out_dir, "test_chain.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2, default=str)
    print(f"\nEvidence: {out_path}")
    print("=" * 72)
    if all_failures:
        print("FAIL")
        return 1
    print("OK: hash chain detects content tampering, link tampering, "
          "and survives admin override")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
