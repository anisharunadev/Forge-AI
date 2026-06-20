"""
FORA-210 — Daily audit sample acceptance tests.

These tests exercise the sample against a stub mirror plane
(`InMemoryMirrorPlane`) and a stub credential inventory
(`InMemoryCredentialInventory`).  They cover the five verifier
invariants from `forge/sync-plane/risk_register.md` §7.2:

  1. Completeness       — P0 if audit count != platform count.
  2. Schema             — P0 if any required `metadata.sync.*` key missing.
  3. Per-tenant ns      — P0 if `tenantId != metadata.sync.authored_for_tenant`.
  4. Actor              — P0 if `actor_type` invalid or four-field invariant broken.
  5. Credential         — P0 if `platform_credential_ref` unknown or rotation overdue.

Plus:
  - Happy path: 10/10 complete, no P0s, sample event emitted with
    the §7 metadata.sync.* block.
  - Small-tenant cohort: <10 runs → exhaustive sample + flag.
  - Empty pool: 0 runs → report with completeness=1.0 (vacuous).
  - On-P0 callback fires for every P0 finding.

Each scenario prints OK or FAIL and the suite writes an evidence
JSON to `agents/audit/evidence/test_sample.json`.

Imports sample.py directly so the test doesn't depend on the
audit package's `__init__.py` re-exporting the sample symbols —
the sample module owns its own contract.
"""

from __future__ import annotations

import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

# Core audit types from the package (stable, shipped).
from agents.audit import AuditEvent, AuditEventType, InMemoryStore  # noqa: E402

# Sample module — imported directly, not via the package __init__,
# so this test is decoupled from any re-export churn there.
from agents.audit.sample import (  # noqa: E402
    SYNC_REQUIRED_KEYS,
    InMemoryCredentialInventory,
    InMemoryMirrorPlane,
    daily_audit_sample,
)


def _good_sync(target_platform: str = "jira", tenant_id: str = "tenant-a",
               actor_type: str = "agent") -> dict:
    """A well-formed `metadata.sync.*` block per
    `forge/sync-plane/risk_register.md` §6."""
    return {
        "sync.target_platform": target_platform,
        "sync.mirror_event_type": "issue_update",
        "sync.query_hash": "sha256:" + "a" * 64,
        "sync.response_hash": "sha256:" + "b" * 64,
        "sync.latency_ms": 412,
        "sync.cost_usd": 0.0,
        "sync.actor_type": actor_type,
        "sync.actor_id": "agent:dev-1",
        "sync.authored_for_tenant": tenant_id,
        "sync.rendered_as": "service-account:fora-sync@tenant-a",
        "sync.idempotency_key": "sha256:" + "c" * 64,
        "sync.platform_region": "us-east-1",
        "sync.platform_credential_ref": "arn:aws:secretsmanager:us-east-1:111:secret:tenant-a/jira",
        "sync.platform_response_code": 200,
    }


def _seed_pair(store, mirror, credentials, *, tenant_id: str, run_id: str,
               target_platform: str, sync=None, audit_count: int = 1,
               platform_count: int = 1) -> None:
    """Plant a (run_id, target_platform) pair: `audit_count` audit
    events + `platform_count` platform records.  Both default to 1
    (the happy path); flip either to assert completeness gaps."""
    sync = sync if sync is not None else _good_sync(target_platform=target_platform, tenant_id=tenant_id)
    mirror.add_run(tenant_id, run_id, target_platform)
    for i in range(platform_count):
        mirror.add_record(tenant_id, run_id, target_platform, {"id": f"{target_platform}-{i}"})
    for i in range(audit_count):
        ev_sync = dict(sync)
        ev_sync["sync.idempotency_key"] = f"sha256:{'d' * 60}{i:04d}"
        # The runtime's `emit_tool_call` doesn't accept `metadata`
        # in v0.1, so build the AuditEvent directly.  This is the
        # same shape the runtime uses (FORA-36 FORA-204 seam fix),
        # and it threads the sync.* keys onto the event's
        # `metadata` field where the sample reads them.
        ev = AuditEvent(
            event_id="",
            event_type=AuditEventType.TOOL_CALL,
            run_id=run_id,
            agent_id="agent-dev",
            tenant_id=tenant_id,
            stage="sync_plane",
            tool=f"{target_platform}.mirror_issue_update",
            input_digest="sha256:" + "0" * 64,
            output_digest="sha256:" + "1" * 64,
            cost_cents=0,
            prompt_tokens=0,
            completion_tokens=0,
            wall_ms=10.0,
            metadata=ev_sync,
        )
        store.append(ev)


def _make_store_with_credentials() -> tuple:
    """Standard test fixtures: a populated credential inventory
    that accepts every credential we use by default.  Covers
    `tenant-a`, `tenant-tiny`, `tenant-empty`, and any other test
    tenant by adding the matching secret ARN per tenant."""
    creds = InMemoryCredentialInventory()
    for tenant in ("tenant-a", "tenant-tiny", "tenant-empty"):
        creds.add(tenant, "arn:aws:secretsmanager:us-east-1:111:secret:tenant-a/jira",
                  rotation_due=True)
        creds.add(tenant, "arn:aws:secretsmanager:us-east-1:111:secret:tenant-a/github",
                  rotation_due=True)
        creds.add(tenant, "arn:aws:secretsmanager:us-east-1:111:secret:tenant-a/clipup",
                  rotation_due=True)
    return creds


# -- scenario ---------------------------------------------------------------


def _scenario_happy_path() -> tuple:
    """AC #4 baseline: 10 runs, all complete, no P0s, sample event
    emitted with `eventType = sample_run_complete` and
    `tool = audit.daily_sample`."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    for i in range(10):
        target = ("jira", "github", "clipup")[i % 3]
        _seed_pair(store, mirror, creds,
                   tenant_id="tenant-a",
                   run_id=f"run-{i:02d}",
                   target_platform=target)

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-tenant-a-fixed",
        rng=random.Random(42),
    )

    failures: list[str] = []
    if not report.is_complete:
        failures.append(f"expected is_complete=True; report={report!r}")
    if report.completeness_rate != 1.0:
        failures.append(f"completeness_rate={report.completeness_rate}, expected 1.0")
    if report.sampled_pairs != 10:
        failures.append(f"sampled_pairs={report.sampled_pairs}, expected 10")
    if report.p0_count != 0:
        failures.append(f"p0_count={report.p0_count}, expected 0; findings={report.findings!r}")
    if p0_fired:
        failures.append(f"on_p0 fired {len(p0_fired)} times on a clean run: {p0_fired!r}")

    # The sample event itself must be in the store with the right shape.
    sample_events = [
        ev for ev in store.all()
        if ev.event_type == AuditEventType.SAMPLE_RUN_COMPLETE
    ]
    if len(sample_events) != 1:
        failures.append(f"expected 1 sample_run_complete event, got {len(sample_events)}")
    if sample_events:
        ev = sample_events[0]
        d = ev.to_dict()
        if d.get("eventType") != "sample_run_complete":
            failures.append(f"eventType={d.get('eventType')!r}, expected 'sample_run_complete'")
        if d.get("tool") != "audit.daily_sample":
            failures.append(f"tool={d.get('tool')!r}, expected 'audit.daily_sample'")
        if d.get("tenantId") != "tenant-a":
            failures.append(f"tenantId={d.get('tenantId')!r}, expected 'tenant-a'")
        md = d.get("metadata") or {}
        for key in ("sync.sample_n", "sync.completeness_rate", "sync.p0_count",
                    "sync.findings", "sync.tool"):
            if key not in md:
                failures.append(f"sample event metadata missing {key!r}")
        if md.get("sync.tool") != "audit.daily_sample":
            failures.append(f"sample metadata.sync.tool={md.get('sync.tool')!r}")

    return {"sampled": report.sampled_pairs, "completeness": report.completeness_rate,
            "p0": report.p0_count, "sampleEvents": len(sample_events)}, failures


def _scenario_completeness_missing_platform() -> tuple:
    """Invariant #1: a run with 3 audit events but 0 platform
    records fires P0 (completeness) and pages on-call."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    # 1 complete pair + 1 broken pair (audit events, no platform records)
    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-ok", target_platform="jira")
    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-missing",
               target_platform="github", audit_count=2, platform_count=0)

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-missing-platform",
        rng=random.Random(7),
    )

    failures: list[str] = []
    if report.completeness_rate != 0.5:
        failures.append(f"completeness_rate={report.completeness_rate}, expected 0.5")
    completeness_findings = [f for f in report.findings if f.invariant == "completeness"]
    if len(completeness_findings) != 1:
        failures.append(f"expected 1 completeness finding, got {len(completeness_findings)}")
    if completeness_findings and completeness_findings[0].run_id != "run-missing":
        failures.append(f"completeness finding on wrong run: {completeness_findings[0].run_id}")
    if len(p0_fired) != 1:
        failures.append(f"on_p0 fired {len(p0_fired)} times, expected 1")
    if not all(f.severity == "P0" for f in report.findings):
        failures.append("non-P0 finding in completeness scenario")
    return {"completenessRate": report.completeness_rate, "p0": len(p0_fired)}, failures


def _scenario_completeness_missing_audit() -> tuple:
    """Invariant #1, mirror side: platform records exist but the
    audit row does not.  Still a P0 (missing audit = the audit row
    IS the trail)."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    # Add run to mirror pool but emit ZERO audit events.
    mirror.add_run("tenant-a", "run-noaudit", "jira")
    mirror.add_record("tenant-a", "run-noaudit", "jira", {"id": "jira-x"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-noaudit",
        rng=random.Random(11),
    )
    failures: list[str] = []
    if report.completeness_rate != 0.0:
        failures.append(f"completeness_rate={report.completeness_rate}, expected 0.0")
    if not any(f.invariant == "completeness" and "no AuditEvents" in f.detail
               for f in report.findings):
        failures.append("expected completeness finding mentioning no AuditEvents")
    return {"completenessRate": report.completeness_rate}, failures


def _scenario_schema_missing_keys() -> tuple:
    """Invariant #2: a row missing several required `metadata.sync.*`
    keys fires one P0 per missing key."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    bad_sync = _good_sync()
    for k in ("sync.response_hash", "sync.platform_region",
              "sync.platform_credential_ref", "sync.platform_response_code"):
        del bad_sync[k]

    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-schema-bad",
               target_platform="jira", sync=bad_sync)
    # Pair the bad row with platform records so completeness passes.
    mirror.add_record("tenant-a", "run-schema-bad", "jira", {"id": "jira-1"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-schema",
        rng=random.Random(13),
    )

    failures: list[str] = []
    schema_findings = [f for f in report.findings if f.invariant == "schema"]
    if len(schema_findings) != 4:
        failures.append(f"expected 4 schema findings, got {len(schema_findings)}")
    if any(f.severity != "P0" for f in schema_findings):
        failures.append("schema finding not P0")
    # Every missing key from `SYNC_REQUIRED_KEYS` should be present.
    missing_keys_seen = {f.detail.split("'")[1] for f in schema_findings}
    for k in ("sync.response_hash", "sync.platform_region",
              "sync.platform_credential_ref", "sync.platform_response_code"):
        if k not in missing_keys_seen:
            failures.append(f"missing key {k!r} not flagged")
    return {"schemaP0s": len(schema_findings)}, failures


def _scenario_tenant_namespace_leak() -> tuple:
    """Invariant #3: `authored_for_tenant` != `tenantId` is a P0
    cross-tenant leak (R6.3 + R8.1)."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    bad_sync = _good_sync(tenant_id="tenant-a")
    bad_sync["sync.authored_for_tenant"] = "tenant-EVIL"

    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-leak",
               target_platform="jira", sync=bad_sync)
    mirror.add_record("tenant-a", "run-leak", "jira", {"id": "jira-x"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-leak",
        rng=random.Random(17),
    )

    failures: list[str] = []
    leaks = [f for f in report.findings if f.invariant == "per_tenant_namespace"]
    if len(leaks) != 1:
        failures.append(f"expected 1 leak finding, got {len(leaks)}")
    elif "cross-tenant leak" not in leaks[0].detail:
        failures.append(f"leak detail missing: {leaks[0].detail!r}")
    if not all(f.severity == "P0" for f in leaks):
        failures.append("leak not flagged as P0")
    return {"leakFindings": len(leaks)}, failures


def _scenario_actor_invalid() -> tuple:
    """Invariant #4: an `actor_type` outside `agent`/`user`/`system`
    is a P0; a missing actor field is also a P0."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    bad_sync = _good_sync(actor_type="alien-overlord")
    bad_sync.pop("sync.rendered_as", None)  # also breaks the four-field invariant

    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-actor",
               target_platform="jira", sync=bad_sync)
    mirror.add_record("tenant-a", "run-actor", "jira", {"id": "jira-x"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-actor",
        rng=random.Random(19),
    )

    failures: list[str] = []
    actor_findings = [f for f in report.findings if f.invariant == "actor"]
    # Expect: 1 bad actor_type + 1 missing rendered_as = 2
    if len(actor_findings) < 2:
        failures.append(f"expected >=2 actor findings, got {len(actor_findings)}: {actor_findings!r}")
    if not any("actor_type" in f.detail for f in actor_findings):
        failures.append("no actor_type finding")
    if not any("rendered_as" in f.detail for f in actor_findings):
        failures.append("no rendered_as finding")
    return {"actorP0s": len(actor_findings)}, failures


def _scenario_credential_unknown() -> tuple:
    """Invariant #5: a credential_ref not in the tenant inventory
    is a P0 (R-X1)."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()  # does NOT include "arn:rogue"

    bad_sync = _good_sync()
    bad_sync["sync.platform_credential_ref"] = "arn:rogue"

    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-cred",
               target_platform="jira", sync=bad_sync)
    mirror.add_record("tenant-a", "run-cred", "jira", {"id": "jira-x"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-cred-unknown",
        rng=random.Random(23),
    )

    failures: list[str] = []
    cred_findings = [f for f in report.findings if f.invariant == "credential"]
    if len(cred_findings) != 1:
        failures.append(f"expected 1 credential finding, got {len(cred_findings)}")
    if cred_findings and "not in tenant" not in cred_findings[0].detail:
        failures.append(f"detail wrong: {cred_findings[0].detail!r}")
    return {"credP0s": len(cred_findings)}, failures


def _scenario_credential_rotation_overdue() -> tuple:
    """Invariant #5: a credential whose rotation is overdue is a P0."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = InMemoryCredentialInventory()
    creds.add("tenant-a", "arn:aws:secretsmanager:us-east-1:111:secret:tenant-a/jira",
              rotation_due=False)  # overdue

    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-rot",
               target_platform="jira")
    mirror.add_record("tenant-a", "run-rot", "jira", {"id": "jira-x"})

    p0_fired: list = []
    report = daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        on_p0=lambda f: p0_fired.append(f),
        sample_run_id="sample-rot",
        rng=random.Random(29),
    )

    failures: list[str] = []
    rot_findings = [f for f in report.findings
                    if f.invariant == "credential" and "overdue" in f.detail]
    if len(rot_findings) != 1:
        failures.append(f"expected 1 rotation-overdue finding, got {len(rot_findings)}")
    return {"rotationP0s": len(rot_findings)}, failures


def _scenario_small_tenant() -> tuple:
    """§7 out-of-scope #3: a tenant with < n runs is sampled
    exhaustively and flagged `small_tenant=True`."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    # Only 3 runs.
    for i in range(3):
        _seed_pair(store, mirror, creds,
                   tenant_id="tenant-tiny", run_id=f"run-t{i}",
                   target_platform="jira")
    # Other tenant's runs must NOT be picked.
    _seed_pair(store, mirror, creds,
               tenant_id="tenant-a", run_id="run-a0", target_platform="jira")

    report = daily_audit_sample(
        "tenant-tiny", n=10,
        store=store, mirror=mirror, credentials=creds,
        sample_run_id="sample-tiny",
        rng=random.Random(31),
    )

    failures: list[str] = []
    if not report.small_tenant:
        failures.append("expected small_tenant=True")
    if report.sampled_pairs != 3:
        failures.append(f"sampled_pairs={report.sampled_pairs}, expected 3")
    if not report.is_complete:
        failures.append(f"expected is_complete=True; report={report!r}")
    # The sample event metadata must carry the small-tenant flag.
    sample_events = [
        ev for ev in store.all()
        if ev.event_type == AuditEventType.SAMPLE_RUN_COMPLETE
    ]
    if not sample_events:
        failures.append("no sample_run_complete event emitted")
    else:
        md = sample_events[0].to_dict().get("metadata") or {}
        if not md.get("sync.small_tenant"):
            failures.append("metadata.sync.small_tenant not set")
    return {"sampled": report.sampled_pairs, "smallTenant": report.small_tenant}, failures


def _scenario_empty_pool() -> tuple:
    """An empty pool yields a vacuously-complete report (no P0s)
    and the sample event still emits (so dashboards stay green)."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    report = daily_audit_sample(
        "tenant-empty", n=10,
        store=store, mirror=mirror, credentials=creds,
        sample_run_id="sample-empty",
        rng=random.Random(37),
    )
    failures: list[str] = []
    if report.completeness_rate != 1.0:
        failures.append(f"empty pool completeness={report.completeness_rate}, expected 1.0")
    if not report.is_complete:
        failures.append("empty pool report should be is_complete")
    sample_events = [ev for ev in store.all()
                     if ev.event_type == AuditEventType.SAMPLE_RUN_COMPLETE]
    if len(sample_events) != 1:
        failures.append(f"empty pool: expected 1 sample event, got {len(sample_events)}")
    return {"completeness": report.completeness_rate}, failures


def _scenario_multi_target_platforms() -> tuple:
    """The sample event's metadata must list the target platforms
    the sample touched (the §6 dashboards filter on this)."""
    store = InMemoryStore()
    mirror = InMemoryMirrorPlane()
    creds = _make_store_with_credentials()

    _seed_pair(store, mirror, creds, tenant_id="tenant-a", run_id="r1", target_platform="jira")
    _seed_pair(store, mirror, creds, tenant_id="tenant-a", run_id="r2", target_platform="github")
    _seed_pair(store, mirror, creds, tenant_id="tenant-a", run_id="r3", target_platform="clipup")

    daily_audit_sample(
        "tenant-a", n=10,
        store=store, mirror=mirror, credentials=creds,
        sample_run_id="sample-multi",
        rng=random.Random(41),
    )
    sample_events = [ev for ev in store.all()
                     if ev.event_type == AuditEventType.SAMPLE_RUN_COMPLETE]
    failures: list[str] = []
    if not sample_events:
        failures.append("no sample event emitted")
        return {"ok": False}, failures
    md = sample_events[0].to_dict().get("metadata") or {}
    platforms = md.get("sync.target_platforms_sampled") or []
    if set(platforms) != {"clipup", "github", "jira"}:
        failures.append(f"target_platforms={platforms}, expected clipup/github/jira")
    return {"platforms": sorted(platforms)}, failures


# -- runner -----------------------------------------------------------------


def main() -> int:
    print("=" * 72)
    print("Audit system — test_sample (FORA-210 AC #4: daily audit sample)")
    print("=" * 72)
    scenarios = [
        ("AC #4 happy path: 10/10 complete, sample event emitted with metadata.sync.*",
         _scenario_happy_path),
        ("Invariant #1 completeness: missing platform records = P0",
         _scenario_completeness_missing_platform),
        ("Invariant #1 completeness: missing audit rows = P0 (audit IS the trail)",
         _scenario_completeness_missing_audit),
        ("Invariant #2 schema: missing required metadata.sync.* keys = P0 per key",
         _scenario_schema_missing_keys),
        ("Invariant #3 per-tenant namespace: authored_for_tenant mismatch = P0 cross-tenant leak",
         _scenario_tenant_namespace_leak),
        ("Invariant #4 actor: invalid actor_type + missing four-field invariant = P0",
         _scenario_actor_invalid),
        ("Invariant #5 credential: unknown credential_ref = P0 (R-X1)",
         _scenario_credential_unknown),
        ("Invariant #5 credential: rotation overdue = P0",
         _scenario_credential_rotation_overdue),
        ("Out-of-scope #3: small-tenant cohort sampled exhaustively + flagged",
         _scenario_small_tenant),
        ("Edge: empty pool yields vacuous completeness + sample event emitted",
         _scenario_empty_pool),
        ("Sample event metadata lists every target_platform it touched",
         _scenario_multi_target_platforms),
    ]
    evidence: dict = {"scenarios": {}, "summary": {}}
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
    evidence["summary"]["totalScenarios"] = len(scenarios)
    evidence["summary"]["failed"] = len(all_failures)
    evidence["summary"]["passed"] = len(scenarios) - len(all_failures)

    out_dir = os.path.join(ROOT, "agents", "audit", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "test_sample.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2, default=str)
    print(f"\nEvidence: {out_path}")
    print("=" * 72)
    if all_failures:
        print("FAIL")
        return 1
    print("OK: daily audit sample holds (5 invariants + happy path + small-tenant + edge cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
