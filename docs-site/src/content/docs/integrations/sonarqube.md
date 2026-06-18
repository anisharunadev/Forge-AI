---
title: SonarQube MCP
description: The SonarQube MCP server — token per tenant, R only. Scan trigger, findings, gate.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/sonarqube/
generator: readme
approval_required: false
---

The **SonarQube MCP server** is the fourth MCP integration. **We do not write to SonarQube** — the MCP server is read-only and uses SonarQube as a gate, not a target.

## Auth

- **Flow:** Token per tenant
- **Per-tenant:** yes
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/sonarqube-token`
- **Get a token:** Your SonarQube instance → Account → Security → Generate Token

### Bootstrap

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/sonarqube \
  --secret-string '{"url":"https://sonar.acme-corp.com","token":"sqp_..."}'
```

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `sonarqube.trigger_scan` | Trigger a scan on a branch | medium |
| `sonarqube.get_findings` | Fetch findings (by severity, file, etc.) | low |
| `sonarqube.get_quality_gate` | Fetch the quality-gate status | low |
| `sonarqube.wait_for_quality_gate` | Block until the gate passes/fails | low |

The MCP server does **not** write to SonarQube. It reads. The customer's CI pipeline runs the actual scan; Forge AI consumes the result.

## The QA + Security gate

The SonarQube quality gate is one of the inputs to the QA + Security stages:

- **Quality gate: passed** → QA stage passes
- **Quality gate: failed** → QA stage fails; return to Dev
- **New high/critical findings** → Security stage fails; severity ≥ high **blocks the merge**

A new high/critical finding opens a Jira bug linked to the PR.

## Where to next

- **[Confluence →](/integrations/confluence/)** — the previous MCP server.
- **[Figma →](/integrations/figma/)** — the next page.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/sonarqube/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
