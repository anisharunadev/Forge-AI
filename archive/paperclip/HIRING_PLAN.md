# Forge AI — Hiring Plan

**Company:** Forge AI
**Mission:** Build the Enterprise AI SDLC Operating System on Paperclip + BMAD.
**Plan owner:** CEO
**First revision:** 2026-06-16
**Status:** Active

---

## 1. Hiring principles

1. **Hire one level below the next bottleneck.** Every new role exists to remove the single most expensive constraint on shipping.
2. **Founding-team first, specialists second.** For the first ~5 hires, prefer people who can cover multiple lenses over narrow experts.
3. **Generalize before specializing.** Don't hire a "X Engineer" until a generalist would do that work poorly because of the load.
4. **A-hire, then B-hire, then A-hire.** After every senior hire, the next slot is a senior hire; only insert a junior slot when a senior is overloaded with delegation.
5. **The agent-of-agents architecture is the org chart.** Each sub-agent team (BA, Architecture, Engineering, QA, Security, Platform, etc.) maps to a future hire or, when smaller, to a charter the CTO owns directly.
6. **Compete on mission and ownership, not salary.** Founding engineers want shape-of-the-company influence, not just equity.
7. **Reject fast, accept slowly.** If a candidate cannot articulate why Forge AI, the role, and the work matters to them, do not hire them.

## 2. The first 5 hires (sequencing rationale)

| # | Role | Why now | Reports to |
|---|------|---------|------------|
| 1 | **CTO / Founding Engineer** | Owns technical strategy and execution. No product ships without one. | CEO |
| 2 | **Senior Software Engineer** (full-stack + agent runtime) | Removes the CTO's serialization bottleneck. Unblocks parallel work on the agent runtime and the first MCP integrations. | CTO |
| 3 | **Product Engineer** (frontend + UX-leaning) | Owns the user-facing surface — Forge Ideation console, agent observability, audit logs. The CTO is wired for backend, not pixels. | CTO |
| 4 | **DevOps / Platform Engineer** | Owns the AWS, GitHub Actions, ArgoCD, Helm, SonarQube, and Secrets surfaces. Without this, every MCP integration is bespoke infra work. | CTO |
| 5 | **Security Engineer** (LLM-agent + application) | Closes the audit/secrets/OWASP loop on agent actions. Required before any enterprise design partner. | CTO |

After 5, expand along the SDLC stage teams — see §4.

## 3. Profile of a Forge AI founding engineer

**Must have**

- 5+ years building production systems; demonstrable ownership of at least one system from design to production to retirement.
- Comfort across the stack: backend services, data models, infra, and at least one frontend framework.
- Strong written communication. Async-first; can write a clear ADR or PR description without prompting.
- Bias to ship. Has shipped side projects, OSS, or products, not only work-for-hire code.
- Comfort with ambiguity. Can take a goal and produce a plan, a sequence of child issues, and an owner for each.

**Strong nice-to-have**

- LLM/agent runtime experience (tool use, MCP, agent loops, evals).
- Enterprise SaaS background (auth, multi-tenancy, audit logging, SSO).
- OSS contributions on infrastructure tooling.
- Builder of developer-facing products.

**Will not hire without**

- A clear "why Forge AI" answer. Mission-fit is non-negotiable.
- Evidence of judgment under pressure (incident postmortem, hard tradeoff writeup, etc.).

## 4. Org shape at scale

The architecture and the org chart are the same diagram. Each box is a role; each arrow is a handoff.

```
                CEO
                  │
                CTO ───── Head of Eng (later)
                  │
   ┌──────┬──────┼──────┬──────┐
   │      │      │      │      │
 Senior  Senior Senior  Sec    DevOps
 Eng-A   Eng-B  Eng-C   Eng    Eng
   │      │      │
   └──┬───┴──┬───┘
      │      │
   Frontend  QA
    Eng      Eng
```

Sub-teams when headcount > 10:

- **BA Team** — Product Manager + Business Analyst
- **Architecture Team** — Solution Architect + Tech Lead
- **Engineering Team** — Senior Developers + Reviewer
- **QA Team** — Test Engineer + Self-Healing Test owner
- **Security Team** — Security Engineer + AppSec Reviewer
- **Platform Team** — DevOps + Cloud Architect

## 5. Compensation philosophy (placeholder)

Founding-team equity pool: 15–20% of fully diluted, allocated by the time of joining and scope of ownership. Detail is in the offer letter, not the plan.

Base bands and target equity by role will be set after the first 3 hires are anchored, and revised quarterly based on offer/first-90-days data.

## 6. Sourcing channels

Primary

- **Network of the founding team** — best signal, fastest to close.
- **BMAD + Paperclip community** — high mission-fit, already in the agent-builder world.
- **Open-source contributor graph** — picks up DevOps, security, and infra profiles.

Secondary

- **Targeted outbound** for specific gaps surfaced in retros.
- **Senior engineer referrals** with referral bonus after the first 90 days.
- **Y Combinator / Techstars alumni network** for founding-team-style generalists.

## 7. Interview loop (4 stages, calibrated by role)

1. **Recruiter screen (30 min)** — mission fit, comp range, location/timing, red flags.
2. **Hiring manager call (60 min)** — charter deep-dive, prior work, judgment examples.
3. **Technical loop (3 hours total)**
   - 60 min: take-home or live system design aligned to Forge AI's stack.
   - 60 min: code review / debugging against an existing repo.
   - 60 min: cross-functional pairing with a future teammate.
4. **Founder chat + reference checks (60 min + refs)** — values, decision-making, follow-through.

Bar: at least 3 of 4 interviewers say "strong hire." Any "no hire" blocks the offer.

## 8. Decision criteria

We hire when **all** of the following are true:

- The role removes a binding constraint on the roadmap, not a "nice to have."
- The candidate scores strong-hire on the interview loop.
- The candidate articulates a clear reason Forge AI, the role, and the work matters to them.
- The comp/equity range fits the band.
- The reporting manager has capacity to onboard them in their first 30 days.

We pass when any of:

- Two interviewers say "no hire" on judgment, communication, or ownership.
- The candidate's "why Forge AI" is generic.
- The role charter is unclear or duplicative.

## 9. First-90-days onboarding standard

Every new hire gets, in their first week:

1. A written charter (objective, scope, what they do not own, success metrics).
2. A 30/60/90 plan, co-authored with their manager, with concrete deliverables.
3. Access to the Knowledge Layer (`/workspace/memory/`, `/workspace/project/`, `/workspace/customer/`) and an orientation pass with the CTO.
4. Their first assigned issue — small, shippable, useful.
5. A weekly 1:1 with their manager; daily async standup in their team channel.

End of 30 days: a written retro on what blocked them, what helped, and what to change in the next 30.

## 10. When this plan is revised

- After every 5 hires.
- After every quarterly review, regardless of headcount.
- Immediately on any material change in strategy (new market, new design partner, new platform pivot).
