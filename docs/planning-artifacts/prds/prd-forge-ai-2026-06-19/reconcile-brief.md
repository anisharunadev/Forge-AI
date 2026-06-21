# Brief-to-PRD Reconciliation Extract

**Input name:** brief-forge-ai-2026-06-18
**Reconciliation date:** 2026-06-19
**PRD under review:** prd-forge-ai-2026-06-19 (status: draft)

---

## 1. Summary

- **Total claims reviewed:** 47
- **CAPTURED:** 24
- **CAPTURED-WITH-DELTA:** 11
- **DROPPED:** 2
- **DEFERRED:** 6
- **QUALITATIVE-ONLY signals:** 4

---

## 2. CAPTURED (24 — no action needed)

1. Product name "Forge Delivery Accelerator" — PRD title and frontmatter.
2. Problem framing: loss of delivery knowledge between stages — PRD §1.1 vision statement.
3. Connected delivery system (requirements → architecture → development → security → deployment) — PRD §1.4 Pillar 2.
4. Three-layer architecture (Organization Knowledge / Project Intelligence / Agent) — captured as Foundation, Phase 0, and Phase 1+ agents.
5. Foundation = Organization Knowledge Layer — PRD §4.1, F-001 through F-010.
6. Phase 0 = Project Intelligence Accelerator — PRD §4.2, F-101 through F-111.
7. Phase 1 = Architecture Accelerator — PRD §4.3, F-201 through F-210.
8. Typed artifact store with schemas, version history, ownership — F-010 Artifact Registry, F-207 Versioning & Supersession.
9. Knowledge acquisition layer for brownfield ingestion — F-101 through F-107.
10. Human approval gates mandatory at governance boundaries — NFR-032, F-006, DL-002.
11. Auditability / append-only audit log — NFR-020, F-005.
12. V1 primary persona = KnackForge Technical Lead — PRD §3.1.
13. Tech Lead owns flow; Architect owns approval — F-205 Approval Workflow, §3.1.
14. V1 first aha = brownfield project → queryable knowledge graph — PRD §8.6 Demo Path step 1–3.
15. KnackForge Architect as secondary V1 persona — PRD §3.1.
16. Steward (Engineering Excellence) as V1-active Foundation persona — PRD §3.1, F-001, A-008.
17. Phases 2–5 (Development, Security+QA, Modernization, Delivery Orchestration) explicitly out of V1 — PRD §4.4, DL-009.
18. Brownfield-first strategy — DL-001, A-001.
19. Per-tenant isolation of Project Intelligence Layer; shared Organization Knowledge Layer — NFR-006, DL-004, DL-005.
20. Strategic Phase A (Internal) → B (Customer-facing) → C (Commercial) — PRD §8.3 Rollout.
21. Phase 1 pilot = one reference brownfield project, end-to-end demo — PRD §8.2 P0–P2, §8.6 Demo Path.
22. Pilot metrics baseline-anchored; no specific % targets until baseline data exists — §2 metrics all `[TO BE VALIDATED DURING PILOT]`, DL-008.
23. Code patches require human review before merge — PRD §6.3 (Production code generation without human review, never in scope).
24. Practice Standard rollout stage between Multi-Engagement and Commercial — §8.3, "we use it ourselves" framing preserved.

---

## 3. CAPTURED-WITH-DELTA (11)

1. **North Star Metric.** Brief: Delivery Predictability. PRD: changed to **Time to Trusted Delivery (TTTD)**. Recorded in DL-006; rationale in §1 and §2.1. Predictability demoted to supporting metric.
2. **North Star framing rationale.** Brief tied NSM to root problem (knowledge loss → outcomes converge). PRD reframes TTTD as "observable, daily, aggregates planning + architecture + development + QA + security + governance efficiency." Root-cause connection to §2 problem preserved in §2.1 but weaker.
3. **Project Intelligence metrics list.** Brief lists 4 (TTPU, Architecture Discovery Coverage, Question Resolution Accuracy, Knowledge Acquisition Time). PRD merges KAT into TTPU (§2.3, addendum B.2), and adds Knowledge Reuse Rate + Architecture Drift Rate.
4. **Counter-metrics (anti-gaming).** Brief mentions "What Success Does Not Mean" qualitatively. PRD operationalizes as 6 named counter-metrics in §2.4 (Architecture Approval Skip Rate, Security Approval Skip Rate, Production Incident Rate, Defect Escape Rate, Knowledge Reuse Avoidance Rate, Human Override Rate). Structural upgrade, not a drop.
5. **Tech Lead JBTD scope.** Brief: Architect/TL feel delivery pain. PRD: expanded to full delivery-ownership narrative (§3.1 inline note: "Forge's long-term success is not 'connect repositories' — it's 'help Tech Leads deliver consistently across every KnackForge engagement.'") Strategic elevation.
6. **Delivery Sponsor persona.** Brief mentions "Director of Engineering / VP Engineering" only as funders. PRD elevates to full V1-active persona (Executive Observer, DL-007 / §3.1).
7. **V1-active personas expanded.** Brief: Tech Lead + Architect + Admin/Engineering Excellence. PRD: adds **The Steward** (Engineering Excellence Lead) as named V1 persona — brief's "Admin/Engineering Excellence" gets a concrete role + JBTD.
8. **Constitutional knowledge sub-types.** Brief §6 enumerates ADR, API contract, task breakdown, code patch, test report, security report, deployment plan (8 types). PRD defines via F-010 Artifact Registry (centrally extensible; typed via templates F-002). Initial Phase 1 set is ADR, API Contract, Task Breakdown, Risk Register, Acceptance Criteria — Risk Register and Acceptance Criteria are **additions**; code patch / test / security / deployment are deferred to Phase 2–3.
9. **Knowledge Acquisition Time metric.** Brief: 4th metric (24h target). PRD: merged into Time to Project Understanding (addendum B.2). Pilot NFR-010 still carries the 10–20 repos in 24h target as a different artifact.
10. **SOC2 timing.** Brief: SOC2-ready is implied. PRD: explicitly locked to **SOC2-ready (controls designed), not certified** (NFR-001, DL-011). Type I/II deferred.
11. **1000+ concurrent workflows.** Brief addendum: 1000+. PRD: relaxed to **100+** (NFR-009, addendum B.7). Rationale: V1 users are internal.

---

## 4. DROPPED (2 — most important findings)

1. **No-Goals / Anti-fear framings are softer in the PRD.** Brief §5 closes with the explicit framing: "These non-goals are stated explicitly because they are the fears every leadership reader is bringing to the document. Saying them out loud turns the fears into commitments." The PRD's §6.3 Out-of-Scope list is more procedural; the emotional/explicit commitment that non-goals exist because leadership fears replacement is not restated. Risk: the reassurance narrative that won the brief rounds may need re-anchoring in downstream artifacts (UX copy, exec-facing materials).
2. **The "first aha" as a UX signal is dropped from §1 and buried in §8.6.** Brief §5 calls out twice ("first aha is not 'the accelerator generated an architecture' — it is 'the platform understood our project in minutes'"). PRD moves this to §8.6 Demo Path step 3 (impact question) and step 1–2 (ingestion) without retaining the "first aha" framing. Risk: UX/Architecture may not see this as a primary UX success criterion if it's only in the demo script.

---

## 5. DEFERRED (6 — confirm deferral is captured)

1. **Scope detail (MVP/V1/V2 functional decomposition)** → PRD. Confirmed: PRD §4, §8.1 captures V1 (Foundation + Phase 0 + Phase 1) and §4.4 names out-of-V1 phases.
2. **Detailed Vision (year-1/year-3 product roadmap)** → PRD. Confirmed: PRD §1 + §8.3 capture strategic rollout.
3. **Budget & pricing posture** → Commercial document / Strategic Phase B. Confirmed: OQ-004 (Commercial pricing posture) §6.1, N-001 §6.4.
4. **Tech stack, DB schema, folder structure, ADRs** → Architecture phase. Confirmed: PRD addendum F explicitly states no tech commitments; NFR-029 model-provider-agnostic; OQ-005 / OQ-006 / OQ-007 are pre-ADR blockers.
5. **Pilot project name, repositories, timeline** → Pilot Plan. Confirmed: OQ-001, A-001, addendum C (candidate names mentioned but explicitly NOT committed).
6. **Implementation / stories** → bmad-create-stories. Confirmed: out of PRD scope by design.

---

## 6. QUALITATIVE-ONLY SIGNALS (4 — cultural/tone/voice elements at risk)

1. **"We use it ourselves" framing** — the strategic argument for the Practice Standard rollout stage. Captured in §8.3 ("Before Forge is sold externally, KnackForge must use Forge internally as the default delivery workflow. 'We use it ourselves' is leadership framing that builds the case for commercial packaging."). **Status: captured.** Flag for downstream: ensure UX/Architecture/Epics reinforce "this is how KnackForge itself works," not "this is what we sell."
2. **Reassurance against replacement-of-engineers fear** — brief explicitly walks the leadership reader's anxiety: "Forge Delivery Accelerator is not intended to replace engineers, architects, or delivery processes." PRD retains the prohibition in §6.3 and §3.3 (out-of-scope personas: AI Delivery Operator, Replacement Engineer, Autonomous Release Manager) **but loses the leadership-addressing tone**. The PRD speaks in engineering vocabulary ("autonomous software delivery system"); the brief addressed executives ("these are the fears every leadership reader is bringing to the document"). Risk for downstream artifacts: if Epics/UX carry the procedural prohibition without the executive reassurance, leadership signoff remains harder.
3. **"Before measuring the baseline"** — the discipline that won several brief revisions (kill the 25–30% number, add `[TARGET - TO BE VALIDATED DURING PILOT]` everywhere). Captured structurally via DL-008 and the `[TO BE VALIDATED DURING PILOT]` posture across §2 metrics. **Status: structurally captured.** Flag: UX/Architecture should not let any persona-facing copy carry a specific % promise; copy needs to mirror the pilot-anchored discipline.
4. **Knowledge-in-individuals → system-as-property** — the brief's opening line and DL-007's "even if Project Intelligence becomes automatic" both build on a cultural claim ("delivery quality must be a property of the system rather than a property of who is assigned"). Captured in §1.2 Strategic posture and DL-007. **Status: captured.** Flag for downstream: this is the through-line for executive-facing copy and the North Star narrative. Architecture decisions (shared vs. per-tenant) should explicitly defend this property, not just satisfy it.

---

## 7. Notes for downstream artifacts

- **Epics/Stories:** The replacement-fear reassurance (§6.3) and "we use it ourselves" (§8.3) framings should be made explicit in the Epic description language, not just inherited from PRD structure.
- **Architecture:** Tech-stack deferral is firm. The eight NFR-029..032 + DL-001..005 constraints are the only mandatory architectural carry-overs. OQ-005 / OQ-006 / OQ-007 are pre-ADR blockers and must be resolved before architecture work begins.
- **UX:** Counter-metrics in §2.4 should have UX-visible surfaces (Human Override Rate feedback, Knowledge Reuse prompts). The "first aha" UX signal (brownfield → queryable in same morning) needs to be a UX success criterion, not just a demo step.
- **Pilot Plan (separate doc):** OQ-001 and OQ-002 are the two open blockers. The pilot must baseline TTTD before any directional claim can be defended.