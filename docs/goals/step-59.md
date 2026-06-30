/goal


Strategic reorientation: Forge AI is becoming an interface on top of LiteLLM, not a competing LLM platform. Currently Forge AI duplicates what LiteLLM already does natively:


- **Cost tracking** — LiteLLM `/spend/logs`, `/spend/keys`, `/spend/teams`, `/spend/users` already track every token + cost

- **Budgets / rate limits** — LiteLLM virtual keys + teams enforce per-tenant budgets

- **Guardrails** — LiteLLM has PII masking, prompt injection detection, content moderation built in

- **Model management** — LiteLLM has `/model/new`, `/model/update`, `/model/delete`

- **Virtual keys** — LiteLLM owns the key lifecycle

- **Teams / RBAC at the LLM layer** — LiteLLM teams + budgets

- **Audit logs** — LiteLLM stores every request/response in `LiteLLM_SpendLogs` table


Forge AI's job is to:

1. Mirror LiteLLM's state into a richer UI

2. Layer on Forge-specific governance (project-level approvals, multi-tenant key isolation)

3. NOT rebuild what LiteLLM does natively


The governance center page says: "Mocked LiteLLM integration; mock policy test playground. All data is client-side (governance-v2 fixtures)." — that's the smoking gun. It mocks LiteLLM instead of proxying it.


This step DELETES the Forge AI duplicates and WIRES to the real LiteLLM proxy.


Read these files first to understand what's duplicating LiteLLM:

- `apps/forge/app/governance-center/page.tsx` (8 tabs: Overview/Policies/Guardrails/Standards/LLM Control/Board/RBAC/Audit)

- `apps/forge/components/governance-v2/governance-center-shell.tsx`

- `backend/app/api/v1/policies.py` (Forge Policy CRUD — LiteLLM has guardrails config)

- `backend/app/api/v1/standards.py` (Forge standards — LiteLLM has guardrails)

- `backend/app/api/v1/governance_violations.py` (Forge violations — LiteLLM has spend logs + failures)

- `backend/app/api/v1/audit.py` (Forge audit — LiteLLM has its own audit)

- `backend/app/api/v1/terminal_costs.py` (Forge cost tracking — LiteLLM does this natively)

- `backend/app/api/v1/admin_llm_gateway.py` (already wraps LiteLLM — extend it)

- `apps/forge/lib/litellm/data.ts` (typed SDK — extend it)

- `apps/forge/lib/hooks/useLiteLLM.ts` (TanStack Query hooks — extend)

- `infra/litellm/config.yaml` (LiteLLM config — extend)

- `apps/forge/app/admin/llm-gateway/page.tsx` (LLM Gateway hub — keep, this is correct)

- `apps/forge/app/audit/page.tsx` (Audit Center — MERGE with LiteLLM audit)

- `apps/forge/app/analytics/page.tsx` (Analytics Center — wire to LiteLLM spend logs)


INVOKE THE SKILL BEFORE CODING:

  python3 -c "import webbrowser; webbrowser.open('https://docs.litellm.ai/docs/proxy/virtual_keys')"

  python3 -c "import webbrowser; webbrowser.open('https://docs.litellm.ai/docs/proxy/guardrails/quick_start')"

  python3 -c "import webbrowser; webbrowser.open('https://docs.litellm.ai/docs/proxy/cost_tracking')"


Read these LiteLLM docs to understand the admin API surface we're proxying to.


Adopt every rule. Then build in this order:


==========================================================

ZONE 1 — THE LITELLM ADMIN ENDPOINTS (canonical truth)

==========================================================


LiteLLM provides these admin endpoints natively. Forge AI should PROXY them, not reimplement:


**Spend tracking** (replaces `terminal_costs.py`):

- `GET /spend/logs` — every request with cost + tokens + latency

- `GET /spend/keys` — total spend per virtual key

- `GET /spend/users` — total spend per internal user

- `GET /spend/teams` — total spend per team

- `GET /spend/models` — total spend per model

- `GET /global/spend/teams` — team-level aggregation


**Budgets** (replaces manual budget tracking):

- `POST /team/new` (with `max_budget`)

- `POST /team/update` (update budget)

- `GET /team/list` (read budgets)

- `POST /key/generate` (with `max_budget` for per-key budget)

- `POST /budget/info` (read budget info)


**Guardrails** (replaces `policies.py` + `standards.py`):

- `POST /guardrails/update` — define a guardrail (PII, prompt injection, etc.)

- `GET /guardrails/list` — list configured guardrails

- Wire guardrails to keys/teams/models via the proxy config


**Models** (replaces `model_providers.py` catalog):

- `GET /models` — list available models

- `POST /model/new` — register a new model

- `POST /model/update` — patch model config

- `POST /model/delete` — remove a model

- `GET /model/info` — model metadata


**Virtual keys** (extend existing `admin_llm_gateway.py`):

- `POST /key/generate` — mint a virtual key (returns the value ONCE)

- `POST /key/update` — patch metadata (budget, models, team)

- `POST /key/delete` — revoke

- `GET /key/info` — key metadata

- `GET /key/list` — all keys (paginated)


**Teams** (new — currently Forge has none):

- `POST /team/new`

- `POST /team/update`

- `POST /team/delete`

- `GET /team/list`

- `GET /team/info`


**MCP servers** (already integrated in `admin_llm_gateway.py`):

- `GET /mcp/tools` — list MCP tools available

- `POST /mcp/call` — invoke an MCP tool


**Audit / Request logs**:

- `GET /request/logs` — every request with metadata


Forge AI's role: a thin facade that translates tenant-scoped queries into LiteLLM admin calls.


==========================================================

ZONE 2 — ADD A LITELLM SDK CLIENT IN THE BACKEND

==========================================================


CREATE `backend/app/services/litellm_admin.py`:


```python

"""LiteLLM admin SDK client — single point of contact with the proxy.


All Forge-side admin actions that need to query/modify LiteLLM state

go through this module. Every method takes a `tenant_id` so we can

filter LiteLLM's flat namespace into per-tenant views.


LiteLLM does not have native multi-tenancy. We use the `team_id`

field on virtual keys + teams to scope operations:

  - Each Forge tenant → one LiteLLM team

  - Each Forge project → one virtual key (under the tenant's team)

  - Each Forge user → one LiteLLM internal user


This means: tenant isolation is enforced by which team_id we pass

to LiteLLM, not by LiteLLM itself.

"""


from __future__ import annotations


import os

from typing import Any

import httpx

from app.core.logging import get_logger


logger = get_logger(__name__)


LITELLM_BASE_URL = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")

LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")



def _headers() -> dict[str, str]:

    return {

        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",

        "Content-Type": "application/json",

    }



async def _request(method: str, path: str, **kwargs) -> dict[str, Any] | list[Any]:

    """Single point of contact with LiteLLM admin API."""

    async with httpx.AsyncClient(timeout=15) as client:

        res = await getattr(client, method)(

            f"{LITELLM_BASE_URL}{path}",

            headers=_headers(),

            **kwargs,

        )

        res.raise_for_status()

        return res.json() if res.headers.get("content-type", "").startswith("application/json") else {}



# ---------------------------------------------------------------------------

# Spend tracking — direct passthrough to LiteLLM

# ---------------------------------------------------------------------------


async def list_spend_logs(

    *,

    team_id: str | None = None,

    start_date: str | None = None,

    end_date: str | None = None,

    limit: int = 100,

) -> list[dict[str, Any]]:

    """Get spend logs filtered by team (tenant)."""

    params = {"limit": limit}

    if team_id:

        params["team_id"] = team_id

    if start_date:

        params["start_date"] = start_date

    if end_date:

        params["end_date"] = end_date

    return await _request("GET", "/spend/logs", params=params)  # type: ignore



async def get_spend_by_team(team_id: str) -> dict[str, Any]:

    """Aggregate spend for one team."""

    return await _request("GET", f"/spend/team/{team_id}")  # type: ignore



async def get_global_spend() -> dict[str, Any]:

    """Global spend stats across all teams."""

    return await _request("GET", "/global/spend")  # type: ignore



# ---------------------------------------------------------------------------

# Virtual keys — extended to use Forge's tenant → team mapping

# ---------------------------------------------------------------------------


async def generate_virtual_key(

    *,

    team_id: str,

    alias: str,

    models: list[str] | None = None,

    max_budget: float | None = None,

    budget_duration: str | None = None,

    user_id: str | None = None,

    metadata: dict[str, Any] | None = None,

) -> dict[str, Any]:

    """Mint a new virtual key for a Forge tenant's team."""

    payload: dict[str, Any] = {

        "team_id": team_id,

        "key_alias": alias,

    }

    if models:

        payload["models"] = models

    if max_budget is not None:

        payload["max_budget"] = max_budget

    if budget_duration:

        payload["budget_duration"] = budget_duration

    if user_id:

        payload["user_id"] = user_id

    if metadata:

        payload["metadata"] = metadata

    return await _request("POST", "/key/generate", json=payload)  # type: ignore



async def rotate_virtual_key(

    key_alias: str,

    *,

    max_budget: float | None = None,

) -> dict[str, Any]:

    """Rotate a key — LiteLLM keeps history, marks old as rotated."""

    payload = {"key_alias": key_alias}

    if max_budget is not None:

        payload["max_budget"] = max_budget

    return await _request("POST", "/key/update", json=payload)  # type: ignore



async def revoke_virtual_key(key_alias: str) -> dict[str, Any]:

    """Revoke (delete) a key."""

    return await _request("POST", "/key/delete", json={"key_alias": key_alias})  # type: ignore



async def list_virtual_keys(team_id: str | None = None) -> list[dict[str, Any]]:

    """List keys — filter by team."""

    params = {}

    if team_id:

        params["team_id"] = team_id

    return await _request("GET", "/key/list", params=params)  # type: ignore



# ---------------------------------------------------------------------------

# Teams — map Forge tenants to LiteLLM teams

# ---------------------------------------------------------------------------


async def create_team(

    team_alias: str,

    *,

    max_budget: float | None = None,

    models: list[str] | None = None,

    metadata: dict[str, Any] | None = None,

) -> dict[str, Any]:

    payload = {"team_alias": team_alias}

    if max_budget is not None:

        payload["max_budget"] = max_budget

    if models:

        payload["models"] = models

    if metadata:

        payload["metadata"] = metadata

    return await _request("POST", "/team/new", json=payload)  # type: ignore



async def list_teams() -> list[dict[str, Any]]:

    return await _request("GET", "/team/list")  # type: ignore



# ---------------------------------------------------------------------------

# Guardrails — delegate entirely to LiteLLM

# ---------------------------------------------------------------------------


async def list_guardrails() -> list[dict[str, Any]]:

    return await _request("GET", "/guardrails/list")  # type: ignore



async def update_guardrail(name: str, config: dict[str, Any]) -> dict[str, Any]:

    return await _request("POST", "/guardrails/update", json={"guardrail_name": name, **config})  # type: ignore



# ---------------------------------------------------------------------------

# Models

# ---------------------------------------------------------------------------


async def list_models() -> list[dict[str, Any]]:

    return await _request("GET", "/models")  # type: ignore



async def get_model_info(model_name: str) -> dict[str, Any]:

    return await _request("GET", f"/model/info", params={"model": model_name})  # type: ignore



# ---------------------------------------------------------------------------

# MCP servers (already used by admin_llm_gateway.py)

# ---------------------------------------------------------------------------


async def list_mcp_tools() -> dict[str, Any]:

    return await _request("GET", "/mcp/tools")  # type: ignore
========================================================== ZONE 3 — REPLACE FORGE COST TRACKING WITH LITELLM PROXY
backend/app/api/v1/terminal_costs.py reimplements cost tracking. DELETE it (or convert to a thin LiteLLM proxy).

REWRITE backend/app/api/v1/terminal_costs.py to delegate:

python

Copy
"""Cost tracking — thin proxy to LiteLLM /spend/logs.


Forge AI does NOT compute cost from token counts. LiteLLM tracks

cost as part of its spend logging (it has the latest model prices).

We just translate the response into Forge's shape.


Old behavior (REMOVED): aggregate from our own `runs` table.

New behavior: stream from LiteLLM.

"""


from fastapi import APIRouter, Depends, Query

from app.api.deps import Principal, get_current_tenant

from app.services.litellm_admin import (

    list_spend_logs, get_spend_by_team, get_global_spend,

)

from app.core.audit import audit


router = APIRouter(prefix="/costs", tags=["costs"])



@router.get("/sessions/{session_id}/cost")

@audit(action="costs.session", target_type="session")

async def get_session_cost(

    session_id: str,

    principal: Principal = Depends(get_current_tenant),

):

    """Session cost = sum of spend logs where session_id is in metadata."""

    logs = await list_spend_logs(

        team_id=principal.tenant.litellm_team_id,

        limit=1000,

    )

    session_logs = [

        l for l in logs

        if l.get("metadata", {}).get("session_id") == session_id

    ]

    return {

        "session_id": session_id,

        "total_cost": sum(l.get("spend", 0) for l in session_logs),

        "total_tokens": sum(l.get("total_tokens", 0) for l in session_logs),

        "request_count": len(session_logs),

        "logs": session_logs[:50],  # recent 50

    }



@router.get("")

@audit(action="costs.list", target_type="tenant")

async def list_costs(

    principal: Principal = Depends(get_current_tenant),

    days: int = Query(default=7, le=90),

):

    """List cost entries for the tenant (recent N days)."""

    from datetime import datetime, timedelta

    start = (datetime.utcnow() - timedelta(days=days)).isoformat()

    logs = await list_spend_logs(

        team_id=principal.tenant.litellm_team_id,

        start_date=start,

        limit=500,

    )

    return [

        {

            "id": l.get("request_id"),

            "timestamp": l.get("startTime"),

            "model": l.get("model"),

            "cost": l.get("spend", 0),

            "tokens": l.get("total_tokens", 0),

            "key_alias": l.get("key_alias"),

            "user": l.get("user"),

        }

        for l in logs

    ]



@router.get("/burn-rate")

@audit(action="costs.burn_rate", target_type="tenant")

async def burn_rate(

    principal: Principal = Depends(get_current_tenant),

):

    """Current spend rate vs budget."""

    team_spend = await get_spend_by_team(principal.tenant.litellm_team_id)

    return {

        "team_id": principal.tenant.litellm_team_id,

        "spend": team_spend.get("spend", 0),

        "budget": team_spend.get("max_budget", 0),

        "remaining": max(0, team_spend.get("max_budget", 0) - team_spend.get("spend", 0)),

        "burn_rate_24h": team_spend.get("daily_spend", 0),

        "days_until_exhausted": (

            team_spend.get("max_budget", 0) / max(team_spend.get("daily_spend", 1), 0.01)

            if team_spend.get("max_budget") else None

        ),

    }
========================================================== ZONE 4 — REPLACE FORGE POLICIES WITH LITELLM GUARDRAILS
backend/app/api/v1/policies.py has Forge's Policy CRUD — but LiteLLM has guardrails. REWRITE this to be a thin proxy:

python

Copy
"""Policies — alias for LiteLLM guardrails.


Forge AI does not maintain its own policy engine. All guardrails

(PII masking, prompt injection detection, content moderation, etc.)

are configured in LiteLLM and applied transparently to every LLM

call through the proxy.


The Forge "Policies" page just lists + edits LiteLLM guardrails.


OLD POLICY MODEL (REMOVED):

  - policies table with rule_type, action, severity

  - policy_engine.py evaluated rules before each call

  - Custom DSL for rule authoring


NEW MODEL:

  - LiteLLM guardrails (presets + custom)

  - Apply via key/team metadata

  - Tested via /chat/completions with probe inputs

"""


from fastapi import APIRouter, Depends, HTTPException

from pydantic import BaseModel, Field

from typing import Any

from app.api.deps import Principal, get_current_tenant

from app.services.litellm_admin import list_guardrails, update_guardrail

from app.core.audit import audit


router = APIRouter(prefix="/policies", tags=["policies"])



class PolicyRead(BaseModel):

    """Forge view of a LiteLLM guardrail."""

    id: str

    name: str

    type: str  # 'pii_masking', 'prompt_injection', 'content_moderation', 'custom'

    config: dict[str, Any]

    enabled: bool

    applies_to: list[str] = Field(default_factory=list)  # list of team_ids / key_aliases



class PolicyUpdate(BaseModel):

    config: dict[str, Any] | None = None

    enabled: bool | None = None



@router.get("", response_model=list[PolicyRead])

@audit(action="policies.list", target_type="guardrail")

async def list_policies(

    principal: Principal = Depends(get_current_tenant),

):

    """List guardrails — proxied from LiteLLM."""

    raw = await list_guardrails()

    return [

        PolicyRead(

            id=g.get("guardrail_name", g.get("name", "")),

            name=g.get("guardrail_name", g.get("name", "")),

            type=g.get("type", "custom"),

            config=g.get("litellm_params", g.get("config", {})),

            enabled=g.get("enabled", True),

            applies_to=g.get("applies_to", []),

        )

        for g in raw

    ]



@router.patch("/{policy_id}", response_model=PolicyRead)

@audit(action="policies.update", target_type="guardrail")

async def update_policy(

    policy_id: str,

    body: PolicyUpdate,

    principal: Principal = Depends(get_current_tenant),

):

    """Update a guardrail — proxied to LiteLLM."""

    config = body.config or {}

    result = await update_guardrail(policy_id, {"enabled": body.enabled, **config})

    return PolicyRead(

        id=policy_id,

        name=policy_id,

        type=result.get("type", "custom"),

        config=result.get("litellm_params", config),

        enabled=result.get("enabled", body.enabled or True),

    )
DELETE backend/app/services/policy_engine.py — no longer needed.

========================================================== ZONE 5 — REPLACE FORGE STANDARDS WITH LITELLM GUARDRAILS
backend/app/api/v1/standards.py has Forge's standard attestations. ATTESTATIONS (SOC 2, GDPR) are still Forge-specific (regulatory, not LLM) — KEEP these. But make them READ-ONLY view of LiteLLM guardrails + manual attestations.

REWRITE backend/app/api/v1/standards.py:

python

Copy
"""Standards — combines LiteLLM guardrails with manual attestations.


Two types of standards:

  1. LLM safety standards (PII masking, content moderation, etc.)

     → These are LiteLLM guardrails, listed via /policies

  2. Regulatory standards (SOC 2, GDPR, HIPAA)

     → Manual attestations, stored in Forge

"""


from fastapi import APIRouter, Depends

from pydantic import BaseModel, Field

from datetime import datetime

from typing import Literal

from uuid import UUID

from app.api.deps import Principal, get_current_tenant

from app.services.litellm_admin import list_guardrails

from app.db.models.standard import Standard, StandardAttestation

from app.core.audit import audit


router = APIRouter(prefix="/standards", tags=["standards"])



class StandardRead(BaseModel):

    id: str

    name: str

    category: Literal["llm_safety", "regulatory", "internal"]

    source: Literal["litellm_guardrail", "manual_attestation", "external"]

    status: Literal["active", "pending", "deprecated"]

    description: str | None = None

    attested_at: datetime | None = None

    config: dict | None = None



@router.get("", response_model=list[StandardRead])

@audit(action="standards.list", target_type="standard")

async def list_standards(

    principal: Principal = Depends(get_current_tenant),

    db = None,

):

    """Combine LiteLLM guardrails + manual attestations."""

    # LLM safety standards from LiteLLM

    guardrails = await list_guardrails()

    llm_standards = [

        StandardRead(

            id=g.get("guardrail_name"),

            name=g.get("guardrail_name"),

            category="llm_safety",

            source="litellm_guardrail",

            status="active" if g.get("enabled", True) else "pending",

            description=g.get("description"),

            config=g.get("litellm_params"),

        )

        for g in guardrails

    ]

    

    # Manual attestations from Forge

    # (read from standard_attestations table)

    attestations = await db.execute(

        select(StandardAttestation).where(StandardAttestation.tenant_id == principal.tenant_id)

    )

    manual_standards = [

        StandardRead(

            id=str(a.id),

            name=a.standard_name,

            category="regulatory",

            source="manual_attestation",

            status=a.status,

            attested_at=a.attested_at,

        )

        for a in attestations.scalars()

    ]

    

    return llm_standards + manual_standards
========================================================== ZONE 6 — DELETE FORGE GOVERNANCE VIOLATIONS (USE LITELLM AUDIT)
backend/app/api/v1/governance_violations.py reimplements violation tracking. DELETE the local violations table — LiteLLM already logs every request + response + cost.

REWRITE as a thin proxy:

python

Copy
"""Governance violations — proxied from LiteLLM request logs.


Forge AI does NOT maintain its own violations table. LiteLLM

logs every request with:

  - Request payload (truncated for PII)

  - Response payload (truncated)

  - Cost + tokens

  - Whether guardrails blocked the request (status_code != 200)

  - Latency


The Governance Violations view = filter request logs by

status_code != 200 OR spend > threshold.


OLD BEHAVIOR (REMOVED):

  - governance_violations table with violation_type, severity

  - Manual polling of policies

  - Custom severity scoring


NEW BEHAVIOR:

  - LiteLLM /request/logs returns the canonical record

  - Forge adds forge-specific metadata (linked_to_project, etc.)

  - UI shows "violations" but they're really just failed LLM calls

"""


from fastapi import APIRouter, Depends, Query

from app.api.deps import Principal, get_current_tenant

from app.services.litellm_admin import list_spend_logs

from app.core.audit import audit


router = APIRouter(prefix="/governance/violations", tags=["governance"])



@router.get("")

@audit(action="governance.violations.list", target_type="tenant")

async def list_violations(

    principal: Principal = Depends(get_current_tenant),

    severity: str = Query(default="all"),  # all / high / medium

    days: int = Query(default=7, le=90),

):

    """Violations = LiteLLM requests that failed guardrails or over-budget."""

    from datetime import datetime, timedelta

    start = (datetime.utcnow() - timedelta(days=days)).isoformat()

    logs = await list_spend_logs(

        team_id=principal.tenant.litellm_team_id,

        start_date=start,

        limit=500,

    )

    # A "violation" = status != 200 or guardrail_action present

    violations = []

    for log in logs:

        metadata = log.get("metadata", {})

        if log.get("status") not in (200, "200", None) or metadata.get("guardrail_action"):

            violations.append({

                "id": log.get("request_id"),

                "timestamp": log.get("startTime"),

                "model": log.get("model"),

                "severity": "high" if log.get("status") in (403, 429, "403", "429") else "medium",

                "kind": metadata.get("guardrail_action", "unknown"),

                "description": metadata.get("guardrail_reason", "Guardrail blocked or budget exceeded"),

                "actor": log.get("user"),

                "key_alias": log.get("key_alias"),

            })

    return violations
DELETE backend/app/db/models/governance_violation.py and the polling logic.

========================================================== ZONE 7 — MERGE FORGE AUDIT WITH LITELLM AUDIT
backend/app/api/v1/audit.py stores Forge-side actions (who-clicked-what). KEEP this — it's Forge-specific (not LLM traffic).

But ADD a tab in the Audit Center that shows LiteLLM request logs (the LLM traffic audit). Two layers:

1.
Forge audit log — user actions in Forge UI (who created a workflow, who approved an ADR)
2.
LLM traffic audit — every LLM request that went through LiteLLM
python

Copy
# In backend/app/api/v1/audit.py

@router.get("/llm-traffic")

@audit(action="audit.llm_traffic", target_type="tenant")

async def llm_traffic(

    principal: Principal = Depends(get_current_tenant),

    days: int = Query(default=7),

    limit: int = Query(default=100),

):

    """LLM traffic audit — proxied from LiteLLM /spend/logs."""

    from datetime import datetime, timedelta

    start = (datetime.utcnow() - timedelta(days=days)).isoformat()

    return await list_spend_logs(

        team_id=principal.tenant.litellm_team_id,

        start_date=start,

        limit=limit,

    )
In apps/forge/app/audit/page.tsx, add a tab "LLM Traffic" that calls this endpoint and shows each request with model + cost + tokens + key_alias.

========================================================== ZONE 8 — DELETE FORGE RBAC (LITELLM HAS TEAMS)
backend/app/api/v1/rbac.py implements Forge-side RBAC with Roles + Permissions. This is still needed (Forge has Forge-specific resources: workflows, agents, ideas). KEEP this.

BUT add a layer that syncs LiteLLM team membership with Forge tenant membership. When a user joins a Forge tenant:

1.
Add them to the corresponding LiteLLM team
2.
Mint a virtual key for them (with budget)
3.
Sync on every change
CREATE backend/app/services/team_sync.py:

python

Copy
"""Sync Forge tenants ↔ LiteLLM teams.


When a tenant is created or a user joins:

  1. Create the LiteLLM team (if not exists) with the tenant's budget

  2. Mint a virtual key for each user

  3. Apply guardrails as tenant-level metadata


LiteLLM does NOT do multi-tenancy natively. We map:

  Forge tenant (UUID)  →  LiteLLM team (string alias)

  Forge user (UUID)    →  LiteLLM internal user (string email)

  Forge project (UUID) →  LiteLLM virtual key (per project)

"""


from app.services.litellm_admin import (

    create_team, list_teams, generate_virtual_key, list_virtual_keys,

)



async def ensure_team_for_tenant(tenant_id: str, tenant_name: str, max_budget: float):

    """Idempotent — create LiteLLM team if it doesn't exist."""

    teams = await list_teams()

    existing = next((t for t in teams if t.get("team_alias") == tenant_id), None)

    if existing:

        return existing

    return await create_team(

        team_alias=tenant_id,

        max_budget=max_budget,

        metadata={"forge_tenant_name": tenant_name, "managed_by": "forge-ai"},

    )



async def ensure_key_for_project(

    tenant_id: str,

    project_id: str,

    user_email: str,

    models: list[str] | None = None,

    max_budget: float | None = None,

):

    """Mint a virtual key for a project + user combo."""

    keys = await list_virtual_keys(team_id=tenant_id)

    alias = f"{tenant_id}:{project_id}:{user_email}"

    if any(k.get("key_alias") == alias for k in keys):

        return next(k for k in keys if k.get("key_alias") == alias)

    return await generate_virtual_key(

        team_id=tenant_id,

        alias=alias,

        models=models,

        max_budget=max_budget,

        user_id=user_email,

        metadata={

            "forge_tenant_id": tenant_id,

            "forge_project_id": project_id,

        },

    )
HOOK this into tenant/user creation in backend/app/services/tenant_service.py and backend/app/services/user_service.py.

========================================================== ZONE 9 — GOVERNANCE CENTER UI: SHOW LITELLM TRUTH
apps/forge/app/governance-center/page.tsx has 8 tabs. REWIRE each to LiteLLM:

Overview — global spend + per-team breakdown (LiteLLM /global/spend)
Policies — list LiteLLM guardrails (/policies → /guardrails/list)
Guardrails — same as Policies (consolidate)
Standards — combined LiteLLM guardrails + manual attestations
LLM Control — model catalog from LiteLLM (/models)
Board — keep (Forge-specific for governance decisions)
RBAC — keep (Forge has Forge-specific resources)
Audit — merge Forge audit + LiteLLM traffic
The page comment says "Mocked LiteLLM integration; mock policy test playground." — that entire mock infrastructure gets replaced.

DELETE apps/forge/lib/governance/data.ts if it has hardcoded mock data, or refactor it to proxy through apps/forge/lib/litellm/data.ts.

========================================================== ZONE 10 — ADMIN LLM GATEWAY: EXTEND, DON'T REPLACE
backend/app/api/v1/admin_llm_gateway.py already wraps some LiteLLM calls (tenants, keys, MCP, health). EXTEND it with new endpoints:

python

Copy
# Add to admin_llm_gateway.py


@router.get("/spend/teams", response_model=list[SpendByTeam])

async def spend_by_teams(principal: Principal):

    """Per-team spend aggregation."""

    teams = await list_teams()

    return [

        SpendByTeam(

            team_id=t.get("team_id"),

            team_alias=t.get("team_alias"),

            spend=t.get("spend", 0),

            max_budget=t.get("max_budget", 0),

        )

        for t in teams

    ]



@router.get("/spend/models", response_model=list[SpendByModel])

async def spend_by_models(principal: Principal):

    """Per-model spend breakdown."""

    from app.services.litellm_admin import _request

    return await _request("GET", "/spend/models")



@router.get("/guardrails", response_model=list[GuardrailRead])

async def list_guardrails(principal: Principal):

    return await list_guardrails()



@router.post("/guardrails/{name}/enable", response_model=GuardrailRead)

async def enable_guardrail(name: str, principal: Principal):

    return await update_guardrail(name, {"enabled": True})



@router.post("/guardrails/{name}/disable", response_model=GuardrailRead)

async def disable_guardrail(name: str, principal: Principal):

    return await update_guardrail(name, {"enabled": False})



@router.get("/models", response_model=list[ModelInfo])

async def list_models(principal: Principal):

    """Model catalog from LiteLLM."""

    from app.services.litellm_admin import list_models as litellm_list

    models = await litellm_list()

    return [

        ModelInfo(

            name=m.get("id"),

            provider=m.get("id", "").split("/")[0] if "/" in m.get("id", "") else "unknown",

            max_tokens=m.get("max_tokens"),

            max_input_tokens=m.get("max_input_tokens"),

            input_cost=m.get("input_cost_per_token", 0) * 1_000_000,  # per million

            output_cost=m.get("output_cost_per_token", 0) * 1_000_000,

        )

        for m in models.get("data", [])

    ]
========================================================== ZONE 11 — ANALYTICS CENTER: LITELLM IS THE SOURCE
apps/forge/app/analytics/page.tsx has 10+ chart widgets. Most should query LiteLLM spend data:

Total cost — sum of LiteLLM spend logs for tenant
Cost trend — daily spend bucketed from logs
Active runs — from Forge runs table (Forge-specific)
Acceptance rate — from Forge (Forge-specific)
Agent usage — group LiteLLM logs by metadata.agent_id
Token usage by model — group LiteLLM logs by model
Provider cost breakdown — parse model name prefix
Provider leaderboard — same
CREATE apps/forge/lib/hooks/useAnalytics.ts:

typescript

Copy
import { useQuery } from '@tanstack/react-query';

import { forgeFetch } from '@/lib/forge-api';


export function useSpendByDay(days: number = 30) {

  return useQuery({

    queryKey: ['analytics', 'spend-by-day', days],

    queryFn: () => forgeFetch(`/admin/llm-gateway/spend/teams?days=${days}`),

    refetchInterval: 60_000,

  });

}


export function useSpendByModel(days: number = 30) {

  return useQuery({

    queryKey: ['analytics', 'spend-by-model', days],

    queryFn: () => forgeFetch(`/admin/llm-gateway/spend/models?days=${days}`),

    refetchInterval: 60_000,

  });

}


export function useSpendLogs(days: number = 7, limit: number = 200) {

  return useQuery({

    queryKey: ['analytics', 'spend-logs', days, limit],

    queryFn: () => forgeFetch(`/costs?days=${days}&limit=${limit}`),

    refetchInterval: 30_000,

  });

}
In apps/forge/components/analytics/widgets/CostTrendWidget.tsx, REPLACE the local aggregation with useSpendByDay().

========================================================== ZONE 12 — TEST SCRIPT
CREATE backend/scripts/test_litellm_proxy.py:

python

Copy
#!/usr/bin/env python3

"""Test that Forge correctly proxies to LiteLLM admin API.


Run: docker compose exec backend python -m scripts.test_litellm_proxy

"""


import asyncio, sys, httpx, os


LITELLM_BASE = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")

LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")

FORGE_BASE = "http://backend:8000/api/v1"



async def get_forge_token():

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={"grant_type": "password", "client_id": "forge-backend",

                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},

        )

        return res.json()["access_token"]



async def test(name, fn):

    try:

        ok = await fn()

        print(f"{'✓' if ok else '✗'} {name}")

        return ok

    except Exception as e:

        print(f"✗ {name} — {e}")

        return False



async def main():

    token = await get_forge_token()

    headers = {"Authorization": f"Bearer {token}"}

    passed = failed = 0

    

    async with httpx.AsyncClient(timeout=15) as c:

        # Direct LiteLLM calls (sanity check)

        async def direct_spend():

            r = await c.get(f"{LITELLM_BASE}/spend/logs?limit=5",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200

        

        async def direct_models():

            r = await c.get(f"{LITELLM_BASE}/models",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200

        

        async def direct_guardrails():

            r = await c.get(f"{LITELLM_BASE}/guardrails/list",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200

        

        async def direct_teams():

            r = await c.get(f"{LITELLM_BASE}/team/list",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200

        

        print("=" * 60 + "\nDIRECT LITELLM (sanity)\n" + "=" * 60)

        if await test("LiteLLM /spend/logs reachable", direct_spend): passed += 1

        else: failed += 1

        if await test("LiteLLM /models reachable", direct_models): passed += 1

        else: failed += 1

        if await test("LiteLLM /guardrails/list reachable", direct_guardrails): passed += 1

        else: failed += 1

        if await test("LiteLLM /team/list reachable", direct_teams): passed += 1

        else: failed += 1

        

        # Forge proxies

        async def forge_costs():

            r = await c.get(f"{FORGE_BASE}/costs?days=7", headers=headers)

            return r.status_code == 200

        

        async def forge_burn_rate():

            r = await c.get(f"{FORGE_BASE}/costs/burn-rate", headers=headers)

            return r.status_code == 200

        

        async def forge_policies():

            r = await c.get(f"{FORGE_BASE}/policies", headers=headers)

            return r.status_code == 200

        

        async def forge_standards():

            r = await c.get(f"{FORGE_BASE}/standards", headers=headers)

            return r.status_code == 200

        

        async def forge_violations():

            r = await c.get(f"{FORGE_BASE}/governance/violations?days=7", headers=headers)

            return r.status_code == 200

        

        async def forge_spend_teams():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/spend/teams", headers=headers)

            return r.status_code == 200

        

        async def forge_spend_models():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/spend/models", headers=headers)

            return r.status_code == 200

        

        async def forge_guardrails():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/guardrails", headers=headers)

            return r.status_code == 200

        

        async def forge_models():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/models", headers=headers)

            return r.status_code == 200

        

        async def forge_llm_traffic():

            r = await c.get(f"{FORGE_BASE}/audit/llm-traffic?days=7&limit=10", headers=headers)

            return r.status_code == 200

        

        async def forge_audit():

            r = await c.get(f"{FORGE_BASE}/audit", headers=headers)

            return r.status_code == 200

        

        print("\n" + "=" * 60 + "\nFORGE → LITELLM PROXIES\n" + "=" * 60)

        for name, fn in [

            ("GET /costs → LiteLLM /spend/logs", forge_costs),

            ("GET /costs/burn-rate → LiteLLM /spend/teams", forge_burn_rate),

            ("GET /policies → LiteLLM /guardrails/list", forge_policies),

            ("GET /standards → combined", forge_standards),

            ("GET /governance/violations → LiteLLM logs", forge_violations),

            ("GET /admin/llm-gateway/spend/teams", forge_spend_teams),

            ("GET /admin/llm-gateway/spend/models", forge_spend_models),

            ("GET /admin/llm-gateway/guardrails", forge_guardrails),

            ("GET /admin/llm-gateway/models", forge_models),

            ("GET /audit/llm-traffic → LiteLLM logs", forge_llm_traffic),

            ("GET /audit → Forge audit log", forge_audit),

        ]:

            if await test(name, fn):

                passed += 1

            else:

                failed += 1

    

    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
Run:

bash

Copy
docker compose exec backend python -m scripts.test_litellm_proxy
========================================================== ZONE 13 — SEED LITELLM GUARDRAILS (CONFIGURE TRUTH)
CREATE backend/scripts/seed_litellm_guardrails.py:

python

Copy
#!/usr/bin/env python3

"""Configure default LiteLLM guardrails via the proxy.


These are not stored in Forge — they're written directly to

LiteLLM's config. Once configured, every LLM request through the

proxy gets these protections.


Run: docker compose exec backend python -m scripts.seed_litellm_guardrails

"""


import asyncio, os

import httpx


LITELLM_BASE = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")

LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")



SEED_GUARDRAILS = [

    {

        "guardrail_name": "pii_masking",

        "litellm_params": {

            "type": "pii_masking",

            "pii_entities": ["email", "phone", "ssn", "credit_card"],

            "mask_pattern": "[REDACTED_{type}]",

        },

        "guardrail_info": {

            "description": "Mask PII (emails, phones, SSNs) before sending to LLM",

            "applied_to": ["all_keys"],

        },

    },

    {

        "guardrail_name": "prompt_injection_detection",

        "litellm_params": {

            "type": "prompt_injection",

            "threshold": 0.85,

            "action": "block",  # block / log / warn

        },

        "guardrail_info": {

            "description": "Detect and block prompt injection attempts",

            "applied_to": ["all_keys"],

        },

    },

    {

        "guardrail_name": "content_moderation",

        "litellm_params": {

            "type": "content_filter",

            "categories": ["violence", "hate", "sexual", "self_harm"],

            "threshold": 0.7,

        },

        "guardrail_info": {

            "description": "Block unsafe content in both input and output",

            "applied_to": ["all_keys"],

        },

    },

    {

        "guardrail_name": "secret_detection",

        "litellm_params": {

            "type": "secret_detection",

            "patterns": ["api_key", "private_key", "password"],

            "action": "block",

        },

        "guardrail_info": {

            "description": "Block requests that contain secrets (API keys, passwords)",

            "applied_to": ["all_keys"],

        },

    },

]



async def seed():

    async with httpx.AsyncClient(timeout=30) as client:

        headers = {"Authorization": f"Bearer {LITELLM_KEY}"}

        

        for guardrail in SEED_GUARDRAILS:

            try:

                res = await client.post(

                    f"{LITELLM_BASE}/guardrails/update",

                    headers=headers,

                    json=guardrail,

                )

                if res.status_code in (200, 201):

                    print(f"✓ Guardrail: {guardrail['guardrail_name']}")

                else:

                    print(f"✗ Failed: {guardrail['guardrail_name']} — {res.text[:200]}")

            except Exception as e:

                print(f"✗ Error: {guardrail['guardrail_name']} — {e}")

        

        print(f"\n✅ Seeded {len(SEED_GUARDRAILS)} LiteLLM guardrails")

        print("\nNow every LLM request through the proxy gets:")

        print("  - PII masking (emails, phones, SSNs)")

        print("  - Prompt injection detection")

        print("  - Content moderation (violence, hate, sexual)")

        print("  - Secret detection (API keys, passwords)")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_litellm_guardrails
VERIFY each guardrail is active by sending a test request:

bash

Copy
curl -X POST http://localhost:4000/chat/completions \

  -H "Authorization: Bearer $LITELLM_KEY" \

  -H "Content-Type: application/json" \

  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "My SSN is 123-45-6789"}]}'
The response should show "123-45-6789" replaced with "[REDACTED_ssn]".

========================================================== ZONE 14 — UPDATE LITELLM CONFIG TO ENABLE GUARDRAILS
UPDATE infra/litellm/config.yaml to declare the guardrails globally:

yaml

Copy
# infra/litellm/config.yaml — Forge AI v2.0 with LiteLLM guardrails

#

# DL-025: Provider Abstraction Layer. The backend talks ONLY to

# http://litellm:4000; this file picks the upstream providers,

# sets spend / rate limits, and exposes the model catalog that the

# orchestrator enumerates.

#

# Guardrails are declared here as the source of truth. Per-key or

# per-team overrides go through the admin API.


model_list:

  - model_name: gpt-4o

    litellm_params:

      model: openai/gpt-4o

      api_key: os.environ/OPENAI_API_KEY

  - model_name: gpt-4o-mini

    litellm_params:

      model: openai/gpt-4o-mini

      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-3-5-sonnet

    litellm_params:

      model: anthropic/claude-3-5-sonnet-20241022

      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: claude-3-5-haiku

    litellm_params:

      model: anthropic/claude-3-5-haiku-20241022

      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: text-embedding-3-small

    litellm_params:

      model: openai/text-embedding-3-small

      api_key: os.environ/OPENAI_API_KEY

      dimensions: 1536

  - model_name: text-embedding-3-large

    litellm_params:

      model: openai/text-embedding-3-large

      api_key: os.environ/OPENAI_API_KEY

      dimensions: 3076


router_settings:

  num_retries: 3

  timeout: 60

  redis_host: os.environ/REDIS_HOST

  redis_port: os.environ/REDIS_PORT


litellm_settings:

  drop_params: true

  set_verbose: false

  telemetry: false

  database_url: os.environ/DATABASE_URL

  

  # Apply guardrails globally to all requests

  guardrails:

    - pii_masking

    - prompt_injection_detection

    - content_moderation

    - secret_detection


general_settings:

  master_key: os.environ/LITELLM_MASTER_KEY

  database_type: "postgres"
After updating, restart LiteLLM:

bash

Copy
docker compose restart litellm
========================================================== ZONE 15 — VERIFICATION CHECKLIST
All must pass:

 seed_litellm_guardrails.py writes 4 guardrails to LiteLLM
 curl .../spend/logs returns LiteLLM native data
 curl .../models returns the 6 configured models
 curl .../guardrails/list returns 4 guardrails
 curl .../team/list shows the seeded tenants (acme-corp)
 test_litellm_proxy.py shows 15/15 passed (4 direct + 11 proxies)
 curl -X POST .../chat/completions with PII content → PII gets masked in response
 curl -X POST .../chat/completions with prompt injection → returns 400
 curl .../admin/llm-gateway/spend/teams returns aggregated spend
 curl .../admin/llm-gateway/spend/models returns per-model spend
 curl .../admin/llm-gateway/guardrails returns 4 guardrails with enabled state
 curl .../admin/llm-gateway/models returns 6 models with pricing
 curl .../costs?days=7 returns LiteLLM spend logs (not from a Forge table)
 curl .../costs/burn-rate returns current burn rate
 curl .../policies returns the 4 LiteLLM guardrails (not from Forge Policy table)
 curl .../standards returns 4 LLM guardrails + N manual attestations
 curl .../governance/violations returns failed/over-budget requests from LiteLLM logs
 curl .../audit/llm-traffic returns LiteLLM request logs
 Analytics Center Cost Trend widget shows real LiteLLM spend (not zeros)
 Analytics Center Token Usage by Model widget shows real model breakdown
 Governance Center Policies tab lists the 4 LiteLLM guardrails
 Governance Center LLM Control tab shows the 6 LiteLLM models
 Admin LLM Gateway → Tenants page shows the LiteLLM team for acme-corp
 Admin LLM Gateway → Health page shows LiteLLM status (healthy)
 When a tenant is created, a LiteLLM team is auto-created
 When a user joins, a virtual key is auto-minted
 DELETED: backend/app/services/policy_engine.py (no longer needed)
 DELETED: backend/app/db/models/governance_violation.py (no violations table)
 governance-center/page.tsx no longer has "Mocked LiteLLM integration" — it now proxies real LiteLLM
 Cost tracking is sourced from LiteLLM, not from Forge's runs table
========================================================== CONSTRAINTS
DO NOT remove backend/app/api/v1/audit.py — Forge audit is Forge-specific
DO NOT remove backend/app/api/v1/rbac.py — Forge RBAC is Forge-specific
DO NOT remove backend/app/api/v1/standards.py entirely — manual attestations are still Forge-specific
KEEP infra/litellm/config.yaml — it's the source of truth for LiteLLM
All mutations to LiteLLM state MUST go through the master key, never via SDK user keys
Tenant isolation MUST be enforced by mapping tenants to LiteLLM teams, NOT by trusting tenant_id from clients
Cost tracking MUST come from LiteLLM /spend/logs (latest prices), NOT from Forge's own token count math
Guardrails MUST be configured in LiteLLM (single source of truth), NOT in a Forge Policy table
========================================================== DELIVERABLE
backend/app/services/litellm_admin.py (Zone 2) — full LiteLLM SDK client
backend/app/services/team_sync.py (Zone 8) — tenant ↔ team sync
backend/app/api/v1/terminal_costs.py (Zone 3) — rewritten as LiteLLM proxy
backend/app/api/v1/policies.py (Zone 4) — rewritten as guardrails proxy
backend/app/api/v1/standards.py (Zone 5) — combined view
backend/app/api/v1/governance_violations.py (Zone 6) — LiteLLM-derived
backend/app/api/v1/audit.py (Zone 7) — add /llm-traffic endpoint
backend/app/api/v1/admin_llm_gateway.py (Zone 10) — extended with spend/guardrails/models
backend/scripts/seed_litellm_guardrails.py (Zone 13)
backend/scripts/test_litellm_proxy.py (Zone 12)
infra/litellm/config.yaml (Zone 14) — guardrails declared globally
apps/forge/lib/hooks/useAnalytics.ts (Zone 11)
apps/forge/lib/hooks/useLiteLLM.ts — extend with new endpoints
apps/forge/app/governance-center/page.tsx — wire all tabs to LiteLLM (Zone 9)
apps/forge/app/audit/page.tsx — add "LLM Traffic" tab (Zone 7)
DELETE: backend/app/services/policy_engine.py
DELETE: backend/app/db/models/governance_violation.py (or keep model unused)
All 27 verification items pass
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — Forge audit log (user actions), Forge RBAC (Forge resources), manual standard attestations (regulatory), workflow approvals, approval gates