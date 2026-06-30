# Reference: The 8 Immutable Rules (Quick-Reference Card)

> **Status:** ✅ Canonical — print this and tape it to your monitor
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/CLAUDE.md` + `/docs/standards/architecture-rules.md` (elaborated)
> **Last updated:** 2026-06-30

---

## Purpose

This is the **one-page card** every Forge contributor and AI agent must internalize. The full elaboration lives at `/docs/standards/architecture-rules.md` (18 rules); this card summarizes the original 8.

**If you violate a rule, your change will be rejected in code review.**

---

## R1 — Provider-agnostic LLM access via LiteLLM Proxy

**All LLM traffic through LiteLLM Proxy. NO direct SDK imports.**

```python
# ✅ Correct
from app.core.litellm_client import LiteLLMClient
client = LiteLLMClient(virtual_key="forge_copilot_*")
await client.acompletion(model="claude-sonnet-4.5", messages=[...])

# ❌ FORBIDDEN
import openai
client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
```

**Enforcement:** CI grep — `grep -rE "from openai|from anthropic" backend/app/` must return empty.

---

## R2 — Multi-tenancy by default

**Every record carries `tenant_id` + `project_id`. RLS at DB level.**

```python
# ✅ Correct
class Story(TenantScopedModel, Base, UUIDPrimaryKeyMixin):
    # tenant_id + project_id inherited

# ❌ FORBIDDEN
class Story(Base):
    # No tenant_id → cross-tenant leak risk
```

**Cross-tenant reads return 404 (not 403 — no enumeration).**

---

## R3 — Human approval gates at boundaries

**AI proposes; humans approve at Architecture / Security / Deployment.**

```python
# ✅ Correct
@router.post("/{approval_id}/decide")
@audit(action="architecture.approval.decide", target_type="approval")
async def decide_approval(approval_id, body, principal):
    # body.decision is Literal["approve", "reject"]
    # Every decision logged + audited
    ...

# ❌ FORBIDDEN
if approval.kind == "deployment":
    approval.decision = "approve"  # Skips human gate
```

**Enforced via LangGraph `interrupt()`.**

---

## R4 — Typed artifacts only

**LLM outputs are Pydantic models with `extra="forbid"`. Never raw text.**

```python
# ✅ Correct
class MigrationPlan(ForgeBaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    tenant_id: UUID
    # ...
    schema_version: str = "1.0.0"

# Parse via Pydantic
plan = MigrationPlan.model_validate(json.loads(response))

# ❌ FORBIDDEN
plan = json.loads(response)
phases = plan["phased_plan"]  # No type safety
```

---

## R5 — Layer isolation

**Org Knowledge (shared across tenants) ≠ Project Intelligence (per-tenant).**

```python
# ✅ Org Knowledge — no tenant_id
class CodingStandard(Base):
    name: Mapped[str]
    # All tenants see the same standards

# ✅ Project Intelligence — tenant-scoped
class Repository(TenantScopedModel, Base):
    url: Mapped[str]
    # tenant_id required

# ❌ FORBIDDEN
class CodingStandard(Base, TenantScopedModel):
    # Standards should be universal; tenant_id pollutes the global view
```

---

## R6 — Mandatory auditability

**Every action logged to append-only audit trail with SHA-256 hash chain.**

```python
# ✅ Correct
@router.post("/api-keys", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.create", target_type="virtual_key")
async def create_virtual_key(...):
    ...

# ❌ FORBIDDEN
@router.post("/api-keys")
async def create_key(...):
    # No @audit → no trace
```

**DB-level `_reject_mutation` listener blocks UPDATE/DELETE on `audit_events`.**

---

## R7 — Mandatory observability

**OpenTelemetry tracing + metrics + logs from day one.**

```python
# ✅ Correct
from opentelemetry import trace
tracer = trace.get_tracer("forge.backend")

async def run_workflow(workflow_id, principal):
    with tracer.start_as_current_span("workflow.run") as span:
        span.set_attribute("workflow.id", str(workflow_id))
        # ...

# ❌ FORBIDDEN
print(f"Workflow {workflow_id} started")  # No trace context
```

---

## R8 — Configurable everything

**No hardcoded GitHub / Claude / OpenAI / AWS / Jira assumptions.**

```python
# ✅ Correct
class Settings(BaseSettings):
    scm_provider: Literal["github", "gitlab", "bitbucket"] = "github"
    # Per-tenant override possible via tenants.settings JSONB

# ❌ FORBIDDEN
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # What if customer uses GitLab?
```

---

## The 8 rules — one-line summary

| Rule | One-liner |
|---|---|
| **R1** | All LLM through LiteLLM Proxy |
| **R2** | Multi-tenant by default (RLS) |
| **R3** | Humans approve at boundaries |
| **R4** | Typed artifacts only |
| **R5** | Org Knowledge ≠ Project Intelligence |
| **R6** | Audit everything (append-only + hash chain) |
| **R7** | Observability from day one |
| **R8** | Configurable everything |

---

## Extended rules (R9-R18)

The elaborated form (`architecture-rules.md`) covers 18 rules total. The 10 extended rules:

| Rule | One-liner |
|---|---|
| **R9** | forge-core is canonical for skills/agents/commands |
| **R10** | forge-pi owns product intelligence |
| **R11** | forge-browser owns visual automation |
| **R12** | Cross-cutting concerns are global chrome |
| **R13** | Idempotency-Key on every mutation |
| **R14** | Soft delete by default |
| **R15** | Approval events are typed |
| **R16** | Secrets Fernet-encrypted at rest |
| **R17** | UI never uses emoji as icons |
| **R18** | Accessibility mandatory (WCAG 2.1 AA) |

---

## Quick verification per PR

```bash
# R1 — no direct SDK imports
grep -rE "from openai|from anthropic" backend/app/  # must be empty

# R2 — every tenant-aware model extends TenantScopedModel
grep -L "TenantScopedModel" backend/app/db/models/*.py | grep -v "__init__"  # must be empty

# R6 — every mutating route has @audit
grep -L "@audit" backend/app/api/v1/*.py  # should only be auth/utility files

# R7 — no print() in production code
grep -rE "^print\(|^\s+print\(" backend/app/  # must be empty (except tests)

# R17 — no emoji in TS/TSX
grep -rE "[\u{1F300}-\u{1F9FF}]" apps/forge/  # must be empty (use lucide-react)

# R18 — Lighthouse Accessibility ≥ 90
pnpm lhci autorun  # check the report
```

---

## Where to go next

- [Standards: architecture-rules](../standards/architecture-rules.md) — Full elaboration (18 rules + examples + forbidden patterns)
- [Standards: coding-standards](../standards/coding-standards.md) — TypeScript + Python patterns
- [Standards: api-conventions](../standards/api-conventions.md) — REST + RBAC + audit + idempotency
- [Vision](../product/vision.md) — Mission + the rules in context

---

**Tape this card to your monitor. Every PR, every code review, every AI agent action — these 8 rules apply.**