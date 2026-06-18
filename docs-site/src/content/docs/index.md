---
title: Forge AI — The Enterprise-Grade SDLC Agent
description: Forge AI is the enterprise-grade SDLC agent from Knackforge. One platform that takes a product idea from a Slack message to a deployed, documented, audited change.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/PRD.md
generator: readme
approval_required: false
template: splash
hero:
  title: Forge AI — The Enterprise-Grade SDLC Agent
  tagline: From a Slack message to a deployed, documented, audited change. One platform. Audited end-to-end. Built for enterprise engineering.
  actions:
    - text: Quickstart
      link: /quickstart/
      icon: right-arrow
      variant: primary
    - text: Self-host guide
      link: /self-host/
      icon: external
      variant: secondary
    - text: View on GitHub
      link: https://github.com/forge-ai/forge
      icon: github
      variant: minimal
---

<div class="forge-hero">
  <h1>The Enterprise-Grade SDLC Agent</h1>
  <p>
    <strong>Forge AI</strong> is the enterprise-grade SDLC agent from <strong>Knackforge</strong>. It takes a product idea from a one-line prompt to a deployed,
    documented, audited change in your SDLC. It runs on top of Paperclip (the agent runtime)
    and a staged workflow, and orchestrates the tools your engineering org already uses —
    Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack — without replacing them.
  </p>
  <div class="cta-row">
    <a class="primary" href="/quickstart/">Get started →</a>
    <a class="secondary" href="/what-is-fora/">What is Forge AI?</a>
    <a class="secondary" href="/self-host/aws/">Self-host on AWS</a>
  </div>
</div>

## Why Forge AI?

You don't get a new tool to log into. You get a **team of sub-agents** that work the way a founding engineering team would: one PRD, one ADR, one PR, one deploy, one Confluence page, **one audit row per action**.

## Key features

<div class="forge-features">
  <div class="forge-feature">
    <h3>🔄 Staged workflow with real gates</h3>
    <p>Ideation → Architect → Dev → QA → Security → DevOps → Docs. The next stage doesn't start until the current one is approved. Not a Jira status — an enforced gate.</p>
  </div>
  <div class="forge-feature">
    <h3>🧠 Knowledge Layer as source of truth</h3>
    <p>A cold-started agent, woken with only the right files in context, can do its job. Every fact has one home. Tribal knowledge never lives in prompts.</p>
  </div>
  <div class="forge-feature">
    <h3>📋 Audit-log complete by default</h3>
    <p>Every tool call, every secret read, every config change is logged. Append-only, cross-account, queryable by <code>tenant_id</code>, <code>run_id</code>, <code>stage</code>, <code>tool</code>, <code>actor</code>.</p>
  </div>
  <div class="forge-feature">
    <h3>🔌 MCP-native integrations</h3>
    <p>Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack — all served from per-tenant MCP namespaces. Add your own in TypeScript or Python.</p>
  </div>
  <div class="forge-feature">
    <h3>🛡️ Tenant isolation, physical not aspirational</h3>
    <p>Sub-agents in separate processes. MCP servers behind per-tenant proxies. DB, secrets, audit log in separate accounts. No silent crossing.</p>
  </div>
  <div class="forge-feature">
    <h3>💸 Cost transparency per run</h3>
    <p>Tokens in, tokens out, dollars spent — every stage reports them. Hard ceilings per run stop overruns before they happen.</p>
  </div>
  <div class="forge-feature">
    <h3>🧬 Model-agnostic</h3>
    <p>Default is Anthropic Claude (Opus 4.8 / Sonnet 4.6 / Haiku 4.5), OpenAI is the backup. Customers can pin per-tenant providers in v1.1.</p>
  </div>
  <div class="forge-feature">
    <h3>📦 Open standards, not lock-in</h3>
    <p>MCP for tools, OpenTelemetry for traces, JSON Schema for contracts, OpenAPI for the public surface, Conventional Commits for history.</p>
  </div>
</div>

## The staged workflow

<div class="stage-pipeline">
  <span class="stage">Ideation</span>
  <span class="arrow">→</span>
  <span class="stage">Architect</span>
  <span class="arrow">→</span>
  <span class="stage">Dev</span>
  <span class="arrow">→</span>
  <span class="stage">QA</span>
  <span class="arrow">→</span>
  <span class="stage">Security</span>
  <span class="arrow">→</span>
  <span class="stage">DevOps</span>
  <span class="arrow">→</span>
  <span class="stage">Docs</span>
</div>

Each stage has an **owner**, a **gate**, a **budget**, and a **log line**. See the [Architecture → Staged workflow](/architecture/staged-workflow/) page for the full contract.

## Where to next

<div class="forge-features">
  <div class="forge-feature">
    <h3>🚀 Quickstart</h3>
    <p>Run Forge AI in dev mode in under 5 minutes. <a href="/quickstart/">Get started →</a></p>
  </div>
  <div class="forge-feature">
    <h3>🛠️ Install / Self-host</h3>
    <p>Prereqs, dev setup, production deploy, AWS reference architecture. <a href="/installation/">Read the install guide →</a></p>
  </div>
  <div class="forge-feature">
    <h3>🤖 Agents</h3>
    <p>Meet the team: BA, Architect, Developer, QA, Security, DevOps, Documentation, Memory. <a href="/agents/">Browse agents →</a></p>
  </div>
  <div class="forge-feature">
    <h3>🏗️ Architecture</h3>
    <p>The Knowledge Layer, multi-tenancy, audit log, staged workflow. <a href="/architecture/">See the architecture →</a></p>
  </div>
</div>

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/PRD.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
