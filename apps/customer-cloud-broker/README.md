# `@fora/customer-cloud-broker` (FORA-126 / 0.7.4)

Brokered OIDC federation to AWS / Azure / GCP / SonarQube. Implements
[ADR-0003 §6](../../docs/architecture/adr-0003-auth-tenancy.md).

The customer-cloud-broker is the **only** path through which a FORA
agent can act on a customer's AWS / Azure / GCP / SonarQube account.
The agent never sees the customer's cloud credentials; the broker
exchanges a FORA-issued token for a short-lived cloud-native token per
action, performs the action, and discards the credential.

## Why a broker, not a sidecar

A sidecar per agent still has the credential crossing into the agent's
process at some point. A broker is a *service* boundary:

- centralised rate-limiting, per-tenant concurrency caps, deny-list of
  dangerous actions (`iam:DeleteUser`, `iam:CreateAccessKey`, etc.),
- paused / killed at the org level without touching agent code,
- single audit producer for every brokered action.

## Pipeline

```
1. Validate envelope (ToolCall, principal=agent, mcp=customer-cloud-broker)
2. Look up tenant trust for the requested cloud. Refuse if missing or
   `cloud_disabled`.
3. Deny-list check. Refuse if the action matches. The federation
   token is *never* minted on a deny-list hit.
4. Adapter lookup. Refuse if no adapter is registered (e.g. Azure
   before FORA-126.2 lands).
5. Adapter `assume()` with the FORA-issued JWT.
6. Adapter `perform()` with the assumed credential.
7. Emit exactly one `cloud.brokered` audit event.
8. Update metrics.
9. Return the `BrokeredResult` to the caller.
```

## Service shape

- One Fastify service, separate from the identity-broker.
- Routes:
  - `POST /broker/action` — broker one ToolCall envelope.
  - `POST /broker/probe` — re-probe a tenant's cloud trust.
  - `GET /healthz`, `GET /readyz`, `GET /metrics`.
- Default port: `7100` (`FORA_CCB_LISTEN_PORT`).

## Files

```
apps/customer-cloud-broker/
  src/
    types.ts            # BrokeredRequest, BrokeredResult, CloudAdapter
    audit.ts            # cloud.brokered event factory + redaction guard
    deny-list.ts        # deny_list.yaml loader + matcher
    metrics.ts          # Prometheus exposition
    trust.ts            # tenant IAM trust onboarding + probe
    broker.ts           # core pipeline (brokerAction)
    adapters/
      aws.ts            # STS AssumeRoleWithWebIdentity (FORA-126.5 per-service dispatch)
      azure.ts          # stub (FORA-126.2)
      gcp.ts            # WIF + per-service dispatch (FORA-126.3)
      sonarqube.ts      # per-project user tokens (FORA-321 / FORA-290 Path B)
      index.ts          # adapter registry
    config.ts           # env-driven config
    server.ts           # Fastify server
    start.ts            # entrypoint
    index.ts            # public exports
  test/
    customer-cloud-broker.test.ts   # 5 acceptance bars
    memory-dump-scan.test.ts        # property test, credential-free
  docs/
    onboarding.md       # customer onboarding playbook
    onboarding-aws.md   # AWS runbook
  bin/
    fora-customer-cloud-broker.mjs
config/customer-cloud-broker/
  deny_list.yaml        # global deny-list (aws/azure/gcp)
  deny_list.schema.json # JSON Schema
tenants/acme/
  cloud_trust.yaml      # Acme's AWS trust onboarding (sample)
```

## Acceptance bars (FORA-126)

1. A `deploy-agent` action on a tenant whose trust is `active` succeeds
   and the audit event contains no credential material.
2. A `deploy-agent` action for a deny-listed cloud action is rejected
   with `403 deny_listed_action` and `response_code = deny_listed`.
3. A memory dump of the agent's process after a brokered action
   contains no AWS-shaped credential — verified by a property test.
4. A tenant whose trust is missing or wrong is in `cloud_disabled`
   state; subsequent actions are refused.
5. Killing the broker halts all cloud-brokered actions; the platform
   (data layer, identity-broker) keeps running.

## Follow-up children

- **FORA-126.2** — full Azure Workload Identity Federation adapter.
- **FORA-126.3** — full GCP Workload Identity Federation adapter.
- **FORA-126.4** — canary-assume phase of the trust probe (real STS).
- **FORA-126.5** — per-service AWS SDK dispatch (replaces v1 shim).
- **FORA-126.6** — `customer-cloud-broker` portal runbook for the
  Azure / GCP cloud pages.
- **FORA-321** — SonarQube adapter (per-project user tokens). Ships
  the broker-side credential layer for the FORA-290 read-only MCP
  server; FORA-290 (Path A) is the MCP boundary, FORA-321 (Path B) is
  the credential layer.
