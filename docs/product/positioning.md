# Product: Positioning

> **Status:** 🔒 **LOCKED** — changes require ADR approval.
> **Doc owner:** Product team
> **Source of truth:** `~/forge-ai/.claude/CLAUDE.md` Mission + this file
> **Last updated:** 2026-07-07
> **Introduced by:** M15-0 (Product Hardening milestone)

---

## The one-line product definition

> **Forge is the AI-native software delivery platform:**
> take a software idea from requirement to production through governed AI workflows.

This line is **the answer** to "what is Forge?" — it is the only line that
may be used in landing pages, sales decks, customer docs (`docs-site/`),
and onboarding copy. Any change requires an Architecture Decision Record
(ADR) approved per `docs/standards/git-workflow.md`.

## Companion truth (architecture, not marketing)

> Forge is not an AI agent. Forge is the operating system that orchestrates
> agents, knowledge, governance, and delivery workflows.

Both lines are true. Use them for different audiences:

| Audience | Use | Why |
|---|---|---|
| Prospects, customers, marketing | The mission (outcome-oriented) | Names what the customer gets |
| Engineers, RFCs, technical docs | The architecture truth | Names what the platform is |

## What the 12 Centers are

The 12 Centers documented in `docs/product/vision.md` §"The 12 Centers" are
**capabilities**, not product. They are surfaced in the UI only when the
golden workflow requires them (see `docs/product/golden-workflow.md`).

| Center | Capability, not product | Surfaced during |
|---|---|---|
| Dashboard | Workspace landing | Always (entry point) |
| Agent Center | Run/inspect AI agents | "Continue development" |
| Connector Center | Connect external systems | "Start new project" → setup |
| Knowledge Center | Browse Org/Project knowledge | "Browse knowledge" |
| Ideation Center | Capture ideas, generate PRDs | "Start new project" → ideation |
| Architecture Center | ADRs, contracts, risks | "Start new project" → architecture |
| Workflows | Visual DAG of in-flight work | "Continue development" |
| Runs | Live + replay run center | "Continue development" / "Review AI work" |
| Governance | Policies + guardrails | "Deploy release" |
| Analytics | LLM usage + cost + burn rate | Always (secondary nav) |
| Command Center | ⌘K palette (63 forge-* commands) | Always (chrome) |
| Co-pilot | Conversational AI | Always (FAB ⌘J) |

## Anti-patterns (do NOT say)

- ❌ "Forge is an AI agent"
- ❌ "Forge is a Jira replacement"
- ❌ "Forge is an AI IDE"
- ❌ "Forge is an architecture generator"
- ❌ "Forge is a knowledge graph"
- ❌ "Forge replaces your code review tool"

If a customer asks "is Forge an X?" the answer is: *"Forge takes a
software idea from requirement to production through governed AI
workflows. Whether that's similar to X depends on which step of that
journey you mean."*

## Acceptance for "positioning is locked"

A reviewer may verify the lock by:

```bash
# 1. The new one-liner exists in the three anchor locations.
grep -l "AI-native software delivery platform" \
    .claude/CLAUDE.md \
    docs/product/vision.md \
    docs/product/positioning.md

# 2. The forbidden framings do not appear in customer-facing surfaces.
grep -rE "Forge is an AI (agent|IDE|coding assistant)" \
    docs-site/ apps/forge/app/welcome/

# Both should return matches for (1) and zero for (2).
```

## Change process

1. Open an ADR in `docs/architecture/decisions/NNNN-<slug>.md` using the
   template in `docs/standards/git-workflow.md`.
2. The ADR must explain why the current line is no longer accurate AND
   propose a replacement.
3. Two approvals required: Product (vision.md doc owner) + Engineering
   (platform team).
4. Only after the ADR merges may this file be edited.

There is **no other path** to change the one-line product definition.