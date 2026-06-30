

Copy
/goal


Re-do Phase 2 (Agents) with full validation. The previous prompt didn't work perfectly — this time: (1) validate all existing backend routes, (2) add proper seed data that's inserted into the database, (3) test every CRUD endpoint with real API calls, (4) wire the frontend to the real data. Read .claude/design-system/ first.


The empty state in the screenshot shows "No agents registered yet" — this means the frontend is calling the API but the API returns empty. We need to fix BOTH sides: backend seed data + frontend integration.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "React Query optimistic update CRUD list detail pattern" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "FastAPI SQLAlchemy Pydantic seed data alembic migration" --domain ux-guideline -f markdown


Adopt every rule. Then build in this EXACT order:


==========================================================

ZONE 1 — VALIDATE BACKEND ROUTES EXIST

==========================================================


FIRST: Read backend/app/api/v1/agents.py to see what routes exist. The backend should have agent_registry service.


If these routes DON'T exist, ADD them:


```python

# backend/app/api/v1/agents.py

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy.ext.asyncio import AsyncSession

from typing import List, Optional

from uuid import uuid4


from app.core.auth import get_current_tenant

from app.db.base import get_db

from app.db.models import Agent, ModelProvider, Runtime, Assignment

from app.schemas.agents import (

    AgentCreate, AgentUpdate, AgentOut,

    ModelProviderCreate, ModelProviderOut,

    RuntimeCreate, RuntimeOut,

    AssignmentCreate, AssignmentOut,

)


router = APIRouter(prefix="/agents", tags=["agents"])



@router.get("", response_model=List[AgentOut])

async def list_agents(

    tenant_id: str = Depends(get_current_tenant),

    status: Optional[str] = None,

    type: Optional[str] = None,

    db: AsyncSession = Depends(get_db),

):

    """List all agents for the current tenant."""

    query = db.query(Agent).filter(Agent.tenant_id == tenant_id)

    if status:

        query = query.filter(Agent.status == status)

    if type:

        query = query.filter(Agent.type == type)

    return query.order_by(Agent.created_at.desc()).all()



@router.post("", response_model=AgentOut, status_code=201)

async def create_agent(

    data: AgentCreate,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    """Register a new agent."""

    agent = Agent(

        id=str(uuid4()),

        tenant_id=tenant_id,

        name=data.name,

        type=data.type,

        runtime=data.runtime,

        version=data.version or "1.0.0",

        provider_id=data.provider_id,

        model=data.model,

        description=data.description,

        capabilities=data.capabilities or [],

        status="active",

    )

    db.add(agent)

    await db.commit()

    await db.refresh(agent)

    return agent



@router.get("/{agent_id}", response_model=AgentOut)

async def get_agent(

    agent_id: str,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    """Get a specific agent."""

    agent = db.query(Agent).filter(

        Agent.id == agent_id, 

        Agent.tenant_id == tenant_id

    ).first()

    if not agent:

        raise HTTPException(404, "Agent not found")

    return agent



@router.patch("/{agent_id}", response_model=AgentOut)

async def update_agent(

    agent_id: str,

    data: AgentUpdate,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    """Update an agent."""

    agent = db.query(Agent).filter(

        Agent.id == agent_id, 

        Agent.tenant_id == tenant_id

    ).first()

    if not agent:

        raise HTTPException(404, "Agent not found")

    

    update_data = data.dict(exclude_unset=True)

    for key, value in update_data.items():

        setattr(agent, key, value)

    

    await db.commit()

    await db.refresh(agent)

    return agent



@router.delete("/{agent_id}", status_code=204)

async def delete_agent(

    agent_id: str,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    """Delete an agent."""

    agent = db.query(Agent).filter(

        Agent.id == agent_id, 

        Agent.tenant_id == tenant_id

    ).first()

    if not agent:

        raise HTTPException(404, "Agent not found")

    

    db.delete(agent)

    await db.commit()

    return None



@router.post("/{agent_id}/test")

async def test_agent(

    agent_id: str,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    """Test if an agent is reachable."""

    agent = db.query(Agent).filter(

        Agent.id == agent_id, 

        Agent.tenant_id == tenant_id

    ).first()

    if not agent:

        raise HTTPException(404, "Agent not found")

    

    # Simulate test (real impl: spawn a test process)

    return {

        "status": "ok",

        "message": f"Agent {agent.name} is reachable",

        "latency_ms": 42,

    }



# MODEL PROVIDERS

@router.get("/../providers", response_model=List[ModelProviderOut])

# Note: this should be in providers.py but include here for reference

# Better: put in separate providers.py file
python

Copy
# backend/app/api/v1/providers.py

from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.ext.asyncio import AsyncSession

from typing import List, Optional

from uuid import uuid4


from app.core.auth import get_current_tenant

from app.db.base import get_db

from app.db.models import ModelProvider

from app.schemas.agents import ModelProviderCreate, ModelProviderOut


router = APIRouter(prefix="/providers", tags=["providers"])



@router.get("", response_model=List[ModelProviderOut])

async def list_providers(

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    return db.query(ModelProvider).filter(

        ModelProvider.tenant_id == tenant_id

    ).order_by(ModelProvider.created_at).all()



@router.post("", response_model=ModelProviderOut, status_code=201)

async def create_provider(

    data: ModelProviderCreate,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    provider = ModelProvider(

        id=str(uuid4()),

        tenant_id=tenant_id,

        name=data.name,

        display_name=data.display_name,

        api_base=data.api_base,

        status="connected",

        models=data.models or [],

        default_model=data.default_model,

    )

    db.add(provider)

    await db.commit()

    await db.refresh(provider)

    return provider



@router.get("/{provider_id}/models")

async def list_provider_models(

    provider_id: str,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    provider = db.query(ModelProvider).filter(

        ModelProvider.id == provider_id, 

        ModelProvider.tenant_id == tenant_id

    ).first()

    if not provider:

        raise HTTPException(404, "Provider not found")

    return {"models": provider.models or []}



@router.post("/{provider_id}/test")

async def test_provider(

    provider_id: str,

    tenant_id: str = Depends(get_current_tenant),

    db: AsyncSession = Depends(get_db),

):

    provider = db.query(ModelProvider).filter(

        ModelProvider.id == provider_id, 

        ModelProvider.tenant_id == tenant_id

    ).first()

    if not provider:

        raise HTTPException(404, "Provider not found")

    

    # Real impl: make a test API call to the provider

    return {

        "status": "ok",

        "message": f"Provider {provider.name} is reachable",

        "models": provider.models,

    }



# RUNTIMES

runtimes_router = APIRouter(prefix="/runtimes", tags=["runtimes"])


# Similar CRUD pattern for runtimes...
python

Copy
# backend/app/schemas/agents.py

from pydantic import BaseModel, Field

from typing import List, Optional

from datetime import datetime



class AgentCreate(BaseModel):

    name: str = Field(..., min_length=1, max_length=100)

    type: str = Field(..., description="cli | mcp | webhook | custom")

    runtime: str = Field(..., description="claude-code | codex | aider | kiro | gemini | custom")

    version: Optional[str] = "1.0.0"

    provider_id: Optional[str] = None

    model: Optional[str] = None

    description: Optional[str] = None

    capabilities: Optional[List[str]] = []



class AgentUpdate(BaseModel):

    name: Optional[str] = None

    type: Optional[str] = None

    runtime: Optional[str] = None

    version: Optional[str] = None

    provider_id: Optional[str] = None

    model: Optional[str] = None

    description: Optional[str] = None

    capabilities: Optional[List[str]] = None

    status: Optional[str] = None



class AgentOut(BaseModel):

    id: str

    tenant_id: str

    name: str

    type: str

    runtime: str

    version: str

    provider_id: Optional[str]

    model: Optional[str]

    description: Optional[str]

    capabilities: List[str]

    status: str

    created_at: datetime

    updated_at: datetime

    

    class Config:

        from_attributes = True



class ModelProviderCreate(BaseModel):

    name: str

    display_name: str

    api_base: str

    api_key: str = ""  # for creation, not returned

    models: Optional[List[str]] = []

    default_model: Optional[str] = None



class ModelProviderOut(BaseModel):

    id: str

    tenant_id: str

    name: str

    display_name: str

    api_base: str

    status: str

    models: List[str]

    default_model: Optional[str]

    created_at: datetime

    

    class Config:

        from_attributes = True



class RuntimeCreate(BaseModel):

    name: str

    type: str = "local-docker"  # local-docker | kubernetes | cloud-sandbox

    config: Optional[dict] = {}

    resource_limits: Optional[dict] = {"cpu": 2, "memory_gb": 4}

    auto_cleanup: bool = True



class RuntimeOut(BaseModel):

    id: str

    tenant_id: str

    name: str

    type: str

    status: str

    config: dict

    created_at: datetime

    

    class Config:

        from_attributes = True



class AssignmentCreate(BaseModel):

    agent_id: str

    project_id: str

    role: str = "default"  # default | reviewer | specialist



class AssignmentOut(BaseModel):

    id: str

    tenant_id: str

    agent_id: str

    project_id: str

    role: str

    created_at: datetime

    

    class Config:

        from_attributes = True
========================================================== ZONE 2 — SQLAlchemy MODELS (verify they exist)
If not present, ADD in backend/app/db/models.py:

python

Copy
# Add to backend/app/db/models.py

from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Text, Integer

from sqlalchemy.dialects.postgresql import UUID, JSONB

from sqlalchemy.sql import func

import uuid


class Agent(Base):

    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    tenant_id = Column(String, ForeignKey("tenants.id"), nullable=False, index=True)

    name = Column(String, nullable=False, index=True)

    type = Column(String, nullable=False)  # cli | mcp | webhook | custom

    runtime = Column(String, nullable=False)  # claude-code | codex | aider | kiro | gemini | custom

    version = Column(String, default="1.0.0")

    provider_id = Column(String, ForeignKey("model_providers.id"), nullable=True)

    model = Column(String, nullable=True)

    description = Column(Text, nullable=True)

    capabilities = Column(JSONB, default=list)

    status = Column(String, default="active")  # active | paused | error | disabled

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())



class ModelProvider(Base):

    __tablename__ = "model_providers"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    tenant_id = Column(String, ForeignKey("tenants.id"), nullable=False, index=True)

    name = Column(String, nullable=False)  # anthropic | openai | bedrock | vertex | azure

    display_name = Column(String, nullable=False)

    api_base = Column(String, nullable=False)

    status = Column(String, default="connected")

    models = Column(JSONB, default=list)

    default_model = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())



class Runtime(Base):

    __tablename__ = "runtimes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    tenant_id = Column(String, ForeignKey("tenants.id"), nullable=False, index=True)

    name = Column(String, nullable=False)

    type = Column(String, default="local-docker")

    config = Column(JSONB, default=dict)

    status = Column(String, default="active")

    created_at = Column(DateTime(timezone=True), server_default=func.now())



class Assignment(Base):

    __tablename__ = "assignments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    tenant_id = Column(String, ForeignKey("tenants.id"), nullable=False, index=True)

    agent_id = Column(String, ForeignKey("agents.id"), nullable=False, index=True)

    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)

    role = Column(String, default="default")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
========================================================== ZONE 3 — ALEMBIC MIGRATION (create tables)
bash

Copy
cd forge-ai

docker compose exec backend alembic revision --autogenerate -m "Add agents providers runtimes assignments"

docker compose exec backend alembic upgrade head
Verify tables exist:

bash

Copy
docker compose exec postgres psql -U forge -d forge -c "\dt" | grep -E "agent|provider|runtime|assignment"
Should show: agents, model_providers, runtimes, assignments

========================================================== ZONE 4 — SEED DATA SCRIPT (the critical part)
Create backend/scripts/seed_agents.py:

python

Copy
#!/usr/bin/env python3

"""

Seed script for agents, providers, runtimes, assignments.

Run: docker compose exec backend python -m scripts.seed_agents

"""


import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import async_session_maker

from app.db.models import Agent, ModelProvider, Runtime, Assignment, Tenant, Project, User



# Static seed data — these are the "common agent patterns" shown in the empty state

SEED_PROVIDERS = [

    {

        "id": "prov-anthropic",

        "name": "anthropic",

        "display_name": "Anthropic",

        "api_base": "https://api.anthropic.com",

        "status": "connected",

        "models": ["claude-sonnet-4.5", "claude-opus-4", "claude-haiku-4"],

        "default_model": "claude-sonnet-4.5",

    },

    {

        "id": "prov-openai",

        "name": "openai",

        "display_name": "OpenAI",

        "api_base": "https://api.openai.com/v1",

        "status": "connected",

        "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"],

        "default_model": "gpt-4o",

    },

    {

        "id": "prov-bedrock",

        "name": "bedrock",

        "display_name": "AWS Bedrock",

        "api_base": "https://bedrock-runtime.us-east-1.amazonaws.com",

        "status": "connected",

        "models": ["anthropic.claude-sonnet-4.5-v2:0", "amazon.nova-pro-v1:0"],

        "default_model": "anthropic.claude-sonnet-4.5-v2:0",

    },

    {

        "id": "prov-vertex",

        "name": "vertex",

        "display_name": "Google Vertex",

        "api_base": "https://us-central1-aiplatform.googleapis.com",

        "status": "disconnected",

        "models": ["gemini-2.5-pro", "claude-sonnet-4.5"],

        "default_model": "gemini-2.5-pro",

    },

]



SEED_RUNTIMES = [

    {

        "id": "rt-local-docker",

        "name": "local-docker",

        "type": "local-docker",

        "config": {"image": "forge-runtime:latest", "network": "bridge"},

        "status": "active",

    },

    {

        "id": "rt-k8s-prod",

        "name": "production-k8s",

        "type": "kubernetes",

        "config": {"namespace": "forge-agents", "node_pool": "standard"},

        "status": "active",

    },

]



# The 6 "common agent patterns" from the empty state

SEED_AGENTS = [

    {

        "id": "agent-code-reviewer",

        "name": "Code reviewer",

        "type": "cli",

        "runtime": "claude-code",

        "provider_id": "prov-anthropic",

        "model": "claude-sonnet-4.5",

        "description": "Reviews PRs automatically, flags issues, suggests fixes. Saves ~3h/week per dev.",

        "capabilities": ["code-review", "pr-analysis", "security-scan"],

        "status": "active",

    },

    {

        "id": "agent-refactor",

        "name": "Refactor agent",

        "type": "cli",

        "runtime": "codex",

        "provider_id": "prov-openai",

        "model": "gpt-4o",

        "description": "Tackles large refactors across the codebase. Auto-generates PRs with tests.",

        "capabilities": ["refactor", "code-transformation", "test-generation"],

        "status": "active",

    },

    {

        "id": "agent-sync",

        "name": "Sync agent",

        "type": "webhook",

        "runtime": "custom",

        "provider_id": "prov-anthropic",

        "model": "claude-haiku-4",

        "description": "Syncs data between Jira, GitHub, Slack, and Forge. Keeps everyone in the loop.",

        "capabilities": ["data-sync", "webhook-handler", "event-routing"],

        "status": "active",

    },

    {

        "id": "agent-test-runner",

        "name": "Test runner",

        "type": "cli",

        "runtime": "claude-code",

        "provider_id": "prov-anthropic",

        "model": "claude-sonnet-4.5",

        "description": "Writes tests, runs them, reports coverage. Increases test coverage by 20% in a sprint.",

        "capabilities": ["test-generation", "test-execution", "coverage-analysis"],

        "status": "active",

    },

    {

        "id": "agent-doc-generator",

        "name": "Doc generator",

        "type": "cli",

        "runtime": "aider",

        "provider_id": "prov-anthropic",

        "model": "claude-sonnet-4.5",

        "description": "Auto-generates docs from code. Keeps README and API docs in sync.",

        "capabilities": ["doc-generation", "readme-update", "api-docs"],

        "status": "active",

    },

    {

        "id": "agent-security",

        "name": "Security auditor",

        "type": "custom",

        "runtime": "kiro",

        "provider_id": "prov-anthropic",

        "model": "claude-opus-4",

        "description": "Scans for security issues, suggests fixes. Runs nightly on the main branch.",

        "capabilities": ["security-scan", "vulnerability-detection", "compliance-check"],

        "status": "active",

    },

]



async def seed():

    """Seed the database with default agents, providers, runtimes."""

    async with async_session_maker() as session:

        # First, get or create the default tenant

        tenant = session.query(Tenant).filter(Tenant.slug == "acme-corp").first()

        if not tenant:

            tenant = Tenant(

                id="tenant-acme-corp",

                slug="acme-corp",

                name="Acme Corp (Dev Demo)",

                plan="pro",

                region="us-east-1",

            )

            session.add(tenant)

            await session.commit()

            print(f"✓ Created tenant: {tenant.name}")

        

        # Seed providers

        for p in SEED_PROVIDERS:

            existing = session.query(ModelProvider).filter(

                ModelProvider.id == p["id"],

                ModelProvider.tenant_id == tenant.id,

            ).first()

            if not existing:

                provider = ModelProvider(tenant_id=tenant.id, **p)

                session.add(provider)

                print(f"✓ Created provider: {p['display_name']}")

        

        await session.commit()

        

        # Seed runtimes

        for r in SEED_RUNTIMES:

            existing = session.query(Runtime).filter(

                Runtime.id == r["id"],

                Runtime.tenant_id == tenant.id,

            ).first()

            if not existing:

                runtime = Runtime(tenant_id=tenant.id, **r)

                session.add(runtime)

                print(f"✓ Created runtime: {r['name']}")

        

        await session.commit()

        

        # Seed agents

        for a in SEED_AGENTS:

            existing = session.query(Agent).filter(

                Agent.id == a["id"],

                Agent.tenant_id == tenant.id,

            ).first()

            if not existing:

                agent = Agent(tenant_id=tenant.id, **a)

                session.add(agent)

                print(f"✓ Created agent: {a['name']}")

        

        await session.commit()

        

        print("\n✅ Seed complete!")

        print(f"   - 1 tenant")

        print(f"   - {len(SEED_PROVIDERS)} providers")

        print(f"   - {len(SEED_RUNTIMES)} runtimes")

        print(f"   - {len(SEED_AGENTS)} agents")



if __name__ == "__main__":

    asyncio.run(seed())
bash

Copy
# Run the seed script

docker compose exec backend python -m scripts.seed_agents
Expected output:

text

Copy
✓ Created tenant: Acme Corp (Dev Demo)

✓ Created provider: Anthropic

✓ Created provider: OpenAI

✓ Created provider: AWS Bedrock

✓ Created provider: Google Vertex

✓ Created runtime: local-docker

✓ Created runtime: production-k8s

✓ Created agent: Code reviewer

✓ Created agent: Refactor agent

✓ Created agent: Sync agent

✓ Created agent: Test runner

✓ Created agent: Doc generator

✓ Created agent: Security auditor


✅ Seed complete!
========================================================== ZONE 5 — API ENDPOINT TESTS (verify each works)
Create backend/scripts/test_agents_api.py:

python

Copy
#!/usr/bin/env python3

"""

Test script for agents API. Verifies each endpoint works.

Run: docker compose exec backend python -m scripts.test_agents_api

"""


import asyncio

import httpx

import sys


BASE_URL = "http://localhost:8000/api/v1"

# Get token via OIDC login (mocked here)

AUTH_TOKEN = "your-test-jwt-token"  # Replace with actual login flow



async def get_auth_token():

    """Get a real auth token via the OIDC flow."""

    async with httpx.AsyncClient() as client:

        # Login via Keycloak

        res = await client.post(

            "http://localhost:8080/realms/forge/protocol/openid-connect/token",

            data={

                "grant_type": "password",

                "client_id": "forge-ui",

                "username": "arun@acme-corp.com",

                "password": "dev-password-change-in-prod",

            },

        )

        return res.json()["access_token"]



async def test_endpoint(client, method, path, expected_status=200, **kwargs):

    """Test a single endpoint and verify status code."""

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}

    res = await client.request(method, f"{BASE_URL}{path}", headers=headers, **kwargs)

    status_ok = "✓" if res.status_code == expected_status else "✗"

    print(f"{status_ok} {method:6s} {path:50s} → {res.status_code} (expected {expected_status})")

    if res.status_code != expected_status:

        print(f"  Body: {res.text[:200]}")

        return False

    return True



async def main():

    # Get auth token

    global AUTH_TOKEN

    AUTH_TOKEN = await get_auth_token()

    print(f"Got auth token: {AUTH_TOKEN[:20]}...\n")

    

    passed = 0

    failed = 0

    

    async with httpx.AsyncClient(timeout=10) as client:

        print("=" * 60)

        print("AGENTS API TESTS")

        print("=" * 60)

        

        # LIST agents

        if await test_endpoint(client, "GET", "/agents"): passed += 1

        else: failed += 1

        

        # LIST agents with filter

        if await test_endpoint(client, "GET", "/agents?status=active"): passed += 1

        else: failed += 1

        

        # CREATE agent

        create_data = {

            "name": "Test Agent",

            "type": "cli",

            "runtime": "claude-code",

            "description": "Test agent",

            "capabilities": ["test"],

        }

        create_res = await client.post(

            f"{BASE_URL}/agents",

            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},

            json=create_data,

        )

        if create_res.status_code == 201:

            print(f"✓ POST   /agents                                  → 201 (created)")

            test_id = create_res.json()["id"]

            passed += 1

        else:

            print(f"✗ POST   /agents                                  → {create_res.status_code}")

            print(f"  Body: {create_res.text[:200]}")

            test_id = None

            failed += 1

        

        # GET specific agent

        if test_id and await test_endpoint(client, "GET", f"/agents/{test_id}"): passed += 1

        else: failed += 1

        

        # UPDATE agent

        if test_id:

            update_data = {"name": "Test Agent Updated", "status": "paused"}

            res = await client.patch(

                f"{BASE_URL}/agents/{test_id}",

                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},

                json=update_data,

            )

            if res.status_code == 200 and res.json()["name"] == "Test Agent Updated":

                print(f"✓ PATCH  /agents/{test_id[:8]}...                → 200 (updated)")

                passed += 1

            else:

                print(f"✗ PATCH  /agents                                  → {res.status_code}")

                failed += 1

        

        # TEST agent

        if test_id and await test_endpoint(client, "POST", f"/agents/{test_id}/test"): passed += 1

        else: failed += 1

        

        # DELETE agent

        if test_id:

            res = await client.delete(

                f"{BASE_URL}/agents/{test_id}",

                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},

            )

            if res.status_code == 204:

                print(f"✓ DELETE /agents/{test_id[:8]}...                → 204 (deleted)")

                passed += 1

            else:

                print(f"✗ DELETE /agents                                  → {res.status_code}")

                failed += 1

        

        # VERIFY deletion

        res = await client.get(

            f"{BASE_URL}/agents/{test_id}",

            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},

        )

        if res.status_code == 404:

            print(f"✓ GET    /agents/{test_id[:8]}...                → 404 (correctly deleted)")

            passed += 1

        else:

            print(f"✗ GET    /agents                                  → {res.status_code} (should be 404)")

            failed += 1

        

        print("\n" + "=" * 60)

        print("PROVIDERS API TESTS")

        print("=" * 60)

        

        if await test_endpoint(client, "GET", "/providers"): passed += 1

        else: failed += 1

        

        if await test_endpoint(client, "GET", "/providers/prov-anthropic/models"): passed += 1

        else: failed += 1

        

        if await test_endpoint(client, "POST", "/providers/prov-anthropic/test"): passed += 1

        else: failed += 1

        

        print("\n" + "=" * 60)

        print("RUNTIMES API TESTS")

        print("=" * 60)

        

        if await test_endpoint(client, "GET", "/runtimes"): passed += 1

        else: failed += 1

        

        print("\n" + "=" * 60)

        print(f"RESULTS: {passed} passed, {failed} failed")

        print("=" * 60)

        

        return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
bash

Copy
# Run the tests

docker compose exec backend python -m scripts.test_agents_api
Expected output:

text

Copy
============================================================

AGENTS API TESTS

============================================================

Got auth token: eyJhbGciOiJSUzI1NiIs...

✓ GET    /agents                                      → 200

✓ GET    /agents?status=active                        → 200

✓ POST   /agents                                      → 201 (created)

✓ GET    /agents/<id>                                 → 200

✓ PATCH  /agents/<id>                                 → 200 (updated)

✓ POST   /agents/<id>/test                            → 200

✓ DELETE /agents/<id>                                 → 204 (deleted)

✓ GET    /agents/<id>                                 → 404 (correctly deleted)


============================================================

RESULTS: 8 passed, 0 failed

============================================================
========================================================== ZONE 6 — FRONTEND WIRING (only if backend tests pass)
Now that backend is verified + seeded, wire the frontend.

In src/lib/query/hooks.ts:

typescript

Copy
// Agents

export function useAgents() {

  return useQuery({

    queryKey: ['agents', 'list'],

    queryFn: () => api.get<Agent[]>('/agents'),

  });

}


export function useCreateAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Agent>) => 

      api.post<Agent>('/agents', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),

  });

}


export function useUpdateAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, ...data }: Partial<Agent> & { id: string }) =>

      api.patch<Agent>(`/agents/${id}`, data),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: ['agents'] });

      qc.invalidateQueries({ queryKey: ['agent', id] });

    },

  });

}


export function useDeleteAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/agents/${id}`),

    onMutate: async (id) => {

      await qc.cancelQueries({ queryKey: ['agents', 'list'] });

      const previous = qc.getQueryData<Agent[]>(['agents', 'list']);

      qc.setQueryData<Agent[]>(['agents', 'list'], old => 

        old?.filter(a => a.id !== id) ?? []

      );

      return { previous };

    },

    onError: (err, id, context) => {

      if (context?.previous) {

        qc.setQueryData(['agents', 'list'], context.previous);

      }

    },

    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),

  });

}


export function useTestAgent() {

  return useMutation({

    mutationFn: (id: string) => 

      api.post<{ status: 'ok' | 'error'; message: string; latency_ms: number }>(`/agents/${id}/test`),

  });

}


// Providers

export function useProviders() {

  return useQuery({

    queryKey: ['providers', 'list'],

    queryFn: () => api.get<Provider[]>('/providers'),

  });

}


export function useCreateProvider() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Provider>) => 

      api.post<Provider>('/providers', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),

  });

}


// Runtimes

export function useRuntimes() {

  return useQuery({

    queryKey: ['runtimes', 'list'],

    queryFn: () => api.get<Runtime[]>('/runtimes'),

  });

}


export function useCreateRuntime() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Runtime>) => 

      api.post<Runtime>('/runtimes', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: ['runtimes'] }),

  });

}
In src/app/(workspace)/agent-center/page.tsx — REPLACE all dummy data:

typescript

Copy
// BEFORE (the problem): hardcoded agents

const AGENTS = [

  { id: '1', name: 'Code reviewer', ... },

  ...

];


// AFTER: real data

const { data: agents, isLoading, error, refetch } = useAgents();

const { data: providers } = useProviders();

const createAgent = useCreateAgent();

const deleteAgent = useDeleteAgent();

const testAgent = useTestAgent();
========================================================== ZONE 7 — VERIFICATION CHECKLIST
Before declaring this done, ALL of these must pass:

1.
 Backend routes exist (agents.py, providers.py, runtimes.py)
2.
 SQLAlchemy models created (Agent, ModelProvider, Runtime, Assignment)
3.
 Alembic migration runs successfully
4.
 Seed script runs and inserts 6 agents + 4 providers + 2 runtimes
5.
 python -m scripts.test_agents_api passes 8/8 tests
6.
 Frontend useAgents() returns the 6 seeded agents
7.
 Creating an agent via UI persists to DB
8.
 Updating an agent via UI persists to DB
9.
 Deleting an agent via UI removes from DB
10.
 Test agent button returns real status
========================================================== CONSTRAINTS
DO NOT use static/dummy data anywhere — only real API calls
DO NOT skip the seed script — the API must return real data
DO NOT skip the test script — every endpoint must be verified
All endpoints MUST be tenant-scoped (Rule 2)
All Python code MUST be syntactically valid (run python -c "import app.api.v1.agents" after changes)
Frontend MUST show loading + error + empty states for all hooks
========================================================== DELIVERABLE
backend/app/api/v1/agents.py — full CRUD endpoints
backend/app/api/v1/providers.py — CRUD + models + test endpoints
backend/app/api/v1/runtimes.py — CRUD endpoints
backend/app/schemas/agents.py — Pydantic schemas
backend/app/db/models.py — Agent, ModelProvider, Runtime, Assignment models
backend/scripts/seed_agents.py — seed data script
backend/scripts/test_agents_api.py — endpoint test script
apps/forge/src/lib/query/hooks.ts — agents, providers, runtimes hooks
apps/forge/src/app/(workspace)/agent-center/page.tsx — real data
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the Agent Center UI, keep the common agent patterns display
VERIFICATION: All 10 items in Zone 7 checklist pass
VERIFICATION: python -m scripts.test_agents_api shows "8 passed, 0 failed"
VERIFICATION: python -m scripts.seed_agents shows "✅ Seed complete!"
VERIFICATION: Frontend Agent Center shows the 6 seeded agents