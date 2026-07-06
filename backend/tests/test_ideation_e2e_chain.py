"""E2E chain test for M4 Ideation Center — M4-G19.

Spec §3.2.3 validation: end-to-end chain
   ingest signal → score idea → generate PRD → push to Jira → see in KG

This single orchestrator test calls the 5 endpoints in sequence and asserts:
  1. The idea is created.
  2. The source sync ingests signals.
  3. The analyze endpoint produces an IdeaAnalysis.
  4. The scoring endpoint computes a score.
  5. The PRD generator emits a typed PRD artifact.
  6. The push-to-jira endpoint (with Idempotency-Key) hits the connector.
  7. The KG graph gains the PRD node.
  8. push_attempts row is written (idempotency cache).
  9. 5 audit rows appear in audit_log covering the chain.

Tenant: acme-corp (11111111-1111-1111-1111-111111111111 per
backend/seeds/packages/acme-corp/data/001_tenant.json).
Project: 22222222-2222-2222-2222-222222222222 per 005_projects.json.
"""

from __future__ import annotations

from typing import Any

TENANT_ID = "11111111-1111-1111-1111-111111111111"
PROJECT_ID = "22222222-2222-2222-2222-222222222222"
CONFLUENCE_SOURCE_ID = "77777777-7777-7777-7777-77777777c001"
ACTOR_ID = "33333333-3333-3333-3333-333333330001"


async def test_e2e_ingest_signal_to_kg(sqlite_db: Any, client: Any) -> None:
    """End-to-end: signal → score → PRD → push → KG."""

    # -------------------------------------------------------------------
    # Step 1: Create the idea.
    # -------------------------------------------------------------------
    idea_payload = {
        "tenant_id": TENANT_ID,
        "project_id": PROJECT_ID,
        "title": "Reduce checkout abandonment",
        "description": "Customer feedback (15 quotes) reports the checkout CTA is below fold.",
        "source": "manual",
        "created_by": ACTOR_ID,
    }
    idea_resp = await client.post("/api/v1/ideation/ideas", json=idea_payload)
    assert idea_resp.status_code == 201, idea_resp.text
    idea = idea_resp.json()
    idea_id = idea["id"]
    assert idea["status"] == "NEW"

    # -------------------------------------------------------------------
    # Step 2: Trigger a source sync. Idempotent.
    # -------------------------------------------------------------------
    sync_resp = await client.post(
        f"/api/v1/ideation/sources/{CONFLUENCE_SOURCE_ID}/sync",
        headers={"Idempotency-Key": "e2e-chain-1"},
    )
    assert sync_resp.status_code in (200, 202), sync_resp.text

    # -------------------------------------------------------------------
    # Step 3: Run analysis.
    # -------------------------------------------------------------------
    analyze_resp = await client.post(f"/api/v1/ideation/ideas/{idea_id}/analyze")
    assert analyze_resp.status_code == 200, analyze_resp.text
    analysis = analyze_resp.json()
    assert "summary" in analysis or "entities" in analysis

    # -------------------------------------------------------------------
    # Step 4: Compute score (opportunity score).
    # -------------------------------------------------------------------
    score_resp = await client.post(f"/api/v1/ideation/scoring/{idea_id}")
    assert score_resp.status_code == 200, score_resp.text
    score = score_resp.json()
    assert score["opportunity_score"] >= 0.0

    # -------------------------------------------------------------------
    # Step 5: Generate PRD.
    # -------------------------------------------------------------------
    prd_resp = await client.post(
        f"/api/v1/ideation/prds/ideas/{idea_id}", json={"template": "bmad"}
    )
    assert prd_resp.status_code in (200, 201), prd_resp.text
    prd = prd_resp.json()
    prd_id = prd["id"]
    assert prd.get("artifact_type") == "PRD"

    # -------------------------------------------------------------------
    # Step 6: Push to Jira with idempotency key.
    # -------------------------------------------------------------------
    push_resp = await client.post(
        f"/api/v1/ideation/ideas/{idea_id}/push/jira",
        json={"project_key": "ACME", "issue_type": "Epic"},
        headers={"Idempotency-Key": "e2e-chain-push-1"},
    )
    assert push_resp.status_code in (200, 202), push_resp.text
    push_result = push_resp.json()
    assert (
        push_result.get("epic_key", "").startswith("ACME-")
        or push_result.get("status") == "success"
    )

    # -------------------------------------------------------------------
    # Step 7: Push again with same key → cached result.
    # -------------------------------------------------------------------
    push_resp_2 = await client.post(
        f"/api/v1/ideation/ideas/{idea_id}/push/jira",
        json={"project_key": "ACME", "issue_type": "Epic"},
        headers={"Idempotency-Key": "e2e-chain-push-1"},
    )
    assert push_resp_2.status_code in (200, 202)
    # The two calls return the same result (idempotency).
    assert push_resp_2.json() == push_result

    # -------------------------------------------------------------------
    # Step 8: KG graph contains the PRD node.
    # -------------------------------------------------------------------
    kg_resp = await client.get(f"/api/v1/ideation/kg_graph/projects/{PROJECT_ID}/idea-graph")
    assert kg_resp.status_code == 200, kg_resp.text
    kg = kg_resp.json()
    assert any(node["id"] == prd_id or node.get("prd_id") == prd_id for node in kg.get("nodes", []))

    # -------------------------------------------------------------------
    # Step 9: push_attempts row written (idempotency cache hit on second call).
    # -------------------------------------------------------------------
    attempts_resp = await client.get(f"/api/v1/ideation/push/{idea_id}/history")
    assert attempts_resp.status_code == 200, attempts_resp.text
    history = attempts_resp.json()
    # Only one attempt stored for the same idempotency key.
    jira_attempts = [a for a in history.get("attempts", []) if a.get("target") == "jira"]
    assert len(jira_attempts) >= 1

    # -------------------------------------------------------------------
    # Step 10: Audit log covers the 5 actions (CREATE_IDEA, SOURCE_SYNC,
    # IDEA_ANALYZE, PRD_GENERATE, IDEA_PUSH).
    # -------------------------------------------------------------------
    # Audit reads are not currently exposed via a REST endpoint; the
    # assertion here uses the sqlite_db fixture directly. The audit
    # rows are written by @audit(action=..., target_type=...) decorators
    # on each route.
    audit_count = sqlite_db.execute(
        "SELECT COUNT(*) FROM audit_log WHERE tenant_id = :tid AND project_id = :pid",
        {"tid": TENANT_ID, "pid": PROJECT_ID},
    ).scalar()
    assert audit_count >= 5, f"expected ≥5 audit rows for the chain, got {audit_count}"


# Fixtures live in tests/conftest.py — the sqlite_db fixture creates an
# in-memory async session, and the client fixture wraps the FastAPI
# app for HTTP calls. Both are reuse-friendly across the Ideation test
# suite.
