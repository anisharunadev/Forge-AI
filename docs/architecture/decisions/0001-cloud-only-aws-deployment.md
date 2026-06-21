# ADR-001: Cloud-only AWS deployment

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group
- Related research: [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q5)

## Context and Problem Statement

Forge AI must run in an environment that supports the platform's constitutional requirements: SOC2-controls-ready posture (NFR-001), pen-test readiness (NFR-035), Keycloak OIDC/SAML federation, OpenTelemetry tracing (Rule 7), RDS PostgreSQL 17 with Apache AGE, per-tenant encryption key custody, and isolated audit log topology. We must choose a deployment topology for V1.

The forces at play:

- The pilot customer (CMC) and reference tenants require SOC2-controls-ready posture and pen-test readiness before data is ingested.
- Multi-tenancy with RLS, per-tenant KMS, and a separate audit log account are easier to express on a single cloud provider than across a hybrid topology.
- The core team has deep AWS expertise (ECS Fargate, RDS, KMS, IAM, CloudWatch) and limited production experience with Azure or GCP managed equivalents.
- Time-to-pilot is a binding constraint. Each additional environment to operate increases operational surface and slows the path to M3 demo.
- A multi-cloud or hybrid strategy is appealing in principle but requires deep integration work that does not advance the M1 substrate.

## Decision Drivers

- NFR-001: SOC2-controls-ready architecture
- NFR-014: RPO <= 24h, RTO <= 4h
- NFR-035: Pen-test readiness
- NFR-008: Single-region commitment for V1
- DL-011: Per-tenant encryption key custody
- Rule 7: OpenTelemetry observability from day one
- Time-to-pilot and team skill distribution

## Considered Options

- AWS only (ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS)
- Azure (AKS / App Service, Azure Database for PostgreSQL, Azure Cache for Redis)
- Google Cloud Platform (GKE, Cloud SQL, Memorystore)
- On-premises deployment
- Hybrid (cloud control plane + on-prem data plane)

## Decision Outcome

Chosen option: **AWS only for V1**. The platform runs on AWS ECS Fargate for compute, RDS for PostgreSQL 17 (with Apache AGE and pgvector extensions), ElastiCache for Redis, S3 for object storage, and KMS for per-tenant customer-managed keys (CMKs). A separate AWS account hosts the append-only audit log (see ADR-008).

This commits Forge to AWS as the single cloud provider at V1. Multi-cloud (Azure / GCP) is deferred to the Strategic Phase B (Customer-facing) per PRD Section 8.3.

### Consequences

Positive:

- Single cloud provider reduces operational surface and integrates with the team's existing expertise.
- Mature managed services: RDS multi-AZ, ElastiCache, KMS, IAM, CloudWatch, Secrets Manager.
- Native OpenTelemetry exporters and AWS Distro for OpenTelemetry (ADOT) simplify Rule 7 compliance.
- KMS per-tenant CMKs are first-class, satisfying DL-011 without custom HSM work.
- Cross-account audit log topology is a standard pattern with CloudTrail + S3 Object Lock.

Negative:

- Vendor lock-in: AWS-specific managed services (RDS, ECS, KMS) make multi-cloud migration expensive later.
- Region selection is binding for V1; data residency decisions for EU tenants must be re-evaluated when expanding.
- Single-region deployment (per NFR-008) limits geo-redundency in V1.

Neutral:

- Multi-cloud remains a Phase B option; the architecture avoids AWS-only SDK calls in business logic where possible.

## Alternatives Considered

### Azure (AKS / App Service + Azure Database for PostgreSQL)

Pros:

- Azure Active Directory B2C supports similar OIDC federation patterns.
- Azure Database for PostgreSQL has flexible server options.

Cons:

- Core team has limited Azure production depth; ramp-up would delay M1.
- Azure equivalents of ECS Fargate + RDS + KMS are less aligned with existing runbooks and dashboards.
- Multi-cloud integration patterns (Keycloak federation, audit log topology) would need to be re-built.

### Google Cloud Platform (GKE + Cloud SQL + Memorystore)

Pros:

- Cloud SQL supports PostgreSQL with extensions.
- Strong Kubernetes story if V1 had gone container-first.

Cons:

- Same team-skill gap as Azure.
- GCP-specific IAM and KMS abstractions diverge from AWS patterns already established in runbooks.
- Multi-region active-active patterns differ from the AWS model assumed in disaster recovery planning.

### On-premises deployment

Pros:

- Maximum data custody control; appealing for regulated tenants.

Cons:

- Blocks cloud-native scaling and managed-service leverage.
- Pen-test readiness (NFR-035) requires significant infrastructure investment (hardware, network segmentation, monitoring).
- SOC2-controls-ready posture is far more expensive to achieve and maintain on-prem than in AWS.

### Hybrid (cloud control plane + on-prem data plane)

Pros:

- Data never leaves the customer network.

Cons:

- Adds a network and latency boundary that complicates every layer (Keycloak, LiteLLM, AGE queries, RLS, audit).
- Operationally doubles the surface: cloud controls + on-prem infrastructure.
- KMS key custody across hybrid boundaries is non-trivial.

## Pros and Cons of the Chosen Option

Pros:

- Fastest path to a SOC2-controls-ready pilot (per-tenant CMK, KMS-managed key rotation, separate audit account).
- ECS Fargate + RDS PostgreSQL 17 is a well-trodden pattern with documented DR posture.
- Existing team expertise reduces implementation risk.

Cons:

- AWS-specific abstractions (RDS event subscriptions, ECS task IAM roles, KMS key policies) embed AWS into the deployment.
- Mitigated by: keeping infrastructure-as-code (Terraform) provider-neutral in spirit and isolating AWS calls in `infra/terraform/` modules.

## References

- [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q5 SOC2-Ready Patterns)
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector
- ADR-008: Append-only WORM audit trail
- PRD NFR-001, NFR-008, NFR-014, NFR-035
- Constitution Rule 7 (Mandatory observability)