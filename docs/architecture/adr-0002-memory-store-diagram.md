# ADR-0002 — One-Page Memory Store Diagram

**Source of truth.** If this file and [ADR-0002](./adr-0002-memory-store.md) §11 ever drift, **this file wins** — re-render the inline copy from here.

**Format.** Mermaid is the primary source. A pure-ASCII fallback follows the Mermaid block for renderers that do not understand Mermaid (Confluence, plain text review, email).

---

## 1. Mermaid (primary)

```mermaid
flowchart LR
  classDef human fill:#f5f5f5,stroke:#333,color:#000
  classDef mem   fill:#fef3c7,stroke:#b45309,color:#000
  classDef store fill:#dbeafe,stroke:#1d4ed8,color:#000
  classDef audit fill:#fde2e4,stroke:#9f1239,color:#000
  classDef gate  fill:#dcfce7,stroke:#166534,color:#000

  H[Human / DevOps agent<br/>PR edits to workspace/*]:::human
  WS[(workspace/<br/>memory · customer · project<br/>git-tracked constitution)]:::store

  PRO[Proposer<br/>any agent]:::mem
  MEM[Memory Agent<br/>curator · promoter · forgetter]:::mem
  MO[Master Orchestrator<br/>reader]:::mem
  STG[Stage sub-agents<br/>Dev · QA · Security · …]:::gate

  PG[(PostgreSQL<br/>memory_fact<br/>hybrid vector + tsvector<br/>RLS by tenant)]:::store
  AUD[(Audit log<br/>append-only)]:::audit

  REC[Reconciliation job<br/>nightly]:::mem

  H -- PR --> WS
  WS -- diff --> REC
  REC -- propose/curate --> MEM

  PRO -- propose --> MEM
  MEM -- curate/promote/forget --> PG
  MEM -- audit_event --> AUD

  MO -- recall --> MEM
  MEM -- facts + citations --> MO
  MO -- inject per-stage policy --> STG

  STG -. never reads directly .-> MEM
```

**Legend**

- **Grey** — human / external actor.
- **Blue** — persistent store (workspace tree, Postgres).
- **Yellow** — Memory agent and its reconciliation job.
- **Red** — Audit log (append-only, mirrored from every `memory.*` call).
- **Green** — stage sub-agents (read indirectly via Master Orchestrator only).

---

## 2. ASCII (fallback)

```
                ┌──────────────────────────┐
                │  Human / DevOps agent    │
                │  PR edits to workspace/* │
                └────────────┬─────────────┘
                             │ PR
                             ▼
   ┌────────────────────────────────────────────────────┐
   │  workspace/  (git-tracked constitution)           │
   │    memory/  customer/  project/                    │
   └─────────────────────┬──────────────────────────────┘
                         │ nightly diff
                         ▼
                 ┌──────────────────┐         ┌──────────────────────┐
   Proposer ───► │  Memory Agent    │ ──────► │  PostgreSQL          │
   (any agent)   │  curator         │ writes  │  memory_fact         │
                 │  promoter        │ ──────► │  hybrid vector +     │
                 │  forgetter       │         │  tsvector · RLS      │
                 └────────┬─────────┘         └──────────────────────┘
                          │ audit_event
                          ▼
                 ┌──────────────────┐
                 │  Audit log       │  append-only — every memory.*
                 │  (immutable)     │  call mirrored here
                 └──────────────────┘

                          ▲
                          │ recall(query, stage, budget)
                          │ facts + citations
                 ┌────────┴─────────┐
                 │ Master           │
                 │ Orchestrator     │  only reader; injects per stage
                 └────────┬─────────┘
                          │ per-stage policy
                          ▼
                 ┌──────────────────┐
                 │  Stage sub-agents│  Dev · QA · Security · …
                 │  (read indirectly)│  never call Memory directly
                 └──────────────────┘
```

---

## 3. How to use

- **PDF / print review** — use the ASCII version with a fixed-width font (Menlo, Consolas, Courier New).
- **Confluence / Notion / GitHub** — the Mermaid block renders inline.
- **Slide deck** — extract the ASCII block, monospace it, drop into a 16:9 slide.
- **The diagram fits a one-page PDF** at standard A4/Letter with 10pt body text.
