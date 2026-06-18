---
title: Security overview
description: The Forge AI security posture — threat model, IAM, secrets, compliance.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

The Forge AI security posture is built on four pillars: the **threat model**, **identity & access**, **secrets**, and **compliance**. The full security bar lives in [`workspace/memory/security.md`](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).

## The one-paragraph threat model

A malicious prompt injection tries to coerce the agent into a tool call outside its allow-list, exfiltrate a secret, or escalate scope to another tenant. The agent runtime defends by:

1. **Plan-then-act** — the agent emits a structured plan; the runtime validates against the allow-list; only then are tools called.
2. **Tool output sanitisation** — tool results are wrapped in `<tool_output source="...">` and passed back to the model as data, not instructions.
3. **Egress proxy** — the only path to the public internet; denies private CIDRs, resolves DNS itself, logs every outbound call.
4. **Per-tenant isolation** — physical, not aspirational. Sub-agents in separate processes; MCP servers behind per-tenant proxies; DB, secrets, audit log in separate accounts.
5. **Budget ceilings** — per-run token and dollar caps; the run halts when hit.
6. **Safety evals** — LLM01–LLM10 covered by a regression eval set that gates every release.

The rest of this section defends the model.

## The four pillars

| Pillar | What it covers | Where to read |
| --- | --- | --- |
| **[Threat model](/security/threat-model/)** | STRIDE per service; the OWASP Top 10 for LLM (LLM01–LLM10); the LLM-agent-specific controls | [memory/security.md §1–§6](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md) |
| **[Identity & access](/security/iam/)** | Customer SSO, RBAC, agent identity, cross-account IAM | [memory/security.md §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md) |
| **[Secrets](/security/secrets/)** | AWS Secrets Manager, Doppler, per-tenant scoping, rotation, audit | [memory/security.md §3](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md) |
| **[Compliance](/security/compliance/)** | SOC 2, ISO 27001, OWASP ASVS, NIST SSDF, WCAG, GDPR | [customer/standards.md §2–§8](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md) |

## The OWASP Top 10 for LLM (2025)

| ID | Threat | Control |
| --- | --- | --- |
| **LLM01** | Prompt injection | Plan-then-act; tool output sanitisation; allow-list |
| **LLM02–05** | Insecure output handling / exfiltration | Egress proxy; tool output wrapping; deny private CIDRs |
| **LLM06–08** | Excessive agency / scope escalation | Allow-list; budget ceilings; human-in-the-loop |
| **LLM09** | Misinformation / PII leakage | Eval set; safety regression gate |
| **LLM10** | Model theft | Per-tenant model routing; BYOK in v1.1 |

The full coverage matrix is at [`memory/security.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).

## The compliance posture

Inherited defaults, audited floor (per [`customer/standards.md`](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md)):

- ✅ **SOC 2 Type I** — ready (Type II window opens Q1 2027)
- ✅ **ISO 27001** — kickoff Q1 2027
- ✅ **OWASP ASVS 4.0** — self-attested Level 2 for the public API
- ✅ **NIST SSDF (SP 800-218)** — staged workflow + threat models + SBOMs
- ✅ **WCAG 2.2 AA** — Forge console is AA-conformant (axe-core in CI)

Roadmap: **SOC 2 Type II** Q1 2027, **HIPAA / FedRAMP** gated on having a federal design partner.

## Where to next

- **[Threat model →](/security/threat-model/)** — STRIDE per service + LLM01–LLM10
- **[Identity & access →](/security/iam/)** — customer SSO, RBAC, agent identity
- **[Secrets →](/security/secrets/)** — Secrets Manager + Doppler
- **[Compliance →](/security/compliance/)** — SOC 2 / ISO 27001 / OWASP

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> + <code>workspace/customer/standards.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
