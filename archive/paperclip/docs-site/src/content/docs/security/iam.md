---
title: Identity & access
description: Customer SSO, RBAC, agent identity, cross-account IAM.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/security.md
generator: readme
approval_required: false
---

The **identity & access** pillar of the Forge AI security posture. The bar is [`memory/security.md` §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md).

## Customer SSO

Customers authenticate to the Forge console via **OIDC** or **SAML 2.0**. Forge AI does **not** store customer passwords.

| Provider | Flow | Setup |
| --- | --- | --- |
| **Okta** | OIDC | <https://developer.okta.com/docs/guides/oidc-client/> |
| **Google Workspace** | OIDC | <https://support.google.com/cloud/answer/6158849> |
| **Azure AD** | OIDC or SAML 2.0 | <https://learn.microsoft.com/azure/active-directory/> |
| **JumpCloud** | OIDC or SAML 2.0 | <https://jumpcloud.com/support/sso-with-oidc> |
| **Generic** | OIDC or SAML 2.0 | Bring your own IdP; configure the OIDC issuer URL + client ID + secret |

The Forge console uses **NextAuth.js** (Auth.js) for the OIDC client.

## MFA

**MFA is required for every Forge AI staff account and every customer admin.** WebAuthn (security key, Touch ID, Windows Hello) is preferred; TOTP is acceptable. **SMS MFA is forbidden.**

## RBAC

Forge AI uses **custom RBAC** (in the platform DB). The off-the-shelf options (Auth0, Clerk) are not flexible enough for our stage-gate enforcement.

| Role | Permissions |
| --- | --- |
| **Owner** | All |
| **Admin** | Tenant config, MCP connections, audit access |
| **CTO** | All stage approvals, audit access, cost dashboard |
| **Engineering Lead** | Architect, Dev, DevOps stage approvals; read QA, Security |
| **Product Manager** | Ideation stage approval; read Dev, QA, Security, DevOps |
| **Engineer** | Dev stage approval (own PRs); read all |
| **Auditor** | Read audit log; read runs; read Confluence pages |

Roles are per-tenant and per-project. A user can be a CTO in one tenant and an Engineer in another.

## Agent identity

Every agent (sub-agent, MCP server, orchestrator) has a **short-lived JWT (≤ 15 min)**, scoped to:

- A tenant
- A run
- An allow-list of tools
- A budget

The token is signed with KMS and rotated on every stage transition. A leaked token expires in ≤ 15 min.

```json
{
  "sub": "agent:developer",
  "tenant_id": "acme-corp",
  "run_id": "01HXYZ...",
  "allow_list": ["github.*", "jira.*", "knowledge.read"],
  "budget_usd": 5.00,
  "iat": 1718400000,
  "exp": 1718400900
}
```

## Cross-account IAM

The audit account is trust-bound to the platform account:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::123456789012:role/fora-audit-shipper" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "sts:ExternalId": "fora-audit-shipper-<env>" }
    }
  }]
}
```

The `ExternalId` is per-environment and prevents the "confused deputy" attack. The platform account's role can **only** write to the audit SQS; it cannot read from the audit S3.

## Cloud providers

| Provider | Status | Notes |
| --- | --- | --- |
| **AWS** | <span class="badge done">shipped</span> | Default. EKS + RDS + ElastiCache + S3 + KMS + Secrets Manager |
| **Azure** | <span class="badge alpha">roadmap</span> | Q2 2027. AKS + Azure Database for Postgres + Azure Cache + Blob Storage + Key Vault |
| **GCP** | <span class="badge alpha">roadmap</span> | Q2 2027. GKE + Cloud SQL + Memorystore + GCS + Cloud KMS |

A customer on Azure or GCP must run a multi-cloud pattern: the orchestrator on Azure/GCP, the audit account still on AWS (for the immutable S3 + object lock).

## Where to next

- **[Secrets →](/security/secrets/)** — Secrets Manager + Doppler.
- **[Multi-tenancy →](/architecture/multi-tenancy/)** — how isolation works.
- **[Compliance →](/security/compliance/)** — SOC 2 / ISO 27001.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/security.md</code> §4 + <code>workspace/customer/standards.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
