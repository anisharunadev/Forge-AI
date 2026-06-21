# Addendum — brief-forge-ai-2026-06-18

User-contributed depth that belongs in downstream documents (PRD, architecture, ADRs, solution design) or that earned a place but does not fit the brief. Captured during the conversation; not part of the brief itself.

## Status: 2026-06-19

The brief is **ready** for handoff to the PRD. The following items from this addendum have been **absorbed** into the brief and are not duplicated here:

- Product name: **Forge Delivery Accelerator** (was "Forge SDLC Platform" / "Forge SDLC AI Platform")
- Vision, business goals, core value proposition (folded into §1 Executive Summary)
- Module list (refactored into §4 Phased Product Strategy as Foundation + Phases 0–5)
- User roles (refactored into §5 Personas & Entry Points with goals and pain points)
- The "Knowledge System not Agent Platform" inversion (now the structural backbone of §3, §6, §8)
- Brownfield-first / Project Intelligence framing (now §3, §4 Phase 0, §5, §7)
- Multi-tenant / Organization Knowledge Layer (now §3, §4 Foundation, §5 Admin persona)
- CodeGraph / RepoGraph references (capability captured in §3 knowledge acquisition layer; specific tools deferred to architecture/ADR phase)

The following items remain as **raw material for downstream phases** and should not be re-derived from scratch:

- **For the PRD**: Functional requirements per capability, user-story detail per persona, acceptance criteria, edge cases, the seven Business Goal metrics with working definitions, MVP/V1/V2 scope.
- **For the architecture phase**: Tech stack (Next.js 15, FastAPI, LangGraph, PostgreSQL 17 + pgvector, Redis, S3, Keycloak/Auth0), folder structure, database tables, MCP integration roadmap, ADRs for workflow engine / database / auth / agent framework, observability posture, NFRs (1000+ concurrent workflows, 99.9% availability, RBAC, encryption, SOC2/GDPR, OpenTelemetry, LangSmith, CloudWatch).
- **For the Pilot Plan (separate document)**: The specific brownfield project name, repositories, pilot timeline, baseline measurement methodology, statistical significance criteria.
- **For the Investment / Budget discussion (separate document)**: Innovation / Engineering Excellence budget request, ROI model, capacity planning assumptions.

---

## Source: User's Initial Dump (2026-06-18)

The user's original vision dump. Preserved verbatim for downstream consumption.

---

# Product Name

## Forge SDLC AI Platform

### Tagline

> Enterprise AI-Powered Software Delivery Platform

---

# Vision

Enable KnackForge teams and customers to move from business idea to production deployment through an AI-assisted, governed, auditable, and secure software delivery lifecycle.

---

# Business Goals

## Goal 1

Reduce software delivery cycle time by 50%.

## Goal 2

Reduce architecture and requirement ambiguity.

## Goal 3

Provide end-to-end traceability.

## Goal 4

Standardize KnackForge engineering practices.

## Goal 5

Create a reusable accelerator for customer engagements.

---

# Core Value Proposition

Current:

```text
Idea
 ↓
Meetings
 ↓
Requirements
 ↓
Design
 ↓
Development
 ↓
Testing
 ↓
Deployment
```

Future:

```text
Idea
 ↓
Forge AI
 ↓
Architecture
 ↓
Tasks
 ↓
Code
 ↓
Tests
 ↓
Security
 ↓
Deployment
```

---

# Product Modules

## Module 1

Forge Ideation

Responsible for:

* Requirement analysis
* Epic generation
* User story generation
* Estimation
* Risk identification

---

## Module 2

Forge Architecture

Responsible for:

* Codebase analysis
* ADR generation
* HLD generation
* LLD generation
* API contracts
* DB design

---

## Module 3

Forge Development

Responsible for:

* Task planning
* Code generation
* Code review

---

## Module 4

Forge QA

Responsible for:

* Unit tests
* Integration tests
* E2E tests
* Self-healing tests

---

## Module 5

Forge Security

Responsible for:

* Secrets scanning
* Dependency scanning
* OWASP validation
* IaC validation

---

## Module 6

Forge DevOps

Responsible for:

* Infrastructure generation
* Deployment workflows
* Environment management

---

## Module 7

Forge Refactor

Responsible for:

* Legacy modernization
* AWS Transform orchestration
* Migration planning

---

# User Roles

## Product Manager

Can:

* Create initiatives
* Approve backlog
* Monitor execution

---

## Architect

Can:

* Approve architecture
* Review ADRs

---

## Developer

Can:

* Execute development workflows
* Review generated code

---

## QA Engineer

Can:

* Review tests
* Execute validation

---

## DevOps Engineer

Can:

* Approve deployments

---

## Admin

Can:

* Manage integrations
* Configure MCPs
* Manage agents

---

# Domain Model

```text
Organization
    │
    ├── Projects
    │
    ├── Users
    │
    ├── MCP Connections
    │
    └── Standards
```

```text
Project
    │
    ├── Workflows
    ├── Artifacts
    ├── Memories
    ├── Approvals
    └── Audit Logs
```

---

# Artifact-Driven Architecture

Everything is an artifact.

## Artifact Types

```text
initiative.md
epic.yaml
story.yaml
architecture.md
adr.md
sequence-diagram.mmd
openapi.yaml
tasks.yaml
code.patch
test-report.md
security-report.md
deployment-plan.md
release-notes.md
```

---

# Workflow Engine

## Workflow Definition

```text
Initiative
   ↓
Ideation
   ↓
Approval
   ↓
Architecture
   ↓
Approval
   ↓
Planning
   ↓
Development
   ↓
Review
   ↓
Testing
   ↓
Security
   ↓
Approval
   ↓
Deployment
```

---

# Agent Architecture

## Master Orchestrator

Responsibilities:

* State management
* Workflow transitions
* Agent execution
* Audit trail
* Cost tracking

---

## Ideation Agent

Inputs:

* Jira
* Zendesk
* Confluence
* GitHub
* SonarQube

Outputs:

```yaml
epics:
stories:
acceptance_criteria:
dependencies:
risks:
```

---

## Architect Agent

Outputs:

```text
architecture.md
openapi.yaml
db-schema.md
adr/
```

---

## Planner Agent

Outputs:

```yaml
tasks:
```

---

## Developer Agent

Outputs:

```text
code.patch
```

---

## Reviewer Agent

Outputs:

```yaml
review-result:
```

---

## QA Agent

Outputs:

```text
test-report.md
```

---

## Security Agent

Outputs:

```text
security-report.md
```

---

## DevOps Agent

Outputs:

```text
terraform/
docker/
github-actions/
```

---

# Technical Stack

## Frontend

```yaml
Framework: Next.js 15
Language: TypeScript
UI: Shadcn/UI
Styling: TailwindCSS
State: TanStack Query
Forms: React Hook Form
Validation: Zod
Charts: Recharts
```

## Backend

```yaml
Framework: FastAPI
Language: Python 3.13
ORM: SQLAlchemy
Migration: Alembic
Validation: Pydantic
```

## Workflow Engine

```yaml
LangGraph
```

## Agent Framework

```yaml
LangGraph
LangChain
LiteLLM
```

## Database

```yaml
PostgreSQL 17
pgvector
```

## Cache

```yaml
Redis
```

## Object Storage

```yaml
AWS S3
```

## Authentication

```yaml
Keycloak
```

or

```yaml
Auth0
```

---

# MCP Integrations

Phase 1:

```yaml
Jira
GitHub
Confluence
SonarQube
AWS
Figma
Slack
```

Phase 2:

```yaml
Zendesk
Azure DevOps
Databricks
```

---

# Folder Structure

```text
forge-ai/
apps/
├── web
├── api
services/
├── workflow-engine
├── agent-runtime
├── memory-service
├── audit-service
agents/
├── ideation
├── architect
├── planner
├── developer
├── reviewer
├── qa
├── security
├── devops
├── refactor
packages/
├── mcp
├── artifacts
├── prompts
├── standards
infrastructure/
├── terraform
├── docker
├── ecs
```

---

# Database Tables

```text
organizations
users
projects
workflows
workflow_runs
workflow_stages
artifacts
approvals
agent_executions
audit_logs
memories
mcp_connections
cost_tracking
```

---

# Non Functional Requirements

## Scalability

* 1000+ concurrent workflows

## Availability

* 99.9%

## Security

* RBAC
* Audit trail
* Encryption at rest

## Compliance

* SOC2 ready
* GDPR ready

## Observability

* OpenTelemetry
* LangSmith
* CloudWatch
```

---

# MVP Scope (First Demo)

### Sprint 1

* Project Management
* Workflow Engine
* Artifact Store

### Sprint 2

* Ideation Agent
* Architecture Agent

### Sprint 3

* Planner Agent
* Developer Agent

### Sprint 4

* Security Agent
* Approval Workflow

### Sprint 5

* Jira MCP
* GitHub MCP

### Demo Flow

```text
Jira Story
      ↓
Ideation Agent
      ↓
Architecture Agent
      ↓
Approval
      ↓
Planner Agent
      ↓
Developer Agent
      ↓
Security Agent
      ↓
Create Pull Request
```
