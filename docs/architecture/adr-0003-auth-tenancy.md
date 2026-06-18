# ADR-0003: Authentication, Tenancy, and IAM Boundary for the Forge AI Platform

| Field             | Value |
|-------------------|-------|
| **Status**        | **Proposed** |
| **Proposed**      | 2026-06-17 |
| **Accepted**      | _pending CEO sign-off_ |
| **Author**        | CTO ([f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0](/FORA/agents/cto)) |
| **Reviewer**      | CEO + (future) Security Engineer |
| **Issue**         | [FORA-38](/FORA/issues/FORA-38) — 0.7 Authentication & tenancy |
| **Parent**        | [FORA-16](/FORA/issues/FORA-16) — Epic 0; [ADR-0001](/FORA/issues/FORA-2) |
| **Supersedes**    | none |
| **Superseded by** | none |

---

## 1. Context

The platform serves three populations whose credentials, scopes, and trust boundaries are *not* the same:

| Population        | Who they are                              | What they can do                          | How they authenticate |
|-------------------|-------------------------------------------|-------------------------------------------|-----------------------|
| **Board users**   | Customer humans (PMs, eng leads, board)   | Read their tenant's data, approve gates   | Corporate IdP via OIDC |
| **Sub-agents**    | FORA-owned agents (BA, Dev, Security, …)  | Operate inside the tenant they were bound to | Short-lived FORA-issued agent tokens |
| **Cloud operators** | Customer-cloud subjects (AWS / Azure / GCP) | Deploy / read customer infra | Short-lived cloud-native tokens (STS, MSAL, OIDC federation) |

[ADR-0001 §2](/FORA/issues/FORA-2) calls for "a typed handoff contract" between sub-agents. The hand-off cannot be type-safe until **identity and tenancy are type-safe**: every tool call, every memory read, every MCP request must carry an unforgeable `(agent_id, tenant_id, role, scopes, trace_id)` envelope. ADR-0001 §5 stages forbid the Security agent from sharing context with the Developer agent — that constraint is meaningless without an IAM boundary that *enforces* separation at the tool layer.

Without a single ADR that names the trust boundaries, the platform accumulates implicit policy in code, prompts, and prompt engineering — exactly the failure mode the CEO's Pillar 1 document calls out.

This ADR is the spine. Five sub-decisions are scoped as one-way doors and need their own ADR once we hire the auth-engineer; they are listed in §10.

## 2. Decision

We adopt a **brokered, claim-based identity model** with **Postgres row-level security (RLS) + object-prefix tenancy** at the data layer, and **a short-lived-token cloud broker** for customer clouds. Concretely:

1. **One identity broker, three principals.** A single `identity-broker` service terminates OIDC for board users, mints agent tokens for FORA sub-agents, and brokers short-lived cloud tokens for the customer cloud. There is exactly one place to audit, rate-limit, and revoke.
2. **Tenancy is a first-class claim** (`tenant_id`) in every authenticated envelope, enforced at the data layer by Postgres RLS for relational data and by a verified prefix (`tenants/{tenant_id}/…`) for object storage, queues, and search indexes. No code path can read or write across tenants without the broker re-issuing a claim.
3. **Agent IAM is deny-by-default and per-role.** Every sub-agent role has a static role-binding that names the *exact* MCPs and tool calls it can invoke. New tools default to `unbound` and require an explicit grant in the tenant policy.
4. **Customer cloud creds are never persistent in Forge memory.** All customer-cloud work is brokered: the agent requests a scoped action, the broker assumes the customer role, performs the action, and returns only the response. Credentials never enter the agent's prompt, memory, or audit detail payload (only the *fact* that an action was brokered is audited).
5. **Secrets resolve at call time, from a tenant-scoped secret manager.** Agent prompts, memory, and code never see raw secret values. A `secrets-mcp` returns references (ARNs, secret IDs); the broker materialises the value at the last hop, then the value is dropped.
6. **Audit is non-negotiable.** Every identity event, scope grant, tenant denial, and secret resolution lands in the append-only audit log (FORA-36, 0.5) with `(actor, tenant, action, scopes_used, outcome, trace_id)`.

### 2.1 One-line summary

> "Three principals, one broker, claim-based tenancy enforced at the data layer, deny-by-default agent IAM, no customer creds in memory, secrets at call time."

## 3. The identity broker

### 3.1 Why a broker (not direct IdP trust)

Direct OIDC trust from every MCP to Okta/Azure/Google is the anti-pattern. It makes revocation a multi-system problem, gives every MCP the user's refresh token, and forces every MCP to re-implement OIDC. The broker is a *thin* trusted service:

- **Single OIDC surface.** One OIDC client per upstream IdP, one JWKS endpoint, one session table. Adding a fourth IdP is a config change, not a code change.
- **Single audit source.** Every login, every token mint, every scope grant flows through the broker → one query surface for security review.
- **Token shape is FORA's, not the IdP's.** The IdP token is exchanged for a FORA-issued access token whose claims we control (`tenant_id`, `roles`, `scopes`, `aud`, `trace_id`).
- **Token binding.** Tokens are bound to the requesting agent's ephemeral key (DPoP / sender-constrained) so a leaked JWT cannot be replayed from a different host.

### 3.2 Token shape (claim set)

```jsonc
{
  "iss": "identity-broker.fora.local",
  "sub": "user:<okta-user-id>" | "agent:<agent-type>:<run-id>",
  "aud": "forge-runtime",
  "tenant_id": "tnt_8XQ…",          // first-class, mandatory
  "principal": "board_user" | "agent" | "cloud_operator",
  "roles": ["developer"],            // role names mapped to MCP scopes
  "scopes": ["mcp:github:read", "mcp:atlassian:read"],
  "trace_id": "01HXYZ…",            // links to the run + audit record
  "iat": 1718610000,
  "exp": 1718610900,                 // ≤15 min for board users, ≤5 min for agents
  "jti": "<unique>"                  // one-shot
}
```

**Why short-lived:** a 15-minute access token is the ceiling at which revocation lag becomes user-visible pain. Agents get 5 minutes because agent action is fast and they re-mint per stage.

### 3.3 IdP coverage in v1

| IdP                | Library / library version target | Notes |
|--------------------|----------------------------------|-------|
| **Okta**           | `openid-client` ≥ 6.x            | Primary; most customer tenants on it |
| **Azure AD / Entra** | `openid-client` ≥ 6.x (MSAL endpoint as OIDC) | Same library, MS discovery URL |
| **Google Workspace** | `openid-client` ≥ 6.x          | One IdP, simpler claim shape, easier tests |
| Auth0 / Ping / generic OIDC | `openid-client` ≥ 6.x       | Future: same OIDC code path, different issuer URL |

`openid-client` is the chosen abstraction; **adding a fourth IdP is config, not code.** If we ever need SAML for legacy IdPs, that is its own ADR.

### 3.4 Session lifecycle

1. Board user lands on `https://app.fora.example/auth/login?tenant=acme`.
2. Broker redirects to the tenant's IdP (discovered from a per-tenant config table keyed by `tenant_id`).
3. IdP returns the OIDC `id_token` + `code`. Broker verifies, looks up or provisions the `board_user` row, evaluates tenant policy (does this user have a seat? what role?), and issues a FORA-issued session cookie + access token.
4. UI presents the user's tenant. Every API call carries the FORA access token, never the IdP token.

## 4. Tenancy: a first-class claim enforced at the data layer

### 4.1 Two enforcement layers, one principle

| Layer                  | Mechanism                                                                 | Why this layer                                |
|------------------------|---------------------------------------------------------------------------|-----------------------------------------------|
| **Relational (Postgres)** | Row-Level Security (RLS) keyed on `current_setting('app.tenant_id')`  | Atomic with the query, no app-side bug possible |
| **Object / queue / search** | Verified object key prefix `tenants/{tenant_id}/…`; broker signs the prefix into the request envelope | S3 / GCS / SQS / OpenSearch have no RLS — the key *is* the boundary |
| **In-process caches**   | Tenant tag on every cache key; broker rejects cross-tenant cache reads | Otherwise RLS can be bypassed via a warm cache |
| **LLM context**         | The Knowledge Layer is *materialised* per tenant at load time (see [FORA-103 0.8](/FORA/issues/FORA-103)); a board user in tenant A cannot pull from tenant B's `customer/` files | The model is the softest layer — see §4.4 |

### 4.2 Postgres RLS — the contract

Every multi-tenant table carries a `tenant_id uuid not null` column. Every read/write goes through a *connection pool that always sets* `SET LOCAL app.tenant_id = '<jwt.tenant_id>'`. RLS policies look like:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

**No exception path.** A `BYPASSRLS` role exists, but it is held *only* by the migration runner and the audit-log writer. The application roles are `NOBYPASSRLS`. Acceptance criterion: a developer cannot write a query that reads across tenants, even by accident.

### 4.3 Object prefix tenancy

The customer-cloud broker refuses to read or write any object key that does not match the prefix derived from the claim. The prefix check is signed into the request envelope; an agent cannot forge it.

```
tenants/{tenant_id}/workspace/...
tenants/{tenant_id}/artifacts/...
tenants/{tenant_id}/audit/...
```

### 4.4 The LLM is the soft layer

LLM context windows cannot be partitioned by tenant. The defence is upstream of the model: the Knowledge Layer is materialised per tenant ([FORA-103 0.8](/FORA/issues/FORA-103)) and the prompt assembler only loads files from the *current* tenant. We treat LLM-internal cross-tenant leakage as a *defence-in-depth* problem: cost-attributable, audit-logged, and surfaced in the Evaluation agent (see §6.4 of ADR-0001).

### 4.5 Tenant identity = primary key, not attribute

`tenant_id` is a primary-key prefix, not a column we sometimes forget. Object keys, audit log records, cost records, run records — all carry `tenant_id` as the *leading* key. A query that forgets `tenant_id` is a bug, not a feature.

## 5. Agent IAM — deny-by-default, per-role

### 5.1 Role registry

Each sub-agent type has exactly one role; the role names a static set of MCPs and a static set of scopes:

```yaml
# config/agent-iam/roles.yaml
roles:
  ba-agent:
    mcps: [jira, zendesk, slack, confluence]
    scopes: [read]
  security-engineer:
    mcps: [github, sonarqube, secrets-mcp]
    scopes: [read, write:findings]
  deploy-agent:
    # Cannot call AWS MCP unless tenant policy grants it. See §6.
    mcps: [github, argo, customer-cloud-broker]
    scopes: [read, write:deploy-request]
  developer:
    mcps: [github, jira, secrets-mcp]
    scopes: [read, write:code]
```

**Default for any new MCP or new role:** unbound. The new MCP must be added to at least one role's `mcps:` list *and* the tenant policy must grant the role that MCP for the tenant. Either gate failing ⇒ the call is denied with `403 unbound_mcp`.

### 5.2 Tenant policy (the override surface)

A tenant can *narrow* the platform defaults but never widen them. Tenant policy lives in `tenants/{tenant_id}/policy.yaml`:

```yaml
# Acme's tenant policy — narrows the platform default
mcp_grants:
  developer:
    aws-deploy: true          # explicitly grant aws-deploy to developer
  ba-agent:
    slack: true
deny:
  - mcp:aws-billing           # nobody in Acme can read billing
```

The platform default is `deny`; tenant policy is a *positive* grant list. "Off by default" survives every accident and every prompt-injection attempt.

### 5.3 Tool-call envelope

Every MCP call is wrapped in a typed envelope that carries the claim set, the request, and the trace:

```ts
type ToolCall = {
  trace_id: string;
  tenant_id: string;          // from JWT, not from caller
  principal: 'board_user' | 'agent' | 'cloud_operator';
  agent_type: string;         // e.g. "developer"
  mcp: string;                // e.g. "github"
  action: string;             // e.g. "create_pr"
  args: unknown;              // schema-validated
  scopes_used: string[];      // asserted by caller, audited by broker
};
```

The broker verifies the claim, checks the role→MCP binding, checks the tenant policy grant, then forwards.

## 6. Customer-cloud IAM boundary

### 6.1 The non-negotiable rule

> **No customer-cloud credential may be stored in Forge memory, the LLM context, the agent prompt, the audit detail payload, or the log archive.**

The customer never grants Forge a long-lived key. Instead, the customer grants Forge an **OIDC federation trust** (AWS IAM Role with `WebIdentity` from the broker; Azure Workload Identity; GCP Workload Identity Federation). The broker then exchanges a FORA-issued token for a cloud-native short-lived token per action.

### 6.2 The broker's job, per agent action

```
1. Agent requests "deploy image X to ECS service Y in account Z"
2. Broker verifies (a) agent role, (b) tenant policy grants deploy-agent:ecs, (c) trace_id is live
3. Broker assumes the customer's pre-provisioned IAM role via OIDC federation → STS-style credentials, ≤15 min
4. Broker performs the action
5. Broker discards the cloud credentials
6. Broker logs the action (who, what, what scopes, what response code) to the audit log
7. Broker returns the response to the agent
```

The agent's prompt and memory never see the cloud creds. They only see the request and the response. The broker's audit entry is *the* record.

### 6.3 Why a broker, not a sidecar

- A sidecar per agent still has the credential crossing into the agent's process at some point. A broker is a *service* boundary.
- Centralised rate-limiting, per-tenant concurrency caps, and `deny-list` of dangerous actions (e.g. `iam:DeleteUser`) belong in one place.
- The broker can be paused / killed at the org level without touching agent code.

## 7. Secrets manager hook

### 7.1 The pattern

- **No secret in code, ever.** Lint rule, pre-commit `gitleaks`, CI secret-scan — all from [engineering standards §5](/FORA/docs/engineering/standards.md).
- **No secret in prompts, ever.** The agent never asks for "the GitHub token"; the broker resolves it.
- **Resolution at call time.** A `secrets-mcp` exposes `resolve(secret_ref)` which returns the secret value *only to the broker*, never to the agent.
- **Two references, not one.** Secrets have a stable `secret_ref` (e.g. `secrets/gh_pat`) and a versioned value. The agent references the `secret_ref`; the value is resolved at the broker.
- **Per-tenant scope.** `tenant_id` is part of the secret_ref. `secrets/gh_pat` in tenant A and `secrets/gh_pat` in tenant B resolve to different values. No accidental cross-tenant secret reuse.
- **Backing store.** A vault (HashiCorp Vault, AWS Secrets Manager, Doppler) is configurable per tenant. v1 ships with AWS Secrets Manager support; Vault is next.

### 7.2 What the agent sees

```text
agent → secrets-mcp: resolve(secret_ref="tenants/tnt_8XQ/secrets/gh_pat")
broker → vault: read(secret_ref, version=latest)
broker → agent: { redacted: true, value_len: 40, fingerprint: "ab12…" }
agent uses the value via the broker; never sees the raw value
```

For MCP calls that *need* a raw value (e.g. signing a Git commit), the broker performs the signing itself and returns the result; the agent never touches the PAT.

## 8. Cross-cutting concerns

### 8.1 Audit (handoff to [FORA-36 0.5](/FORA/issues/FORA-36))

Every event from the broker — login, token mint, scope grant, tenant denial, secret resolve, cloud-brokered action — is appended. Required fields: `actor`, `tenant_id`, `principal`, `action`, `scopes_used`, `decision`, `trace_id`, `timestamp`. The broker writes via a dedicated audit role that *does* have `BYPASSRLS` on the audit table only.

### 8.2 Cost (handoff to [FORA-75 0.6](/FORA/issues/FORA-75))

Every brokered action costs tokens (OIDC exchange, claim verification) and dollars (cloud API call). The Cost agent pulls from the audit log + broker metrics. The broker publishes a Prometheus `/metrics` surface with `broker_token_mint_total`, `broker_tenant_denial_total`, `broker_cloud_assume_total`, p99 latencies.

### 8.3 Evaluation (cross-cutting, ADR-0001 §3.3)

- Cross-tenant denial rate per agent type (target: zero, except for legit "user not in this tenant" cases)
- Time-to-revoke on a forced token revocation (target: <60s)
- Cloud-broker action error rate per role
- Secret-resolve cache hit rate (higher = cheaper, but bounded TTL)

## 9. Acceptance criteria (mapped to FORA-38 §Acceptance)

| FORA-38 criterion | How this ADR satisfies it |
|---|---|
| A board user signs in with their corporate IdP and lands in their tenant only. | §3 broker issues tenant-bound JWT; §4 RLS + prefix enforce isolation. |
| A sub-agent in tenant A cannot enumerate, read, or write data from tenant B even with a malformed/replayed request. | §4.2 RLS + §4.3 object prefix + §5.3 claim-bound envelope + DPoP (§3.2). |
| A coding agent cannot call the AWS deploy MCP unless the tenant policy explicitly grants it. | §5.2 deny-by-default + per-tenant policy grants. |
| All secrets resolve at call time from the secret manager; nothing is embedded in agent prompts or memory. | §7 resolution pattern + redacted value returned to agent. |

## 10. Sub-decisions (need their own ADR; blocked on auth-engineer hire)

| # | Sub-ADR                  | Owner            | One-way door? |
|---|--------------------------|------------------|---------------|
| 1 | OIDC broker schema & JWKS rotation | auth-engineer (hire) | yes — wire format is forever |
| 2 | Per-tenant policy DSL grammar | auth-engineer (hire) | yes — every tenant uses it |
| 3 | Cloud-broker OIDC federation playbook (AWS / Azure / GCP) | auth-engineer + DevOps (future) | yes — cloud trust is forever |
| 4 | Secret-manager backing store contract (AWS SM / Vault) | auth-engineer (hire) | partial — pluggable, but the interface is forever |
| 5 | Agent token binding mechanism (DPoP vs mTLS) | auth-engineer + Security (future) | yes — picks the wire protocol |

## 11. Out of scope (explicitly)

- **User-facing RBAC inside a tenant** — the BA/Architect/Dev role *inside* a tenant's board users. This is a future "tenant user-management" epic; here we only authorise the *platform* actors.
- **MFA policy and step-up auth** — IdP-side. We honour what the IdP returns.
- **Cross-tenant analytics** — explicitly impossible by construction (no aggregate query can bypass RLS).
- **Bring-your-own-IdP beyond OIDC** — SAML support is a separate ADR if/when a customer requires it.

## 12. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Broker becomes a single point of failure | Active-active multi-AZ; per-tenant rate-limit / circuit-breaker; cached JWKS | Broker is stateless; redeploy. Tenant isolation unaffected because RLS is data-layer. |
| RLS bypass via a forgotten `BYPASSRLS` role | Code review + lint rule that flags any `BYPASSRLS` outside `migrations/` and `audit/` | Revoke the role; existing sessions reconnect with `NOBYPASSRLS`. |
| OIDC IdP outage | Cached JWKS; broker can mint from cached claims for ≤5 min while a degraded read-only mode kicks in | Tenant is in read-only until IdP returns; UI surfaces a banner. |
| Customer cloud cred rotation drift | Broker issues a fresh cloud token per action; long-lived state is zero | Disable the customer-cloud-broker MCP; deploys stop but data-layer keeps working. |
| Secret-manager compromise | Short-lived resolved values; per-tenant blast radius; audit log of *every* read | Rotate the affected secret_ref; the old version can be revoked independently of new ones. |

## 13. Why this is one ADR, not five

The five FORA-38 deliverables (SSO, tenant namespace, agent IAM, cloud IAM boundary, secrets) are not independent: SSO is the entry point, the tenant claim is what SSO issues, agent IAM is the policy on the claim, the cloud broker and secrets MCP are both *consumers* of the claim. Splitting this into five ADRs would force the reader to chase a single coherent design across five files. The five sub-decisions in §10 are the *real* one-way doors and they each get their own ADR.

---

**CTO sign-off pending. Awaiting CEO review.**
