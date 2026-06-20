# Pilot Readiness Lens Review — Forge Delivery Accelerator

## Overall verdict

The pilot could start tomorrow in a *narrow* sense (Steward, Tech Lead, Architect, and the M3 core can be brought up), but the PRD is not yet pilot-grade as a contract: the pilot's defining unknowns (TTTD baseline methodology, knowledge graph strategy, source-of-truth policy, and the connector SDK target's realism for the four required systems) are still phase-blockers, and the P1.5 Architecture Validation Gate is defined only in terms of an undefined phrase ("major correction"). At least two of the seven OQs (OQ-001, OQ-002) must be resolved by Engineering Excellence *before* P1.5 begins, and the runbook and adoption-signal telemetry are not on a path that lands in time. The pilot will not fail on day one, but it will fail to be *defensible* by P3 if these gaps are not closed during the M3–P1.5 window.

## Top pilot-blocking risks

1. **TTTD baseline methodology is undefined (OQ-002).** §2.1 / §6.1 / §8.2 — **CRITICAL.** PRD states `[TO BE MEASURED]` and defers resolution to "alongside OQ-001" by Engineering Excellence + Pilot TL. The metric is the *North Star* and also drives P3 directional-improvement judgement, but no definition of "deployment-approved release package" artifact, no enumeration of which approvals count, and no clock-start trigger is provided. Without a methodology document, P0 cannot produce a baseline that P3 can defend. *Mitigation: ship a one-page Baseline Methodology ADR as a precondition to P0; define the clock-start event, the gate-evidence package contents, and the data source for "approval timestamp."*

2. **P1.5 "major correction" is undefined.** §8.2 — **CRITICAL.** The exit criterion is "≥80% of generated outputs accepted without major correction." Two reviewers can disagree on what counts as "major." This is the gate that prevents "8 weeks measuring a system whose architecture output is fundamentally wrong" — but the gate itself is not operationalized. *Mitigation: pre-define a 3-bucket rubric (Accept / Minor Correction / Major Correction) with examples per artifact type (ADR, API contract, task breakdown, risk register) before P1.5 starts; require two reviewers per artifact and compute Cohen's kappa to surface reviewer disagreement.*

3. **Connector SDK target of 3–5 engineer-days is not realistic for the four required connectors as a one-shot scope.** §6.1 OQ-008 + NFR-027 — **CRITICAL.** Bitbucket Cloud/Server, GitHub (Apps vs. PAT), Jira (REST v3 + next-gen), and Confluence (Cloud + Data Center) each have non-trivial auth, pagination, and rate-limit edge cases. With webhooks (NFR-017) plus polling fallback plus idempotent re-sync (NFR-016) plus event subscription plus audit-log emission (F-005), 3–5 days each is achievable *if* SDK scaffolding is already in place — but the PRD treats this as a *new* per-connector cost without acknowledging the shared substrate. *Mitigation: explicitly split "first connector" (likely 8–10 days) from "subsequent connectors" (3–5 days), and validate the substrate on GitHub before committing to the other three.*

4. **Knowledge graph strategy (OQ-006) is unresolved and the pilot must ingest a real brownfield project.** §6.1 + A-007 — **CRITICAL.** A-007 currently commits to "single graph engine, not federated," but OQ-006 is still open. The pilot ingest (10–20 repos within 24h per NFR-010) is an early M5 demo gate, which is a prerequisite to pilot kickoff. If a graph engine is chosen at M3 and fails the brownfield pilot project's actual shape (e.g., heavy JSON document stores, polyglot persistence, monorepo with N services), there is no documented rollback. *Mitigation: name a placeholder strategy (e.g., PostgreSQL+AGE) and a hard pivot criterion (e.g., "if any p95 query > 2s on a 20-repo synthetic at end of M3, trigger KG ADR"); do not let OQ-006 slip past M3.*

5. **Adoption signals (§8.5) require telemetry that has not been scoped and is not in the build sequence.** §8.5 — **HIGH.** "Active Tech Leads per week," "Approval cycle completion rate," "Artifact Consumption Rate," and "First Aha Time" all require instrumentation that does not exist in M1–M7. M1 covers F-001/002/004/005/006/010 — there is no FR explicitly responsible for emitting the adoption telemetry; the closest is NFR-022 (metrics & dashboards) and F-005 (audit). "Artifact Consumption Rate" requires tracking downstream references to artifacts (task breakdown → implementation PR) which depends on Phase 2 (out of V1) or a manual proxy. "First Aha Time" requires a stopwatch on a user-driven event that is not defined. *Mitigation: add an "Adoption Telemetry" sub-section to M1 (or a new M1.5) that defines the event schema for each adoption signal before P1 starts; downgrade "Artifact Consumption Rate" to a P2+ measurement or define its V1 proxy.*

6. **Pilot ops runbook timing is infeasible (N-003).** §6.4 + §8.2 — **HIGH.** N-003 is "Pilot kickoff − 2 weeks" and P1 (Pilot kickoff) is itself 1 week, after P0 (4 weeks). The runbook must be ready by *the start of P1*, not two weeks before, which is fine — but the PRD never assigns *who* writes it. N-003 owner is "Pilot TL," but the Pilot TL is not staffed in any pre-pilot phase; the runbook content (incident response, on-call, SLO breach handling) depends on Architecture (OQ-005 deployment model) and NFRs (NFR-013/014) that are still in motion. *Mitigation: name the Pilot TL in the Pilot Plan document alongside OQ-001; pre-assign on-call rotation, escalation tree, and a 1-page incident playbook as P0 exit criteria.*

7. **Pilot → multi-engagement decision criteria are post-hoc-able.** §8.2 P3 exit — **HIGH.** P3 exit says "Decision recorded; metric targets formalized for next phase." There is no enumeration of what "decision" means in advance. P2 collects "directional improvement" and "counter-metrics stable or improving" but offers no thresholds, no statistical test, no minimum sample size, and no stratification. P1.5 has an 80% threshold, but P2 does not. P3 will be decided by the loudest voice in the room. *Mitigation: pre-define P2 success as (a) ≥X% directional improvement on TTTD with n≥Y completed requirements, (b) Human Override Rate ≤Z%, (c) P1.5 ≥80% acceptance re-confirmed in the pilot engagement. If any fail, default to "iterate" not "expand."*

## Per-lens findings

### 1. Pilot scope resolvability

**OQ-001 (pilot project identification) is under-described as a phase-blocker.** The blocker says only "Cannot establish baseline metrics, cannot scope pilot scope or success criteria" and assigns it to Engineering Excellence with a "Pilot Plan document (separate)" as the resolution path. The Pilot Plan is not referenced elsewhere in the PRD and is not an artifact this PRD commits to producing. The Phase 0 metric gates (NFR-010 "10–20 repos in 24h") imply a specific shape of pilot project (size, number of repos, polyglot or not) that is not enumerated as a Pilot Plan input.

*Additional risk:* the addendum lists CMC, GAPI, Honeywell, Neptune, Voyager as candidate names but explicitly as "not committed." The pilot TL has no committed engagement to walk into tomorrow. The list is also a customer-confidentiality surface — names appear in the PRD body of a run folder.

**Recommendation:** treat OQ-001 as two sub-questions: (a) *which* pilot engagement (commitment), and (b) *what* the pilot engagement's repo / service / ADR inventory looks like (estimation input). Resolve (a) before M2; resolve (b) before M3.

### 2. Baseline measurement methodology

OQ-002 is paired with OQ-001 ("Decide alongside OQ-001") but the pairing assumes the same people are available at the same time. The PRD gives the TL a *definition* of TTTD but no *measurement procedure*: which system emits the "approved requirement entering the delivery system" event? Is it Jira workflow transition, Forge intake, or a Steward-attested timestamp? Which "deployment-approved release package" event closes the clock — package created, package approved, or deployment executed? Are approval waits *included* in TTTD, or only the time the package is actively being worked? The PRD's NFR-032 forces *all* governance waits to be in the loop, but the methodology does not say how to separate "wait time" from "work time."

*Additional issue:* §2.4 Counter-Metrics introduce a separate question — do counter-metric spikes (e.g., Human Override Rate) cause a baseline to be re-measured? If a pilot team is learning the tool in P1, override rates will be high for reasons unrelated to baseline.

**Recommendation:** the Baseline Methodology ADR should answer four questions: (1) clock-start event source and identity, (2) clock-stop event source and identity, (3) how governance wait time is attributed, (4) how the baseline is protected from pilot learning effects (suggest: discard first 2 weeks of P2 data).

### 3. P1.5 Architecture Validation Gate

"≥80% accepted without major correction" is the headline gate. The PRD never defines "major correction." A minor correction might be a typo, a missing NFR reference, or a renamed field. A major correction might be a wrong architectural decision, a missing service in the dependency graph, or an ADR that doesn't reflect the brownfield project's actual constraint. The boundary between "minor" and "major" is exactly where reviewer disagreement will concentrate, and the PRD provides no rubric.

*Compounding issue:* the reviewers are "pilot Tech Lead + pilot Architect" — but the Pilot TL and Pilot Architect are not staffed. The Architect persona is the *KnackForge Architect* (V1 secondary, §3.1); if the pilot project is at a customer (CMC, Honeywell), there may also be a *customer architect* whose approval matters but is not mentioned. The §8.6 demo script shows "Architect approves" without specifying whether this is the Forge role or a customer role.

*Operational gap:* the gate is "1–2 weeks" with no enumerated test set size. 5 artifacts? 20? If the test set is small, the 80% threshold has wide confidence intervals. If large, the gate exceeds 2 weeks.

**Recommendation:** pre-publish a 3-bucket rubric (Accept / Minor / Major) with 2–3 worked examples per artifact type, require 2 reviewers per artifact, pre-commit to a minimum of 15 artifacts across ADR/API contract/Task Breakdown/Risk Register, and require both reviewers' agreement on the bucket for the sample to count.

### 4. M3 First Aha Time

§8.4 / §8.5 call out First Aha Time as "the headline UX success criterion" with the operational definition: "time from a Tech Lead connecting a brownfield project to the moment they experience 'the platform understood our project in minutes.'" Two problems:

- **"The moment they experience" is a subjective event.** The Tech Lead's perception of understanding is not observable without instrumentation. Is it when they first *say* it? When they stop clicking? When they issue a Q&A query whose result they accept without modification? The PRD never defines the tripwire.
- **"Minutes" has no upper bound.** "In minutes" could mean 5 minutes or 59 minutes. The §8.6 demo flow implies the aha happens between step 2 (ingestion complete, architecture map shown) and step 3 (Q&A asked). That is a 0-minute aha by construction. The PRD is not actually stress-testing this — a real Tech Lead opening the tool against an unfamiliar 10-repo project may need 30–60 minutes of exploration before feeling "understood."

**Recommendation:** define First Aha Time as a *measured* event with a tripwire (e.g., "Tech Lead clicks 'Mark as understood' on the project dashboard, with the timestamp delta from the ingestion-complete event"). Set a target (e.g., p50 ≤ 30 min, p95 ≤ 2 hours) and accept that "in minutes" is a marketing phrase, not a measurement.

### 5. Adoption signals

The six signals in §8.5 are: (a) Active Tech Leads per week, (b) Approval cycle completion rate, (c) Knowledge Reuse Rate, (d) Human Override Rate trend, (e) Artifact Consumption Rate, (f) Self-Reported Time Saved, plus First Aha Time.

- **(a), (b)** are derivable from F-005 audit log if the audit log captures login events and approval-decision timestamps. **F-005's description does not include user login events**, only "artifact create / approve / modify / override / gate-skip event." Login telemetry must be added to NFR-021 or to a new telemetry FR.
- **(c)** is definitional but requires a reference to existing artifacts at story / ADR / project creation time. There is no FR in M1–M7 that captures "this artifact references that artifact." This is part of F-206 Traceability, but F-206 is Phase 1 (M6+) — Pilot Tech Lead usage in M3–M5 has no traceability surface to measure.
- **(d)** is the cleanest signal — derivable from F-005 + F-006. Feasible.
- **(e)** is the most under-specified. "ADR → Task Breakdown → referenced during implementation" requires Phase 2 (Development Accelerator, out of V1) to exist. There is no V1 proxy.
- **(f)** is a survey — does not require telemetry, but requires survey distribution and response capture, which is not in any FR.
- **First Aha Time** — see lens 4.

*Net:* of 6 signals, 2 are feasible as-stated (b, d), 2 require M1-scope additions (a, c), 1 is impossible in V1 (e), 1 is operationally undefined (f). This means the §8.5 signal panel *cannot* be reported on with current PRD scope.

**Recommendation:** narrow the pilot signal panel to (b) Approval cycle completion rate, (d) Human Override Rate trend, and (c) Knowledge Reuse Rate (with a V1 proxy: % of new ADRs that cite an existing standard or template). Defer (a), (e), (f), and First Aha Time to post-pilot. Add explicit telemetry FRs to M1 for (a) and (c).

### 6. Counter-metrics as pilot guardrails

§2.4 lists six counter-metrics with no response plan. Specifically:

- **Human Override Rate spike** — is the response "investigate the output quality" (in-flight) or "pause pilot" (gate)? Different response, different cost. The PRD does not say.
- **Architecture Approval Skip Rate** — how is "skip" detected? The approval engine (F-006) *prevents* skips by gating, so this metric is only meaningful if blanket waivers are possible. The PRD allows "Approved by self" / "blanket-waiver" patterns as failure modes but does not say how Forge detects them.
- **Security Approval Skip Rate** — V1 has no security persona; security approval is Phase 3. This metric is unmeasurable in V1.
- **Knowledge Reuse Avoidance Rate** — requires the same traceability surface as Knowledge Reuse Rate. Same gap.
- **Production Incident Rate** and **Defect Escape Rate** — these are *outcome* metrics that require the team to operate long enough for incidents to occur. In an 8–12 week P2, the sample is too small.

**Recommendation:** for the pilot, restrict counter-metrics to the ones measurable in V1: (a) Human Override Rate (with a clear response: if >40% in any 2-week window, trigger P1.5 re-run), (b) Architecture Approval Skip Rate (define detection: any `status: approved` event in audit without a preceding `approval_request` event). Mark the others as Phase 3 / P4+ signals.

### 7. Steward / Architect / Tech Lead handoffs

The three roles have clear *responsibilities* in §3.1 and §4, but the *handoff contracts* are missing. The pilot must operate the following handoffs:

- **Steward → Tech Lead:** standards / templates / policies published, versioned, discoverable. No FR in M1 names the discovery surface (F-008 Admin UI is Steward-facing, not Tech Lead-facing).
- **Tech Lead → Architect:** a complete architecture package submitted (F-205). PRD does not name the submission surface, the SLA for Architect review, or what "complete" means in terms of M6 vs. M7 (since F-205 lives in M7 and F-201/202/203/204 in M6).
- **Architect → Tech Lead:** decision returned via F-205. No FR defines the decision-rationale capture (the architect can reject "because I disagree" without recording why; the audit log records the *event*, not the *rationale*).
- **Steward → Architect:** standards attestation configuration (F-208). F-208 is in M7; the Steward's authoring surface for that config is not enumerated.

*Compounding:* the PRD never says who the Pilot TL, Pilot Architect, and Pilot Steward *are*. The Pilot Plan document (deferred to OQ-001 resolution) is the only place these names would live. Without named humans, the handoffs are abstract.

**Recommendation:** add an "M0 — Pilot staffing" deliverable to §8.1 that names the three pilot role-holders and produces a 1-page handoff contract per pair (e.g., "TL → Architect: package contains X, Y, Z; Architect returns decision within N business days; rationale required for reject/request-changes").

### 8. Connector readiness

NFR-027 commits to 3–5 engineer-days per connector. The four required connectors (GitHub, Bitbucket, Jira, Confluence) have platform-specific complexity that the PRD does not acknowledge:

- **GitHub:** Apps vs. PAT auth, rate-limit policies that differ per endpoint, webhook delivery guarantees (at-least-once with retries), pagination cursor handling.
- **Bitbucket:** Cloud vs. Server / Data Center have different APIs; the PRD does not say which. The brief implies Cloud (no Server mention), but enterprise customers may run Server. 3–5 days for both is unrealistic.
- **Jira:** REST v2 vs. v3 differ; next-gen projects have different schemas; the PRD says "Jira" without version. Webhooks (NFR-017) require webhook *registration* per project, not per tenant.
- **Confluence:** same Cloud vs. Data Center fork as Bitbucket. CQL (Confluence Query Language) is non-standard.

The 3–5 day target is realistic *per connector* if the SDK substrate (auth, rate-limit, pagination, webhook subscription, audit emission) already exists. The PRD does not enumerate the substrate as a separate work item, which means the 3–5 days will be consumed building the substrate on the first connector and missing the target on the remaining three.

**Recommendation:** the Architecture ADR for connectors (triggered by OQ-008) should commit to a substrate-first sequence: SDK substrate (estimate 8–10 days) + first connector (GitHub, 3–5 days) + remaining connectors (3–5 days each, achievable only after substrate is proven). The PRD should adopt "first connector 8–10 days, subsequent 3–5 days" to avoid the appearance of a missed target.

### 9. Knowledge graph strategy for pilot

OQ-006 is open; A-007 commits to "single graph engine, not federated"; addendum does not name a graph technology (it is explicitly deferred to ADRs). The pilot needs to ingest 10–20 brownfield repos and produce a queryable model at M5 (NFR-010). The PRD names four candidate strategies (Neo4j, PostgreSQL+AGE, PostgreSQL graph tables, GraphRAG, hybrid) but no evaluation criteria.

*Risk for pilot:* the pilot project is a *brownfield* project (per A-001, 10+ repos baseline). A real brownfield project may have:
- Monorepo with N services and shared libraries (affects F-103 boundary detection).
- Polyglot persistence (SQL + NoSQL + files; affects F-106 Database Map).
- Generated code (protobuf, OpenAPI) that confuses static analysis.
- Legacy code with no tests and no documentation (affects F-108 Q&A confidence).

A graph strategy chosen without seeing the pilot project's actual shape risks being wrong-shaped on day one. There is no fallback if F-103 produces 50% false-positive services (counter to the P1.5 80% gate).

**Recommendation:** the pilot should be allowed to begin with a *placeholder* strategy (suggest: PostgreSQL+AGE) and a *pivot criterion* (e.g., "if Architecture Discovery Coverage <70% on the pilot's first 5 repos at end of M3, escalate KG ADR"). Do not let OQ-006 slip past M3.

### 10. Pilot → multi-engagement decision criteria

P3 exit criteria: "Decision recorded; metric targets formalized for next phase." This is a one-line exit criterion for a stage that decides whether the initiative expands. The PRD is silent on:

- **Minimum sample size.** How many completed TTTD cycles in P2 are required to call the directional improvement "directional" vs. "noise"?
- **Statistical test.** T-test? Bayesian? Non-parametric? The PRD does not say.
- **Stratification.** Do all pilot projects count equally, or only completed, gated, and approved ones?
- **Counter-metric thresholds.** The counter-metrics have no thresholds (see lens 6); P3 will need them.
- **Stakeholder ratification.** Who signs off the P3 decision? The Delivery Sponsor persona consumes dashboards but is not named as a decision authority.

**Recommendation:** pre-define P2 → P3 success criteria as: (a) ≥ 12 completed TTTD cycles in P2 (suggested minimum), (b) median TTTD improvement ≥ 20% vs. P0 baseline (suggested target, to be tightened after P0), (c) Human Override Rate ≤ 30% rolling 4-week, (d) P1.5 ≥ 80% re-confirmed in pilot engagement. Document a default-to-iterate rule for any failure. Make the Delivery Sponsor the named approver, with veto by Steward on counter-metric grounds.

### 11. Pilot ops runbook timing

N-003 is owned by "Pilot TL" with a "Pilot kickoff − 2 weeks" deadline. Issues:

- **Pilot TL is not staffed until OQ-001 resolves.** The Pilot TL cannot write a runbook for a pilot they have not been told they are running.
- **The runbook depends on OQ-005 (deployment model)** for on-call topology, escalation tree, and SLO breach handling. OQ-005 is open.
- **N-003 has no acceptance criteria.** A runbook is not a single artifact; it is incident response, on-call rotation, SLO breach handling, communication tree, post-mortem template, and rollback procedure. The PRD treats it as a single line.
- **The "−2 weeks" deadline conflicts with the Pilot Plan being a separate document.** If the Pilot Plan is being assembled in P0 (4 weeks), the runbook can be assembled in parallel — but the PRD does not coordinate this.

**Recommendation:** treat the runbook as a P0 exit criterion, not a P1 prerequisite. Break the runbook into a checklist: (1) named on-call rotation, (2) escalation tree, (3) communication channels (Slack channel, status page, customer comms template), (4) rollback procedure, (5) SLO breach playbook. Each item can be drafted in parallel with OQ-001 / OQ-005 / OQ-006 resolution and finalized at end of P0.

## Mechanical notes

- The PRD references "Section 2.5" twice for the `[TO BE VALIDATED DURING PILOT]` posture, but Section 2.4 is the last numbered subsection in §2. Section 2.5 does not exist; the posture is documented as a "DL-008" decision in §7.
- The PRD's claim that "the platform works without F-009" (V1-Optional) is contradicted by §8.5 adoption signals, which depend on dashboards (F-009's purpose) to be reported. The Delivery Sponsor persona's job-to-be-done is unfulfillable without F-009, but F-009 is V1-Optional. Either the persona's job-to-be-done is aspirational, or F-009 is implicitly V1-required.
- "First Aha Time" is referenced as both a §8.4 validation timing event *and* a §8.5 adoption signal. These are different uses — one is a milestone, the other is a longitudinal measurement. The PRD conflates them. A tripwire-defined event (lens 4) cannot serve as both without an explicit measurement protocol.
- The addendum's domain model is more authoritative than the PRD body (A.3 "Foundational invariants" are encoded in the model but only mentioned in passing in §5.11). Readers of the PRD body alone will miss the model.
- "Reconcile-brief.md" is referenced in `.decision-log.md` but the file is not in the run folder. If downstream artifacts need the reconciliation, the file is missing.
- OQ-003 is listed as a phase-blocker in §6.1 but described as "Locked decision — not a blocker, just a revisit condition." It is mis-classified. Either remove from §6.1 or mark as "blocker-resolved" with a note.
- The PRD uses `[TO BE VALIDATED DURING PILOT]` and `[TO BE MEASURED]` interchangeably; the distinction (if any) is not defined.
- The PRD's claim of "Brownfield-first strategy approved" (DL-001) and the addendum's "candidate engagement names" place a customer-confidentiality surface in the PRD body. Consider removing the names from the addendum or moving them to a restricted Pilot Plan.
- A-001 says "Pilot is brownfield-first (10+ repos baseline)" but the brief does not appear to commit to 10+ repos for the *pilot*; 10+ repos is the V1 customer profile. A real pilot engagement may have 3–5 repos, which would invalidate NFR-010's "10–20 repos in 24h" as a pilot-level target.
- §8.2 P0 (Pre-pilot) says "without Forge enabled (or with Forge in observe-only mode)." Observe-only mode is not defined as a V1 capability. M1 does not include a "telemetry without enforcement" mode. This is an implicit ask that the PRD does not budget.
