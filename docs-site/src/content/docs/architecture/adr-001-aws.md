---
title: ADR-001 — Cloud-only AWS deployment
description: V1 commits Forge to AWS as the single cloud provider.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that Forge AI runs on AWS in V1. ECS Fargate for compute, RDS PostgreSQL 17 for data, ElastiCache Redis for cache, S3 for objects, KMS for keys, with a separate AWS account for the audit log.

## Context

Forge AI must run in an environment that supports the platform's constitutional requirements: SOC2-controls-ready posture (NFR-001), pen-test readiness (NFR-035), Keycloak OIDC/SAML federation, OpenTelemetry tracing (Rule 7), RDS PostgreSQL 17 with Apache AGE, per-tenant encryption key custody, and isolated audit log topology.

The forces at play:

- The pilot customer requires SOC2-controls-ready posture and pen-test readiness before data is ingested.
- Multi-tenancy with RLS, per-tenant KMS, and a separate audit log account are easier to express on a single cloud provider than across a hybrid topology.
- The core team has deep AWS expertise (ECS Fargate, RDS, KMS, IAM, CloudWatch) and limited production experience with Azure or GCP managed equivalents.
- Time-to-pilot is a binding constraint. Each additional environment to operate increases operational surface.
- A multi-cloud or hybrid strategy is appealing in principle but requires deep integration work that does not advance the M1 substrate.

## Decision drivers

- NFR-001: SOC2-controls-ready architecture
- NFR-014: RPO ≤ 24h, RTO ≤ 4h
- NFR-035: Pen-test readiness
- NFR-008: Single-region commitment for V1
- DL-011: Per-tenant encryption key custody
- Rule 7: OpenTelemetry observability from day one
- Time-to-pilot and team skill distribution

## Considered options

- AWS only (ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS) — **chosen**
- Azure (AKS / App Service, Azure Database for PostgreSQL, Azure Cache for Redis)
- Google Cloud Platform (GKE, Cloud SQL, Memorystore)
- On-premises deployment
- Hybrid (cloud control plane + on-prem data plane)

## Decision outcome

Chosen option: **AWS only for V1**.

The platform runs on:

| Service | Purpose |
|---|---|
| ECS Fargate | Compute (FastAPI backend, LangGraph orchestrator, LiteLLM Proxy) |
| RDS for PostgreSQL 17 | Primary database with Apache AGE + pgvector |
| ElastiCache Redis | Cache and pub/sub |
| S3 | Object storage (artifacts, exports) |
| KMS | Per-tenant customer-managed keys (CMKs) |
| CloudWatch | Logs, metrics, dashboards |
| Secrets Manager | Per-tenant secrets |

A **separate AWS account** hosts the append-only audit log (see [ADR-008](/architecture/adr-008-worm-audit/)).

This commits Forge to AWS as the single cloud provider at V1. Multi-cloud (Azure / GCP) is deferred to Phase B.

## Consequences

**Positive:**

- Single cloud provider reduces operational surface and integrates with the team's existing expertise.
- Mature managed services: RDS multi-AZ, ElastiCache, KMS, IAM, CloudWatch, Secrets Manager.
- Native OpenTelemetry exporters and AWS Distro for OpenTelemetry (ADOT) simplify Rule 7 compliance.
- KMS per-tenant CMKs are first-class, satisfying DL-011 without custom HSM work.
- Cross-account audit log topology is a standard pattern with CloudTrail + S3 Object Lock.

**Negative:**

- Vendor lock-in: AWS-specific managed services (RDS, ECS, KMS) make multi-cloud migration expensive later.
- Region selection is binding for V1; data residency decisions for EU tenants must be re-evaluated when expanding.
- Single-region deployment (per NFR-008) limits geo-redundency in V1.

**Neutral:**

- Multi-cloud remains a Phase B option; the architecture avoids AWS-only SDK calls in business logic where possible.

## Alternatives considered

### Azure

Pros: Azure AD B2C supports OIDC federation; Azure Database for PostgreSQL has flexible server options.

Cons: Limited team production depth on Azure; equivalents of ECS Fargate + RDS + KMS are less aligned with runbooks; multi-cloud integration patterns would need to be re-built.

### Google Cloud Platform

Pros: GKE is mature; Cloud SQL has reasonable managed Postgres.

Cons: Even less team depth than Azure; ADCs and CMEK are workable but unfamiliar.

### On-premises

Pros: Maximum control.

Cons: SOC2-controls posture is harder to demonstrate; pen-test readiness is harder; team has no production on-prem footprint.

### Hybrid

Pros: Data residency flexibility.

Cons: Two operational surfaces; cross-cloud audit log topology is significantly more complex; defeats the time-to-pilot constraint.

## Related

- [ADR-002: PostgreSQL 17 + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
- [Production deployment](/guides/production-deploy/)
