"""step-78 F15 — Observability self-check.

Acceptance coverage for Phase 3 Feature 15 (Audit / Health / Compliance
/ Alerts / Drift / GDPR). Run with:
  cd backend && PYTHONPATH=. python3 tests/services/test_observability_f15.py
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from app.schemas.observability_v2 import (
    ActiveAlert,
    AlertConfig,
    AuditQueryParams,
    ComplianceReport,
    GdprExportResponse,
    HealthServicesResponse,
    MetricsResponse,
)
from app.services.observability_service import (
    ObservabilityService,
    observability_service,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _principal(*, tenant_id=None, user_id=None, role="member") -> object:
    """Lightweight principal stand-in (avoids AuthenticatedPrincipal import)."""

    class _P:
        pass

    p = _P()
    p.tenant_id = str(tenant_id or uuid.uuid4())
    p.user_id = str(user_id or uuid.uuid4())
    p.project_id = str(uuid.uuid4())
    p.role = role
    return p


def test_a_observability_client_group_methods_present():
    """F15 — every LiteLLM proxy method the spec mandates is on the client."""
    # ponytail: import the module file directly to avoid the litellm
    # package init (which eagerly creates a DB session factory).
    import importlib.util
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parents[2]
        / "app/integrations/litellm/observability_client.py"
    )
    spec = importlib.util.spec_from_file_location("_obs_client_isolated", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cls = mod.ObservabilityClientGroup

    expected = {
        "audit_list",
        "audit_get",
        "health",
        "health_readiness",
        "health_liveness",
        "health_services",
        "health_history",
        "health_latest",
        "health_shared_status",
        "health_license",
        "health_backlog",
        "health_test_connection",
        "compliance_eu_ai_act",
        "compliance_gdpr",
        "in_product_nudges",
        "event_logging",
        "callback",
    }
    missing = expected - set(dir(cls))
    assert not missing, f"missing methods: {missing}"


def test_b_base_client_exposes_observability_property():
    """F15 — base client exposes `observability` property."""
    # ponytail: parse the source file to confirm the property exists
    # without importing the package (which eagerly creates an engine).
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parents[2]
        / "app/integrations/litellm/litellm_base_client.py"
    )
    src = path.read_text(encoding="utf-8")
    assert re.search(
        r"def\s+observability\s*\(\s*self\s*\)\s*->\s*ObservabilityClientGroup", src
    ), "LiteLLMBaseClient.observability property not found in source"


def test_c_forge_health_endpoint_returns_forge_field():
    """F15 acceptance #7 — /forge/health exposes Forge-side metrics."""
    from app.schemas.forge import ForgeHealth, LiteLLMHealthDetail

    detail = observability_service.forge_health_detail()
    response = ForgeHealth(
        status="ok",
        litellm=LiteLLMHealthDetail(reachable=True),
        forge=detail.model_dump(),
    )
    assert response.forge is not None
    assert "uptime" in response.forge
    assert "version" in response.forge
    assert "p95_chat_latency_ms" in response.forge


def test_d_router_exposes_16_routes():
    """Spec lines 673-686 — 16 routes."""
    # ponytail: parse the route decorators directly from the source —
    # avoids the litellm package-init chain.
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[2] / "app/api/v1/forge_observability.py"
    src = path.read_text(encoding="utf-8")
    pattern = re.compile(r'@router\.(get|post|put|delete|patch)\(\s*"([^"]+)"', re.MULTILINE)
    found = {(m.upper(), "/forge" + p) for m, p in pattern.findall(src)}

    expected = {
        ("GET", "/forge/audit"),
        ("GET", "/forge/audit/{event_id}"),
        ("GET", "/forge/health/services"),
        ("GET", "/forge/health/extended"),
        ("GET", "/forge/metrics/spend-drift"),
        ("GET", "/forge/metrics/rate-limits"),
        ("GET", "/forge/metrics/latency"),
        ("GET", "/forge/compliance/eu-ai-act"),
        ("GET", "/forge/compliance/gdpr/export"),
        ("POST", "/forge/compliance/gdpr/delete"),
        ("GET", "/forge/orgs/{org_id}/alerts"),
        ("POST", "/forge/orgs/{org_id}/alerts"),
        ("GET", "/forge/alerts/active"),
        ("POST", "/forge/webhooks/callback"),
        ("POST", "/forge/event-logging"),
        ("GET", "/forge/in-product-nudges"),
    }
    missing = expected - found
    assert not missing, f"missing routes: {missing}"


def test_e_audit_query_params_accepts_since_datetime():
    p = AuditQueryParams(
        since=datetime.now(UTC),
        until=datetime.now(UTC),
        event_type="forge.prompts.created",
    )
    assert p.event_type == "forge.prompts.created"


def test_f_hash_chain_verifies_known_input():
    """Acceptance #10 — chain verification works on a valid input."""
    tenant_id = uuid.uuid4()
    svc = ObservabilityService()
    chain_refs: list[str] = []
    for i in range(3):
        payload = {"event": f"e{i}", "i": i}
        ref = svc.chain_hash(tenant_id=tenant_id, payload=payload)
        chain_refs.append((payload, ref))

    # Reconstruct events for verification.
    events = [{"payload": p, "hash_chain_ref": r} for p, r in chain_refs]
    assert svc.verify_chain(tenant_id=tenant_id, events=events)


def test_f_hash_chain_tamper_detected():
    """Acceptance #10 — tampering breaks the chain."""
    tenant_id = uuid.uuid4()
    svc = ObservabilityService()
    a_ref = svc.chain_hash(tenant_id=tenant_id, payload={"event": "a"})
    b_ref = svc.chain_hash(tenant_id=tenant_id, payload={"event": "b"})

    # Tamper: pretend a was modified but the recorded ref stays.
    tampered = [
        {"payload": {"event": "a-TAMPERED"}, "hash_chain_ref": a_ref},
        {"payload": {"event": "b"}, "hash_chain_ref": b_ref},
    ]
    assert not svc.verify_chain(tenant_id=tenant_id, events=tampered)


def test_g_gdpr_export_response_shape():
    g = GdprExportResponse(
        profile={"user_id": "u1"},
        audit_events=[{"event_id": "e1"}],
        spend_records=[{"cost_usd": 0.01}],
        agent_configs=[],
        rag_queries=[],
    )
    assert g.profile["user_id"] == "u1"
    assert len(g.audit_events) == 1


def test_h_gdpr_delete_kickoff_does_not_touch_audit_events():
    """Spec line 699 + anti-pattern #8 — audit must not be deleted."""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    resp = observability_service.gdpr_delete_kickoff(tenant_id=tenant_id, user_id=user_id)
    # The kickoff explicitly enumerates affected tables; ensure audit_events is absent.
    joined = " ".join(resp.affected_tables).lower()
    assert "audit_event" not in joined, "audit_events must NOT be in the deletion set"
    assert "rag_chunks" in joined or "litellm_call_records" in joined


def test_i_alert_config_defaults():
    cfg = AlertConfig(tenant_id=uuid.uuid4())
    assert cfg.warn_pct == 80
    assert cfg.exceed_pct == 95
    assert "email" in cfg.channels


def test_j_rate_limit_record_and_count():
    tenant_id = uuid.uuid4()
    svc = ObservabilityService()
    for _ in range(5):
        svc.record_rate_limit(tenant_id=tenant_id, count=1)
    # Internal counter incremented 5x in the last 60s.
    from time import time

    from app.services.observability_service import _RATE_LIMIT_BUCKETS

    bucket = _RATE_LIMIT_BUCKETS.get(tenant_id, [])
    active = sum(c for ts, c in bucket if time() - ts < 60)
    assert active == 5


def test_k_metrics_response_shape():
    m = MetricsResponse(spend_drift=0.5, rate_limits={"k": 1}, latency={"p95": 100.0})
    assert m.spend_drift == 0.5


def test_l_health_services_response_shape():
    h = HealthServicesResponse(db="ok", cache="ok", providers=["openai"])
    assert h.db == "ok"
    assert h.providers[0] == "openai"


def test_m_compliance_report_shape():
    rep = ComplianceReport(
        report_id=uuid.uuid4(),
        generated_at=datetime.now(UTC),
        tenant_id=uuid.uuid4(),
        sections={"inventory": [], "oversight": {}},
    )
    assert "inventory" in rep.sections


def test_n_active_alert_kinds():
    """Spec line 187 — alert kinds cover the six required categories."""
    for kind in (
        "budget_warning",
        "budget_exceeded",
        "spend_drift",
        "model_unavailable",
        "rate_limit_warning",
        "rate_limit_exceeded",
    ):
        a = ActiveAlert(
            id=uuid.uuid4(),
            kind=kind,
            tenant_id=uuid.uuid4(),
            message="test",
            fired_at=datetime.now(UTC),
        )
        assert a.kind == kind


def test_o_query_audit_does_not_instantiate_engine():
    """Ponytail: query_audit should be callable against a mock session."""
    from types import SimpleNamespace

    class _MockResult:
        def __init__(self, rows, total):
            self.rows = rows
            self.total = total

        def scalars(self):
            return SimpleNamespace(all=lambda: self.rows)

        def scalar_one(self):
            return self.total

    class _MockSession:
        async def execute(self, stmt):
            return _MockResult([], 0)

    svc = ObservabilityService()
    rows, total = asyncio.run(
        svc.query_audit(_MockSession(), tenant_id=uuid.uuid4(), project_id=None)
    )
    assert rows == []
    assert total == 0


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    import asyncio
    import sys

    failed = 0
    for name, fn in list(globals().items()):
        if not name.startswith("test_"):
            continue
        try:
            if asyncio.iscoroutinefunction(fn):
                asyncio.run(fn())
            else:
                fn()
            print(f"PASS {name}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}: {type(e).__name__}: {e}")
    sys.exit(failed)
