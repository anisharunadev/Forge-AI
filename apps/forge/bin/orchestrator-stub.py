#!/usr/bin/env python3
"""
Forge orchestrator dev stub (Phase D — covers all 13 UI domains).

A single-file Python HTTP server (stdlib only) that exposes the
subset of the FORA Orchestrator REST API the Forge console consumes
through `lib/api/proxy/[...path]/route.ts`. Intended for local UI
development when the real FastAPI backend does not exist.

Start:
    python3 apps/forge/bin/orchestrator-stub.py
    # or: pnpm dev:stub

Override port: ORCHESTRATOR_STUB_PORT=4000 python3 ...

Returns seed data matching the shapes previously baked into the
in-repo mock-data files. When the real orchestrator lands, swap
this file for the FastAPI server — the UI consumes the contract,
not this implementation.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = os.environ.get("ORCHESTRATOR_STUB_HOST", "127.0.0.1")
PORT = int(os.environ.get("ORCHESTRATOR_STUB_PORT", "4000"))
TENANT = "acme-corp"
TENANT_UUID = "00000000-0000-4000-8000-000000000ace"

NOW = datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or NOW).isoformat()


# ---------- Run / stages state ----------
RUN_ID = "00000000-0000-4000-8000-000000000001"
RUN_ALIAS = "demo-run-001"
_state = threading.Lock()
_run = {
    "id": RUN_ID,
    "tenant_id": TENANT_UUID,
    "goal_id": "goal-forge-demo",
    "project_id": "project-forge-demo",
    "status": "running",
    "current_stage": "dev",
    "triggered_by": {"type": "manual", "actor": "demo@forge.local"},
    "cost_ceiling_usd": "25.00",
    "cost_spent_usd": "4.83",
    "started_at": iso(NOW - timedelta(hours=2)),
    "finished_at": None,
    "deleted_at": None,
    "archived_at": None,
}
_stages = [
    {
        "id": f"stage-{RUN_ID}-{s}",
        "run_id": RUN_ID,
        "stage": s,
        "status": ("approved" if i < 2 else ("running" if i == 2 else "pending")),
        "decision": None,
        "started_at": iso(NOW - timedelta(hours=2 - i * 0.3)) if i <= 2 else None,
        "finished_at": None,
    }
    for i, s in enumerate(["ideation", "architect", "dev", "qa", "security", "devops", "docs"])
]


# ---------- Domain data (seed-shaped for UI rendering) ----------

def gen_id(prefix: str, n: int) -> str:
    return f"{prefix}-{n:03d}"


def make_connectors():
    base = [
        ("jira", "Jira", "success", 1),
        ("github", "GitHub", "success", 1),
        ("gitlab", "GitLab", "degraded", 1),
        ("slack", "Slack", "success", 1),
        ("teams", "Microsoft Teams", "success", 1),
        ("sonarqube", "SonarQube", "success", 1),
        ("figma", "Figma", "success", 1),
        ("aws", "AWS", "success", 1),
        ("azdo", "Azure DevOps", "error", 1),
        ("zendesk", "Zendesk", "success", 2),
        ("databricks", "Databricks", "success", 2),
    ]
    out = []
    for i, (cid, name, status, tier) in enumerate(base):
        out.append({
            "id": cid,
            "name": cid,
            "displayName": name,
            "tenantId": TENANT,
            "status": status,
            "tier": tier,
            "health": {
                "lastCallAt": iso(NOW - timedelta(minutes=5 + i)),
                "p50Ms": 80 + i * 12,
                "p95Ms": 240 + i * 30,
                "errorRate": 0.001 * (i + 1),
                "callCount24h": 1500 + i * 230,
            },
            "scope": {
                "grantedScopes": ["read", "write"],
                "deniedScopes": [],
                "roleBinding": "developer",
            },
            "credential": {
                "secretRef": f"tenants/{TENANT}/secrets/{cid}_cred@latest",
                "redacted": True,
                "valueLen": 64,
                "fingerprint": f"sha256:{cid[:8]}",
                "lastRotatedAt": iso(NOW - timedelta(days=20)),
                "expiresAt": iso(NOW + timedelta(days=90)),
            },
            "lastUsedAt": iso(NOW - timedelta(minutes=3 + i)),
            "lastAuditEntryId": f"audit-{i:05d}",
        })
    return out


def make_epics():
    return [
        {
            "id": "epic-forge-393",
            "identifier": "FORA-393",
            "title": "UI / Visualization Spine (Next.js 15 + React Flow)",
            "status": "active",
            "owner": "pm",
            "subGoalList": ["goal-forge-ui-spine"],
            "successMetric": "All 8 v1.0 centers ship with the typed-artifact renderers and TypedTable baseline.",
            "description": "Forge UI typed-artifact browser on top of the Orchestrator's Handoff Contract.",
            "storyIds": ["story-forge-393-1", "story-forge-393-2", "story-forge-393-3"],
            "requirementBriefId": "rb-forge-393",
            "draftPrdId": "prd-forge-393",
            "createdAt": iso(NOW - timedelta(days=9)),
            "updatedAt": iso(NOW - timedelta(hours=2)),
        },
        {
            "id": "epic-forge-501",
            "identifier": "FORA-501",
            "title": "Project Intelligence Center",
            "status": "active",
            "owner": "eng-lead",
            "subGoalList": ["goal-pi-center"],
            "successMetric": "PMs can browse typed-artifact graphs across all epics without writing SQL.",
            "description": "Renders Epics, Stories, Handoff Contracts, Requirement Briefs, and Draft PRDs.",
            "storyIds": ["story-forge-501-list", "story-forge-501-brief", "story-forge-501-tabs"],
            "requirementBriefId": "rb-forge-501",
            "draftPrdId": "prd-forge-501",
            "createdAt": iso(NOW - timedelta(days=4)),
            "updatedAt": iso(NOW - timedelta(hours=1)),
        },
        {
            "id": "epic-forge-578",
            "identifier": "FORA-578",
            "title": "Connector Center — Tier 1 MCP matrix",
            "status": "active",
            "owner": "cto",
            "subGoalList": ["goal-conn-tier1"],
            "successMetric": "11 Tier-1 connectors discoverable, scopeable, and credential-rotatable from the UI.",
            "description": "MCP credential envelopes with role bindings and redaction.",
            "storyIds": ["story-forge-578-list"],
            "requirementBriefId": None,
            "draftPrdId": None,
            "createdAt": iso(NOW - timedelta(days=2)),
            "updatedAt": iso(NOW - timedelta(hours=4)),
        },
    ]


def make_stories():
    base = [
        ("story-forge-393-1", "FORA-488", "epic-forge-393", "Design system package skeleton + design tokens + Shadcn primitives", "done", "high"),
        ("story-forge-393-2", "FORA-509", "epic-forge-393", "TypedTable renderer for typed-artifact lists", "done", "high"),
        ("story-forge-393-3", "FORA-512", "epic-forge-393", "React Flow graph renderers (Knowledge, Traceability)", "in_progress", "medium"),
        ("story-forge-501-list", "FORA-507", "epic-forge-501", "Epic + Story list with TypedTable", "done", "high"),
        ("story-forge-501-brief", "FORA-510", "epic-forge-501", "Requirement Brief renderer (11 sections)", "in_progress", "high"),
        ("story-forge-501-tabs", "FORA-514", "epic-forge-501", "Stage-tabs cross-reference matrix", "backlog", "medium"),
        ("story-forge-578-list", "FORA-591", "epic-forge-578", "Connector Center list + tier + sync history", "backlog", "medium"),
    ]
    out = []
    for i, (sid, ident, eid, title, status, prio) in enumerate(base):
        out.append({
            "id": sid,
            "identifier": ident,
            "epicId": eid,
            "title": title,
            "acceptanceCriteria": [
                f"Renders the {title} per the design tokens.",
                "Loads via the API proxy with empty-state fallback.",
            ],
            "status": status,
            "priority": prio,
            "owner": "eng-lead" if i % 2 == 0 else "pm",
            "blockedBy": [],
            "blocks": [],
            "risk": None,
            "handoffContractIds": [f"hc-forge-{ident.lower()}-001"],
            "createdAt": iso(NOW - timedelta(days=7 - i)),
            "updatedAt": iso(NOW - timedelta(hours=i * 3)),
        })
    return out


def make_handoff_contracts():
    return [
        {
            "id": "hc-forge-488-001",
            "storyId": "story-forge-393-1",
            "version": "1.0.0",
            "fromStage": "architect",
            "toStage": "dev",
            "steps": [{"fromStage": "architect", "toStage": "dev", "artefactRef": "packages/forge-ui/src/primitives", "sha256": "sha256:placeholder-488"}],
            "inputSchemaRef": "schemas/forge-ui/primitives.in.json",
            "outputSchemaRef": "schemas/forge-ui/primitives.out.json",
            "exampleRef": "examples/forge-ui/primitives.json",
            "sla": {"p50Ms": 50, "p99Ms": 120, "maxRetries": 2},
            "createdAt": iso(NOW - timedelta(days=5)),
        }
    ]


def make_briefs():
    return [
        {
            "id": "rb-forge-501",
            "epicId": "epic-forge-501",
            "title": "Project Intelligence — Requirement Brief",
            "schema_version": "1.0",
            "source": "FORA-501 description",
            "sections": [
                {"key": "mission", "title": "Mission", "body": "Build the Project Intelligence Center."},
                {"key": "core_vision", "title": "Core Vision", "body": "Typed-artifact graph browsing across epics."},
            ],
            "createdAt": iso(NOW - timedelta(days=4)),
            "updatedAt": iso(NOW - timedelta(hours=2)),
        }
    ]


def make_drafts():
    return [
        {
            "id": "prd-forge-501",
            "epicId": "epic-forge-501",
            "title": "Project Intelligence Center — Draft PRD",
            "markdown": "## 1. Mission\n\nBuild Forge AI's Project Intelligence Center.",
            "lintPassed": True,
            "sectionBodies": {
                "mission": "Build Forge AI's Project Intelligence Center.",
                "core_vision": "Typed-artifact graph browsing across epics.",
            },
            "createdAt": iso(NOW - timedelta(days=4)),
            "updatedAt": iso(NOW - timedelta(hours=2)),
        }
    ]


def make_governance():
    return {
        "approvals": [
            {
                "id": "apr-fora-507",
                "kind": "request_confirmation",
                "title": "Approve FORA-507 Governance Center v1.0 GA",
                "prompt": "Ship the Governance Center slice as v1.0 GA.",
                "state": "pending",
                "createdAt": iso(NOW - timedelta(hours=3)),
                "idempotencyKey": "conf:fora-507:plan:v0.4.0",
            }
        ],
        "policies": [
            {
                "id": "pol-deny-destructive-prod",
                "title": "Deny destructive MCP actions in prod",
                "summary": "Block all delete_*/rotate_* tools against prod connectors.",
                "status": "active",
                "version": "1.4.0",
                "updatedAt": iso(NOW - timedelta(days=2)),
                "updatedBy": {"displayName": "CTO", "id": "cto"},
            }
        ],
        "rbac_roles": [
            {"id": "role-board", "name": "board", "description": "Board token", "permissions": [{"resource": "approval.request_confirmation", "actions": ["accept", "decline"]}], "memberCount": 1, "system": True, "updatedAt": iso(NOW - timedelta(days=7))}
        ],
        "board_confirmations": [
            {"id": "bc-fora-393", "subject": {"identifier": "FORA-393", "id": "fora-393"}, "planRev": "v0.1", "outcome": "accepted", "decider": {"displayName": "Board", "id": "board"}, "decidedAt": iso(NOW - timedelta(days=1)), "idempotencyKey": "conf:fora-393:plan:v0.1", "prompt": "Approve FORA-393 Plan rev v0.1."}
        ],
    }


def make_onboarding_catalog():
    return {
        "regions": ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"],
        "timezones": ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Asia/Kolkata"],
        "repos": [
            {"id": "repo-api", "url": "https://github.com/acme/api-service", "defaultBranch": "main", "language": "TypeScript", "size": "1.2 MB", "lastCommitAt": iso(NOW)},
            {"id": "repo-web", "url": "https://github.com/acme/web", "defaultBranch": "main", "language": "TypeScript", "size": "2.4 MB", "lastCommitAt": iso(NOW)},
        ],
        "stacks": [
            {"id": "st-1", "repoId": "repo-api", "language": "TypeScript", "framework": "Fastify", "buildTool": "pnpm", "testFramework": "Vitest", "confidence": "high"},
        ],
        "agents": [
            {"id": "claude-code", "name": "Claude Code", "type": "cli", "defaultProvider": "anthropic", "description": "General-purpose coding agent."},
            {"id": "forge-sdlc", "name": "Forge SDLC", "type": "workflow", "defaultProvider": "forge", "description": "Full SDLC orchestrator."},
        ],
    }


def make_audit():
    actors = [
        {"id": "u-priya", "name": "Priya Shah", "avatar": "PS"},
        {"id": "u-marcus", "name": "Marcus Lee", "avatar": "ML"},
        {"id": "u-diego", "name": "Diego Alvarez", "avatar": "DA"},
    ]
    records = []
    for i in range(34):
        actor = actors[i % len(actors)]
        records.append({
            "id": f"audit-{i:05d}",
            "tenantId": TENANT,
            "tenantName": "Acme Corp",
            "actor": actor,
            "action": ["login", "approve", "deploy", "edit", "export"][i % 5],
            "target": {"type": "run", "id": RUN_ID, "label": "Demo Run"},
            "payload": {"ip": "10.0.4.21"},
            "timestamp": iso(NOW - timedelta(hours=i)),
            "hash": f"sha256:{i:064x}",
            "prevHash": f"sha256:{(i - 1) if i > 0 else 0:064x}",
        })
    records.sort(key=lambda r: r["timestamp"], reverse=True)
    return {"records": records, "actors": actors, "tenants": [{"id": TENANT, "name": "Acme Corp"}]}


def make_ideation():
    return {
        "ideas": [
            {"id": "idea-001", "title": "Unified Knowledge Graph (F-115)", "summary": "Cross-tenant knowledge graph.", "status": "prd", "score": 8.7, "scoreBreakdown": {"impact": 9, "feasibility": 8, "confidence": 8, "effort": 9}, "owner": "Priya Shah", "ownerAvatar": "PS", "createdAt": iso(NOW - timedelta(days=30)), "tags": ["knowledge"], "impact": "high", "prdRef": "prd-001", "analysis": "Centralizes knowledge fragments.", "risks": ["Indexing latency"]},
            {"id": "idea-002", "title": "Real-time Cost Guardrails", "summary": "Per-run cost ceilings with Slack alerts.", "status": "ideation", "score": 7.8, "scoreBreakdown": {"impact": 8, "feasibility": 9, "confidence": 8, "effort": 7}, "owner": "Marcus Lee", "ownerAvatar": "ML", "createdAt": iso(NOW - timedelta(days=20)), "tags": ["cost"], "impact": "medium", "prdRef": None, "analysis": "Hard ceiling per run.", "risks": []},
        ],
        "roadmap": [
            {"id": "rm-1", "ideaId": "idea-002", "column": "now", "title": "Cost guardrails", "quarter": "Q2 2026", "owner": "Marcus Lee", "effort": "M"},
        ],
        "prds": [
            {"id": "prd-001", "title": "Unified Knowledge Graph (F-115)", "ideaId": "idea-001", "owner": "Priya Shah", "updatedAt": iso(NOW - timedelta(days=1)), "status": "review", "markdown": "# Unified Knowledge Graph\n\n## Problem\n..."},
        ],
        "arch_previews": [
            {"id": "ap-001", "title": "Knowledge Graph Ingestion Pipeline", "description": "Repo → AGE → PGVector.", "nodes": [{"id": "n1", "label": "GitHub Webhook", "kind": "external", "x": 0, "y": 0}], "edges": [{"id": "e1", "source": "n1", "target": "n2", "label": "push event"}]},
        ],
        "approvals": [
            {"id": "appr-001", "kind": "idea", "refId": "idea-002", "title": "Approve Cost Guardrails", "requestedBy": "Marcus Lee", "requestedAt": iso(NOW - timedelta(hours=2)), "status": "pending"},
        ],
    }


def make_project_intel():
    return {
        "repos": [
            {"id": "repo-forge", "name": "forge-ai", "url": "https://github.com/forge-ai/forge", "status": "healthy", "lastIngestionAt": iso(NOW - timedelta(hours=3)), "bytesIngested": 18400000, "files": 482, "errors": []},
        ],
        "architecture": {"id": "dg-1", "title": "Forge dependency graph", "services": [{"id": "svc-orchestrator", "label": "Orchestrator"}, {"id": "svc-knowledge", "label": "Knowledge"}], "edges": [{"id": "e1", "source": "svc-orchestrator", "target": "svc-knowledge"}]},
        "api_endpoints": [
            {"id": "a1", "service": "orchestrator", "method": "GET", "path": "/v1/runs", "auth": "jwt", "description": "List runs."},
        ],
        "services": [
            {"id": "svc-orchestrator", "name": "Orchestrator", "language": "Python", "deployments": 3},
        ],
        "db_schema": {"tables": [{"name": "tenants", "schema": "public", "columns": [{"name": "id", "type": "uuid", "nullable": False, "primaryKey": True}]}]},
        "qa_examples": [
            {"id": "qa1", "question": "Which services implement ADR-0007?", "answer": "The Orchestrator service.", "sources": [{"kind": "ADR", "ref": "adr-0007"}]},
        ],
    }


def make_analytics():
    cost_trend = []
    for i in range(30):
        d = NOW - timedelta(days=29 - i)
        cost_trend.append({"date": d.strftime("%Y-%m-%d"), "costUsd": round(120 + i * 3.5 + (i % 5) * 2, 2)})
    return {
        "kpis": {"totalCostUsd30d": sum(c["costUsd"] for c in cost_trend), "activeRuns": 9, "avgAcceptancePct": 80, "knowledgeReusePct": 68, "totalRuns": 50},
        "cost_trend": cost_trend,
        "runs_by_status": [{"status": s, "count": c} for s, c in [("finished", 28), ("running", 9), ("paused", 5), ("aborted", 3), ("waiting_approval", 3), ("created", 2)]],
        "artifact_acceptance": {"accepted": 72, "rejected": 18, "pending": 10},
        "agent_usage": [
            {"agent": "claude-code", "invocations": 412, "costUsd": 8.42},
            {"agent": "forge-sdlc", "invocations": 198, "costUsd": 12.31},
        ],
        "latency_histogram": [
            {"range": f"{i}-{i+1}m", "count": (i + 1) * 2} for i in range(10)
        ],
    }


def make_connector_center():
    return {
        "connectors": [
            {"id": "github", "name": "github", "displayName": "GitHub", "category": "source-control", "status": "healthy", "lastSyncAt": iso(NOW - timedelta(minutes=10)), "nextSyncAt": iso(NOW + timedelta(minutes=5)), "callCount24h": 1842, "errorRate24h": 0.001, "scopes": ["repo:read", "repo:write"]},
        ],
        "marketplace": [
            {"id": "gitlab", "name": "gitlab", "displayName": "GitLab", "category": "source-control", "publisher": "Forge Team", "shortDescription": "Mirror GitLab repos.", "rating": 4.6, "installs": 1284},
        ],
        "sync_history": [
            {"id": "sr-001", "connectorId": "github", "startedAt": iso(NOW - timedelta(minutes=10)), "finishedAt": iso(NOW - timedelta(minutes=9, seconds=52)), "status": "success", "recordsSynced": 1240, "triggeredBy": "schedule"},
        ],
    }


def make_agent_center():
    return {
        "agents": [
            {"id": "claude-code", "name": "Claude Code", "type": "cli", "status": "active", "version": "1.4.2", "description": "Anthropic Claude for coding.", "defaultProvider": "anthropic", "supportedTasks": ["implement", "review"], "lastInvokedAt": iso(NOW - timedelta(minutes=2)), "invocations24h": 412, "costUsd24h": 8.42},
        ],
        "providers": [
            {"id": "anthropic", "name": "anthropic", "displayName": "Anthropic", "status": "connected", "region": "us-east-1", "defaultModel": "claude-3-5-sonnet", "models": ["claude-3-5-sonnet"], "costPer1kTokensUsd": 0.003, "errorRate24h": 0.002, "calls24h": 1840},
        ],
        "assignments": [
            {"taskType": "implement", "agentId": "claude-code", "providerId": "anthropic", "enabled": True},
        ],
        "runtimes": [
            {"id": "rt-001", "agentId": "claude-code", "kind": "sandbox", "status": "active", "region": "us-east-1", "cpuPercent": 38, "memPercent": 52, "uptimeSec": 18420, "startedAt": iso(NOW - timedelta(hours=5))},
        ],
    }


def make_architecture():
    return {
        "adrs": [
            {"id": "adr-0001", "number": 1, "title": "Cloud-only AWS deployment", "status": "published", "owner": "Marcus Lee", "updatedAt": iso(NOW - timedelta(days=150)), "markdown": "# Cloud-only AWS\n\n## Status: Published\n"},
        ],
        "contracts": [
            {"id": "contract-orchestrator", "title": "Orchestrator REST API", "kind": "openapi", "service": "orchestrator", "version": "1.4.2", "owner": "Marcus Lee", "updatedAt": iso(NOW - timedelta(days=7)), "source": "openapi: 3.0.3", "status": "published"},
        ],
        "task_breakdowns": [
            {"id": "tb-knowledge", "title": "Knowledge Graph ingestion (F-115)", "source": "PRD-001", "totalEstimateHours": 64, "tree": {"id": "t1", "title": "KG ingestion", "estimateHours": 64, "status": "in_progress", "children": []}},
        ],
        "risk_registers": [
            {"id": "rr-platform", "title": "Platform Risk Register", "source": "CTO Office", "updatedAt": iso(NOW - timedelta(days=7)), "risks": [{"id": "r1", "title": "LiteLLM rate limit", "likelihood": 3, "impact": 4, "owner": "Marcus Lee", "mitigation": "Backoff + breaker.", "status": "mitigating"}]},
        ],
        "traceability": {"id": "tg-knowledge", "title": "KG traceability", "nodes": [{"id": "req1", "label": "REQ: Cross-tenant KG", "kind": "requirement", "x": 0, "y": 0}], "edges": []},
        "versions": [
            {"version": "v1.4 (M2)", "releasedAt": iso(NOW - timedelta(days=21)), "highlights": ["Unified audit hash chain", "Knowledge Center"]},
        ],
    }


def make_knowledge_center():
    nodes = []
    edges = []
    for i in range(26):
        nodes.append({"id": f"n-{i:02d}", "label": f"Node {i}", "kind": ["Repo", "Service", "Component", "ADR", "Idea", "Risk", "Task", "Test"][i % 8], "x": (i % 5) * 100, "y": (i // 5) * 80, "updatedAt": iso(NOW - timedelta(hours=i))})
    for i in range(41):
        edges.append({"id": f"e-{i:02d}", "source": f"n-{i % 26:02d}", "target": f"n-{(i + 1) % 26:02d}", "kind": ["implements", "owns", "blocks", "mitigates", "depends_on", "relates_to"][i % 6]})
    return {"nodes": nodes, "edges": edges}


def make_org_knowledge():
    return {
        "standards": [
            {"id": "std-api-design", "title": "API Design", "category": "architecture", "status": "approved", "owner": "platform-eng@acme.com", "body": "All public APIs must use REST + OpenAPI 3.1.", "updatedAt": iso(NOW - timedelta(days=40)), "version": "4.2.0"},
        ],
        "templates": [
            {"id": "tpl-bmad-prd", "title": "BMad PRD", "kind": "prd", "description": "Product Requirements Document template.", "updatedAt": iso(NOW - timedelta(days=22)), "preview": "## Goals\n## Non-goals\n## User stories", "owner": "pm@acme.com", "uses": 184},
        ],
        "policies": [
            {"id": "pol-prod-approval", "title": "Require approval for production deploy", "effect": "require-approval", "scope": "deployment.environment == \"production\"", "logic": {"==": [{"var": "deployment.environment"}, "production"]}, "enabled": True, "updatedAt": iso(NOW - timedelta(days=20)), "owner": "platform-eng@acme.com"},
        ],
    }


# ---------- HTTP handler ----------

ROUTES = []  # built dynamically below


class Handler(BaseHTTPRequestHandler):
    server_version = "ForgeOrchestratorStub/1.0"

    def log_message(self, fmt, *args):  # noqa: A002
        sys.stderr.write(f"[stub] {self.address_string()} - {fmt % args}\n")

    def _send_json(self, status: int, body):
        if not isinstance(body, (list, dict)):
            body = {"data": body}
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.send_header("x-orchestrator-stub", "1")
        self.end_headers()
        self.wfile.write(payload)

    def _send_text(self, status: int, text: str):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("x-orchestrator-stub", "1")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    # --- Routes ---
    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        return self._route_get(path)

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        return self._route_post(path, self._read_body())

    def do_PUT(self):  # noqa: N802
        self._send_json(405, {"code": "METHOD_NOT_ALLOWED", "message": "PUT not implemented"})

    def do_DELETE(self):  # noqa: N802
        self._send_json(405, {"code": "METHOD_NOT_ALLOWED", "message": "DELETE not implemented"})

    def do_PATCH(self):  # noqa: N802
        self._send_json(405, {"code": "METHOD_NOT_ALLOWED", "message": "PATCH not implemented"})

    # --- GET dispatcher ---
    def _route_get(self, path: str):
        if path == "/healthz":
            return self._send_text(200, "ok")

        # Runs
        if path == "/v1/runs":
            with _state:
                return self._send_json(200, [_resolve_run(RUN_ID)])
        m = re.match(r"^/v1/runs/([^/]+)/stages$", path)
        if m:
            with _state:
                if not _resolve_run(m.group(1)):
                    return self._send_json(404, {"code": "NOT_FOUND", "message": "run not found", "request_id": "stub"})
                return self._send_json(200, {"stages": list(_stages)})
        m = re.match(r"^/v1/runs/([^/]+)$", path)
        if m:
            with _state:
                resolved = _resolve_run(m.group(1))
                if not resolved:
                    return self._send_json(404, {"code": "NOT_FOUND", "message": "run not found", "request_id": "stub"})
                return self._send_json(200, resolved)

        # Connectors (legacy /v1/connectors + new /v1/connector-center/*)
        if path == "/v1/connectors":
            return self._send_json(200, _data["connectors_legacy"])
        m = re.match(r"^/v1/connectors/([^/]+)$", path)
        if m:
            for c in _data["connectors_legacy"]:
                if c["id"] == m.group(1):
                    return self._send_json(200, c)
            return self._send_json(404, {"code": "NOT_FOUND", "message": "connector not found", "request_id": "stub"})
        if path == "/v1/connector-center/connectors":
            return self._send_json(200, _data["connector_center"]["connectors"])
        if path == "/v1/connector-center/marketplace":
            return self._send_json(200, _data["connector_center"]["marketplace"])
        if path == "/v1/connector-center/sync-history":
            return self._send_json(200, _data["connector_center"]["sync_history"])

        # Intelligence — project scoped
        for prefix, store, items in [
            ("epics", "epics", "epics"),
            ("stories", "epics", "stories"),
            ("handoffs", "epics", "handoffs"),
            ("briefs", "epics", "briefs"),
            ("drafts", "epics", "drafts"),
        ]:
            if path == f"/v1/projects/project-forge-demo/{prefix}":
                return self._send_json(200, _data["intelligence"][items])
            m = re.match(rf"^/v1/projects/[^/]+/{prefix}/([^/]+)$", path)
            if m:
                for it in _data["intelligence"][items]:
                    if it["id"] == m.group(1):
                        return self._send_json(200, it)
                return self._send_json(404, {"code": "NOT_FOUND", "message": "not found", "request_id": "stub"})

        # Governance
        gov_map = {
            "/v1/governance/approvals": "approvals",
            "/v1/governance/policies": "policies",
            "/v1/governance/rbac-roles": "rbac_roles",
            "/v1/governance/board-confirmations": "board_confirmations",
        }
        if path in gov_map:
            return self._send_json(200, _data["governance"][gov_map[path]])

        # Onboarding
        if path == "/v1/onboarding/catalog":
            return self._send_json(200, _data["onboarding"])

        # Audit
        if path == "/v1/audit/records":
            return self._send_json(200, _data["audit"]["records"])
        if path == "/v1/audit/actors":
            return self._send_json(200, _data["audit"]["actors"])
        if path == "/v1/audit/tenants":
            return self._send_json(200, _data["audit"]["tenants"])

        # Ideation
        idea_map = {
            "/v1/ideation/ideas": "ideas",
            "/v1/ideation/roadmap": "roadmap",
            "/v1/ideation/prds": "prds",
            "/v1/ideation/arch-previews": "arch_previews",
            "/v1/ideation/approvals": "approvals",
        }
        if path in idea_map:
            return self._send_json(200, _data["ideation"][idea_map[path]])

        # Project intel
        pi_map = {
            "/v1/project-intel/repos": "repos",
            "/v1/project-intel/api-endpoints": "api_endpoints",
            "/v1/project-intel/services": "services",
            "/v1/project-intel/qa-examples": "qa_examples",
        }
        if path in pi_map:
            return self._send_json(200, _data["project_intel"][pi_map[path]])
        if path == "/v1/project-intel/architecture":
            return self._send_json(200, _data["project_intel"]["architecture"])
        if path == "/v1/project-intel/db-schema":
            return self._send_json(200, _data["project_intel"]["db_schema"])

        # Analytics
        a_map = {
            "/v1/analytics/kpis": "kpis",
            "/v1/analytics/cost-trend": "cost_trend",
            "/v1/analytics/runs-by-status": "runs_by_status",
            "/v1/analytics/artifact-acceptance": "artifact_acceptance",
            "/v1/analytics/agent-usage": "agent_usage",
            "/v1/analytics/latency-histogram": "latency_histogram",
        }
        if path in a_map:
            return self._send_json(200, _data["analytics"][a_map[path]])

        # Agent Center
        ac_map = {
            "/v1/agent-center/agents": "agents",
            "/v1/agent-center/providers": "providers",
            "/v1/agent-center/assignments": "assignments",
            "/v1/agent-center/runtimes": "runtimes",
        }
        if path in ac_map:
            return self._send_json(200, _data["agent_center"][ac_map[path]])

        # Architecture
        ar_map = {
            "/v1/architecture/adrs": "adrs",
            "/v1/architecture/contracts": "contracts",
            "/v1/architecture/task-breakdowns": "task_breakdowns",
            "/v1/architecture/risk-registers": "risk_registers",
            "/v1/architecture/versions": "versions",
        }
        if path in ar_map:
            return self._send_json(200, _data["architecture"][ar_map[path]])
        if path == "/v1/architecture/traceability":
            return self._send_json(200, _data["architecture"]["traceability"])

        # Knowledge center
        if path == "/v1/knowledge-center/nodes":
            return self._send_json(200, _data["knowledge_center"]["nodes"])
        if path == "/v1/knowledge-center/edges":
            return self._send_json(200, _data["knowledge_center"]["edges"])

        # Org knowledge
        ok_map = {
            "/v1/org-knowledge/standards": "standards",
            "/v1/org-knowledge/templates": "templates",
            "/v1/org-knowledge/policies": "policies",
        }
        if path in ok_map:
            return self._send_json(200, _data["org_knowledge"][ok_map[path]])

        return self._send_json(404, {"code": "NOT_FOUND", "message": f"no route for {path}", "request_id": "stub"})

    def _route_post(self, path: str, body):
        # Run lifecycle
        m = re.match(r"^/v1/runs/([^/]+)/(pause|resume|cancel)$", path)
        if m:
            run_id, verb = m.group(1), m.group(2)
            with _state:
                if not _resolve_run(run_id):
                    return self._send_json(404, {"code": "NOT_FOUND", "message": "run not found", "request_id": "stub"})
                _apply_verb(verb)
                return self._send_json(200, dict(_run))

        # Governance approve/decline
        m = re.match(r"^/v1/governance/approvals/([^/]+)/(accept|decline)$", path)
        if m:
            apr_id, action = m.group(1), m.group(2)
            for a in _data["governance"]["approvals"]:
                if a["id"] == apr_id:
                    a["state"] = "accepted" if action == "accept" else "declined"
                    return self._send_json(200, a)
            return self._send_json(404, {"code": "NOT_FOUND", "message": "approval not found", "request_id": "stub"})

        # Project create (onboarding submit)
        if path == "/v1/projects":
            ts = int(NOW.timestamp())
            new_project = {
                "id": f"proj-{ts}",
                "tenantId": TENANT,
                "tenantName": "Acme Corp",
                "status": "provisioning",
                "createdAt": iso(),
                "name": body.get("name") or body.get("tenantName") or "Untitled project",
                "region": body.get("region") or "us-east-1",
            }
            return self._send_json(201, new_project)

        return self._send_json(404, {"code": "NOT_FOUND", "message": f"no POST route for {path}", "request_id": "stub"})


def _apply_verb(verb: str):
    if verb == "pause":
        _run["status"] = "paused"
    elif verb == "resume":
        _run["status"] = "running"
    elif verb == "cancel":
        _run["status"] = "aborted"
        _run["finished_at"] = iso()


def _resolve_run(run_id: str):
    if run_id in (RUN_ID, RUN_ALIAS):
        return dict(_run)
    return None


# Stub uses an RLock-like context manager — re-bind threading.Lock() to a context manager proxy.
class _Lock:
    def __init__(self):
        self._l = threading.Lock()
    def __enter__(self):
        self._l.acquire()
        return self
    def __exit__(self, *exc):
        self._l.release()


_state = _Lock()

_data = {
    "connectors_legacy": make_connectors(),
    "intelligence": {
        "epics": make_epics(),
        "stories": make_stories(),
        "handoffs": make_handoff_contracts(),
        "briefs": make_briefs(),
        "drafts": make_drafts(),
    },
    "governance": make_governance(),
    "onboarding": make_onboarding_catalog(),
    "audit": make_audit(),
    "ideation": make_ideation(),
    "project_intel": make_project_intel(),
    "analytics": make_analytics(),
    "connector_center": make_connector_center(),
    "agent_center": make_agent_center(),
    "architecture": make_architecture(),
    "knowledge_center": make_knowledge_center(),
    "org_knowledge": make_org_knowledge(),
}


def main() -> int:
    candidates = [PORT]
    if PORT == 4000:
        candidates.extend([4002, 4003, 4004, 4005])
    elif PORT != 4002:
        candidates.append(4002)
    last_err = None
    for try_port in candidates:
        try:
            server = ThreadingHTTPServer((HOST, try_port), Handler)
        except OSError as err:
            last_err = err
            print(f"[stub] port {try_port} unavailable: {err}", flush=True)
            continue
        print(f"[stub] orchestrator dev stub listening on http://{HOST}:{try_port}", flush=True)
        print(f"[stub] try: curl http://{HOST}:{try_port}/healthz", flush=True)
        try:
            port_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".stub-port")
            with open(port_file, "w", encoding="utf-8") as fh:
                fh.write(str(try_port))
        except OSError:
            pass
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[stub] shutting down", flush=True)
            server.shutdown()
        return 0
    print(f"[stub] no free port in {candidates}: {last_err}", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())