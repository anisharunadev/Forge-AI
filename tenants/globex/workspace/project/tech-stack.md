# Forge AI — Tech Stack

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [README §3](../README.md#3-the-acceptance-bar)
**Owner:** CTO owns merges. The relevant stage owner co-signs their section (DevOps owns §5, §6, §7; Security owns §9, §10; the lead engineer co-signs §2, §3, §4).
**Convention:** Every choice in this document is justified. Alternatives considered, why this one, maintenance signal, exit plan. "It depends" is not in a v1 file.
**Glossary:** Every acronym below (MCP, OIDC, SAML, MFA, SSO, EKS, ALB, FTS, RDS, KMS, CDN, WAF, IaC, CI/CD, SLO, RPS, p99, p50, SSE, RSC, pgvector, ASVS, BYOK, SLA, etc.) is defined in [customer/glossary.md](../customer/glossary.md). If you find a term used here that is not in the glossary, file a glossary PR.
**Linked Paperclip issues:**
- Parent Epic: [Forge AI-26](/Forge AI/issues/Forge AI-26) — Epic 10 — Knowledge Layer
- Sub-goal: [Forge AI-100](/Forge AI/issues/Forge AI-100) — 10.3 Project folder hardening
- Plan of record: [Forge AI-15](/Forge AI/issues/Forge AI-15#document-plan) — BMAD → Paperclip Hierarchy Plan
- Architecture: [memory/architecture.md](../memory/architecture.md) — the agent-of-agents shape this stack implements
**Related:** [PRD.md](./PRD.md), [roadmap.md](./roadmap.md), [memory/architecture.md §2](../memory/architecture.md)

---

## 1. Stack principles

1. **Boring where boring is correct.** Postgres, Kubernetes, GitHub Actions, TypeScript. The novel parts of the platform — the agent runtime, the staged workflow, the Knowledge Layer — are the only places we tolerate novelty.
2. **Build vs. orchestrate.** If AWS, GitHub, SonarQube, Figma, or any other integrated tool already does it well, we orchestrate. The agent runtime is novel; the auth we use is OIDC.
3. **Open standards, not proprietary lock-in.** MCP for tool calls, OpenTelemetry for traces, JSON Schema for contracts, OpenAPI for the public surface, Conventional Commits for history.
4. **The customer can swap the model provider.** We are not Anthropic-only, not OpenAI-only. The customer picks per tenant.
5. **One language per concern.** TypeScript for the platform and the web; Python for the agent runtime, evals, and ML. Resist the urge to add a third.

## 2. Languages and runtimes

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Platform services (API, web, worker) | TypeScript (Node.js, ESM, strict) | Node 20 LTS | Same language for backend and web; strong typing; the largest AI/agent ecosystem |
| Agent runtime + evals | Python | 3.12 | The ML/eval ecosystem (pytest, ruff, vellum, promptfoo); the LLM SDKs are Python-first |
| IaC | HCL (Terraform) | 1.9+ | The industry default; the largest provider support |
| Helm charts | YAML / Go template | Helm 3.14+ | The default for Kubernetes workloads |
| MCP server SDKs | TypeScript + Python | matches above | MCP is language-agnostic; we ship both flavours |

**Forbidden in v1:** Go, Rust, Java, C#, Ruby, PHP. Adding one of these requires an ADR.

## 3. Application frameworks

| Layer | Choice | Why this, not the alternative |
| --- | --- | --- |
| API service | **Fastify 4.x** | Faster than Express, better TypeScript story than Nest, simpler than Hono for our shape |
| Web (Forge console) | **Next.js 14 (App Router)** | Server components + RSC + the React ecosystem; the PM/Eng Lead views are mostly read-mostly dashboards where RSC shines |
| Worker / queue consumer | **BullMQ on Redis** | Native to the Node ecosystem; we already have Redis; the alternative (Temporal) is a big lift for v1 |
| Agent runtime | **Custom Python service on FastAPI** | The LLM SDK + MCP SDK + evals are Python-first; the orchestration is small enough not to need Temporal |
| Background jobs (long-running) | **Argo Workflows on the same EKS cluster** | Kubernetes-native; we get retries, suspend/resume, artefact passing for free |
| Validation | **Zod (TS), Pydantic (Py)** | The de-facto standard; same shape on both sides of the wire |

## 4. Data layer

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Primary OLTP database | **PostgreSQL 16** (RDS, then Aurora) | Tenant isolation via row-level security, JSONB for the contract payloads, pgvector for the v1 vector store |
| Vector store (v1) | **pgvector** in the primary DB | One less service to operate; pgvector is "good enough" for v1; a managed vector DB is a v2 conversation |
| Cache | **Redis 7** (ElastiCache) | Sessions, idempotency keys, BullMQ, rate limiting |
| Object store | **S3** | Audit log artefacts, prompt/response bodies (when `Forge AI_LOG_LLM=1`), Confluence snapshots |
| Queue | **BullMQ on Redis** (jobs) + **SQS** (cross-account audit shipping) | BullMQ for in-cluster work; SQS for the audit-account boundary |
| Search (admin views) | **Postgres full-text** for v1; **OpenSearch** when we need it | Don't add OpenSearch until we need it |

### Schema conventions

- Every row has `id uuid primary key default gen_random_uuid()` and `tenant_id text not null`.
- Every table has `created_at timestamptz default now()` and `updated_at timestamptz default now()` (trigger-maintained).
- Soft delete via `deleted_at timestamptz` for user data; hard delete on legal request.
- PII columns are tagged with a check constraint or a marker in `information_schema`; the export/redact pipeline reads the marker.

## 5. Infrastructure

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Cloud | **AWS** (us-east-1 primary, us-west-2 standby, eu-west-1 added Q2 2027) | The customer base is on AWS; the IAM / Secrets Manager / KMS story is the deepest |
| Container orchestration | **EKS** (Kubernetes 1.29+) | The default; the ArgoCD + Helm + Karpenter story is solid; AKS and GKE are the alternatives if a customer requires them |
| Container runtime | **containerd** via EKS | The default; Bottlerocket for the nodes |
| IaC | **Terraform 1.9+** with a separate state file per env and per account | The default; OpenTofu is a watching brief |
| GitOps | **ArgoCD** | The default; syncs the cluster state from `infra/argocd/<env>/` |
| Secrets | **AWS Secrets Manager** (prod) + **Doppler** (dev/staging) | Per [memory/security.md §3](../memory/security.md) |
| KMS | **AWS KMS** with customer-managed keys per tenant | The customer can bring their own key (BYOK) by Q2 2027 |
| Image registry | **ECR** with cosign signatures, Trivy scan in CI | Per [memory/security.md §9](../memory/security.md) |
| DNS | **Route 53** with DNSSEC | The default |
| CDN / WAF | **CloudFront + AWS WAF** | The default; the WAF rule set is reviewed quarterly |
| Email (transactional) | **SES** for now; **Postmark** for product email | SES for ops, Postmark for deliverability |

## 6. CI/CD and DevEx

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Source control | **GitHub** (Enterprise Cloud) | The customer is on GitHub; self-hosted GitHub Enterprise is a customer option |
| CI | **GitHub Actions** | Native to the source control; runners in our VPC via Actions Runner Controller |
| CD | **ArgoCD** (GitOps) | Per §5; the release train syncs the cluster state from Git |
| Image build | **BuildKit** via Actions | Fast, layer-cached, scan-on-build |
| Dependency updates | **Renovate** | The default; weekly PR cadence; auto-merge for green patches |
| Pre-commit | **pre-commit** framework with `gitleaks`, `prettier`, `ruff`, `tsc` | The default |
| Secrets scanning | **gitleaks** (pre-commit + CI) + **TruffleHog** (scheduled scan) | Per [memory/security.md §3](../memory/security.md) |
| Container scanning | **Trivy** in CI | Open, fast, integrates with cosign |

## 7. Observability

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Logs | **Loki** (Grafana stack) or **CloudWatch Logs** | Loki if we want to stay OSS; CloudWatch if we want zero-ops. **Decision: CloudWatch for v1, Loki in v1.1.** |
| Metrics | **Prometheus + Grafana** | The de-facto standard; integrates with the EKS ecosystem via the Prometheus Operator |
| Traces | **OpenTelemetry SDK** → **Grafana Tempo** | Vendor-neutral; the LLM SDKs (Anthropic, OpenAI) all support OTel |
| Alerting | **Alertmanager → PagerDuty** | The default; PagerDuty is the customer's expected channel |
| Status page | **Statuspage** (by Atlassian) | The default; incident templates are pre-built |
| LLM observability | **Langfuse** (self-hosted) or **Helicone** | Langfuse for the open-source, self-hostable option; Helicone for the zero-ops. **Decision: Langfuse for v1, evaluate Helicone in v1.1.** |

## 8. LLM and AI

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Primary model provider | **Anthropic** (Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5) | The best-in-class for our prompts; the safety posture is the deepest |
| Backup model provider | **OpenAI** (GPT-class) for failover | Vendor diversification; cost optimisation for non-reasoning work |
| Customer-overridable provider | Per-tenant model routing in v1.1 | The customer can pick the provider per tenant |
| Embeddings | **Voyage AI** (default) or the customer's choice | Voyage for code, OpenAI `text-embedding-3-large` as fallback |
| LLM SDK | **Anthropic SDK** (Python + TS), **OpenAI SDK** (Python + TS) | Native SDKs; the prompt cache is on by default |
| Prompt management | **In-repo, versioned YAML** + **Langfuse** for tracing | The source of truth is Git; Langfuse is the observability layer |
| Eval framework | **promptfoo** for the prompt/contract evals + **custom harness** for the agent-loop evals | promptfoo is the best open-source fit for prompt evals; the agent-loop needs a custom harness because it spans multiple stages |

## 9. Authentication, authorisation, identity

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Customer SSO | **OIDC + SAML 2.0** | The industry default; we do not store customer passwords |
| Internal SSO | **OIDC via Google Workspace** (Forge AI staff) | The default; MFA enforced |
| MFA | **WebAuthn / TOTP** | The default; SMS MFA is forbidden |
| Customer RBAC | Custom (in the platform DB) | We need fine-grained, per-tenant, per-project roles; the off-the-shelf options (Auth0, Clerk) are not flexible enough for our stage gates |
| Internal RBAC | **AWS IAM** (cross-account) + **Kubernetes RBAC** (in-cluster) | The default |
| Agent identity | Short-lived JWT (≤ 15 min) | Per [memory/security.md §4](../memory/security.md) |
| Secrets at runtime | Sidecar / env injection from Secrets Manager | Per [memory/security.md §3](../memory/security.md) |

## 10. Integrations (MCP servers, priority 1)

Each MCP server lives in a per-tenant namespace, behind a per-tenant egress proxy.

| Tool | MCP server | Auth flow | Read / Write | Notes |
| --- | --- | --- | --- | --- |
| **Jira** | In-house (TS) | OAuth 2.0 (3LO) | R/W | The first MCP server we ship; the v1.0 design-partner integration |
| **GitHub** | In-house (TS) | GitHub App (per-tenant) | R/W | PR creation, review request, status sync |
| **Confluence** | In-house (TS) | OAuth 2.0 (3LO) | R/W | Page read/write, link to ADR |
| **SonarQube** | In-house (TS) | Token per tenant | R | Scan trigger, findings, gate; we do not write to SonarQube |
| **Figma** | In-house (TS) | OAuth 2.0 | R | Design link, design-tokens extract |
| **AWS** | In-house (Py) | Cross-account IAM role | R (scoped) | Deploy, IAM, secrets read; we do not give the agent write to AWS |
| **Slack / Teams** | In-house (TS) | OAuth 2.0 | R/W | Notification, approval, status |

**Reference MCP server repo** (when we open-source it in 2027): a template each customer can fork, not a managed service. The customer owns the credentials, the egress, and the audit trail.

## 11. Customer-facing surface

| Concern | Choice | Why this, not the alternative |
| --- | --- | --- |
| Web framework | **Next.js 14 (App Router)** | Per §3 |
| Component library | **Radix UI** primitives + **shadcn/ui** | Accessible by default (WCAG 2.2 AA), unstyled, owned in our repo |
| Styling | **Tailwind CSS** | The default; plays well with shadcn |
| State management | **TanStack Query** for server state; **Zustand** for local UI state | Server-state via TanStack; local state via Zustand; no Redux |
| Forms | **React Hook Form + Zod** | The default |
| Charts | **Recharts** (admin) + **D3** (custom) | Recharts for the dashboard widgets; D3 when we need bespoke |
| Auth in the web | **NextAuth.js** (Auth.js) for Forge AI staff; **OIDC client** for customer SSO | We use the standard OIDC flow; we do not roll our own |
| Accessibility testing | **axe-core** in CI + **manual screen-reader pass** per release | Per [customer/standards.md §7](../customer/standards.md) |

## 12. The dependencies we will regret

A short list, written down so we do not pretend we did not see them.

| Risk | What it is | What we do about it |
| --- | --- | --- |
| **Anthropic / OpenAI outage** | A run stalls | Circuit-breaker; backup provider for non-reasoning work; per-tenant failover in v1.1 |
| **EKS / Karpenter surprise** | A breaking change in a managed service | Pin versions; test in staging; a quarterly upgrade window |
| **Langfuse self-hosting tax** | Operating another service is real work | Evaluate Helicone in v1.1; do not let Langfuse become a second product |
| **Postgres at scale** | A single hot tenant can starve the rest | Per-tenant connection pool (PgBouncer), per-tenant IOPS budget, plan for sharding at 100 tenants |
| **The agent-of-agents shape itself** | A wrong architectural bet | The ADR for the staged workflow is a one-way door; we test it in Q3 with a real design partner before we commit |

## 13. What is not in the stack (yet)

| Not in v1 | Why not | When it might land |
| --- | --- | --- |
| Temporal | A big operational lift; BullMQ is enough for v1 | Q1 2027, if we hit long-running-workflow limits |
| OpenSearch | Postgres FTS is enough for the admin views | When a customer asks and we cannot say no |
| ClickHouse | Loki + CloudWatch is enough for the audit query volume | Q2 2027, when audit log volume justifies a columnar store |
| Snowflake / BigQuery | The customer brings their own warehouse; we do not duplicate | When a customer contract requires it |
| A managed vector DB (Pinecone, Weaviate) | pgvector is good enough for v1; one less service to operate | Q2 2027, when the corpus outgrows pgvector |
| HashiCorp Vault | AWS Secrets Manager + Doppler covers v1 | When a customer requires Vault as a compliance artefact |

## 14. Stack anti-patterns (auto-flag in review)

- A new dependency that is not on the list above without an ADR.
- A new language without an ADR.
- A new managed service without a cost estimate and a maintenance owner.
- A "temporary" library that has been in the lockfile for > 90 days.
- A new AWS region without a DR + cost review.

## 15. Related

- The product this stack serves: [PRD.md](./PRD.md)
- The roadmap that sequences the stack's growth: [roadmap.md](./roadmap.md)
- The architecture this stack implements: [memory/architecture.md](../memory/architecture.md)
- The security controls this stack must defend: [memory/security.md](../memory/security.md)
- The DevOps / SRE patterns this stack enables: [memory/devops.md](../memory/devops.md)

---

## 16. Linked ADRs (candidates)

This file lists stack choices; each one-way-door choice should grow an ADR in `docs/adr/` per [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records). The CTO opens the ADRs in this order:

| ADR | Title | Status | Why it is a one-way door |
| --- | --- | --- | --- |
| ADR-0001 | Anthropic as primary model provider, OpenAI as backup | proposed | Vendor concentration; changing it later rewrites every prompt contract |
| ADR-0002 | Anthropic SDK + OpenAI SDK (no LangChain) | proposed | Lock-in to a framework that has churned historically |
| ADR-0003 | AWS-only in v1; Azure/GCP deferred | proposed | IAM + secrets + observability story is materially different per cloud |
| ADR-0004 | pgvector in v1; no managed vector DB | proposed | One less service; revisit at Q2 2027 if corpus outgrows pgvector |
| ADR-0005 | Fastify + Next.js + Python (no Go/Rust/Java) | proposed | Org learning curve; three languages is the max |
| ADR-0006 | BullMQ + Argo Workflows (no Temporal) in v1 | proposed | Operational lift; revisit at Q1 2027 if limits bite |
| ADR-0007 | OIDC + custom RBAC (not Auth0/Clerk) | proposed | Stage-gate enforcement needs fine-grained roles those products do not model |

These are the only stack ADRs permitted to land in `docs/adr/` during the v1 window. The CTO opens them; the relevant sub-team lead co-signs.

---

## 17. Change log

| Rev | Date | Author | What changed |
| --- | --- | --- | --- |
| v1.0 | 2026-06-17 | CTO (this hardening pass) | Status bump to v1.0 production bar; added co-signer note, glossary cross-reference, linked Paperclip issues, ADR candidate list, change log. No stack changes. |
| v0.1 | 2026-06-16 | CTO | Initial proposed draft. |
