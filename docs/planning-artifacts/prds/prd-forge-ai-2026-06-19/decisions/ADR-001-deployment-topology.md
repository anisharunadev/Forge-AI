---
adr_id: ADR-001
title: Deployment Topology — Cloud-Only (AWS) at V1
status: Accepted
date: 2026-06-20
deciders: Arunachalam V, Architecture team
consulted: Compliance, Security, KnackForge leadership
informed: Engineering, Product
supersedes: PRD §6.1 OQ-005
related:
  - PRD §5.11 Foundational Architecture Constraints
  - PRD NFR-008 (Data Residency)
  - PRD NFR-025 (12-Factor Posture)
  - PRD DL-011 (SOC2 Ready, Not Certified)
  - _bmad-output/research-forge-architecture-decisions-2026-06-20.md (Q5 SOC2 Patterns)
---

# ADR-001: Deployment Topology — Cloud-Only (AWS) at V1

## Context and Problem Statement

The PRD §6.1 OQ-005 explicitly lists deployment topology as an unresolved open question, recording three candidates: **cloud**, **self-hosted**, and **hybrid**. The PRD's §5.11 Foundational Architecture Constraints commit to NFR-025 (12-factor posture) and NFR-008 (single-region at V1), but do not name the deployment topology. The `review-architecture.md` flagged this as a contradiction (12-factor assumes cloud; self-hosted violates 12-factor).

The decision must satisfy:
- **NFR-025** — 12-factor posture
- **NFR-008** — Single-region at V1
- **NFR-001** — SOC2-ready (designed, not certified)
- **NFR-014** — RPO ≤ 24h, RTO ≤ 4h
- **NFR-016 / NFR-017** — Connector contract (per-tenant OAuth, PAT, service account)
- **Strategic Phase A** — V1 users are KnackForge-internal (per reconcile-brief.md)

## Decision Drivers

- **Pilot scope is internal** — V1 users are KnackForge engineers across CMC, GAPI, Honeywell engagements. No external customer demand yet.
- **Operational simplicity** — single topology (cloud) reduces ops surface area vs. dual (cloud + self-hosted)
- **12-factor requirement** — NFR-025 commits to declarative config + disposable processes + portability; cloud-native platforms are the natural fit
- **SOC2-ready posture** — managed services (AWS RDS, AWS KMS, AWS CloudWatch) accelerate SOC2-controls readiness
- **Connector ecosystem** — Jira, Confluence, GitHub, Bitbucket, AWS, SonarQube, Slack, Teams all have first-class cloud APIs; self-hosted connectors would require additional engineering

## Considered Options

### Option 1: Cloud-Only (AWS) at V1
Single deployment on AWS. Self-hosted and hybrid are explicitly deferred to Strategic Phase B (Customer-facing).

### Option 2: Self-Hosted (Customer-Managed)
KnackForge customer operates Forge in their own infrastructure. Cloud not used.

### Option 3: Hybrid (Cloud for KnackForge-internal, Self-Hosted for Customers)
Two deployment topologies supported from V1.

## Decision Outcome

**Chosen Option 1: Cloud-Only (AWS) at V1.** The pilot's internal scope, the SOC2-ready posture, the 12-factor requirement, and the operational simplicity argument all converge on cloud-only.

### Architecture commitments (consequence of this decision)

- **Compute**: AWS ECS Fargate (or EKS if container orchestration needs grow)
- **Database**: AWS RDS for PostgreSQL 17 (multi-AZ for HA)
- **Cache/Pub-Sub**: AWS ElastiCache for Redis
- **Storage**: AWS S3 for artifacts, audit logs, and ingestion staging
- **Secrets**: AWS Secrets Manager (per-tenant secrets)
- **Encryption**: AWS KMS with **per-tenant Customer Master Keys** (CCK) with annual rotation
- **Audit log**: separate AWS account, AWS S3 with Object Lock (compliance mode, write-once-read-many), retention ≥ 7 years
- **Observability**: AWS CloudWatch + OpenTelemetry, logs and traces shipped to SIEM
- **Region**: Single region at V1 (recommend `us-east-1`; deferred to compliance for final sign-off)

### Positive Consequences

- **Operational simplicity** — single deployment topology, single ops runbook
- **SOC2 acceleration** — managed services provide controls-ready primitives
- **Pilot velocity** — faster iteration on internal users (no customer-side deployment to coordinate)
- **12-factor native** — AWS managed services map directly to 12-factor principles

### Negative Consequences

- **Customer-driven request deferred** — some KnackForge customers may require on-prem (financial services, defense). This is a real GTM constraint that must be addressed at Strategic Phase B.
- **Cloud vendor lock-in** — managed services (RDS, KMS, CloudWatch) are AWS-specific. Migration cost is non-trivial.
- **Regional availability risk** — single-region deployment has an availability ceiling (RTO ≤ 4h per NFR-014). Mitigated by multi-AZ within region.

### Neutral Consequences

- **Self-hosted pilot** — if a KnackForge customer requires self-hosted during V1 (unlikely but possible), this would require an exception process and additional engineering. Recommended path: customer pilot is on cloud during V1, with the explicit promise of self-hosted availability in Phase B.

## Pros and Cons of the Options

### Option 1: Cloud-Only (AWS)

**Pros:**
- Operational simplicity
- SOC2 acceleration via managed services
- 12-factor native
- Faster pilot velocity
- Lower upfront ops investment

**Cons:**
- Vendor lock-in (AWS)
- On-prem customer requests deferred
- Single-region availability ceiling

### Option 2: Self-Hosted (Customer-Managed)

**Pros:**
- Customer data never leaves customer infrastructure (some regulated industries require this)
- Higher willingness-to-pay (security-conscious customers)

**Cons:**
- Massive ops surface: 100+ customers × customer-managed upgrades, backups, observability
- Slows pilot velocity dramatically
- 12-factor partly contradicts (no managed services)
- Connector integration complexity (no managed network access)
- Higher upfront engineering investment

### Option 3: Hybrid

**Pros:**
- Both customer profiles served from V1

**Cons:**
- Doubles the ops surface (cloud + self-hosted runbooks)
- Doubles the test matrix (every feature must work in both topologies)
- Doubles the security audit surface
- Effectively requires Option 1's engineering + Option 2's engineering

## Strategic Implications

This ADR commits Forge to **Strategic Phase A (Internal)** as cloud-only. Strategic Phase B (Customer-facing) must re-evaluate this decision based on:
- Which KnackForge customers request on-prem
- What SOC2 Type II certification timeline is feasible
- Whether AWS GovCloud or Azure Government meets customer compliance requirements

If Strategic Phase B requires self-hosted, the architecture must support it through:
- Containerization (Docker Compose / Helm)
- Externalized state (Postgres + Redis can run on-prem)
- No AWS-specific primitives (replace CloudWatch with OTel-only, replace RDS with self-managed Postgres, etc.)

## Open Items (Deferred to Implementation ADR)

- **Region**: `us-east-1` recommended; compliance sign-off required
- **Multi-AZ vs single-AZ within region**: multi-AZ recommended for SOC2-CC7 (availability)
- **Backup retention specifics**: 30-day point-in-time recovery, 7-year audit log retention
- **Disaster recovery**: pilot uses AWS-native DR (cross-AZ failover); full multi-region DR is V2+

## References

- PRD §6.1 Open Questions — OQ-005
- PRD §5.11 Foundational Architecture Constraints
- `review-architecture.md` — flag: "NFR-025 commits to 12-factor posture but does not name the deployment topology"
- `_bmad-output/research-forge-architecture-decisions-2026-06-20.md` — Q5 SOC2 Patterns
- NFR-001, NFR-008, NFR-014, NFR-025, DL-011