---
title: Compliance
description: SOC 2, ISO 27001, OWASP ASVS, NIST SSDF, WCAG, GDPR.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/customer/standards.md
generator: readme
approval_required: false
---

The **compliance** pillar. The bar is [`customer/standards.md`](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md). The standards are the **floor**; the customer contract is the **ceiling**.

## The inheritance model

```
                        ISO 27001 / SOC 2
                               │
                ┌──────────────┼──────────────┐
                │              │              │
              OWASP         NIST SSDF     WCAG 2.2 AA
                │              │              │
                └──────────────┼──────────────┘
                               │
                       Forge AI defaults
                       (this workspace)
                               │
                       Customer contract
                       (the ceiling)
```

A customer can **tighten** a default (e.g., require FIPS-validated crypto) but cannot **loosen** it without a written exception, a CTO signature, and a one-way-door ADR.

## The current posture (2026-06-18)

| Standard | Status | Window | Owner |
| --- | --- | --- | --- |
| **SOC 2 Type I** | <span class="badge done">ready</span> | Q4 2026 audit | CTO + Security |
| **SOC 2 Type II** | <span class="badge beta">kickoff Q1 2027</span> | 12-month window | CTO + Security |
| **ISO 27001** | <span class="badge beta">kickoff Q1 2027</span> | annual cert | CTO + Security |
| **OWASP ASVS 4.0** | <span class="badge done">self-attested L2</span> | every major release | Security |
| **NIST SSDF (SP 800-218)** | <span class="badge done">compliant</span> | ongoing | Security + DevOps |
| **OWASP Top 10 for LLM (2025)** | <span class="badge done">LLM01–LLM10 covered</span> | every PR (capability); weekly (safety) | Security |
| **WCAG 2.2 AA** | <span class="badge done">AA-conformant</span> | every PR (axe-core); release gate | Designer + Engineer |
| **GDPR / CCPA / UK-GDPR** | <span class="badge done">compliant</span> | ongoing | CTO + Security |
| **HIPAA** | <span class="badge alpha">roadmap</span> | gated on federal design partner | CTO |
| **FedRAMP** | <span class="badge alpha">roadmap</span> | gated on federal design partner | CTO |
| **PCI-DSS** | <span class="badge alpha">roadmap</span> | gated on payments customer | CTO |

Cert status is tracked in `docs/compliance/cert-status.md` (the CTO maintains it).

## The SOC 2 Type II bar (the gate for the first enterprise design partner)

Per [`customer/standards.md` §2](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md):

- **Security** — the controls in [`memory/security.md` §3–§7](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md) (secrets, auth, audit, change management).
- **Availability** — the targets in [`memory/devops.md` §5–§8](https://github.com/fora-platform/fora/blob/main/workspace/memory/devops.md) (observability, on-call, DR, backup).
- **Confidentiality** — the tenant-isolation controls in [`memory/security.md` §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).
- **Processing Integrity** — the staged workflow gates in [`memory/architecture.md` §3](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md).
- **Privacy** — the data-minimisation and retention controls in [`memory/security.md` §10](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).

**What we add for SOC 2:**

- Quarterly access reviews for every human with prod access.
- Annual penetration test by an independent firm; findings feed the security backlog.
- A vendor review for every sub-processor; the list is published and customer-readable.
- An annual risk assessment with a written risk register and a treatment plan.

**Customer commitment:** a SOC 2 Type II report is available under NDA within 30 days of the audit period close. Customers on multi-year contracts can request a bridge letter for the gap.

## Vulnerability SLAs

| Severity | SLA to fix |
| --- | --- |
| **P0** | 24 h |
| **P1** | 7 d |
| **P2** | 30 d |
| **P3** | next quarter |

A P0 for a customer is a P0 for Forge AI.

## The data handling

| Data class | Retention | Export | Delete |
| --- | --- | --- | --- |
| **Customer data** | tenant-controlled (default 365 d) | on request | on request, 30-day SLA |
| **Audit log** | 365 d (compliance) | on request | **never** (immutable) |
| **Run artefacts** (PRD, ADR, PR) | 365 d | on request | on request, 30-day SLA |
| **PII** | tenant-controlled | redacted in audit log | on request, 30-day SLA |

A 72-hour breach-notification SLA to the customer and (where required) the supervisory authority.

## The sub-processor list

A current list of sub-processors is published at <https://docs.fora.ai/legal/sub-processors>. Any change to the list is communicated to the customer within 10 business days.

## Where to next

- **[Identity & access →](/security/iam/)** — RBAC, agent identity.
- **[Secrets →](/security/secrets/)** — Secrets Manager + Doppler.
- **[Audit log →](/architecture/audit/)** — the audit schema.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/customer/standards.md</code> §2–§8</dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
