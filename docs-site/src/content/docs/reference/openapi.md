---
title: OpenAPI Reference
description: The OpenAPI 3 schema for the Forge AI HTTP API.
---

This page summarizes the OpenAPI 3 schema for the Forge AI HTTP API. The full schema is available at `/api/v1/openapi.json` (dev and staging) and is bundled with the backend.

## What is this?

The schema that drives:

- The interactive Swagger UI at `/api/v1/docs` (dev only).
- The TypeScript client generated for the frontend.
- The Pydantic models in the backend.
- The typed artifact schemas (ADR, API Contract, etc.).

## Top-level structure

```yaml
openapi: 3.1.0
info:
  title: Forge AI API
  version: 1.0.0
  description: Enterprise SDLC Agent Operating System
servers:
  - url: https://api.forge-ai.com/api/v1
  - url: http://localhost:8000/api/v1
security:
  - bearerAuth: []
paths:
  /health: ...
  /commands: ...
  /commands/{forge_cmd}: ...
  /commands/{forge_cmd}/execute: ...
  /workflows: ...
  /workflows/{workflow_id}: ...
  /artifacts: ...
  /artifacts/{artifact_id}: ...
  /approvals: ...
  /audit: ...
  /kg/cypher: ...
  /kg/vector-search: ...
  /me: ...
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    ADR: ...
    APIContract: ...
    TaskBreakdown: ...
    RiskRegister: ...
    SecurityReport: ...
    DeploymentPlan: ...
```

## Typed artifact schemas

The six typed artifacts are schemas in `components.schemas`.

### ADR

```yaml
ADR:
  type: object
  required: [id, tenant_id, title, context, decision, consequences, status, created_at]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid, nullable: true }
    title: { type: string, minLength: 5, maxLength: 200 }
    context: { $ref: '#/components/schemas/Section' }
    decision: { $ref: '#/components/schemas/Section' }
    consequences: { $ref: '#/components/schemas/Section' }
    alternatives:
      type: array
      items: { $ref: '#/components/schemas/Section' }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
    composite_score: { type: number, minimum: 0, maximum: 100, nullable: true }
    created_at: { type: string, format: date-time }
    decided_at: { type: string, format: date-time, nullable: true }
```

### APIContract

```yaml
APIContract:
  type: object
  required: [id, tenant_id, service_a, service_b, version, endpoints, status]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid }
    service_a: { type: string }
    service_b: { type: string }
    version: { type: string }
    endpoints:
      type: array
      items: { $ref: '#/components/schemas/Endpoint' }
    data_models:
      type: array
      items: { $ref: '#/components/schemas/DataModel' }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
```

### TaskBreakdown

```yaml
TaskBreakdown:
  type: object
  required: [id, tenant_id, tasks, status]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid }
    parent_adr_id: { type: string, format: uuid, nullable: true }
    tasks:
      type: array
      items: { $ref: '#/components/schemas/Task' }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
```

### RiskRegister

```yaml
RiskRegister:
  type: object
  required: [id, tenant_id, risks, status]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid }
    pr_id: { type: string, nullable: true }
    risks:
      type: array
      items: { $ref: '#/components/schemas/Risk' }
    composite_score: { type: number, minimum: 0, maximum: 100, nullable: true }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
```

### SecurityReport

```yaml
SecurityReport:
  type: object
  required: [id, tenant_id, findings, status]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid }
    findings:
      type: array
      items: { $ref: '#/components/schemas/Finding' }
    policy_check_results:
      type: array
      items: { $ref: '#/components/schemas/PolicyCheckResult' }
    is_final: { type: boolean }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
```

### DeploymentPlan

```yaml
DeploymentPlan:
  type: object
  required: [id, tenant_id, build_id, environment, strategy, status]
  properties:
    id: { type: string, format: uuid }
    tenant_id: { type: string, format: uuid }
    project_id: { type: string, format: uuid }
    build_id: { type: string }
    environment:
      type: string
      enum: [dev, staging, prod]
    strategy:
      type: string
      enum: [recreate, rolling, canary, blue_green]
    canary_pct: { type: integer, minimum: 1, maximum: 100, nullable: true }
    canary_window_minutes: { type: integer, minimum: 1, nullable: true }
    blast_radius: { $ref: '#/components/schemas/BlastRadius' }
    rollback_procedure: { type: string }
    expected_cost_usd: { type: number, nullable: true }
    status:
      type: string
      enum: [draft, in_review, accepted, accepted_after_minor_edits, rejected]
```

## Common schemas

### Section

```yaml
Section:
  type: object
  required: [body, word_count]
  properties:
    title: { type: string }
    body: { type: string }
    word_count: { type: integer, minimum: 0 }
```

### Finding

```yaml
Finding:
  type: object
  required: [scanner, severity, rule_id, message, location]
  properties:
    scanner: { type: string, enum: [sast, sca, secrets, policy] }
    severity: { type: string, enum: [critical, high, medium, low, info] }
    rule_id: { type: string }
    message: { type: string }
    location: { $ref: '#/components/schemas/Location' }
```

### Risk

```yaml
Risk:
  type: object
  required: [axis, score, rationale]
  properties:
    axis: { type: string, enum: [blast_radius, data_integrity, security, perf, compliance] }
    score: { type: integer, minimum: 0, maximum: 10 }
    rationale: { type: string }
```

## Versioning

The API follows semver. Breaking changes bump the major version (`/api/v2`). The current version is `v1`.

## Related

- [HTTP API](/reference/api/)
- [Events](/reference/events/)
- [Typed artifacts](/concepts/typed-artifacts/)
