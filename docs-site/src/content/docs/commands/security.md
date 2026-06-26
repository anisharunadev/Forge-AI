---
draft: false
title: Security Commands
description: The 5 security commands — scan, sbom, policy-check, incident, audit-export.
---

The security category has 5 commands that produce and consume Security Report typed artifacts.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-sec-scan` | admin | yes | Run SAST/SCA scanners |
| `forge-sec-sbom` | admin | yes | Generate or refresh an SBOM |
| `forge-sec-policy-check` | admin | yes | Evaluate tenant policy against the repo |
| `forge-sec-incident` | system | yes | Open a security incident record |
| `forge-sec-audit-export` | admin | yes | Export a tenant-scoped audit bundle |

## What is this category for?

Security is one of the three **mandatory approval gates** (R3). Every security command produces a Security Report typed artifact and pauses at the gate before any downstream action.

## How to use

### Scan (admin, requires approval)

```bash
pnpm forge:exec forge-sec-scan \
  --args '{"repo_id":"acme-api","scanners":["sast","sca","secrets"],"severity_floor":"high"}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

Runs SAST (Semgrep default), SCA (Trivy default), and secrets scanning. `severity_floor` filters findings below the threshold.

### SBOM (admin, requires approval)

```bash
pnpm forge:exec forge-sec-sbom \
  --args '{"repo_id":"acme-api","format":"cyclonedx","sign":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

Generates a CycloneDX SBOM. `sign=true` adds a Sigstore signature for downstream verification.

### Policy check (admin, requires approval)

```bash
pnpm forge:exec forge-sec-policy-check \
  --args '{"repo_id":"acme-api","policy_set":"soc2-v1"}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

Evaluates the named policy set against the repo. Policy sets are versioned and tenant-scoped (e.g., `soc2-v1`, `hipaa-v1`, `pci-dss-v1`).

### Incident (system, requires approval)

```bash
pnpm forge:exec forge-sec-incident \
  --args '{"severity":"sev1","title":"Leaked API key in public repo","description":"..."}' \
  --tenant-id acme-corp --project-id acme-api --user-id system
```

Opens a security incident record. The command is invoked by system actors (alerting, automated detection) and pauses for human approval before triggering response workflows.

### Audit export (admin, requires approval)

```bash
pnpm forge:exec forge-sec-audit-export \
  --args '{"window":"30d","format":"signed-bundle"}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

Exports a tenant-scoped audit bundle — the `audit_log` rows for the window, plus a manifest and a signature. The bundle is what you hand to an external auditor.

## Output

- `forge-sec-scan` → Security Report (typed artifact)
- `forge-sec-sbom` → SBOM document (CycloneDX or SPDX)
- `forge-sec-policy-check` → Policy Check Report
- `forge-sec-incident` → Incident Record
- `forge-sec-audit-export` → Signed audit bundle

## When to use

| Scenario | Command |
|---|---|
| Pre-merge security gate | `forge-sec-scan` (admin) |
| Quarterly compliance | `forge-sec-sbom` (admin) |
| New repo onboarding | `forge-sec-policy-check` (admin) |
| Detected breach | `forge-sec-incident` (system) |
| External audit | `forge-sec-audit-export` (admin) |

## Approval gate

Every security command requires approval. The Security Report typed artifact cannot be marked `final` by an agent — only by an authorized human (Steward or Security Reviewer role).

## Related

- [Auditability](/concepts/auditability/)
- [Approval gates](/concepts/approval-gates/)
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
