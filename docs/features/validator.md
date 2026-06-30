# Feature: Code Validator (Validation Reports)

> **Status:** Wired to real backend (F-501 + F-502 — LangGraph sub-graph + REST endpoints)
> **Routes:** `apps/forge/app/validator/page.tsx` (list) + `apps/forge/app/validator/[report_id]/page.tsx` (detail) + `apps/forge/app/validator/live/page.tsx` (live tail)
> **Backend:** `backend/app/api/v1/validation_reports.py` (3 routes)
> **Validator agent:** `backend/app/agents/code_validator.py` + 4 scanner nodes
> **Schemas:** `backend/app/schemas/validation_report.py`
> **Constitutional rules:** R1 (LiteLLM proxy — validator LLM calls), R2 (multi-tenant), R4 (typed artifacts — `ValidationReport`), R6 (auditability — dual write to ArtifactRegistry + AuditEvent)

---

## Purpose

The Code Validator is the **post-implementation quality gate**. It runs 4 scanners (secrets, IaC, vulns, standards) in parallel, aggregates findings into a typed `ValidationReport` with a `PASS`/`FAIL` decision, and stores it as a tenant-scoped Artifact.

Per PRD §1.4 the Validator serves **tech leads** (read scan results + recommend fixes), **engineers** (drill into findings + see remediation), and **stewards** (audit scan history + compliance evidence).

**Key capabilities:**

- **LangGraph sub-graph** — independent of SDLC supervisor (NFR-042 + NFR-043)
- **4 scanners in parallel** — secrets, IaC, vulns, standards (Send API fan-out)
- **Typed `ValidationReport`** — schema-versioned (1.0.0), typed findings, decision enum
- **Dual-write to ArtifactRegistry + AuditEvent** — append-only, content-hashed
- **3 polling cadences** — list 30s, detail 5s (while running), live 3s
- **Severity-ranked findings** — critical / high / medium / low with sort rank
- **Remediation panel** — per-finding suggested fix + standards reference
- **Live tail page** — watches running scans in near-real-time

---

## Architecture

```
ValidatorListPage (/validator)
└── ValidationReportCard grid (per project)
    ├── Project selector input
    ├── Refresh button
    └── 30s polling

ValidatorDetailPage (/validator/[report_id])
└── Per-report detail
    ├── Breadcrumb back to /validator
    ├── Summary card (status banner + severity counts)
    ├── FindingsTable (severity-sorted, file-path-grouped)
    └── RemediationPanel (suggested fixes per finding)

ValidatorLivePage (/validator/live)
└── Live scan tail
    ├── Running reports (top)
    ├── Recently completed (bottom 6)
    └── 3s polling

Backend (LangGraph sub-graph)
└── START
      └─▶ scan_secrets ──┐
            scan_iac ────┼─▶ aggregate_findings ──▶ END
            scan_vulns ──┤
            scan_standards ┘

Backend REST
└── POST /api/v1/validation-reports
       ├── ArtifactRegistry (append-only, content_hash)
       └── AuditEvent (audit trail)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/validator` | ValidatorListPage | List view per project |
| `/validator/[report_id]` | ValidatorDetailPage | Per-report detail |
| `/validator/live` | ValidatorLivePage | Live scan tail |

### Backend (FastAPI) — `backend/app/api/v1/validation_reports.py` — **3 routes**

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/validation-reports` | `validation_reports:create` | Submit a ValidationReport (201) |
| `GET` | `/api/v1/validation-reports/{id}` | (auth) | Get one report |
| `GET` | `/api/v1/validation-reports?commit_sha=X` | (auth) | List reports for tenant + commit_sha (RLS-scoped) |

> **Note on frontend URLs:** The frontend uses `/v1/validator/projects/{id}/reports` and `/v1/validator/reports/{id}` (different path than backend). This is the orchestrator proxy path, not the FastAPI path. The orchestrator translates the call.

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `artifacts` | ValidationReport persisted as Artifact (append-only) |
| `audit_events` | Audit trail per submit |
| `validation_reports` (legacy?) | May be a separate table — current canonical store is `artifacts` |

### Pydantic schemas (`backend/app/schemas/validation_report.py`)

```python
SEVERITY_LEVELS = ("critical", "high", "medium", "low", "info")
"""Ordered worst->best so by_severity aggregation is stable."""

DecisionLiteral = Literal["PASS", "FAIL"]
SeverityLiteral = Literal["critical", "high", "medium", "low", "info"]

SCHEMA_VERSION: str = "1.0.0"


class ValidationFinding(ForgeBaseModel):
    """One issue surfaced by a scanner during a validation run."""
    finding_id: str = Field(..., min_length=1, max_length=128)
    severity: SeverityLiteral
    file_path: str = Field(..., min_length=1, max_length=1024)
    line: int = Field(..., ge=0)
    rule_id: str = Field(..., min_length=1, max_length=128)
    evidence: str = Field(..., min_length=1)
    recommended_fix: str = Field(default="")
    standards_ref: list[str] = Field(default_factory=list)


class ValidationSummary(ForgeBaseModel):
    """Aggregated counters for a single ValidationReport."""
    total_findings: int = Field(default=0, ge=0)
    by_severity: dict[SeverityLiteral, int] = Field(default_factory=dict)
    scan_duration_ms: int = Field(default=0, ge=0)
    scanners_executed: list[str] = Field(default_factory=list)

    @field_validator("by_severity")
    @classmethod
    def _ensure_known_severities(cls, v: dict[str, int]) -> dict[str, int]:
        unknown = set(v.keys()) - set(SEVERITY_LEVELS)
        if unknown:
            raise ValueError(...)
        return v


class ValidationReport(ForgeBaseModel):
    """Top-level envelope for a single validator run."""
    report_id: UUID
    run_id: UUID
    timestamp: datetime
    validator_version: str = Field(..., min_length=1, max_length=64)
    decision: DecisionLiteral
    findings: list[ValidationFinding] = Field(default_factory=list)
    summary: ValidationSummary
    evidence_pack_url: str = Field(default="", max_length=2048)
    schema_version: str = Field(default=SCHEMA_VERSION)

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, v: str) -> str:
        if v != SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version {v!r}; expected {SCHEMA_VERSION!r}")
        return v
```

### TypeScript mirror (`apps/forge/lib/api.ts`)

```typescript
export type ValidationSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Rank used for sorting — lower number = higher priority. */
export const VALIDATION_SEVERITY_RANK: Record<ValidationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface ValidationFindingLocation {
  readonly filePath: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ValidationFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly message: string;
  readonly location: ValidationFindingLocation;
  readonly suggestedFix?: string;
}

export interface ValidationSummary {
  readonly total: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly passed: number;
}

/** Outcome of a single scan. `pass` ⇒ zero findings of `critical`/`high`. */
export type ValidationStatus = 'pass' | 'fail' | 'running' | 'error';

export interface ValidationReport {
  readonly reportId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly status: ValidationStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly summary: ValidationSummary;
  readonly findings: ReadonlyArray<ValidationFinding>;
}
```

> **⚠️ Schema divergence:** Backend uses 5-level severity (`critical / high / medium / low / info`) + `decision: PASS/FAIL`. Frontend uses 4-level severity (`critical / high / medium / low`) + `status: pass/fail/running/error`. The adapter maps backend's `decision` → frontend's `status` (PASS→pass, FAIL→fail) and merges `low + info` on the frontend.

---

## 3 TanStack Query Hooks (`apps/forge/lib/hooks/useValidationReports.ts`)

```typescript
// 1. List — 30s polling
export function useValidationReports(projectId: string) {
  return useQuery({
    queryKey: validationQueryKeys.list(projectId),
    queryFn: () => listValidationReports(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// 2. Detail — 5s polling while running
export function useValidationReport(reportId: string) {
  return useQuery({
    queryKey: validationQueryKeys.detail(reportId),
    queryFn: () => getValidationReport(reportId),
    enabled: Boolean(reportId),
    refetchInterval: (q) => {
      const data = q.state.data as ValidationReport | undefined;
      return data?.status === 'running' ? 5_000 : false;  // smart polling
    },
    staleTime: 10_000,
  });
}

// 3. Live tail — 3s polling
export function useLiveValidationScans(projectId: string) {
  return useQuery({
    queryKey: validationQueryKeys.live(projectId),
    queryFn: () => listValidationReports(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 3_000,
    staleTime: 1_000,
  });
}
```

**3 polling cadences:**
- **List page** — 30s (low traffic, avoid hammering)
- **Detail page** — 5s while `running`, then stop (smart predicate)
- **Live page** — 3s constant (operator wants real-time)

---

## LangGraph Sub-Graph (`backend/app/agents/code_validator.py`)

### Topology (Fan-out / Fan-in)

```
START
  └─▶ scan_secrets ──┐
        scan_iac ────┼─▶ aggregate_findings ──▶ END
        scan_vulns ──┤
        scan_standards ┘
```

- **Entry node:** `scan_secrets`
- **Fan-out:** 3 parallel scanners via LangGraph's `Send` API
- **Aggregator:** `aggregate_findings` produces typed `ValidationReport`

### Independence (NFR-043)

> "The sub-graph is fully independent of the SDLC supervisor:
> - It carries its own `CodeValidatorState`
> - It owns its own prompt template (`app.agents/prompts/code_validator.j2`)
> - It uses a dedicated LiteLLM virtual key prefix (`forge_validator_*`) via `LiteLLMClient.create_virtual_key`
> - It does NOT import from `sdlc_agent` or `sdlc_state`"

### 4 Scanner Nodes (`backend/app/agents/code_validator_nodes/`)

| Node | Purpose |
|---|---|
| `scan_secrets.py` | Detect leaked secrets (API keys, passwords, tokens) |
| `scan_iac.py` | IaC misconfiguration (Terraform / CloudFormation / K8s) |
| `scan_vulns.py` | CVE / vulnerability scan (per dependency file) |
| `scan_standards.py` | Compliance against coding standards (per Rule 9) |
| `aggregate_findings.py` | Combine all 4 buckets → typed `ValidationReport` with PASS/FAIL |

### Code Validator State (`backend/app/agents/code_validator_state.py`)

```python
class Severity(str, Enum):
    """Severity scale used by every scanner.

    Ordered from least to most severe. The aggregate node converts
    """
```

---

## Dual-Write Pattern (F-502)

```python
# backend/app/api/v1/validation_reports.py
"""The dual write (ArtifactRegistry + AuditEvent) mirrors F-308
StandardsAttestationService: the audit trail is the system of record
while the registry supplies queryability."""

# On submit:
async def submit_validation_report(body, principal, ...):
    # 1. Persist as Artifact (append-only, content-hashed)
    artifact = await artifact_registry.create(
        tenant_id=...,
        artifact_type="validation_report",
        payload=report.model_dump(mode="json") + {"commit_sha": commit_sha},
        content_hash=sha256(payload),
        ...
    )
    
    # 2. Write AuditEvent
    await audit_service.record(
        action="validation_reports.create",
        target_type="validation_report",
        target_id=report.report_id,
        ...
    )
    
    # 3. Emit event (downstream consumers)
    await bus.publish(EventType.VALIDATION_REPORT_SUBMITTED, {...})
```

This pattern ensures:
- **Audit trail is the system of record** — every submit logged
- **ArtifactRegistry supplies queryability** — fast lookup by commit_sha
- **Content hash prevents tampering** — duplicate detection via SHA-256

---

## 4 Validator Components (`apps/forge/components/validator/`)

| Component | Lines | Purpose |
|---|---|---|
| `FindingsTable.tsx` | 195 | Severity-sorted, file-path-grouped findings |
| `ValidationReportCard.tsx` | 174 | Card per report (status + summary + counts) |
| `RemediationPanel.tsx` | 121 | Per-finding suggested fixes + standards ref |
| `SeverityBadge.tsx` | 59 | Color-coded severity badge |
| **Total** | **549** | |

---

## Edge cases

| State | Treatment |
|---|---|
| **No reports** | Empty state + "No reports yet" (NOT misleading) |
| **Loading** | Loading state with typed message (NOT spinners) |
| **5xx error** | Error state with retry CTA (NOT "No reports yet") |
| **Scan running** | Live page shows in-flight + cyan pulse |
| **Scan completed** | Live page archives to "recently completed" tray (max 6) |
| **Zero findings** | `decision: PASS` + emerald badge |
| **Critical findings** | `decision: FAIL` + rose badge |
| **Invalid commit_sha** | Empty list (RLS scopes correctly) |
| **Cross-tenant report ID** | 404 (RLS enforcement) |
| **Unknown severity** | Backend rejects with `ValueError` (closed set enforcement) |
| **Unsupported schema_version** | Backend rejects with `ValueError` (only `1.0.0` accepted) |
| **`prefers-reduced-motion`** | Pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Validator MUST NOT:

- ❌ Add a new severity without updating `SEVERITY_LEVELS` constant (5 closed values)
- ❌ Change `SCHEMA_VERSION` without migration plan (only `1.0.0` accepted for v1)
- ❌ Bypass ArtifactRegistry + AuditEvent dual-write — both required
- ❌ Skip tenant scoping — every query must be RLS-scoped
- ❌ Import from `sdlc_agent` or `sdlc_state` — NFR-043 independence
- ❌ Use direct SDK imports — Rule 1 (via LiteLLM with `forge_validator_*` virtual key prefix)
- ❌ Skip `@audit()` decorator on submit — Rule 6
- ❌ Skip `require_permission()` on create — RBAC enforcement
- ❌ Add a new scanner without updating `scanners_executed` list
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeletons
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Mix severity enums (backend 5-level vs frontend 4-level) without adapter

---

## Verification checklist

- [ ] `/validator` renders list of ValidationReportCards
- [ ] `/validator/[report_id]` renders detail (summary + findings + remediation)
- [ ] `/validator/live` renders live tail (running + recently completed)
- [ ] `curl .../validation-reports?commit_sha=X` returns matching reports
- [ ] `curl .../validation-reports/{id}` returns single report
- [ ] `POST /validation-reports` creates 201 + writes Artifact + AuditEvent
- [ ] List page polls every 30s
- [ ] Detail page polls every 5s while running, stops after completion
- [ ] Live page polls every 3s
- [ ] Project selector input updates query
- [ ] Refresh button refetches immediately
- [ ] Severity badges render correct color per level
- [ ] FindingsTable sorts by severity rank (critical first)
- [ ] RemediationPanel renders per-finding suggested fixes
- [ ] Live page separates running vs completed (max 6 completed shown)
- [ ] Invalid severity rejected with 400
- [ ] Unsupported schema_version rejected with 400
- [ ] Cross-tenant report ID returns 404 (RLS)
- [ ] Permission denied returns 403
- [ ] Empty state renders when no reports
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — severity colors
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R4 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (3 routes)
- [DB schema](../reference/db-schema.md) — `artifacts` (where reports are persisted)
- [Dashboard](./dashboard.md) — "Recent scans" widget
- [Workflows](./workflows.md) — Validation run as workflow step
- [Architecture Center](./architecture-center.md) — Standards tab is verified by validator
- [Governance](./governance.md) — Compliance score derived from validator
- [Audit](./audit.md) — Every submit logged via dual-write
- [Projects](./projects.md) — Per-project validation reports
- [Settings](./settings.md) — Validation thresholds + policy gates

---

## Maintenance notes

**When to update this doc:**

- A new scanner added → update 4-scanner table
- A new severity added → update `SEVERITY_LEVELS` + adapter
- `SCHEMA_VERSION` bumps → document migration plan
- A new polling cadence added → update 3-cadence list
- A new component added → update 4-component list

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/validation_reports.py     ←  3 routes (create + get + list)
backend/app/agents/code_validator.py        ←  LangGraph sub-graph (entry: scan_secrets)
backend/app/agents/code_validator_state.py  ←  Severity enum + state TypedDict
backend/app/agents/code_validator_nodes/    ←  5 nodes (scan_secrets, scan_iac, scan_vulns, scan_standards, aggregate_findings)
backend/app/agents/prompts/code_validator.j2 ←  LLM prompt template
backend/app/schemas/validation_report.py    ←  Pydantic source of truth (5 severities + DecisionLiteral + SCHEMA_VERSION=1.0.0)
backend/app/services/artifact_registry.py  ←  Dual-write target
backend/app/services/audit_service.py      ←  Dual-write target
         ↓
apps/forge/lib/api.ts                     ←  TypeScript mirror (4 severities + status enum + VALIDATION_SEVERITY_RANK)
apps/forge/lib/hooks/useValidationReports.ts ←  3 hooks (list + detail + live) with smart polling
         ↓
apps/forge/app/validator/page.tsx          ←  List page (141 lines)
apps/forge/app/validator/[report_id]/page.tsx ←  Detail page (189 lines)
apps/forge/app/validator/live/page.tsx     ←  Live page (168 lines)
apps/forge/components/validator/           ←  4 components (549 lines)
```

If any link in this chain drifts, the Validator breaks silently. Always update all links.

---

## Why this is "post-implementation quality"

The Validator is the **gate between "code shipped" and "code trusted"**. Per NFR-042, a `PASS` decision means zero findings of `critical` or `high` severity. This is what allows:

- **Engineers** — get an authoritative "go / no-go" for their PR
- **Tech leads** — see which repos / files have the most debt (top violations)
- **Stewards** — compliance evidence (every scan persists as Artifact)

The dual-write pattern (ArtifactRegistry + AuditEvent) is critical: the registry supplies **queryability** (find all reports for commit X), while the audit trail supplies **accountability** (who ran what, when, with what result). Both are needed — one without the other is incomplete.

The independent sub-graph (NFR-043) means the Validator can evolve without touching the SDLC supervisor — adding a new scanner doesn't require touching the orchestrator. This is a textbook **bounded context** boundary.