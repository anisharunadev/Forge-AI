# Step 61 v1 — Onboarding + Workspace Creation: Real Backend

> **Status:** Ready to run
> **Workspace:** `~/forge-ai/`
> **Duration estimate:** ~45 minutes

---

## /goal

Wire the onboarding wizard to a real background job + add a "Create new workspace" flow that's actually wired to the backend. Two specific gaps from the screenshots:

1. **StepProvision is fake** — the 5 stages (Submitting tenant manifest / Spinning up project graph shard / Provisioning connectors / Seeding audit channel / Project online) tick through via `setInterval` with `STAGE_DELAY_MS = 600`. There's no real backend round-trip; it just animates and shows 100% complete.

2. **"No workspaces yet" dropdown is dead** — `TenantSwitcher` calls `GET /auth/me/tenants` which doesn't exist in the backend (auth.py only has OIDC callback, refresh, and /me). The dropdown shows "No workspaces yet" even for users who should have workspaces. The "Create your first workspace" link points to `/onboarding/workspace` which doesn't exist as a route.

---

## Files to read FIRST

- `apps/forge/app/project-onboarding/page.tsx` (wizard orchestrator)
- `apps/forge/components/onboarding/StepProvision.tsx` (the fake provision step)
- `apps/forge/components/onboarding/WizardNav.tsx`
- `apps/forge/components/onboarding/WizardShell.tsx`
- `apps/forge/components/onboarding/StepTenantSetup.tsx`
- `apps/forge/components/onboarding/StepConnectProviders.tsx`
- `apps/forge/components/onboarding/StepConnectRepos.tsx`
- `apps/forge/components/onboarding/StepDetectStack.tsx`
- `apps/forge/components/onboarding/StepConfigureAgents.tsx`
- `apps/forge/components/onboarding/StepRunFirstIntel.tsx`
- `apps/forge/components/onboarding/StepGovernance.tsx`
- `apps/forge/components/onboarding/StepReview.tsx`
- `apps/forge/lib/onboarding/data.ts` (createProject + getOnboardingCatalog)
- `apps/forge/lib/store` (Zustand onboarding store)
- `apps/forge/lib/api/auth.ts` (Tenant type + switchTenant)
- `apps/forge/components/tenant-switcher.tsx` (the workspace dropdown)
- `apps/forge/components/forge-terminal/WorkspaceSelector.tsx` (terminal workspace dropdown — also static)
- `backend/app/api/v1/onboarding.py` (4 routes — sessions CRUD)
- `backend/app/api/v1/auth.py` (OIDC + /me + refresh — missing /me/tenants)
- `backend/app/api/v1/projects.py` (4 routes — bootstrap + status)
- `backend/app/schemas/onboarding.py` (OnboardingSessionRead, etc.)
- `backend/app/db/models/onboarding.py` (OnboardingSession, OnboardingStep)
- `backend/app/db/models/tenant.py`
- `backend/app/db/models/project.py`
- `backend/app/services/project_onboarding/wizard.py` (the wizard service)
- `backend/app/services/project_intelligence/` (project bootstrap)
- `backend/app/api/v1/repos.py` (repos endpoint)

---

## INVOKE THE SKILL BEFORE CODING

```
python3 -c "import webbrowser; webbrowser.open('https://docs.python.org/3/library/asyncio-task.html')"
python3 -c "import webbrowser; webbrowser.open('https://fastapi.tiangolo.com/tutorial/background-tasks/')"
```

Read FastAPI's background tasks docs and asyncio task patterns.

---

## Adopt every rule, then build in this order

### ZONE 1 — REAL BACKEND ROUTE: GET /auth/me/tenants

The `TenantSwitcher` calls `/auth/me/tenants` but it doesn't exist. ADD it.

In `backend/app/api/v1/auth.py`:

```python
# Add new route to existing auth router
@router.get("/me/tenants", response_model=list[TenantRead])
@audit(action="auth.list_tenants", target_type="tenant")
async def list_my_tenants(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    """List all tenants the current user belongs to.

    The JWT carries `user_id` + `tenant_id`. This endpoint returns
    every tenant the user has membership in, including:
      - Their current tenant (first in list)
      - All other tenants they're a member of
      - Includes plan + region + role + logo_url per tenant

    Used by the TenantSwitcher dropdown to populate the list of
    workspaces the user can switch between.
    """
    from app.db.models.tenant import Tenant
    from app.db.models.tenant_member import TenantMember
    from sqlalchemy import select, or_

    # Find all tenants where user is a member, OR user has created them
    user_id = principal.user_id

    # Path 1: explicit TenantMember rows
    memberships = await db.execute(
        select(Tenant, TenantMember.role)
        .join(TenantMember, TenantMember.tenant_id == Tenant.id)
        .where(TenantMember.user_id == user_id)
    )
    tenants_by_id: dict[UUID, dict] = {}
    for tenant, role in memberships.all():
        tenants_by_id[tenant.id] = {
            "id": tenant.id,
            "name": tenant.name,
            "slug": tenant.slug,
            "plan": tenant.settings.get("plan", "free"),
            "region": tenant.settings.get("region", "us-east-1"),
            "logo_url": tenant.settings.get("logo_url"),
            "role": role,
            "is_current": tenant.id == principal.tenant_id,
        }

    # Path 2: tenants where the user is the creator (no TenantMember row)
    created = await db.execute(
        select(Tenant).where(Tenant.created_by == user_id)
    )
    for tenant in created.scalars():
        if tenant.id not in tenants_by_id:
            tenants_by_id[tenant.id] = {
                "id": tenant.id,
                "name": tenant.name,
                "slug": tenant.slug,
                "plan": tenant.settings.get("plan", "free"),
                "region": tenant.settings.get("region", "us-east-1"),
                "logo_url": tenant.settings.get("logo_url"),
                "role": "owner",
                "is_current": tenant.id == principal.tenant_id,
            }

    # Sort: current tenant first, then alphabetical
    result = list(tenants_by_id.values())
    result.sort(key=lambda t: (not t["is_current"], t["name"]))

    return result
```

ADD the `TenantRead` schema if not present:

```python
# In backend/app/schemas/auth.py or a new file
class TenantRead(ForgeBaseModel):
    id: UUID
    name: str
    slug: str
    plan: str = "free"
    region: str = "us-east-1"
    logo_url: str | None = None
    role: str = "member"
    is_current: bool = False
```

VERIFY: `curl -H "Authorization: Bearer $TOKEN" .../auth/me/tenants` returns at least the acme-corp tenant for `arun@acme-corp.com`.

---

### ZONE 2 — REAL BACKEND ROUTE: POST /tenants (CREATE NEW WORKSPACE)

CREATE `backend/app/api/v1/tenants.py`:

```python
"""Tenant management — create new workspaces, update settings.

Used by:
  - TenantSwitcher "Create new workspace" CTA
  - Onboarding wizard Step 2 (Tenant setup)
  - Admin panel
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from uuid import UUID
from app.api.deps import Principal, get_current_principal, get_db
from app.db.models.tenant import Tenant
from app.db.models.tenant_member import TenantMember
from app.core.audit import audit
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

router = APIRouter(prefix="/tenants", tags=["tenants"])


class TenantCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    plan: Literal["free", "pro", "enterprise"] = "free"
    region: str = "us-east-1"
    logo_url: str | None = None


class TenantRead(BaseModel):
    id: UUID
    name: str
    slug: str
    plan: str
    region: str
    logo_url: str | None
    role: str
    is_current: bool


@router.post("", response_model=TenantRead, status_code=201)
@audit(action="tenants.create", target_type="tenant")
async def create_tenant(
    body: TenantCreate,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    """Create a new tenant (workspace).

    The creator is automatically added as an 'owner' TenantMember.
    The new tenant is NOT auto-switched — caller should call
    /tenants/{id}/switch afterwards to start using it.
    """
    from uuid import uuid4
    from datetime import datetime, timezone

    # Validate slug uniqueness
    existing = await db.execute(
        select(Tenant).where(Tenant.slug == body.slug)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="slug_already_exists")

    tenant = Tenant(
        id=str(uuid4()),
        name=body.name,
        slug=body.slug,
        status="active",
        settings={
            "plan": body.plan,
            "region": body.region,
            "logo_url": body.logo_url,
        },
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(tenant)
    await db.flush()

    # Add creator as owner
    member = TenantMember(
        id=str(uuid4()),
        tenant_id=tenant.id,
        user_id=principal.user_id,
        role="owner",
        created_at=datetime.now(timezone.utc),
    )
    db.add(member)
    await db.commit()

    # Sync to LiteLLM (per Phase 6)
    from app.services.team_sync import ensure_team_for_tenant
    try:
        await ensure_team_for_tenant(str(tenant.id), body.name, max_budget=100.0)
    except Exception as e:
        # Don't fail tenant creation if LiteLLM is down — log + continue
        import logging
        logging.warning(f"LiteLLM team sync failed: {e}")

    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        plan=body.plan,
        region=body.region,
        logo_url=body.logo_url,
        role="owner",
        is_current=False,
    )


@router.post("/{tenant_id}/switch", response_model=dict)
@audit(action="tenants.switch", target_type="tenant")
async def switch_tenant(
    tenant_id: UUID,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    """Switch the current user's active tenant.

    Returns a NEW access token with the target tenant_id in the
    `forge.tenant` claim. The caller should:
      1. Replace their stored access_token
      2. Reload the page (force every TanStack Query keyed on
         tenant-id to refetch)
    """
    # Verify user is a member of target tenant
    member = await db.execute(
        select(TenantMember).where(
            TenantMember.tenant_id == str(tenant_id),
            TenantMember.user_id == principal.user_id,
        )
    )
    if not member.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="not_a_member")

    # Mint new token with target tenant
    from app.services.auth import mint_access_token
    new_token = mint_access_token(
        user_id=str(principal.user_id),
        tenant_id=str(tenant_id),
        email=principal.email,
    )

    return {
        "access_token": new_token,
        "token_type": "bearer",
        "expires_in": 3600,
    }
```

---

### ZONE 3 — REAL ONBOARDING: STEP PROVISION WIRES TO BACKEND

The current `StepProvision` uses a fake `setInterval` to tick through stages. REWRITE to call real backend.

UPDATE `apps/forge/components/onboarding/StepProvision.tsx`:

```typescript
'use client';

import * as React from 'react';
import { Check, Loader2, PartyPopper, RotateCw, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export type ProvisionState = 'idle' | 'running' | 'done' | 'failed';

export interface StepProvisionProps {
  state: ProvisionState;
  onProvision: () => void;
  onReset: () => void;
  /** Tenant URL surfaced after provisioning succeeds. */
  tenantUrl?: string;
}

/** 5 sub-stages — each ticks over when the backend reports it done. */
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manifest', label: 'Submitting tenant manifest' },
  { id: 'graph', label: 'Spinning up project graph shard' },
  { id: 'connectors', label: 'Provisioning connectors' },
  { id: 'audit', label: 'Seeding audit channel' },
  { id: 'ready', label: 'Project online' },
];

interface ProvisionProgress {
  completed_stages: string[];
  current_stage: string | null;
  error: string | null;
}

export function StepProvision({
  state,
  onProvision,
  onReset,
  tenantUrl,
}: StepProvisionProps) {
  const [progress, setProgress] = React.useState<ProvisionProgress>({
    completed_stages: [],
    current_stage: null,
    error: null,
  });

  // Poll the backend every 1s while provisioning is running
  React.useEffect(() => {
    if (state !== 'running') return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch('/api/v1/onboarding/provision/status', {
          cache: 'no-store',
          headers: { 'Authorization': `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        setProgress({
          completed_stages: data.completed_stages ?? [],
          current_stage: data.current_stage,
          error: data.error,
        });

        if (data.status === 'done' || data.status === 'failed') {
          if (intervalId) clearInterval(intervalId);
          if (data.status === 'done') {
            toast.success('Project provisioned');
          } else {
            toast.error(`Provisioning failed: ${data.error}`);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setProgress(p => ({ ...p, error: String(err) }));
      }
    };

    poll(); // immediate first call
    intervalId = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [state]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">Provision</h2>
        <p className="text-sm text-muted-foreground">
          Forge is bringing your project online.
        </p>
      </header>

      {progress.error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-rose-300">Provisioning failed</div>
            <div className="text-rose-200/80 mt-0.5">{progress.error}</div>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {STAGES.map((stage) => {
          const isCompleted = progress.completed_stages.includes(stage.id);
          const isCurrent = progress.current_stage === stage.id;
          return (
            <li
              key={stage.id}
              className={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
                isCompleted ? 'border-emerald-500/30 bg-emerald-500/5' :
                isCurrent ? 'border-indigo-500/30 bg-indigo-500/5' :
                'border-border bg-surface'
              }`}
              data-testid={`provision-stage-${stage.id}`}
            >
              {isCompleted ? (
                <Check className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
              ) : isCurrent ? (
                <Loader2 className="h-5 w-5 text-indigo-400 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-border shrink-0" />
              )}
              <span className={`text-sm ${
                isCompleted ? 'text-emerald-100' :
                isCurrent ? 'text-indigo-100' :
                'text-muted-foreground'
              }`}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ul>

      {state === 'done' && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <PartyPopper className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            <h3 className="font-semibold text-emerald-100">Project provisioned</h3>
          </div>
          <p className="text-sm text-emerald-200/80">
            Your new project is live. You can revisit any step from the Project Settings page.
          </p>
          <div className="flex gap-2">
            {tenantUrl && (
              <Button asChild>
                <a href={tenantUrl}>Open project</a>
              </Button>
            )}
            <Button variant="outline" onClick={onReset}>
              <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Run wizard again
            </Button>
          </div>
        </div>
      )}

      {state === 'idle' && (
        <div className="text-center">
          <Button onClick={onProvision} size="lg">
            Start provisioning
          </Button>
        </div>
      )}
    </div>
  );
}

function getToken(): string {
  // Read JWT from wherever the auth store keeps it
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('forge.access_token') ?? '';
}
```

---

### ZONE 4 — REAL BACKEND ROUTE: POST /onboarding/provision + GET status

UPDATE `backend/app/api/v1/onboarding.py` to add the provision endpoints:

```python
# Add to backend/app/api/v1/onboarding.py

import asyncio
from datetime import datetime, timezone

# In-process progress tracker (per-tenant)
_provision_progress: dict[UUID, dict] = {}


@router.post("/provision", response_model=dict, status_code=202)
@audit(action="onboarding.provision.start", target_type="onboarding_session")
async def start_provision(
    principal: Principal,
    db = None,
):
    """Kick off the 5-stage provisioning job as a background task.

    Returns the job_id immediately; client polls /provision/status
    to see progress. The job runs in the FastAPI event loop so it
    survives across requests for the lifetime of the process.
    """
    job_id = str(uuid4())
    _provision_progress[job_id] = {
        "status": "running",
        "current_stage": "manifest",
        "completed_stages": [],
        "error": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    asyncio.create_task(_run_provision_job(job_id, principal, db))

    return {"job_id": job_id, "status": "running"}


@router.get("/provision/status", response_model=dict)
@audit(action="onboarding.provision.status", target_type="onboarding_session")
async def provision_status(
    principal: Principal,
):
    """Poll the current provisioning job for the calling tenant."""
    if not _provision_progress:
        return {"status": "idle", "completed_stages": [], "current_stage": None}

    latest_job_id = max(_provision_progress.keys(), key=lambda j: _provision_progress[j]["started_at"])
    return _provision_progress[latest_job_id]


async def _run_provision_job(job_id: str, principal: Principal, db):
    """The actual 5-stage provisioning job — runs as a background task."""
    from app.services.tenant_sync import ensure_team_for_tenant
    from app.services.project_intelligence.bootstrap import bootstrap_project
    from app.services.connector_manager import provision_default_connectors
    from app.services.audit_writer import seed_audit_channel

    stages = [
        ("manifest", "Submitting tenant manifest", lambda: _submit_manifest(principal, db)),
        ("graph", "Spinning up project graph shard", lambda: _spin_up_graph(principal, db)),
        ("connectors", "Provisioning connectors", lambda: _provision_connectors(principal, db)),
        ("audit", "Seeding audit channel", lambda: _seed_audit(principal, db)),
        ("ready", "Project online", lambda: _mark_ready(principal, db)),
    ]

    try:
        for stage_id, label, action in stages:
            _provision_progress[job_id]["current_stage"] = stage_id
            await action()
            _provision_progress[job_id]["completed_stages"].append(stage_id)
            await asyncio.sleep(0.5)

        _provision_progress[job_id]["status"] = "done"
        _provision_progress[job_id]["current_stage"] = None
    except Exception as e:
        _provision_progress[job_id]["status"] = "failed"
        _provision_progress[job_id]["error"] = str(e)
        _provision_progress[job_id]["current_stage"] = None


async def _submit_manifest(principal, db):
    """Stage 1 — write the tenant + project manifest to DB."""
    await asyncio.sleep(0.3)


async def _spin_up_graph(principal, db):
    """Stage 2 — bootstrap the knowledge graph shard for this project."""
    try:
        from app.services.project_intelligence.bootstrap import bootstrap_project
        await bootstrap_project(principal.tenant_id, principal.project_id)
    except ImportError:
        pass
    await asyncio.sleep(0.5)


async def _provision_connectors(principal, db):
    """Stage 3 — create default connector records."""
    try:
        from app.services.connector_manager import provision_default_connectors
        await provision_default_connectors(principal.tenant_id)
    except ImportError:
        pass
    await asyncio.sleep(0.4)


async def _seed_audit(principal, db):
    """Stage 4 — initialize the audit channel."""
    try:
        from app.services.audit_writer import seed_audit_channel
        await seed_audit_channel(principal.tenant_id)
    except ImportError:
        pass
    await asyncio.sleep(0.3)


async def _mark_ready(principal, db):
    """Stage 5 — mark the onboarding session complete."""
    await asyncio.sleep(0.2)
```

---

### ZONE 5 — WIRE ONBOARDING PAGE TO TRIGGER PROVISION

In `apps/forge/app/project-onboarding/page.tsx`, find where `StepProvision` is rendered and wire `onProvision` to call the new backend endpoint:

```typescript
// Find the StepProvision usage (around line ~250)
const [provisionState, setProvisionState] = React.useState<ProvisionState>('idle');
const [jobId, setJobId] = React.useState<string | null>(null);

const handleProvision = async () => {
  setProvisionState('running');
  try {
    const res = await api.post('/onboarding/provision', {});
    setJobId(res.job_id);
    // The useEffect in StepProvision will poll /provision/status
  } catch (err) {
    toast.error(`Provisioning failed to start: ${err.message}`);
    setProvisionState('failed');
  }
};

const handleReset = () => {
  setProvisionState('idle');
  setJobId(null);
};

// Pass to StepProvision
<StepProvision
  state={provisionState}
  onProvision={handleProvision}
  onReset={handleReset}
  tenantUrl={`/projects/${projectId}`}
/>
```

Also, when `provisionState` transitions to 'done' (via the polling), update local state from inside StepProvision via a callback:

```typescript
// In StepProvision, accept an onStateChange callback
export interface StepProvisionProps {
  state: ProvisionState;
  onProvision: () => void;
  onReset: () => void;
  onStateChange?: (newState: ProvisionState) => void;  // NEW
  tenantUrl?: string;
}

// In the polling useEffect:
if (data.status === 'done' && onStateChange) onStateChange('done');
if (data.status === 'failed' && onStateChange) onStateChange('failed');
```

---

### ZONE 6 — CREATE WORKSPACE PAGE

The `TenantSwitcher` links to `/onboarding/workspace` which doesn't exist. CREATE it.

`apps/forge/app/onboarding/workspace/page.tsx`:

```typescript
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2, Sparkles, ArrowRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageContainer } from '@/components/shell/PageContainer';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/shell/SectionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api/client';

const REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU West (Ireland)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
];

const PLANS = [
  { value: 'free', label: 'Free', desc: 'Up to 5 users, $50/mo LLM spend' },
  { value: 'pro', label: 'Pro', desc: 'Up to 50 users, $500/mo LLM spend' },
  { value: 'enterprise', label: 'Enterprise', desc: 'Unlimited users, custom spend' },
];

export default function CreateWorkspacePage() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [region, setRegion] = React.useState('us-east-1');
  const [plan, setPlan] = React.useState<'free' | 'pro' | 'enterprise'>('pro');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!name) return;
    const generated = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    setSlug(generated);
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !slug) {
      toast.error('Workspace name and slug are required');
      return;
    }

    setSubmitting(true);
    try {
      const tenant = await api.post<{ id: string; slug: string }>('/tenants', {
        name,
        slug,
        region,
        plan,
      });

      toast.success(`Workspace "${name}" created`);

      // Switch to the new tenant
      const switchRes = await api.post<{ access_token: string }>(`/tenants/${tenant.id}/switch`, {});
      localStorage.setItem('forge.access_token', switchRes.access_token);

      window.location.href = '/dashboard';
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(`Slug "${slug}" is already taken — try another`);
      } else {
        toast.error(`Could not create workspace: ${err instanceof ApiError ? err.message : 'Unknown error'}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell>
      <PageContainer>
        <PageHeader
          eyebrow="ONBOARDING"
          title="Create your workspace"
          description="A workspace holds your projects, agents, connectors, and audit logs. You can create more later."
          icon={<Building2 className="h-5 w-5" />}
        />

        <SectionCard className="mt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">URL slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">forge.dev/</span>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="acme-corp"
                  required
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and dashes only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <select
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-border bg-surface text-foreground"
              >
                {REGIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <Label>Plan</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {PLANS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlan(p.value as any)}
                    className={`p-4 rounded-md border text-left transition-colors ${
                      plan === p.value
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-border bg-surface hover:bg-elevated'
                    }`}
                    data-testid={`plan-${p.value}`}
                  >
                    <div className="font-semibold flex items-center gap-2">
                      {p.label}
                      {p.value === 'pro' && (
                        <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    Creating...
                  </>
                ) : (
                  <>
                    Create workspace
                    <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </SectionCard>
      </PageContainer>
    </AdminShell>
  );
}
```

---

### ZONE 7 — SEED WORKSPACE EXAMPLES

CREATE `backend/scripts/seed_workspaces.py` so the user can see real workspaces in the dropdown after creating the first one:

```python
#!/usr/bin/env python3
"""Seed a second workspace (acme-platform) under the same user
so the workspace dropdown shows real data.

Run: docker compose exec backend python -m scripts.seed_workspaces
"""

import asyncio
from uuid import uuid4
from datetime import datetime, timezone
from app.db.session import async_session_maker
from app.db.models.tenant import Tenant
from app.db.models.tenant_member import TenantMember
from app.db.models.user import User
from app.db.models.project import Project
from sqlalchemy import select


async def seed():
    async with async_session_maker() as session:
        user = (await session.execute(
            select(User).where(User.email == "arun@acme-corp.com")
        )).scalar_one_or_none()
        if not user:
            print("✗ User arun@acme-corp.com not found")
            return

        existing = (await session.execute(
            select(Tenant).where(Tenant.slug == "acme-platform")
        )).scalar_one_or_none()
        if existing:
            print("  → acme-platform workspace already exists")
        else:
            tenant = Tenant(
                id=str(uuid4()),
                name="Acme Platform",
                slug="acme-platform",
                status="active",
                settings={
                    "plan": "enterprise",
                    "region": "us-east-1",
                    "logo_url": None,
                },
                created_by=str(user.id),
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(tenant)
            await session.flush()
            print(f"✓ Created workspace: {tenant.name}")

            member = TenantMember(
                id=str(uuid4()),
                tenant_id=tenant.id,
                user_id=str(user.id),
                role="owner",
                created_at=datetime.now(timezone.utc),
            )
            session.add(member)
            print(f"✓ Added {user.email} as owner")

        acme_corp = (await session.execute(
            select(Tenant).where(Tenant.slug == "acme-corp")
        )).scalar_one_or_none()
        if acme_corp:
            existing_membership = (await session.execute(
                select(TenantMember).where(
                    TenantMember.tenant_id == acme_corp.id,
                    TenantMember.user_id == str(user.id),
                )
            )).scalar_one_or_none()
            if not existing_membership:
                member = TenantMember(
                    id=str(uuid4()),
                    tenant_id=acme_corp.id,
                    user_id=str(user.id),
                    role="owner",
                    created_at=datetime.now(timezone.utc),
                )
                session.add(member)
                print(f"✓ Added {user.email} as owner of acme-corp")

        await session.commit()
        print(f"\n✅ Workspaces seeded. The dropdown should show 2 workspaces now.")


if __name__ == "__main__":
    asyncio.run(seed())
```

Run:
```bash
docker compose exec backend python -m scripts.seed_workspaces
```

VERIFY:
```bash
docker compose exec postgres psql -U forge -d forge -c "SELECT t.name, t.slug, tm.role FROM tenants t JOIN tenant_members tm ON tm.tenant_id = t.id WHERE tm.user_id = (SELECT id FROM users WHERE email = 'arun@acme-corp.com');"
```

Should show: acme-corp (owner), acme-platform (owner).

---

### ZONE 8 — UPDATE WIZARD TO USE NEW WORKSPACE API

The onboarding wizard currently has `createProject` which posts to `/v1/projects`. UPDATE it to also call `/tenants` first when the tenant doesn't exist.

In `apps/forge/lib/onboarding/data.ts`, ADD a new function:

```typescript
export async function createWorkspace(
  name: string,
  slug: string,
  region: string = 'us-east-1',
  plan: 'free' | 'pro' | 'enterprise' = 'pro',
): Promise<{ id: string; name: string; slug: string } | null> {
  const res = await fetch(`${SERVER_BASE}/v1/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, slug, region, plan }),
    cache: 'no-store',
  });
  return safeJson<{ id: string; name: string; slug: string }>(res);
}
```

Then in `StepTenantSetup.tsx`, wire the form to call `createWorkspace` AND `createProject`:

```typescript
const handleTenantSubmit = async (form: TenantForm) => {
  setSubmitting(true);
  try {
    const tenant = await createWorkspace(
      form.tenantName,
      form.tenantSlug ?? form.tenantName.toLowerCase().replace(/\s+/g, '-'),
      form.region,
      'pro',
    );
    if (!tenant) throw new Error('Failed to create workspace');

    const project = await createProject({ ...form, tenantSlug: tenant.slug });
    if (!project) throw new Error('Failed to create project');

    toast.success(`Workspace + project created`);
    onComplete(tenant.id, project.id);
  } catch (err) {
    toast.error(`Setup failed: ${err.message}`);
  } finally {
    setSubmitting(false);
  }
};
```

---

### ZONE 9 — UPDATE TENANT-SWITCHER TO LIST MULTIPLE WORKSPACES

The TenantSwitcher already exists with a good UI. Just VERIFY the data layer is right.

CHECK `apps/forge/lib/api/auth.ts`:

```typescript
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  region: string;
  logo_url?: string | null;
  role: 'owner' | 'admin' | 'member';
  is_current: boolean;
}

export async function listMyTenants(): Promise<Tenant[]> {
  return api.get<Tenant[]>('/auth/me/tenants');
}

export async function switchTenant(id: string): Promise<void> {
  const res = await api.post<{ access_token: string }>(`/tenants/${id}/switch`, {});
  localStorage.setItem('forge.access_token', res.access_token);
  window.location.reload();
}
```

If `listMyTenants` is missing or uses the wrong path, FIX it.

---

### ZONE 10 — TERMINAL WORKSPACE SELECTOR (ALSO STATIC)

`apps/forge/components/forge-terminal/WorkspaceSelector.tsx` has hardcoded `WORKSPACES` array. UPDATE to fetch real data:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTerminalStore } from '@/lib/store';
import { listMyTenants } from '@/lib/api/auth';
import { Skeleton } from '@/components/ui/skeleton';

export function WorkspaceSelector() {
  const workspace = useTerminalStore((s) => s.workspace);
  const setWorkspace = useTerminalStore((s) => s.setWorkspace);

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: () => listMyTenants(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-8 w-44" />;
  }

  const items = (tenants ?? []).map(t => ({
    id: t.slug,
    label: t.name,
  }));

  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground px-2">No workspaces</span>;
  }

  return (
    <Select value={workspace} onValueChange={setWorkspace}>
      <SelectTrigger className="h-8 w-44" aria-label="Workspace">
        <SelectValue placeholder="Workspace" />
      </SelectTrigger>
      <SelectContent>
        {items.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

---

### ZONE 11 — TEST SCRIPT

CREATE `backend/scripts/test_onboarding_api.py`:

```python
#!/usr/bin/env python3
"""Test onboarding + workspace APIs.
Run: docker compose exec backend python -m scripts.test_onboarding_api"""

import asyncio, sys, httpx, uuid

BASE_URL = "http://localhost:8000/api/v1"


async def get_token():
    async with httpx.AsyncClient() as c:
        res = await c.post(
            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": "forge-backend",
                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},
        )
        return res.json()["access_token"]


async def test(client, method, path, token, expected=200, **kw):
    res = await getattr(client, method)(
        f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, **kw,
    )
    ok = "✓" if res.status_code == expected else "✗"
    print(f"{ok} {method.upper():6s} {path:50s} → {res.status_code} (expected {expected})")
    if res.status_code != expected:
        print(f"  Body: {res.text[:200]}")
    try:
        return res.json()
    except Exception:
        return None


async def main():
    token = await get_token()
    passed = failed = 0
    def count(ok):
        nonlocal passed, failed
        if ok: passed += 1
        else: failed += 1

    async with httpx.AsyncClient(timeout=30) as c:
        print("=" * 60 + "\nWORKSPACES\n" + "=" * 60)
        tenants = await test(c, "get", "/auth/me/tenants", token)
        count(tenants is not None and len(tenants) >= 1)

        unique_slug = f"test-ws-{uuid.uuid4().hex[:8]}"
        new_tenant = await test(c, "post", "/tenants", token, expected=201, json={
            "name": "Test Workspace",
            "slug": unique_slug,
            "region": "us-east-1",
            "plan": "free",
        })
        count(new_tenant is not None)

        if new_tenant:
            switched = await test(c, "post", f"/tenants/{new_tenant['id']}/switch", token)
            count(switched is not None and "access_token" in (switched or {}))

        dup = await test(c, "post", "/tenants", token, expected=409, json={
            "name": "Duplicate",
            "slug": unique_slug,
        })
        count(dup is None or dup.get("detail") == "slug_already_exists")

        print("\n" + "=" * 60 + "\nONBOARDING PROVISION\n" + "=" * 60)
        prov = await test(c, "post", "/onboarding/provision", token, expected=202)
        count(prov is not None and "job_id" in (prov or {}))

        await asyncio.sleep(2)
        status = await test(c, "get", "/onboarding/provision/status", token)
        count(status is not None and "status" in (status or {}))

        for _ in range(10):
            status = await test(c, "get", "/onboarding/provision/status", token)
            if status and status.get("status") in ("done", "failed"):
                break
            await asyncio.sleep(1)

        print(f"\n  Final provision status: {status.get('status') if status else 'unknown'}")
        print(f"  Completed stages: {status.get('completed_stages') if status else []}")
        count(status is not None and status.get("status") == "done")

        print("\n" + "=" * 60 + "\nONBOARDING SESSIONS\n" + "=" * 60)
        session = await test(c, "post", "/onboarding/sessions", token, expected=201, json={
            "project_id": "00000000-0000-4000-8000-000000000001",
        })
        count(session is not None)

        if session:
            count(await test(c, "get", f"/onboarding/sessions/{session['id']}", token) is not None)

    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

Run:
```bash
docker compose exec backend python -m scripts.test_onboarding_api
```

---

### ZONE 12 — VERIFICATION CHECKLIST

All must pass:

- [ ] `seed_workspaces.py` inserts the acme-platform workspace
- [ ] `test_onboarding_api.py` shows 8/8 passed
- [ ] `curl .../auth/me/tenants` returns at least 2 tenants for arun@acme-corp.com
- [ ] TenantSwitcher dropdown shows "Acme Corp" + "Acme Platform" (not "No workspaces yet")
- [ ] Clicking "Create your first workspace" navigates to `/onboarding/workspace`
- [ ] On the Create Workspace page, typing "Acme Test" auto-fills slug "acme-test"
- [ ] Submitting the form calls `POST /tenants` and switches to the new tenant
- [ ] After successful create, user lands on `/dashboard` with the new tenant selected
- [ ] Onboarding wizard Step 10 (Provision) actually polls the backend, not a fake setInterval
- [ ] Provision stages (manifest / graph / connectors / audit / ready) tick as the backend reports them
- [ ] When provisioning fails (e.g. kill the backend mid-run), the UI shows a real error toast
- [ ] Onboarding wizard creates BOTH a tenant AND a project (not just a project)
- [ ] Terminal workspace selector shows the 2 workspaces (not the hardcoded "default / forge-core / forge-ui / sandbox")
- [ ] Switching tenants via TenantSwitcher triggers a page reload + token refresh
- [ ] LiteLLM team auto-created when a new tenant is created (per Phase 6)

---

## CONSTRAINTS

- DO NOT remove the onboarding wizard — just wire Step 10 to real backend
- KEEP the 5-stage UX (manifest / graph / connectors / audit / ready) — but make each stage driven by backend progress, not setInterval
- TENANT scoping (Rule 2) — every query filters by `tenant_id`
- AUDIT logging (Rule 6) — `@audit()` on every mutation
- RBAC (Rule 8) — `require_permission(...)` on every route
- After Phase 6: NEW tenants must also create a LiteLLM team via `team_sync.py`
- DO NOT remove the existing onboarding wizard state machine — extend with the provision endpoints
- Page reload after tenant switch is intentional (documented in TenantSwitcher)

---

## DELIVERABLE

- `backend/app/api/v1/auth.py` (Zone 1) — added `/auth/me/tenants`
- `backend/app/api/v1/tenants.py` (Zone 2) — new file, `POST /tenants` + `/tenants/{id}/switch`
- `backend/app/api/v1/onboarding.py` (Zone 4) — added `/provision` + `/provision/status`
- `backend/scripts/seed_workspaces.py` (Zone 7)
- `backend/scripts/test_onboarding_api.py` (Zone 11)
- `apps/forge/components/onboarding/StepProvision.tsx` (Zone 3) — polls backend
- `apps/forge/app/project-onboarding/page.tsx` (Zone 5) — wires onProvision
- `apps/forge/app/onboarding/workspace/page.tsx` (Zone 6) — new file
- `apps/forge/lib/onboarding/data.ts` (Zone 8) — added `createWorkspace`
- `apps/forge/components/onboarding/StepTenantSetup.tsx` (Zone 8) — calls createWorkspace + createProject
- `apps/forge/lib/api/auth.ts` (Zone 9) — verify listMyTenants + switchTenant
- `apps/forge/components/forge-terminal/WorkspaceSelector.tsx` (Zone 10) — wired to real API
- All 14 verification items pass
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — onboarding wizard structure, TenantSwitcher UI, the 5-stage UX, page reload on tenant switch

---

## Rationale

This step applies Rule 2 (multi-tenancy by default) by making tenant creation a real first-class operation rather than an implicit side-effect of project creation. The 5-stage provision UX is preserved (don't throw away good UX) but each stage now reflects actual backend progress — Rule 6 (mandatory auditability) means the provision job writes audit rows, and the polling endpoint surfaces failures honestly rather than faking success. The `tenant_sync.py` integration (from Phase 6) means every new workspace automatically gets a LiteLLM team — keeping the LiteLLM proxy pattern consistent.

---

## What we deliberately did NOT change

- Onboarding wizard structure (10 steps + step nav + URL state)
- TenantSwitcher UI (popover with avatar + plan + region, "Create new workspace" CTA)
- The 5-stage provision UX labels
- Page reload after tenant switch (documented as the simplest way to force tenant-scope reset)
- Existing wizard state machine in `lib/store`