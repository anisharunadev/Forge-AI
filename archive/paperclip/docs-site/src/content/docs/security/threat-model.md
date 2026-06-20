---
title: Threat model
description: STRIDE per service, the OWASP Top 10 for LLM (LLM01–LLM10), and the LLM-agent-specific controls.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

The full threat model for Forge AI. The bar is [`memory/security.md` §1](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md). Every service has a one-paragraph threat model + a STRIDE table.

## The one-paragraph threat model

> A malicious prompt injection tries to coerce the agent into a tool call outside its allow-list, exfiltrate a secret, or escalate scope to another tenant. The agent runtime defends by plan-then-act, tool output sanitisation, an egress proxy, per-tenant isolation, budget ceilings, and a regression safety eval set.

The rest of this section defends the model.

## STRIDE per service

### Agent runtime

| Category | Threat | Control |
| --- | --- | --- |
| **Spoofing** | Forged agent identity | Short-lived JWT (≤ 15 min), rotated on stage transition; signed with KMS |
| **Tampering** | Tool output modified in transit | Tool output wrapped in `<tool_output source="...">`; egress proxy logs every call |
| **Repudiation** | Agent denies a tool call | Every call is captured in the audit log (append-only, cross-account) |
| **Information disclosure** | Cross-tenant data leak | Per-tenant namespaces; RLS on every table; MCP router refuses cross-tenant |
| **Denial of service** | Runaway LLM cost | Per-run cost ceiling ($50 hard stop); token budget |
| **Elevation of privilege** | Tool call outside allow-list | Plan-then-act; runtime validates plan against allow-list |

### MCP server

| Category | Threat | Control |
| --- | --- | --- |
| **Spoofing** | Forged MCP token | Per-tenant OAuth 2.0 or GitHub App; token scoped to one tenant |
| **Tampering** | Tool response tampered | TLS to the tool's API; response SHA captured in audit log |
| **Repudiation** | MCP denies a call | Every call captured in audit log |
| **Information disclosure** | Cross-tenant tool call | MCP router refuses; per-tenant namespace; per-tenant auth |
| **Denial of service** | MCP server overload | Per-tenant RPS limits; circuit breaker (5 fails, 30 s cooldown) |
| **Elevation of privilege** | Tool call outside scope | Per-tool allow-list; per-tenant scope; IAM role with `ExternalId` |

### Audit account

| Category | Threat | Control |
| --- | --- | --- |
| **Tampering** | Audit row modified | S3 object lock (compliance mode); 365-day retention |
| **Repudiation** | Audit row deleted | Object lock prevents deletion; one-way write from platform account |
| **Information disclosure** | Forge AI reads the audit log | Forge AI's IAM role is write-only to SQS; cannot read from S3 |

## The OWASP Top 10 for LLM (2025)

| ID | Threat | Control |
| --- | --- | --- |
| **LLM01** | Prompt injection | Plan-then-act; tool output sanitisation; allow-list; human-in-the-loop on sensitive tools |
| **LLM02** | Insecure output handling | Egress proxy; output URL allow-list; deny private CIDRs |
| **LLM03** | Training data poisoning | We don't fine-tune; we use off-the-shelf models |
| **LLM04** | Model DoS | Per-run cost ceiling; token budget; rate limiting |
| **LLM05** | Supply chain | Model provider rotation (Anthropic primary, OpenAI backup); safety evals on every release |
| **LLM06** | Sensitive information disclosure | Per-tenant isolation; secrets never in prompts; PII marker in DB schema |
| **LLM07** | Insecure plugin design | MCP server allow-list; per-tenant auth; per-tenant RPS limits |
| **LLM08** | Excessive agency | Allow-list; budget ceilings; human-in-the-loop; no `subprocess`, no `eval`, no shell |
| **LLM09** | Over-reliance | QA + eval gates; human approval on every stage |
| **LLM10** | Model theft | Per-tenant model routing; BYOK in v1.1; egress proxy logs all model calls |

## The LLM-agent-specific controls

Per [`memory/security.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md):

- **Plan-then-act** — the agent emits a plan; the runtime validates against the allow-list; only then are tools called.
- **Tool output sanitisation** — tool results are wrapped in `<tool_output source="...">` and passed back as data, not instructions.
- **Allow-list per agent** — the default is empty; tools are added per-stage.
- **Budget ceilings** — per-run token and dollar caps; the run halts when hit.
- **Human-in-the-loop** — every stage gate is a human approval.
- **Safety evals** — LLM01–LLM10 covered by a regression eval set that gates every release.
- **Egress proxy** — the only path to the public internet; denies private CIDRs; logs every call.
- **Per-tenant isolation** — physical, not aspirational.

## The safety eval set

Lives in `packages/evals/cases/safety/`:

```
packages/evals/cases/safety/
├── prompt-injection/       # LLM01
├── exfiltration/           # LLM02-LLM05
├── scope-escalation/       # LLM06-LLM08
├── pii-leakage/            # LLM09
└── over-refusal/           # LLM10
```

A safety eval regression > 0% **blocks the release**.

## Where to next

- **[Identity & access →](/security/iam/)** — customer SSO, RBAC, agent identity.
- **[Secrets →](/security/secrets/)** — Secrets Manager + Doppler.
- **[Compliance →](/security/compliance/)** — SOC 2 / ISO 27001.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> §1–§6</dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
