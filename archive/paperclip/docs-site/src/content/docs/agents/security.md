---
title: Security
description: The Security agent — the fifth stage. OWASP scan, safety evals, threat-model checks.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

The **Security agent** is the fifth stage. It wakes when QA passes and produces the **threat model check**, the **OWASP scan**, and the **safety eval results**.

## What it reads

- The PR diff + ADR from earlier stages.
- The existing threat models in `docs/threat-models/`.
- The OWASP ASVS controls in `workspace/memory/security.md` §6.
- The OWASP Top 10 for LLM Applications (LLM01–LLM10).

## What it produces

| Artefact | Storage |
| --- | --- |
| Threat model check | `docs/threat-models/<service>.md` (updated) |
| OWASP ASVS report | `docs/security/asvs-<release>.md` |
| Safety eval report | `docs/security/safety-<release>.md` |
| Findings | Jira (linked to the PR / Epic) |

## The OWASP ASVS bar

Per [`customer/standards.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md):

- **Level 2** self-attested for every public-facing API, refreshed at every major release.
- **Level 3** score for the agent runtime, refreshed at every minor release.

A new public API without a Level 2 score is a P1 customer trust issue.

## The OWASP Top 10 for LLM (2025)

The Security agent runs the safety eval set on every PR (capability) and weekly (safety). The set covers LLM01–LLM10:

| ID | Threat | Control |
| --- | --- | --- |
| **LLM01** | Prompt injection | Plan-then-act; tool output sanitisation; allow-list |
| **LLM02–05** | Insecure output handling / exfiltration | Egress proxy; tool output wrapping; deny private CIDRs |
| **LLM06–08** | Excessive agency / scope escalation | Allow-list; budget ceilings; human-in-the-loop |
| **LLM09** | Misinformation / PII leakage | Eval set; safety regression gate |
| **LLM10** | Model theft | Per-tenant model routing; BYOK in v1.1 |

A safety eval regression > 0% blocks the release.

## Vulnerability SLAs

| Severity | SLA to fix |
| --- | --- |
| **P0** | 24 h |
| **P1** | 7 d |
| **P2** | 30 d |
| **P3** | next quarter |

A P0 for a customer is a P0 for Forge AI. The Security agent escalates a P0 to on-call within 15 minutes.

## When it fails

| Failure | Behaviour |
| --- | --- |
| ASVS Level 2 score drops | Open a ticket; CTO reviews |
| Safety eval regression | **Block the release** |
| New high/critical finding | Open a bug; severity ≥ high **blocks the merge** |
| Threat-model check fails | Open a ticket; return to Architect stage |

## Where to next

- **[QA →](/agents/qa/)** — the previous stage.
- **[DevOps →](/agents/devops/)** — the next stage.
- **[Security overview →](/security/)** — the threat model, IAM, secrets, compliance.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> + <code>workspace/customer/standards.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
