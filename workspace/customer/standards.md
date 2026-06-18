# Customer Standards

**Scope:** Industry standards FORA inherits from, and the model for how a customer can extend them.
**Audience:** Every sub-agent and engineer working on the customer-facing surface or on compliance work.
**Stage injection:** Inject into **Architect**, **Security**, **Documentation**, and **Product** sub-agents. Required for any change that touches the customer contract, the audit surface, or the data-handling boundary.

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** That is your first ten minutes. This file is the inherited-standards bar; the README is how you walk in.
- **The standards in §2–§8 are a floor, not a ceiling.** A customer can tighten a default (e.g., require FIPS-validated crypto) but cannot loosen one without a written exception, a CTO signature, and a one-way-door ADR (per [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records)). Customer-specific tightening lives in `engagements/<customer-slug>/conventions.md`, never inline.
- **The sentence "we already do this" is the riskiest sentence in this file.** Every §2–§8 commitment is backed by a control in [memory/security.md](../memory/security.md) or [memory/devops.md](../memory/devops.md). A new commitment that does not cite the backing control is rejected at PR review.
- **Certifications in §2–§8 are time-bound.** A claim like "SOC 2 Type II certified" is only true on the dates the auditor signed off. A current claim of a lapsed cert is a misrepresentation; the claim is checked against `docs/compliance/cert-status.md` (the cert status file the CTO maintains) before it ships to a customer surface.

---

## 1. The inheritance model

FORA's defaults inherit from the standards below. A customer can **tighten** a default (e.g., require FIPS-validated crypto) but cannot **loosen** it without a written exception, a CTO signature, and a one-way-door ADR. The standards are the floor; the customer's contract is the ceiling.

```
                        ISO 27001 / SOC 2
                               │
                ┌──────────────┼──────────────┐
                │              │              │
              OWASP         NIST SSDF     WCAG 2.2 AA
                │              │              │
                └──────────────┼──────────────┘
                               │
                       FORA defaults
                       (this workspace)
                               │
                       Customer contract
                       (the ceiling)
```

The defaults are the audit baseline. The customer's contract is what we deliver; everything below the contract and above the defaults is the "headroom" we can spend on improvements.

## 2. SOC 2 Type II (the gate for the first enterprise design partner)

**What we inherit:**

- **Security** — the controls in [memory/security.md §3–§7](../memory/security.md) (secrets, auth, audit, change management).
- **Availability** — the targets in [memory/devops.md §5–§8](../memory/devops.md) (observability, on-call, DR, backup).
- **Confidentiality** — the tenant-isolation controls in [memory/security.md §4](../memory/security.md#4-authentication-authorisation-tenancy).
- **Processing Integrity** — the staged workflow gates in [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine).
- **Privacy** — the data-minimisation and retention controls in [memory/security.md §10](../memory/security.md#10-compliance-posture-today).

**What we add for SOC 2:**

- Quarterly access reviews for every human with prod access.
- Annual penetration test by an independent firm; findings feed the security backlog.
- A vendor review for every sub-processor; the list is published and customer-readable.
- An annual risk assessment with a written risk register and a treatment plan.

**Customer commitment:** a SOC 2 Type II report is available under NDA within 30 days of the audit period close. Customers on multi-year contracts can request a bridge letter for the gap.

## 3. ISO/IEC 27001 (the international baseline)

**What we inherit:** the controls in §2 above (and the underlying security and devops controls in [memory/security.md](../memory/security.md) and [memory/devops.md](../memory/devops.md)).

**What we add for ISO 27001:**

- A Statement of Applicability (SoA) that maps every Annex A control to its implementation, justification, and owner.
- An Information Security Management System (ISMS) that the CTO owns, with quarterly management review.
- A risk treatment plan that feeds the security backlog.

**Customer commitment:** the SoA and the cert are available under NDA. The cert is renewed annually; surveillance audits are quarterly.

## 4. NIST SSDF (SP 800-218) — secure software development

**What we inherit:** the staged workflow in [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine), the testing bar in [memory/coding.md §5](../memory/coding.md#5-testing-discipline), the supply-chain controls in [memory/security.md §9](../memory/security.md#9-vendor-and-supply-chain).

**What we add for SSDF:**

- A documented threat model per service (per [memory/security.md §1](../memory/security.md#1-threat-model-one-paragraph-the-rest-of-the-doc-defends-it)).
- Provenance for every container image (cosign signature, SBOM, attestation).
- A vulnerability management process with explicit SLAs (P0 = 24 h, P1 = 7 d, P2 = 30 d, P3 = next quarter).

## 5. OWASP ASVS 4.0 (application security)

**What we inherit:** the controls in [memory/security.md §6](../memory/security.md#6-owasp-application-security-baseline).

**What we add:**

- A self-attested ASVS Level 2 score for every public-facing API, refreshed at every major release.
- An ASVS Level 3 score for the agent runtime, refreshed at every minor release.

## 6. OWASP Top 10 for LLM Applications (2025)

**What we inherit:** the controls in [memory/security.md §5](../memory/security.md#5-llm-agent-specific-controls) (prompt-injection defence, plan-then-act, human-in-the-loop, budget ceilings, safety evals).

**What we add:**

- A regression eval set covering LLM01–LLM10 maintained in `packages/evals/cases/safety/`.
- A red-team exercise quarterly; the findings feed the security backlog with the SLAs in §4.

## 7. WCAG 2.2 Level AA (web accessibility)

**What we inherit:** the repo and component conventions in [customer/conventions.md](./conventions.md).

**What we add:**

- All customer-facing surfaces (the Forge console, the agent observability dashboard, the audit log viewer) are AA-conformant.
- Keyboard navigability, screen-reader semantics, and visible focus are part of the PR bar.
- An automated axe-core check runs in CI on every PR that touches a customer-facing page.
- A manual screen-reader pass is part of the release gate for new customer-facing surfaces.

## 8. GDPR / CCPA / UK-GDPR

**What we inherit:** the data-handling controls in [memory/security.md §10](../memory/security.md#10-compliance-posture-today) (data minimisation, tenant-scoped retention, export/delete endpoints).

**What we add:**

- A Data Processing Addendum (DPA) is the contract for every customer.
- A sub-processor list published and updated within 10 business days of any change.
- A Data Protection Impact Assessment (DPIA) for every feature that processes special-category data.
- A 72-hour breach-notification SLA to the customer and (where required) the supervisory authority.

## 9. Customer extensions

A customer can extend the standards in three ways:

1. **Tighter defaults** — e.g., "all data must stay in `eu-west-1`," "all crypto must be FIPS-validated," "every agent action must be human-approved." Tightening does not need an ADR; it is a per-tenant override in `engagements/<customer-slug>/conventions.md`.
2. **Additional certifications** — e.g., HIPAA, FedRAMP, PCI-DSS. These are scoped engagements, not defaults; they are scoped in the customer contract and priced accordingly.
3. **Customer-specific conventions** — e.g., "your Jira project uses `FE-` prefixes and a different severity matrix." These live in `engagements/<customer-slug>/conventions.md` (per [customer/conventions.md §2](./conventions.md#2-repo-and-workspace-layout-per-customer)) and override the global `customer/conventions.md` for that customer only.

A customer request that conflicts with a **one-way door** (e.g., "disable the audit log" — see [memory/security.md §7](../memory/security.md#7-audit-logging) for the audit log immutability rule) is declined, not negotiated. The decline is documented in writing and tracked as a closed-lost entry in the deal record.

## 10. Standards anti-patterns (auto-flag in review)

- A change to a customer-facing surface without a WCAG check.
- A change to the data-handling surface without a DPIA review (if special-category data is in scope).
- A new sub-processor onboarded without the vendor review in [memory/security.md §9](../memory/security.md#9-vendor-and-supply-chain).
- A customer extension that loosens a default without an ADR and the CTO's signature.
- A claim in a customer-facing doc ("SOC 2 Type II certified") that is not currently true per `docs/compliance/cert-status.md`.
- A cert claim with a lapsed period (e.g., "we are SOC 2 certified" during the gap between audit cycles).

## 11. Related

- The technical controls this builds on: [memory/security.md](../memory/security.md) and [memory/architecture.md](../memory/architecture.md)
- Customer-facing naming and delivery norms: see [customer/conventions.md](./conventions.md)
- Customer-facing vocabulary and acronyms: see [customer/glossary.md](./glossary.md)
- The product these standards serve: see [project/PRD.md](../project/PRD.md)
- The roadmap toward compliance milestones: see [project/roadmap.md](../project/roadmap.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it adds or removes an inherited standard (§2–§8), tightens a one-way door, or changes the customer extension model in §9. A change that loosens a default (drops a control, narrows a commitment, or removes a SLA) is rejected. The CTO owns merges to this file; a security reviewer is required on every PR.
