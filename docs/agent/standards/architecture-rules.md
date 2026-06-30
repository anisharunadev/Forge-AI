# Standard: Architecture Rules (The 18 Immutable Rules)

> **Status:** ✅ Canonical — every AI agent working on Forge MUST honor these rules
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/CLAUDE.md` (root) + this file (elaborated)
> **Last updated:** 2026-06-30

---

## Purpose

This document is the **canonical expansion** of the 18 constitutional rules that govern every line of code, every feature, and every AI agent action in Forge AI Agent OS. The 8 core rules live in `CLAUDE.md` (the root file every AI agent reads first); this document provides the **elaborated form** with examples, forbidden patterns, and verification checklists.

**If you violate a rule, your change will be rejected in code review.** No exceptions.

---

## Source of truth

- **This file** — `/workspace/docs/standards/architecture-rules.md` (elaborated form)
- **Root file** — `~/forge-ai/CLAUDE.md` (1-page summary)
- **Quick reference** — `/workspace/docs/reference/8-rules.md` (the 8 core rules in card form)
- **Constitutional matrix** — every feature doc has a "Constitutional rules" section mapping its rules

---

## The 18 rules

### Core rules (R1-R8 — the original 8)

#### R1 — Provider-agnostic LLM access via LiteLLM Proxy

**Rule:** All LLM traffic MUST flow through the LiteLLM Proxy. NO direct SDK imports.

**Why:** Cost governance, rate limiting, audit, vendor portability, key rotation.

**Where it lives:** `backend/app/core/litellm_client.py` + `backend/app/integrations/litellm/`

**Enforcement:**
- ESLint rule against importing `openai`, `anthropic`, `google-generativeai`, `cohere`, `mistral`, etc.
- CI grep: `grep -rE "from openai|from anthropic|from google\.generativeai" backend/app/` must return empty
- Cost recorded to `litellm_call_records` (the audit source of truth)

**Correct pattern:**

```python
# backend/app/services/copilot.py
from app.core.litellm_client import LiteLLMClient

async def stream_response(prompt: str) -> AsyncIterator[str]:
    client = LiteLLMClient(virtual_key="forge_copilot_*")
    async for chunk in client.acompletion(
        model="anthropic/claude-sonnet-4.5",
        messages=[{"role": "user", "content": prompt}],
    ):
        yield chunk.choices[0].delta.content or ""
```

**Forbidden patterns:**

```python
# ❌ Direct OpenAI SDK
import openai
client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
client.chat.completions.create(...)

# ❌ Direct Anthropic SDK
import anthropic
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
client.messages.create(...)

# ❌ Bypassing the proxy via HTTP
import httpx
await httpx.post("https://api.openai.com/v1/chat/completions", ...)
```

**See also:** [standards/litellm-integration.md](./litellm-integration.md), [reference/litellm-bridge.md](../reference/litellm-bridge.md), [features/admin-hub.md](../features/admin-hub.md)

---

#### R2 — Multi-tenancy by default

**Rule:** Every record carries `tenant_id` + `project_id`. RLS enforced at DB level. No code path can produce a cross-tenant read or write.

**Why:** A single Forge deployment serves many customer orgs. Leaking one tenant's data to another is a security incident.

**Where it lives:** `backend/app/db/models/tenant.py` + `backend/app/db/models/base.py` (TenantScopedModel mixin) + Postgres RLS policies

**Enforcement:**
- Every Pydantic model that touches DB extends `TenantScopedModel`
- Every SQL query goes through `TenantScopedSession` (auto-adds `WHERE tenant_id = ?`)
- Postgres RLS policies enforce tenant isolation at the DB layer
- 404 returned on cross-tenant reads (NOT 403, to avoid tenant enumeration)

**Correct pattern:**

```python
# backend/app/db/models/story.py
from app.db.base import TenantScopedModel

class Story(TenantScopedModel, Base, UUIDPrimaryKeyMixin):
    __tablename__ = "stories"
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # tenant_id + project_id inherited from TenantScopedModel
```

```python
# backend/app/api/v1/stories.py
@router.get("/{story_id}")
async def get_story(
    story_id: UUID,
    principal: Principal,  # carries tenant_id + project_id from JWT
    db: DbSession,
):
    story = await db.get(Story, story_id)  # RLS auto-filters
    if not story:
        raise HTTPException(404)  # cross-tenant = 404, not 403
    return story
```

**Forbidden patterns:**

```python
# ❌ Cross-tenant query (no filter)
await db.execute(select(Story).where(Story.id == story_id))

# ❌ Skipping the principal
async def get_story(story_id: UUID, db: DbSession):
    story = await db.get(Story, story_id)
    return story  # Could leak any tenant's data

# ❌ Hardcoded tenant_id
await db.execute(select(Story).where(Story.tenant_id == UUID("00000000-0000-4000-8000-000000000001")))
```

**See also:** [standards/data-model.md](./data-model.md), [features/auth.md](../features/auth.md) (uuid5 coercion), [features/workspaces.md](../features/workspaces.md) (sidebar chrome)

---

#### R3 — Human approval gates at boundaries

**Rule:** No autonomous crossing of **Architecture / Security / Deployment** boundaries. Every such transition requires a human approval event.

**Why:** Some decisions are too consequential to delegate to agents. AI proposes; humans approve.

**Where it lives:** `backend/app/services/policy_engine.py` + `backend/app/api/v1/approvals.py` + sub-routers in `architecture/approvals.py` and `ideation/approvals.py`

**3 mandatory gates:**

| Boundary | Gate | UI |
|---|---|---|
| **Architecture** | Before producing an ADR / contract | Architecture Center → Approvals tab |
| **Security** | Before merging a security-sensitive change | Governance → Approvals |
| **Deployment** | Before deploying to production | Workflows → Approval node |

**Correct pattern:**

```python
# backend/app/api/v1/architecture/approvals.py
@router.post("/{approval_id}/decide")
@audit(action="architecture.approval.decide", target_type="approval")
async def decide_approval(
    approval_id: UUID,
    body: ApprovalDecision,
    principal: Principal,
    db: DbSession,
):
    approval = await db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(404)
    if approval.decision != "pending":
        raise HTTPException(409, "Already decided")

    # Record decision
    approval.decision = body.decision  # approve | reject
    approval.decided_by = principal.actor_id
    approval.decided_at = datetime.now(timezone.utc)
    approval.reason = body.reason

    # Emit event for downstream nodes
    await bus.publish(EventType.APPROVAL_DECIDED, {...})

    return approval
```

**Forbidden patterns:**

```python
# ❌ Auto-approval without human
if approval.kind == "deployment":
    approval.decision = "approve"  # Skip human gate
    await db.commit()

# ❌ No audit on decision
async def decide(approval_id, body):
    await db.execute(update(Approval).values(decision=body.decision))
    # No @audit decorator — no trace of who decided what
```

**See also:** [features/architecture-center.md](../features/architecture-center.md), [features/governance.md](../features/governance.md), [features/workflows.md](../features/workflows.md) (approval node type)

---

#### R4 — Typed artifacts only

**Rule:** LLM outputs are Pydantic models with `extra="forbid"`. NEVER raw text or untyped dicts.

**Why:** Typed artifacts make LLM output testable, auditable, diff-able, and downstream-consumable. Untyped text is opaque.

**Where it lives:** `backend/app/schemas/` (every typed artifact)

**Enforcement:**
- All schemas extend `ForgeBaseModel` (Pydantic v2 + `extra="forbid"`)
- LLM responses parsed via `model_validate()` (NOT `dict()` access)
- Schema version embedded (`schema_version: str`) for migrations

**Correct pattern:**

```python
# backend/app/schemas/migration_plan.py
class MigrationPlan(ForgeBaseModel):
    """The typed migration-plan artifact produced by the Refactor Agent."""
    model_config = ConfigDict(extra="forbid")

    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    project_id: UUID
    phased_plan: list[MigrationPhase] = Field(..., min_length=1, max_length=100)
    risk_register: list[RiskItem] = Field(default_factory=list, max_length=500)
    schema_version: str = "1.0.0"  # for migrations
```

```python
# Correctly parse LLM output
response = await litellm_client.acompletion(
    model="anthropic/claude-sonnet-4.5",
    messages=[...],
    response_format={"type": "json_schema", "json_schema": MigrationPlan.model_json_schema()},
)
plan = MigrationPlan.model_validate(json.loads(response.choices[0].message.content))
```

**Forbidden patterns:**

```python
# ❌ Raw dict access
plan = json.loads(response.choices[0].message.content)
phases = plan["phased_plan"]  # no type info, can break downstream

# ❌ Missing extra="forbid"
class MigrationPlan(BaseModel):
    name: str
    # LLM can return extra fields; they'll silently pass through

# ❌ No schema_version
class MigrationPlan(BaseModel):
    name: str
    # v1 / v2 breaking change = silent failure
```

**See also:** [standards/coding-standards.md](./coding-standards.md) (Pydantic v2 patterns), every feature doc has a "Schemas" section

---

#### R5 — Layer isolation

**Rule:** Org Knowledge is shared across tenants (curated standards). Project Intelligence is per-tenant (ingested code, decisions).

**Why:** Standards are universal; projects are private. Mixing them violates tenant isolation AND pollutes the canonical knowledge base.

**Where it lives:** `backend/app/db/models/organization_knowledge.py` vs `backend/app/db/models/project_intelligence.py`

**Correct pattern:**

```python
# Org Knowledge — shared (no tenant_id required)
class CodingStandard(Base):
    __tablename__ = "coding_standards"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    rule_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    # NO tenant_id — all tenants see the same standards


# Project Intelligence — per-tenant (extends TenantScopedModel)
class Repository(TenantScopedModel, Base):
    __tablename__ = "repositories"
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime)
    # tenant_id + project_id REQUIRED
```

**Forbidden patterns:**

```python
# ❌ Tenant-scoped table without tenant_id
class CodingStandard(Base):
    name: Mapped[str]
    # Will leak across tenants via shared query

# ❌ Org-scoped table with tenant_id
class CodingStandard(Base, TenantScopedModel):
    name: Mapped[str]
    # Standards should be universal; tenant_id here pollutes the global view
```

**See also:** [features/knowledge-center.md](../features/knowledge-center.md), [features/projects.md](../features/projects.md)

---

#### R6 — Mandatory auditability

**Rule:** Every action — agent, model, prompt, tool, cost, artifact, timestamp, result — is logged to an append-only audit trail.

**Why:** Compliance (SOC2 / ISO 27001), incident response, debugging, customer trust. If it's not logged, it didn't happen.

**Where it lives:** `backend/app/core/audit.py` (decorator) + `backend/app/services/audit_service.py` + `audit_events` table

**Enforcement:**
- `@audit(action="...", target_type="...")` decorator on every mutating route
- DB-level `_reject_mutation` listener on UPDATE/DELETE (immutability)
- SHA-256 hash chain across consecutive rows (tamper detection)

**Correct pattern:**

```python
# backend/app/core/audit.py
def audit(action: str, target_type: str):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, principal: Principal, **kwargs):
            result = await func(*args, principal=principal, **kwargs)
            await audit_service.record(
                action=action,
                target_type=target_type,
                target_id=getattr(result, "id", None),
                actor_id=principal.actor_id,
                tenant_id=principal.tenant_id,
                timestamp=datetime.now(timezone.utc),
                result=result,
            )
            return result
        return wrapper
    return decorator
```

```python
# Usage
@router.post("/api-keys", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.create", target_type="virtual_key")
async def create_virtual_key(...):
    ...
```

**Forbidden patterns:**

```python
# ❌ No @audit decorator on mutation
@router.post("/api-keys")
async def create_virtual_key(...):  # No audit trail
    ...

# ❌ Direct DB write (bypasses audit service)
await db.execute(insert(VirtualKey).values(...))

# ❌ Audit event without target_type
await audit_service.record(action="create", actor_id=...)  # What was created?
```

**See also:** [features/audit.md](../features/audit.md), [features/admin-hub.md](../features/admin-hub.md)

---

#### R7 — Mandatory observability

**Rule:** OpenTelemetry tracing, metrics, and logs from day one. Every service exports to the observability stack.

**Why:** Production debugging requires distributed tracing. Cost attribution requires per-call metrics. SLO monitoring requires structured logs.

**Where it lives:** `backend/app/core/telemetry.py`

**3 pillars:**
- **Tracing** — every request gets a trace_id; spans for LLM calls, DB queries, external API calls
- **Metrics** — Prometheus-format metrics (request count, latency, cost, error rate)
- **Logs** — structured JSON logs (timestamp, level, trace_id, span_id, message, context)

**Correct pattern:**

```python
# backend/app/core/telemetry.py
from opentelemetry import trace

tracer = trace.get_tracer("forge.backend")

async def run_workflow(workflow_id: UUID, principal: Principal):
    with tracer.start_as_current_span("workflow.run") as span:
        span.set_attribute("workflow.id", str(workflow_id))
        span.set_attribute("tenant.id", str(principal.tenant_id))

        # LLM call (gets its own span)
        with tracer.start_as_current_span("llm.completion"):
            response = await litellm_client.acompletion(...)

        # DB query (auto-instrumented by SQLAlchemy)
        result = await db.execute(...)

        span.set_attribute("workflow.cost_usd", calculate_cost(response))
        return result
```

**Forbidden patterns:**

```python
# ❌ print() instead of structured logs
print(f"Workflow {workflow_id} started")

# ❌ No trace context
async def run_workflow(...):
    # No span = no tracing = blind debugging
    ...

# ❌ Lost exception context
try:
    await run_agent(...)
except Exception as e:
    logger.error(f"Failed: {e}")  # No traceback
```

---

#### R8 — Configurable everything

**Rule:** No hardcoded GitHub / Claude / OpenAI / AWS / Jira assumptions. Every external dependency is configurable per-tenant.

**Why:** Forge serves customers on different clouds, different SCMs, different ticketing systems. Hardcoding any one of them makes the product single-tenant.

**Where it lives:** `backend/app/core/config.py` (Pydantic Settings) + tenant-level overrides in `tenants.settings` (JSONB)

**Correct pattern:**

```python
# backend/app/core/config.py
class Settings(BaseSettings):
    # LLM provider
    litellm_proxy_url: str = "http://litellm:4000"
    default_model: str = "anthropic/claude-sonnet-4.5"

    # SCM provider (per-tenant override possible)
    scm_provider: Literal["github", "gitlab", "bitbucket"] = "github"

    # Ticketing provider (per-tenant override possible)
    ticketing_provider: Literal["jira", "linear", "github_issues"] = "jira"

    # AWS region
    aws_region: str = "us-east-1"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="FORGE_")
```

```python
# Per-tenant override
tenant = await db.get(Tenant, tenant_id)
if tenant.settings.get("scm_provider"):
    scm_provider = tenant.settings["scm_provider"]  # per-tenant override
```

**Forbidden patterns:**

```python
# ❌ Hardcoded GitHub
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # What if customer uses GitLab?
headers = {"Authorization": f"token {GITHUB_TOKEN}"}

# ❌ Hardcoded Jira API
JIRA_BASE = "https://acme.atlassian.net"  # Not multi-tenant

# ❌ Hardcoded model
await litellm.acompletion(model="claude-sonnet-4.5")  # What if customer wants GPT-4?
```

**See also:** [features/connector-center.md](../features/connector-center.md) (12 ConnectorTypes)

---

### Extended rules (R9-R18 — the elaborations)

#### R9 — forge-core is canonical for skills/agents/commands

**Rule:** All skill, agent, and command definitions live in `packages/forge-core/`. UI auto-discovers them. Never hardcode lists in `apps/forge`.

**Why:** Single source of truth; auto-discovery; versioned; reusable across surfaces.

**Where it lives:** `packages/forge-core/` (skills + agents + commands)

**Correct pattern:**

```typescript
// apps/forge/components/command-center/CommandPalette.tsx
// Imports from forge-core dynamically — never hardcodes
import { loadCommands } from '@/lib/forge-core/loader';

const commands = await loadCommands();  // 63 forge-* commands from forge-core
```

**Forbidden patterns:**

```typescript
// ❌ Hardcoded command list
const COMMANDS = [
  { name: "forge-review", category: "Quality" },
  { name: "forge-arch-adr", category: "Architecture" },
  // ... 61 more hardcoded entries
];
```

**See also:** [reference/forge-core.md](../reference/forge-core.md), [features/command-center.md](../features/command-center.md)

---

#### R10 — forge-pi owns product intelligence

**Rule:** Codebase scanning, knowledge graph construction, idea scoring, PRD generation, architecture-diagram auto-gen, and API-contract discovery MUST delegate to `packages/forge-pi/`. Never reimplement in `apps/forge`.

**Why:** Reimplementing these = weeks of work + drift from canonical implementation.

**Where it lives:** `packages/forge-pi/commands/` (scan, build-graph, score-idea, draft-prd, etc.)

**See also:** [reference/forge-core.md](../reference/forge-core.md)

---

#### R11 — forge-browser owns visual automation

**Rule:** Screenshot capture, pixel comparison, WCAG accessibility audits, post-deploy smoke testing, UAT automation, the QA Agent, and the Canary Agent MUST delegate to `packages/forge-browser/`. Never reimplement in `apps/forge`.

**Where it lives:** `packages/forge-browser/commands/` (screenshot, ui-review, a11y-audit, journey, deploy-verify)

**See also:** [reference/forge-core.md](../reference/forge-core.md)

---

#### R12 — Cross-cutting concerns are global chrome

**Rule:** Co-pilot FAB, ConnectorPicker, `⌘K` Command palette, and WorkspaceSwitcher must be available everywhere. They're not optional page features — they're the substrate.

**Where it lives:** `apps/forge/components/shell/` (ShellChrome mounts these globally)

**3 global surfaces:**

| Surface | Hotkey | Lives in |
|---|---|---|
| Co-pilot FAB | `⌘J` | `components/copilot/` |
| Connector Picker | (in command palette) | `components/connectors/` |
| `⌘K` Command | `⌘K` | `components/command-center/` |
| Workspace Switcher | `⌘\` | `components/shell/Sidebar.tsx` |

**Forbidden patterns:**

```typescript
// ❌ Mounting Co-pilot only on /copilot page
// app/copilot/page.tsx
<CoPilot />  // Wrong — should be in root layout

// ❌ Hidden ⌘K on certain pages
useEffect(() => {
  if (pathname !== '/') {
    disableCommandPalette();  // Wrong — palette is global
  }
}, [pathname]);
```

**See also:** [features/copilot.md](../features/copilot.md), [features/command-center.md](../features/command-center.md), [features/workspaces.md](../features/workspaces.md)

---

#### R13 — Idempotency-Key contract on all mutations

**Rule:** Every `POST`, `PUT`, `PATCH`, `DELETE` from frontend MUST send a fresh `Idempotency-Key: <uuid-v4>` header. Backend dedupes.

**Why:** Network retries are inevitable. Without idempotency keys, a retry creates a duplicate record.

**Where it lives:** `backend/app/core/idempotency.py` (middleware) + `apps/forge/lib/api/client.ts` (key generator)

**Correct pattern:**

```typescript
// apps/forge/lib/api/client.ts
export async function postMutation<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),  // fresh per attempt
    body: JSON.stringify(body),
  });
}
```

**Forbidden patterns:**

```typescript
// ❌ Missing Idempotency-Key on POST
await fetch("/api/v1/workflows", {
  method: "POST",
  body: JSON.stringify(workflow),
});
// Retry = duplicate workflow
```

**See also:** [standards/api-conventions.md](./api-conventions.md), [features/workflows.md](../features/workflows.md)

---

#### R14 — Soft delete by default, hard delete only for security

**Rule:** Tables have a `deleted_at` column. Hard deletes only for GDPR / right-to-be-forgotten / tenant offboarding.

**Why:** Recoverability + audit trail. Accidental deletes happen; "Ctrl+Z" should work for DB rows.

**Where it lives:** `backend/app/db/models/base.py` (`SoftDeleteMixin`)

**Correct pattern:**

```python
# backend/app/db/models/story.py
class Story(TenantScopedModel, Base, SoftDeleteMixin):
    __tablename__ = "stories"
    # deleted_at: Mapped[datetime | None] = ...  (inherited)
    # deleted_by: Mapped[UUID | None] = ...  (inherited)

# Soft delete
await db.execute(
    update(Story)
    .where(Story.id == story_id)
    .values(deleted_at=datetime.now(timezone.utc), deleted_by=principal.actor_id)
)

# Queries auto-filter deleted_at IS NULL
```

**Forbidden patterns:**

```python
# ❌ Hard delete
await db.execute(delete(Story).where(Story.id == story_id))
# Lost audit trail; cannot recover; cannot investigate incident
```

---

#### R15 — Approval events are typed (not free-text)

**Rule:** Every approval decision is a typed event with `decision: Literal["approve", "reject"]`, `reason`, `decided_by`, `decided_at`. Never free-text.

**Why:** Type-safe decisions enable downstream automation (e.g. "approve" triggers merge, "reject" triggers re-plan).

**Where it lives:** `backend/app/schemas/approval.py`

**Correct pattern:**

```python
class ApprovalDecision(ForgeBaseModel):
    decision: Literal["approve", "reject"]
    reason: str = Field(..., min_length=1, max_length=2000)
    decided_by: UUID
    decided_at: datetime
```

**Forbidden patterns:**

```python
# ❌ Free-text decision
class ApprovalDecision(BaseModel):
    notes: str  # "Looks good" / "needs more work" / ?
```

---

#### R16 — Secrets are Fernet-encrypted at rest

**Rule:** All env vars, API keys, OAuth tokens stored in DB are Fernet-encrypted with a tenant-derived key. Never stored plaintext.

**Why:** DB dumps must not leak credentials. Per-tenant keys mean one tenant's DB extract doesn't decrypt another's.

**Where it lives:** `backend/app/core/encryption.py` + `backend/app/services/secrets_service.py`

**Key derivation:**
```python
# Stable from JWT_SECRET + tenant_id (deterministic)
tenant_key = Fernet(base64.urlsafe_b64encode(
    hashlib.sha256(f"{JWT_SECRET}:{tenant_id}".encode()).digest()[:32]
))
encrypted = tenant_key.encrypt(plaintext.encode())
```

**See also:** [features/connector-center.md](../features/connector-center.md) (Fernet envelope)

---

#### R17 — UI never uses emoji as icons

**Rule:** All icons are `lucide-react` components. Emoji is banned (inconsistent rendering, accessibility issues, no semantic meaning).

**Why:** Consistent visual language, accessible (icons have `aria-hidden`), no Unicode variation issues.

**Where it lives:** All components — `import { Activity, Bot, ... } from 'lucide-react'`

**Correct pattern:**

```tsx
import { Activity } from "lucide-react";

<Activity className="h-4 w-4" aria-hidden="true" />
```

**Forbidden patterns:**

```tsx
// ❌ Emoji icon
<span>🚀</span>

// ❌ Inline SVG without semantic meaning
<svg viewBox="0 0 24 24"><path d="..." /></svg>

// ❌ Missing aria-hidden (screen readers announce decorative icons)
<Activity className="h-4 w-4" />
```

---

#### R18 — Accessibility is mandatory (WCAG 2.1 AA)

**Rule:** Every page passes WCAG 2.1 AA. Lighthouse Accessibility ≥ 90. Every interactive element has an `aria-label` or visible label.

**Why:** Compliance + users with disabilities. Forge serves enterprise; enterprise buys accessible software.

**Where it lives:** `apps/forge/app/` (every page) + `components/ui/` (every component)

**Enforcement:**
- Lighthouse CI in pipeline (block merge if < 90)
- axe-core in Playwright tests
- Manual screen-reader testing on every Center

**Correct patterns:**

```tsx
// All interactive elements labeled
<button aria-label="Switch workspace">
  <WorkspaceIcon />
</button>

// Headings in order
<h1>Dashboard</h1>
<h2>Recent activity</h2>
<h3>Story #1234</h3>

// Focus rings visible
className="focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2"

// prefers-reduced-motion respected
@media (prefers-reduced-motion: reduce) {
  .animate-pulse { animation: none; }
}
```

**Forbidden patterns:**

```tsx
// ❌ Icon-only button without label
<button><CloseIcon /></button>

// ❌ Skipped heading levels
<h1>Title</h1>
<h3>Subsection</h3>  // Skipped h2

// ❌ Color-only signal (no glyph)
<span style={{ color: 'red' }}>Error</span>  // Color-blind users can't distinguish
```

**See also:** [standards/design-system.md](./design-system.md) (motion + reduced-motion)

---

## Verification checklist

For every PR, verify:

- [ ] **R1** — `grep -rE "from openai|from anthropic" backend/app/` returns empty
- [ ] **R2** — Every Pydantic model touching DB extends `TenantScopedModel`
- [ ] **R3** — Every Architecture/Security/Deployment transition has an approval gate
- [ ] **R4** — Every LLM output is parsed via `model_validate()` (not `dict` access)
- [ ] **R5** — Org Knowledge tables don't have `tenant_id`; Project Intelligence tables do
- [ ] **R6** — Every mutating route has `@audit(...)` decorator
- [ ] **R7** — Every async function has tracing context
- [ ] **R8** — No hardcoded GitHub/Jira/OpenAI strings; use settings
- [ ] **R9** — UI skill/agent/command lists load from `packages/forge-core/`
- [ ] **R10** — Codebase scanning delegates to `packages/forge-pi/`
- [ ] **R11** — Visual automation delegates to `packages/forge-browser/`
- [ ] **R12** — Co-pilot + `⌘K` + WorkspaceSwitcher mounted in root layout
- [ ] **R13** — Every POST/PUT/PATCH/DELETE sends `Idempotency-Key`
- [ ] **R14** — Tables use `SoftDeleteMixin`; hard deletes only for security
- [ ] **R15** — Approval decisions are `Literal["approve", "reject"]`
- [ ] **R16** — Secrets encrypted at rest via Fernet
- [ ] **R17** — All icons are `lucide-react`; no emoji
- [ ] **R18** — Lighthouse Accessibility ≥ 90; every interactive element labeled

---

## How rules evolve

1. **Propose** — open a PR against `~/forge-ai/CLAUDE.md` adding the rule with rationale
2. **Discuss** — platform team + security team review
3. **Approve** — at least 2 senior engineers sign off
4. **Implement** — update `docs/standards/architecture-rules.md` (this file) + every affected feature doc
5. **Verify** — run the verification checklist above in CI

---

## Related docs

- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)
- [The 8 rules quick reference](../reference/8-rules.md)
- [Forge-core reference](../reference/forge-core.md)
- [LiteLLM bridge](../reference/litellm-bridge.md)

---

**Remember: If you violate a rule, your change will be rejected in code review. No exceptions.**