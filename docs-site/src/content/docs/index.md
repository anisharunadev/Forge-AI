---
title: Forge AI — Enterprise SDLC Agent Operating System
description: Orchestrate agents, knowledge, governance, and delivery workflows with Forge AI.
template: splash
---

<section class="hero-banner">
  <h1>The operating system for AI-driven software delivery</h1>
  <p>
    Forge AI orchestrates agents, knowledge, governance, and delivery workflows
    across every stage of the software development lifecycle. One platform.
    Thirteen command categories. Eight constitutional rules. Zero brand leakage.
  </p>
  <div class="cta-row">
    <a class="cta-primary" href="/start-here/quickstart/">
      Quickstart
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 5l7 7-7 7"/>
      </svg>
    </a>
    <a class="cta-secondary" href="/architecture/overview/">Architecture</a>
    <a class="cta-secondary" href="/commands/">Command reference</a>
  </div>
</section>

## Why Forge?

| If you have… | Forge gives you… |
|---|---|
| A single AI agent that hallucinates contracts and skips review | A typed-artifact pipeline with HITL gates at architecture, security, and deployment boundaries |
| Point tools that don't share context | A project intelligence knowledge graph that fuses repos, tickets, docs, and chat into one source of truth |
| A "do-it-yourself" stack of scripts and SaaS | 63 production-grade `forge-*` commands across 13 categories, audited end to end |

Forge is built on eight constitutional rules — model-provider agnostic, multi-tenant by default, mandatory human approval gates, typed artifacts only, layer isolation, mandatory auditability, mandatory observability, and configurable everything. Every feature is anchored to a numbered Architecture Decision Record (ADR).

## Quickstart

Three commands stand up a local Forge AI stack from a fresh checkout:

```bash
git clone <repo-url> forge-ai && cd forge-ai
cp .env.example .env && $EDITOR .env   # set ANTHROPIC_API_KEY
docker compose up -d                   # postgres, redis, localstack
pnpm forge:list                        # confirm 63 forge-* commands
```

Open `http://localhost:3000/forge-command-center` and run your first `forge-*` command. Full walkthrough in the [Quickstart](/start-here/quickstart/).

## What you get

<div class="feature-grid">

<div class="feature-card">
<h3>Project Intelligence</h3>
<p>Scan repos, deps, services, and secrets. Build a tenant-scoped knowledge graph that fuses code, tickets, and docs.</p>
</div>

<div class="feature-card">
<h3>Typed Artifacts</h3>
<p>Every workflow produces one of six typed artifacts: ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan.</p>
</div>

<div class="feature-card">
<h3>Approval Gates</h3>
<p>Architecture, security, and deployment boundaries pause for human review. The HITL gate is enforced by the orchestrator, not by convention.</p>
</div>

<div class="feature-card">
<h3>White-labeled Commands</h3>
<p>Every internal action is exposed as a <code>forge-&lt;area&gt;-&lt;verb&gt;</code> command. The implementation underneath is hidden — only the brand shows.</p>
</div>

<div class="feature-card">
<h3>Multi-Tenant by Default</h3>
<p>Row-level security on every table. Per-tenant KMS keys. Isolated audit log topology. No retro-fit required.</p>
</div>

<div class="feature-card">
<h3>Append-Only Audit</h3>
<p>Every action — agent, model, prompt, tool, cost, artifact, timestamp, result — lands in a tamper-evident ledger with daily hash chain anchors.</p>
</div>

<div class="feature-card">
<h3>Model-Provider Agnostic</h3>
<p>All LLM traffic flows through a single proxy with virtual keys, audit logs, and budget guardrails. Swap providers without code changes.</p>
</div>

<div class="feature-card">
<h3>Terminal in the Browser</h3>
<p>Native PTY stream lets you run Claude Code, Codex, or any CLI tool in a browser tab. Every byte is audited.</p>
</div>

<div class="feature-card">
<h3>Knowledge Reuse</h3>
<p>Capture lessons from sessions, summarize across the org, promote durable rules to the constitution.</p>
</div>

<div class="feature-card">
<h3>Connector Center</h3>
<p>Thirteen first-party connectors: GitHub, Jira, Confluence, Figma, Slack, AWS, SonarQube, Zendesk, ClickUp, Azure DevOps, Databricks, and more.</p>
</div>

<div class="feature-card">
<h3>Steward Governance</h3>
<p>Hybrid MDM with Steward-priority conflict resolution. When the knowledge graph disagrees with code, the Steward decides.</p>
</div>

<div class="feature-card">
<h3>OpenTelemetry Native</h3>
<p>Traces, metrics, and logs from day one. LiteLLM cost ledger plus per-tenant budget envelopes.</p>
</div>

</div>

## Architecture at a glance

```text
+----------------------------------------------------------------------------+
|                                  Browser                                   |
|         Next.js 15 + React 19 + xterm.js + React Flow + Shadcn UI          |
+------------------------------------+---------------------------------------+
                                     |           HTTPS / WebSocket           |
                                     |                   v                   |
+----------------------------------------------------------------------------+
|                            AWS Primary Account                             |
|                                                                            |
|+----------------------------------+    +----------------------------------+|
||           ECS Fargate            |    |        RDS PostgreSQL 17         ||
||  +----------------------------+  |    |  +------------+  +------------+  ||
||  |      FastAPI backend       |  |    |  | Apache AGE |  |  pgvector  |  ||
||  |- LangGraph SDLC            |  |    |  |  (graph)   |  | (vectors)  |  ||
||  |- Terminal Mgr              |  |    |  +------------+  +------------+  ||
||  |- forge commands            |  |    |  |   RLS +    |  | audit_log  |  ||
||  |- Knowledge graph           |  |    |  |            |  |            |  ||
||  +----------------------------+  |    |  +------------+  +------------+  ||
||                |                 |    |                                  ||
||                v                 |    |                                  ||
||                                  |    |  +----------------------------+  ||
||                                  |    |  |     ElastiCache Redis      |  ||
||                                  |    |  +----------------------------+  ||
||                |                 |    |                                  ||
||                                  |    |                v                 ||
||  +----------------------------+  |    |  +----------------------------+  ||
||  |        S3 + KMS CMK        |  |    |  |       LiteLLM Proxy        |  ||
||  +----------------------------+  |    |  |virtual keys + audit        |  ||
||  +----------------------------+  |    |  +----------------------------+  ||
+----------------------------------------------------------------------------+
                                     |                                       |
                                     |                   v                   |
+----------------------------------------------------------------------------+
|                  LLM Providers (model-provider agnostic)                   |
|      Anthropic | OpenAI | Bedrock | Vertex | Azure | OpenRouter | ...      |
+----------------------------------------------------------------------------+
```

The full architecture lives in the [Architecture overview](/architecture/overview/) and the eight locked ADRs in [Architecture → ADRs](/architecture/adr-001-aws/).

## Get involved

- [GitHub repository](https://github.com/forge-ai/forge-ai) — source, issues, PRs
- [Discussions](https://github.com/forge-ai/forge-ai/discussions) — design questions and proposals
- [Operations → Pilot program](/operations/pilot-overview/) — current pilot phase and KPIs
- [Reference → Glossary](/reference/glossary/) — terminology across Forge, the stack, and the constitutional rules
