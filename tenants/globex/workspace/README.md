# Forge AI — Knowledge Layer

The Knowledge Layer is the customer-owned source of truth that every Forge AI sub-agent reads to do its job. The CTO can wake a future sub-agent, inject only the relevant files per stage, and the agent can complete a task from the Knowledge Layer alone.

**Owner:** CTO
**Status:** v0.1 (proposed, 2026-06-16)
**Out of scope for v1:** dynamic memory writes from agents (separate ticket — see [Roadmap §7](../project/roadmap.md)).

---

## 1. The layout

```
workspace/
├── README.md                   # this file — the index and the injection model
├── memory/                     # shared engineering knowledge (cross-project, cross-customer)
│   ├── coding.md               # code style, testing discipline, PR bar
│   ├── security.md             # threat model, secrets, auth, audit, agent safety
│   ├── architecture.md         # agent-of-agents shape, ADRs, contracts, data model
│   ├── devops.md               # CI/CD, observability, deploy, on-call, cost
│   ├── ideation.md             # BA / Ideation stage playbook, Epic synthesis, human-approval gate
│   └── qa.md                   # QA stage playbook, the four test tiers, Security handoff, v2 cost budget
├── customer/                   # customer-facing defaults (overridable per customer)
│   ├── standards.md            # SOC 2, ISO 27001, NIST SSDF, OWASP, WCAG, GDPR inheritance
│   ├── conventions.md          # naming, repo layout, delivery norms, override model
│   └── glossary.md             # terms, vocabulary, acronyms, anti-glossary
└── project/                    # this specific project (Forge AI itself)
    ├── PRD.md                  # the product requirements
    ├── roadmap.md              # the sequenced milestones
    └── tech-stack.md           # the concrete tech
```

Three folders, twelve files, one job: **let a cold-started sub-agent do useful work with only the files it needs.**

## 2. The injection model

A sub-agent wakes up with the glossary, the sub-agent-specific memory file, the customer conventions, the project PRD (or a slice of it), and the handoff contract for its stage. That is it. The agent should not need anything else.

| Sub-agent stage | Memory files | Customer files | Project files | Other |
| --- | --- | --- | --- | --- |
| **BA / Ideation** | `ideation.md`, `architecture.md` | `conventions.md`, `glossary.md` | `PRD.md` | The PRD template |
| **Architect** | `architecture.md`, `security.md` | `standards.md`, `conventions.md`, `glossary.md` | `PRD.md`, `tech-stack.md` | The ADR template |
| **Developer** | `coding.md`, `architecture.md` | `conventions.md`, `glossary.md` | `tech-stack.md` | The PR template |
| **QA** | `coding.md`, `qa.md` | `conventions.md`, `glossary.md` | `tech-stack.md` | The eval set |
| **Security** | `security.md`, `architecture.md` | `standards.md`, `glossary.md` | `tech-stack.md` | The threat model |
| **DevOps** | `devops.md`, `coding.md` | `conventions.md`, `glossary.md` | `tech-stack.md` | The deploy runbook |
| **Documentation** | — | `standards.md`, `conventions.md`, `glossary.md` | `PRD.md`, `roadmap.md` | The doc template |
| **Refactor** | `coding.md`, `architecture.md` | `conventions.md`, `glossary.md` | `tech-stack.md` | The refactor checklist |
| **Cost** | `devops.md`, `architecture.md` | `conventions.md`, `glossary.md` | `tech-stack.md`, `roadmap.md` | The FinOps review template |
| **Audit** | `security.md`, `architecture.md` | `standards.md`, `glossary.md` | `tech-stack.md` | The audit sample script |
| **Evaluation** | `coding.md`, `security.md` | `standards.md`, `glossary.md` | `tech-stack.md` | The eval set |
| **Memory** | (all six) | (all three) | (all three) | The Knowledge Layer spec (this file) |

**Glossary is always injected.** The other files are selected by the Master Orchestrator based on the stage and the handoff contract.

## 3. The acceptance bar

A file passes the Knowledge Layer bar if:

- A sub-agent, woken cold with only that file in context, can read it and act.
- The file has no acronyms that are not defined in the glossary.
- The file has no references to "tribal knowledge" that is not in another file in the workspace.
- The file has a "Related" section at the bottom pointing to the other files that touch the same concern.
- The file is opinionated. "It depends" is not in a v1 file.

A file fails the bar if it is a placeholder, a TODO, or a copy-paste from another workspace. The Knowledge Layer is the spine of the platform; placeholders are a bug.

## 4. The "where do I put this?" decision tree

When new knowledge arrives (from a postmortem, a customer conversation, an incident retro, a quarterly offsite), the writer asks:

1. **Is it about Forge AI the product, or about this customer's product?**
   - Forge AI → `project/`
   - Customer → `engagements/<customer-slug>/` (in the monorepo) or a customer-specific override file in `customer/`
2. **Is it about how every project at Forge AI should be built, or about how this one project is built?**
   - Every project → `memory/` (and probably an ADR if it's a one-way door)
   - This project → `project/`
3. **Is it about the customer surface (what the customer sees, signs, pays for) or the engineering surface (what we build with)?**
   - Customer surface → `customer/`
   - Engineering surface → `memory/`
4. **Is it a term?**
   - Yes → `customer/glossary.md` (the dictionary)
5. **Is it a one-way door?**
   - Yes → `memory/architecture.md` ADR + a corresponding update to the relevant `memory/` or `customer/` file
6. **Is it a temporary note?**
   - No. There is no "temporary" in the Knowledge Layer. Convert to a ticket or convert to a permanent file.

## 5. Versioning

- The Knowledge Layer is versioned with the platform. A change to a `memory/` file ships through the normal release train.
- A change to a `customer/` file ships through the normal release train **and** is announced in the customer changelog when it affects customer-facing behaviour.
- A change to a `project/` file is internal; it ships through the normal release train.
- A breaking change to a `customer/` file is a major version bump and is gated on customer communication.

## 6. Customer extensions

A customer can extend the Knowledge Layer by:

1. **Adding files under `engagements/<customer-slug>/`** in the monorepo (per [customer/conventions.md §2](../customer/conventions.md)).
2. **Overriding a default** in `engagements/<customer-slug>/conventions.md` (per [customer/conventions.md §7](../customer/conventions.md)).
3. **Requesting a new file** in the global `customer/` or `memory/` folder. The CTO reviews; if accepted, the file lands in the global workspace and ships in the next release.

A customer cannot:

- Loosen a security or audit default (per [customer/standards.md §9](../customer/standards.md)).
- Write to the global `memory/` folder (read-only by contract).
- Edit the glossary directly (file a glossary PR instead).

## 7. Out of scope (v1)

- **Dynamic memory writes from agents.** v1 is "humans write, agents read." Dynamic writes are a separate ticket and a v1.1 conversation. The risk model changes once an agent can mutate the Knowledge Layer, and the contract for that change is not small.
- **A vector index over the workspace.** The workspace is small enough (12 files for v1, growing to a few dozen) that a full-text / grep read is sufficient. A vector index lands when the workspace outgrows what a sub-agent can hold in one context window.
- **A customer-facing knowledge surface.** The Knowledge Layer is internal to the customer's tenant. A customer-facing "knowledge" view is a v2 product conversation.
- **Cross-tenant knowledge sharing.** Tenants are isolated. There is no global cross-tenant learning layer in v1.

## 8. Maintenance

- The CTO owns the Knowledge Layer.
- A sub-agent owner (Developer, Security, DevOps, etc.) is the co-owner of their stage's memory file.
- A customer-facing role (PM, Sales Eng) is the co-owner of the customer files.
- Quarterly review: every file is re-read by its owner; "stale" is a P2 process bug.
- Annual review: the entire workspace is re-read by the CTO; the layout is revisited; one-way doors are re-validated.

## 9. Quick start for a new sub-agent

You are a sub-agent. You have just woken up. You have the glossary, the memory file for your stage, the customer conventions, and the project PRD. Here is your first ten minutes:

1. **Read the glossary.** Confirm every term you will use is in there; if not, file a glossary PR.
2. **Read your memory file.** Confirm the principles, the bar, and the anti-patterns.
3. **Read the customer conventions.** Confirm you are not about to violate a customer-specific override.
4. **Read the project PRD (or the slice of it that is yours).** Confirm the goal, the non-goals, and the success metrics.
5. **Read the handoff contract for your stage.** Confirm the input schema matches what you received.
6. **State your plan in one paragraph.** The plan-then-act pattern requires the plan before the act.
7. **Do the work.** Log every action. Honour the budget. Honour the allow-list.
8. **Hand off.** Emit the output schema. Log the handoff. Stop.

If at any point the files are inconsistent with each other, **stop and surface the conflict in a comment.** Do not improvise.

## 10. Related

- The six memory files: [coding.md](./memory/coding.md), [security.md](./memory/security.md), [architecture.md](./memory/architecture.md), [devops.md](./memory/devops.md), [ideation.md](./memory/ideation.md), [qa.md](./memory/qa.md)
- The three customer files: [standards.md](./customer/standards.md), [conventions.md](./customer/conventions.md), [glossary.md](./customer/glossary.md)
- The three project files: [PRD.md](./project/PRD.md), [roadmap.md](./project/roadmap.md), [tech-stack.md](./project/tech-stack.md)
