# Compliance Lens Review — Forge Delivery Accelerator

## Overall verdict

The PRD claims SOC2-ready and GDPR-ready posture as aspirational control design, which is defensible for a V1 pilot — but **the controls are not yet described at the level a SOC2 auditor or a data-protection authority would recognize**. The compliance narrative is layered on top of capability requirements (F-004 RBAC, F-005 Audit, F-006 Approval) without addressing well-known audit landmines: how an insider admin's audit-tampering is prevented, how right-to-erasure interacts with immutable audit logs, what lawfulness-of-processing posture Forge takes as a data processor of ingested customer repositories, whether GDPR data transfers to a single-region deployment are lawful, and what evidence (tests, pen-test reports, monitoring) backs the isolation claim. Most of these are *fixable in V1* with targeted additions; several are *intentionally deferred and correctly so*. Without those additions, a SOC2 Type I readiness assessment would surface 5–8 control gaps and a pilot customer with EU personal data would create immediate GDPR exposure.

---

## SOC2 control coverage matrix

Mapped against the 2017 Trust Services Criteria (with 2022 Points of Focus revisions noted). Categories abbreviated: CC = Common Criteria, A = Availability, PI = Processing Integrity, C = Confidentiality, P = Privacy.

| TSC Category | PRD Coverage | Evidence in PRD | Gap |
|---|---|---|---|
| **CC1 — Control Environment** | Adequate | Steward role, decision log, leadership framing | No tone-at-the-top compliance charter; no code of conduct reference |
| **CC2 — Communication & Info** | Thin | F-005 Audit, F-009 (V1-optional) Dashboard | No policy lifecycle (draft/review/approve/retire); no security awareness training requirement |
| **CC3 — Risk Assessment** | Silent | — | No risk register of compliance risks; no data-protection impact assessment (DPIA) referenced |
| **CC4 — Monitoring** | Thin | NFR-021 structured logs, NFR-022 metrics | No SOC2-style control self-assessment cadence; no anomaly detection on audit log |
| **CC5 — Control Activities** | Adequate | F-003 Policy Engine, F-004 RBAC, F-006 Approval | No change-management NFR (who approves infra changes vs. app changes vs. policy changes) |
| **CC6 — Logical & Physical Access** | Adequate | NFR-004 SSO, F-004 RBAC, NFR-005 Secrets | No MFA requirement; no access-review cadence; no privileged-access management for admins |
| **CC6.1 Logical access security software/infrastructure** | Adequate | NFR-003 TLS/KMS, NFR-005 vault | No service-to-service mTLS, no secrets-rotation cadence specified |
| **CC7 — System Operations** | Adequate | NFR-021/022/023 observability, NFR-024 deployability | No incident-response NFR; no vulnerability-management cadence; no backup-restore tested-and-proven (quarterly test mentioned in NFR-014 only) |
| **CC8 — Change Management** | Thin | NFR-032 (human approval for governance boundaries) | No SDLC controls (branch protection, code review, pre-prod testing requirements); no separate change-management for the platform itself vs. tenant content |
| **CC9 — Risk Mitigation** | Thin | NFR-007 pen-test pre-pilot, NFR-014 RPO/RTO | No vendor-risk-management NFR for sub-processors (LLM providers — Claude, GPT, etc. — are sub-processors per GDPR) |
| **A — Availability** | Adequate | NFR-009/013/014/015 | Capacity-planning NFR missing; no SLA credit posture |
| **PI — Processing Integrity** | Adequate | F-208 Standards Attestation, F-210 Acceptance Criteria, F-209 context-aware generation | No output-validation NFR (LLM outputs are non-deterministic; "≥80% accepted" is a pilot criterion, not a PI control) |
| **C — Confidentiality** | Adequate | NFR-003 encryption, NFR-006 per-tenant isolation, NFR-007 no leakage | No data-classification NFR; no DLP for outbound connectors |
| **P — Privacy** | Thin | NFR-002 GDPR-ready, NFR-006 per-tenant | **Multiple gaps — see lens 2 below.** |

**Net:** Strong on Confidentiality and the access-control sliver of CC6. Thin-to-silent on the meta-controls (CC3 risk assessment, CC8 change management for the platform, CC9 vendor/sub-processor management, full Privacy criteria). For "SOC2-ready" this is plausible if Architecture ADRs fill the meta-control gaps; the PRD alone does not.

---

## Top compliance risks

Ordered by severity. Each: title, affected NFR/FR, severity, one-liner, mitigation.

1. **Audit immutability is signed-entry shallow.** NFR-020 / F-005 / Critical — Signed entries do not prevent an insider with KMS access from re-signing after mutation; without WORM storage, external notarization, or independent append-only sinks, the immutability claim is not audit-defensible. *Mitigation:* Add (a) WORM/Object-Lock storage for audit table, (b) hash-chain (each entry references prior entry hash + signed by external KMS key whose rotation requires dual control), (c) daily off-system anchor (S3 Object Lock to a separate AWS account, or transparency log), (d) automated tamper-detection monitor that alerts on hash-chain breaks.
2. **GDPR lawful basis and data-controller/processor posture is unstated.** NFR-002, F-007 / Critical — Forge ingests customer repositories (which contain personal data — employee names in commit metadata, customer identifiers in code) and processes them via LLM sub-processors. The PRD never says whether Forge is a controller, processor, or sub-processor; never names lawful basis for processing; never commits to a DPA template. *Mitigation:* Name Forge's processor posture in NFR-002; commit to a DPA template; identify a sub-processor list (Anthropic, OpenAI, Google, Moonshot, DeepSeek are all GDPR-relevant); commit to a 72-hour breach-notification SLA.
3. **Right-to-erasure vs. audit-log immutability is unresolved.** NFR-020, NFR-002 / Critical — GDPR Article 17 requires erasure on request; immutable audit logs that name the erased data subject create a direct conflict. The PRD claims both without resolving. *Mitigation:* Define an "audit-tombstone" pattern — audit log retains `subject_id` and a `redaction_marker` field that replaces PII fields with a hash, with original PII stored encrypted in a separate erasure-capable store. Document the GDPR Article 17(3) exemptions relied on (e.g., legitimate-interest basis for security logs).
4. **Single-region V1 deployment is incompatible with EU customer pilots.** NFR-008 / Critical — "Single-region" is unnamed (which region?), and GDPR Articles 44–49 restrict transfers of personal data outside the EEA to adequacy-decision countries or Standard Contractual Clauses. A US-only single-region deployment serving an EU-based customer creates immediate transfer exposure. *Mitigation:* In NFR-008, name the V1 region (e.g., `us-east-1`) AND commit to an EU region for any EU pilot engagement, OR commit to SCCs + TIA (Transfer Impact Assessment) and pre-pilot data-flow mapping before any EU personal data is ingested.
5. **Connector ingestion establishes Forge as processor of all ingested personal data without DPA controls.** F-007, NFR-002 / High — GitHub/Bitbucket/Jira/Confluence ingestion brings commit authors, ticket assignees, comment authors — all personal data — into Forge. There is no NFR for data-minimization in ingestion, no purpose-limitation, no retention rule. *Mitigation:* Add NFR covering (a) ingestion scope limitation (only metadata needed for PI, not full commit diffs unless required), (b) retention rule (e.g., purge commit-author personal data after N days unless tied to an active artifact), (c) connector-level data-classification declaration.
6. **No MFA, no access-review cadence, no PAM for admins.** NFR-004 / High — SOC2 CC6.2 and CC6.3 require more than SSO. The PRD names SSO as required but is silent on MFA, periodic access reviews, and how admin (Steward + ops) access is privileged-access-managed. *Mitigation:* NFR-004 should require MFA on all IdP-managed accounts; add NFR covering quarterly access review by Steward; add NFR covering just-in-time elevation + break-glass logging for any tenant-data-touching admin action.
7. **Encryption scope silently omits backups, logs, internal service-to-service, and non-primary stores.** NFR-003 / High — "In transit + at rest" with KMS reads as covering primary database and TLS for clients. Backups, log stores (e.g., the structured logs required by NFR-021), internal mTLS between workflow engine / connector runtime / LLM gateway / knowledge graph, and secondary stores (search index, cache, knowledge graph engine — possibly Neo4j per OQ-006) are silent. *Mitigation:* Expand NFR-003 to enumerate every store class (primary DB, backups, logs, audit, search index, cache, KG engine) and require encryption at rest for each; add NFR-003a requiring mTLS for all internal service communication.
8. **Sub-processor management is absent.** NFR-029 / High — LLM providers (Claude, GPT, Gemini, Kimi, DeepSeek) are sub-processors. SOC2 CC9.2 and GDPR Article 28(2) both require sub-processor due-diligence and customer notification/approval. The PRD treats them as swappable infrastructure (which is correct for NFR-029's purpose) but does not bind the Steward to sub-processor onboarding controls. *Mitigation:* Add NFR-029a (or expand NFR-002) requiring: published sub-processor list, customer notification on changes, DPA with each, data-residency option per sub-processor, and a sub-processor risk-assessment cadence.
9. **Pen-test posture is one-shot pre-pilot with no recurring cadence.** NFR-007 / High — Pre-pilot pen-test is good. There is no recurring penetration test (annual SOC2 expectation), no bug bounty, no continuous automated pen-testing for the multi-tenant boundary specifically. *Mitigation:* NFR-007 should specify: pre-pilot pen-test (current), annual external pen-test, continuous automated multi-tenant-isolation test in CI, public bug bounty by Phase 2 or commercial path.
10. **Insider-tamper threat model for audit is unanalyzed.** NFR-020, F-004 / Medium-High — The Steward role has admin authority across all tenants (Organization Knowledge Layer is shared; Steward publishes to all). A malicious or compromised Steward can modify standards that downstream approval logic depends on, can read all tenant data (depending on how Steward is implemented), and has KMS access for audit signing. There is no separation-of-duties NFR (DL-002 is about human approval of governance transitions, not about who can tamper with controls themselves). *Mitigation:* Add SoD NFR: the role that approves artifacts (Architect) cannot be the same identity that can modify the audit infrastructure or the Organization Knowledge Layer for the same tenant; require dual-control for audit KMS key rotation; require independent log shipping before signing.

---

## Per-lens findings

### 1. SOC2 control coverage

The PRD's SOC2 coverage is **strongest at the access-control layer (CC6)** and **weakest at the meta-control layer (CC3 risk assessment, CC8 change management, CC9 vendor risk, full Privacy criteria)**. Specifically:

- **CC1 Control Environment** — Adequate. Steward role and decision log provide structural evidence; missing: tone-at-the-top compliance charter and reference to a code of conduct.
- **CC2 Communication** — Thin. F-005 and (V1-optional) F-009 cover internal communication of policy state; missing: employee security-awareness training, customer-facing security documentation commitments (e.g., how will customers receive audit-log extracts?), and a security advisory disclosure process.
- **CC3 Risk Assessment** — Silent. No risk-assessment NFR, no DPIA, no threat model documented. For a multi-tenant LLM system, a documented threat model is table stakes for any auditor.
- **CC4 Monitoring** — Thin. NFR-021/022 cover observability; missing: anomaly detection on audit log itself, control self-testing cadence, and SIEM integration intent.
- **CC5 Control Activities** — Adequate. F-003 Policy Engine is the strongest asset; missing: separate change-management for the *platform* (vs. tenant content).
- **CC6 Access** — Adequate-with-gaps. SSO named; MFA, periodic access review, and PAM not named.
- **CC7 Operations** — Adequate. NFR-014 quarterly DR test is good; missing: incident-response NFR, vulnerability-management cadence (CVEs in LLM libs, connector SDK deps).
- **CC8 Change Management** — Thin. NFR-032 governs artifact transitions, not platform change management. A SOC2 auditor will ask "who reviewed and approved this code change before production?" — currently answered only by `F-205 Approval Workflow` for artifacts, not for platform code.
- **CC9 Vendor / Sub-processor Risk** — Silent. See lens 9.
- **A Availability** — Adequate. NFR-009/013/014/015 cover; missing: capacity-planning NFR, denial-of-service posture (connectors at F-007 are external dependencies).
- **PI Processing Integrity** — Adequate-with-caveat. F-208/F-209/F-210 define what good output looks like; PI control evidence will require "≥80% accepted" demonstrated over time — but that is a pilot gate, not a runtime PI control. Missing: input-validation NFR for the generation surface (e.g., what if a Tech Lead submits a requirement that asks Forge to generate code containing an SSN or a known secret?).
- **C Confidentiality** — Adequate. NFR-003/006/007 cover the core; missing: data-classification NFR.
- **P Privacy** — Thin. Only NFR-002 names GDPR. The full Privacy category has 18 criteria; the PRD addresses ~4 of them implicitly.

### 2. GDPR readiness

NFR-002 says "GDPR-ready." Walking the GDPR obligations a processor-of-personal-data SaaS faces:

| GDPR Article / obligation | PRD coverage | Status |
|---|---|---|
| **Art. 5 — Lawfulness, fairness, transparency** | Silent | Gap — Forge's role (controller vs. processor vs. sub-processor) is unstated |
| **Art. 6 — Lawful basis for processing** | Silent | Gap |
| **Art. 13/14 — Information to data subject** | Silent | Gap — how does a customer satisfy its Art. 13/14 obligation when Forge is processor? |
| **Art. 15 — Right of access** | Silent | Gap — NFR-002 mentions "data subject rights" but does not specify the mechanism or SLA |
| **Art. 16 — Right to rectification** | Silent | Gap |
| **Art. 17 — Right to erasure** | Conflicts with NFR-020 | **Critical conflict — see lens 8** |
| **Art. 18 — Right to restriction** | Silent | Gap |
| **Art. 20 — Right to data portability** | Partial — NFR-019 covers artifact export | Adequate-for-artifacts, silent on data-subject access requests |
| **Art. 25 — Data protection by design and by default** | Thin — NFR-006 partial | Missing explicit "data minimization" NFR |
| **Art. 28 — Processor obligations (DPA, sub-processors)** | Silent | **Critical gap — see lens 9** |
| **Art. 30 — Records of processing activities** | Silent | Gap |
| **Art. 32 — Security of processing** | Partial — NFR-003/005/006/007 | Adequate for security baseline; missing encryption-scope expansion (lens 6) |
| **Art. 33 — Breach notification to authority (72h)** | Named in NFR-002 as "posture" | **Insufficient — commitment is needed, not posture** |
| **Art. 34 — Breach notification to data subject** | Silent | Gap |
| **Art. 35 — DPIA** | Silent | Gap — for a system processing source code at scale, DPIA is good practice and required for high-risk processing |
| **Art. 44–49 — International transfers** | NFR-008 silent on region | **Critical gap — see lens 5** |
| **Art. 37 — DPO** | Silent | Gap — if KnackForge processes EU personal data at scale, DPO appointment may be required |
| **Art. 38/39 — DPO tasks** | n/a unless DPO required | n/a |
| **UK GDPR / DPA 2018 equivalents** | Silent | Gap if any UK customer |

Net: "GDPR-ready" is the **most overstated compliance claim in the PRD**. A pilot with EU personal data ingested would expose KnackForge immediately.

### 3. Multi-tenancy isolation

NFR-006/007 + the addendum's domain model claim strong isolation, and the architecture (`engagement_scope` flag + per-tenant Project Intelligence Layer + "no cross-engagement query path") is principled. What the PRD **does not establish**:

- **How isolation is enforced architecturally.** The addendum describes the model (A.1–A.2) but the PRD defers tech stack to ADRs. Until an ADR names the row-level-security mechanism (Postgres RLS, application-layer enforcement, query-routing proxy), the isolation is aspirational.
- **How isolation is verified.** NFR-007 says "Pen-test required pre-pilot" — that's a one-shot check. There is no **continuous automated test in CI** asserting that a query against tenant A cannot return a row owned by tenant B. Without an automated regression test, isolation can break silently across releases.
- **Monitoring of cross-tenant attempts.** No NFR for monitoring failed-isolation attempts or alerting on suspicious cross-tenant access patterns.
- **Steward-as-cross-tenant-actor.** The Steward role spans all tenants (Organization Knowledge Layer is shared). The PRD should specify whether Steward can read tenant PI data, and if so under what conditions. Today it is ambiguous.
- **Knowledge-graph isolation under federated strategy.** A-007 / OQ-006 mention federated KG as a future option and warn "NFR-007 becomes harder to enforce." Until OQ-006 resolves, isolation cannot be fully designed.

The claim is **plausible but unproven**. A pre-pilot pen-test is necessary but not sufficient.

### 4. Audit immutability

NFR-020: "append-only. Tamper-evident (signed entries or equivalent)."

Threat model gaps:

- **Insider with admin access.** A database admin (DBA), the Steward, or anyone with KMS key access can: (a) modify an audit row, (b) recompute the signature, (c) leave no trace. Signed entries alone do not address this. The mitigation pattern is **WORM storage** (S3 Object Lock, GCS Bucket Lock, immutable ledger) + **hash-chained entries** + **external notarization** (e.g., daily Merkle root published to an external anchor the org cannot write to).
- **Schema-level mutations.** "Append-only" is enforced at the application layer typically; an admin with DB access can `ALTER TABLE` or `UPDATE` directly. App-layer controls do not prevent this.
- **KMS key compromise.** If the audit signing key is in the same KMS as the application, an attacker who compromises app credentials can sign forged entries. A **separate, externally-anchored** signing flow (or HSM with quorum deletion) addresses this.
- **Time-skew attacks.** Without a trusted timestamp authority (RFC 3161 TSA), an admin can backdate entries. SOC2 auditors often look for TSA-signed timestamps on security-relevant events.
- **"Or equivalent" is doing a lot of work.** This is a place where the PRD is intentionally vague; an auditor will push for specifics.

### 5. Data residency

NFR-008 says "Single-region at V1" without naming the region, and "Multi-region support deferred" with `[TO BE DECIDED]` if commercial path requires it. Problems:

- **GDPR Articles 44–49.** If the region is the US and any EU personal data is ingested (which will be the case for any EU-based pilot engagement), the transfer requires (a) an adequacy decision (Privacy Framework may apply), (b) Standard Contractual Clauses + Transfer Impact Assessment, or (c) another Article 49 derogation. The PRD is silent.
- **"Single-region" is ambiguous.** Single region of deployment? Single region of data storage? Single region of backup? Single region of LLM inference? Each is a different control.
- **Backup region.** NFR-014 says "Backups daily minimum" — to the same region or a different one? Cross-region backup is a resilience feature but creates a second residency claim.
- **LLM inference region.** NFR-029's model-provider independence abstracts providers, but each provider has its own regional inference options. For EU data, EU customers may require EU inference. This is not addressed.

### 6. Encryption scope

NFR-003: "In transit (TLS 1.2+); at rest (industry-standard AES). Key management via cloud KMS."

Silent on:

- **Backup encryption** — backups often have weaker controls than primary stores.
- **Log encryption** — NFR-021 structured logs may contain PII (commit authors, ticket text). Are these encrypted at rest? With what key (same as primary, separate)?
- **Search index** — if F-108 Q&A or F-103 architecture discovery requires a search index (Elasticsearch, OpenSearch, pgvector, vector DB), encryption-at-rest and access-control inheritance from tenant are not stated.
- **Cache layer** — Redis/Memcached/equivalent caches frequently leak because they're treated as ephemeral.
- **Internal service-to-service encryption (mTLS)** — within the cluster, do services mutually authenticate and encrypt? Many cloud-internal defaults are plaintext-on-the-bus.
- **Knowledge graph engine** — if Neo4j or similar (OQ-006), its encryption-at-rest posture is separate from Postgres.
- **Audit log encryption** — separate from application encryption keys? Ideally yes, with a key whose lifecycle is independent.

### 7. Identity and access

NFR-004 names SSO (OIDC/SAML, required) and SCIM (V1-optional). F-004 RBAC names roles (Steward, Tech Lead, Architect, Developer-future, Security Engineer-future, Delivery Sponsor).

Gaps for compliance:

- **MFA.** Not required by NFR-004. SOC2 CC6.1 expects MFA on all access to in-scope systems. Without it, "SSO required" is half a control.
- **Access review cadence.** No NFR requires periodic (typically quarterly) review of who has which role in which tenant.
- **Privileged access management (PAM).** The Steward has super-user across tenants; ops engineers have database/KMS access. No NFR for JIT elevation, session recording, or break-glass procedure for these roles.
- **Separation of duties.** Can the person who defines a standard (Steward) also be the person who approves an artifact citing that standard (Architect)? Currently the roles are distinct (Steward vs. Architect) but the same individual could hold both in a small pilot. No SoD NFR prohibits this.
- **RBAC granularity for compliance.** Roles exist; permissions within roles are not enumerated. SOC2 auditors often ask for a permission matrix; "Steward can X, Y, Z but not A, B, C" should be explicit.
- **Connector credentials.** F-007 connectors will hold customer-side credentials (GitHub PATs, Jira API tokens, etc.). Where do these live, who can read them, are they rotated? NFR-005 covers secrets in general; specific rotation cadence for connector creds is missing.

### 8. Right to erasure vs audit immutability

This is the **clearest unresolved tension** in the PRD.

- GDPR Article 17: data subject has right to erasure of personal data without undue delay when grounds apply.
- NFR-020: audit log is immutable.
- Audit log will contain data-subject identifiers (who approved what, who triggered which ingestion, who is mentioned in which comment).
- If a data subject requests erasure, the audit log rows referencing them either (a) remain intact (immutability preserved, GDPR Article 17 violated unless an Article 17(3) exemption applies) or (b) are modified/redacted (immutability broken).

The PRD does not address this. Resolutions exist:

- **Article 17(3) exemptions.** Right-to-erasure does not apply when processing is necessary for (a) freedom of expression, (b) compliance with a legal obligation, (c) public interest in public health, (d) archiving in the public interest, (e) establishment, exercise, or defence of legal claims. Audit logs likely fall under (b) or (e) for security-relevant events, but this requires documented analysis per row class.
- **Tombstoning pattern.** Keep the audit row (immutability preserved) but replace PII fields with a one-way hash of the data-subject ID; store the mapping in a separate, deletion-capable store. This preserves the integrity of the audit log (the row is unchanged in structure) while erasing the personal data (the PII is no longer recoverable).
- **Data minimization at audit-write time.** Only log data-subject IDs when necessary; use role labels ("Architect") for governance events.

The PRD must commit to one approach before any EU pilot.

### 9. Connector as a data flow

F-007 connectors (GitHub, Bitbucket, GitLab, Jira, Confluence, SonarQube, AWS, Figma, Slack, Zendesk, Azure DevOps, Databricks) pull data from systems of record. Each connector pulls personal data:

- **GitHub/Bitbucket/GitLab:** commit author names + emails, PR reviewers, comment authors.
- **Jira:** ticket creator, assignee, comment authors, watchlists.
- **Confluence:** page authors, editors, comment authors.
- **Slack/Figma/Zendesk/Databricks/Azure DevOps:** all carry user identifiers.

Once ingested, this personal data is processed by Forge (storage + analysis) and **by LLM sub-processors** (per NFR-029, the requirement is sent to a model provider for F-108 Q&A, F-209 context-aware generation, F-201 ADR generation, etc.).

**GDPR processor analysis:**
- Forge's customer (e.g., CMC) is the controller for personal data in its source repositories.
- Forge is the processor when it stores and processes that data on the controller's behalf.
- LLM providers (Anthropic, OpenAI, etc.) are sub-processors.
- Article 28 requires a DPA between controller and processor, and between processor and each sub-processor. The sub-processor change mechanism (right to object) must exist.
- Article 28(3) requires the processor to process only on documented instructions from the controller.

The PRD names none of this. Specifically:

- No DPA template committed.
- No sub-processor list published (or commitment to publish one).
- No purpose-limitation NFR (Forge may process ingested data for purposes X, Y, Z; not for training, not for product improvement without opt-in).
- No retention NFR (how long is commit-author PII retained after a project goes cold?).
- No data-subject-rights handling NFR (when CMC receives an Art. 15/17 request from a former employee whose commit is in the knowledge graph, how does Forge support CMC's response?).

### 10. Pen-testing posture

NFR-007: "Pen-test required pre-pilot." Good, but:

- **No recurring cadence.** SOC2 CC4.1 expects ongoing monitoring; annual external pen-test is the norm. Pre-pilot only means a single check at one point in time, with no obligation to re-test after material changes.
- **No scope specification.** Multi-tenant boundary? Authn/authz? LLM-prompt-injection surfaces? Web app? All of the above? Scope drives cost and value.
- **No bug bounty.** Even a small private bug bounty signals security maturity and finds issues pen-tests miss.
- **No continuous automated testing.** For multi-tenant isolation specifically, a CI test that asserts "tenant A query cannot return tenant B data" catches regressions faster than annual pen-tests.
- **No red-team / purple-team exercises.** Out of V1 scope probably, but worth noting for the security roadmap.

### 11. Out-of-V1 compliance items

Items correctly deferred: SOC2 Type I/II certification, BYOK, multi-region active/active, federated identity across customer IdPs, white-labeling, agent marketplace, custom customer methodologies, multi-org federation. These are reasonable to defer for a pilot-internal V1.

Items that **may be misclassified** as deferred:

- **DPA template and sub-processor list.** These are arguably V1-critical because every pilot customer needs them before signing. Defer to "before first external pilot" rather than "out of V1."
- **DPIA for the platform itself.** Could be a V1 deliverable, not a deferral.
- **Data Processing Agreement execution with each pilot customer.** This is operational but required before any personal data is processed.
- **Breach-notification SLA commitment (72h).** This is a 10-word addition to NFR-002; deferring it costs nothing and reduces risk.

Items that **may be underweighted** in V1:

- **MFA on all accounts.** Cost is minimal; SOC2 expectation is universal. Adding to NFR-004 now is cheap.
- **Quarterly access reviews.** Adding to NFR-004 as an operational NFR (not a control-engineering task) is cheap.
- **Incident-response NFR.** A short "in case of suspected security incident, runbook X is invoked" NFR is cheap and addresses CC7.4–CC7.5.
- **Encryption-scope expansion (lens 6).** A 5-line addition to NFR-003 closing the backup/log/internal-mTLS gaps.
- **Audit-tamper-defense (lens 4).** A pattern commit (WORM + hash chain + external anchor) is the kind of architectural decision that should be locked now, not after pilot.

---

## Mechanical notes

- **NFR-002 ("GDPR-ready") and NFR-001 ("SOC2-ready") are the two highest-risk compliance claims in the PRD.** Both are defensible only if subsequent ADRs and operational NFRs add the missing meta-controls. As written, the PRD is "compliance-aspirational" not "compliance-designed."
- **The addendum is more compliance-relevant than the PRD body on isolation** — A.3 foundational invariants encode the right model, but the operational evidence (tests, monitoring, pen-test reports) is deferred to architecture.
- **Decision log DL-011 correctly defers SOC2 certification** to commercial path. Decision log does not, however, document the GDPR meta-control gaps, which is the more pressing risk for pilot.
- **OQ-005 (V1 deployment model) is correctly identified as a phase-blocker** — without it, NFR-008 data residency cannot be answered.
- **Phase-blockers OQ-006 (KG strategy) and OQ-007 (source-of-truth hierarchy) have compliance implications** not flagged in their rows. KG strategy choice (e.g., Neo4j) determines secondary-store encryption scope (lens 6). Source-of-truth policy must address PII redaction strategy (lens 8).
- **NFR-030 (cost controls) has a privacy-adjacent implication** — per-tenant spend tracking means Forge can infer engagement volume per tenant, which is commercial confidential information that should not leak cross-tenant (same isolation regime as PII).
- **NFR-032 (human governance enforcement)** is strong on the artifact side but does not extend to platform governance — Steward actions on shared Organization Knowledge Layer do not require second-party approval under current design.
- **Pilot phasing P1.5 (Architecture Validation Gate, ≥80% acceptance)** is a processing-integrity criterion, not a compliance criterion. The pilot exit should include a compliance sign-off step (DPAs signed, DPIA filed if required, sub-processor list published, encryption-scope NFR closed) that is currently unmentioned.
- **No mention of regulatory change-monitoring NFR.** GDPR (and equivalents) evolve; the org should commit to tracking regulatory changes and updating controls.
- **The PRD is internally consistent on multi-tenancy** — the addendum's domain model and the NFRs align. This is the PRD's strongest compliance asset.
- **No mention of contractual SLA commitments** to pilot customers (uptime, breach notification, sub-processor change notice, audit-log access). These are typically committed in a Master Service Agreement, not a PRD, but the PRD should at least name them as contract requirements that the architecture must support.

### Cross-references that close compliance gaps cheaply

If KnackForge has limited appetite for compliance expansion before pilot, the highest-leverage additions ranked by ROI:

1. Add a sub-processor list to NFR-029 + commit to customer notification on change (closes SOC2 CC9.2 and GDPR Art. 28(2) in one move).
2. Expand NFR-003 to enumerate every store class (closes lens 6).
3. Add MFA + quarterly access review to NFR-004 (closes most CC6 gaps).
4. Add 72-hour breach notification commitment to NFR-002 (closes GDPR Art. 33).
5. Commit to a tombstoning pattern in NFR-020 (closes lens 8).
6. Name the V1 region in NFR-008 and add an SCC/TIA commitment if EU pilots are possible (closes lens 5).
7. Add a continuous automated multi-tenant-isolation test requirement to NFR-007 (closes lens 3 evidence gap).
8. Add an incident-response NFR (closes CC7.4–CC7.5).
9. Commit to a DPA template as a V1 deliverable (closes most of lens 2 and lens 9).
10. Add a hash-chain + WORM pattern to NFR-020 (closes most of lens 4).
