# GCP onboarding runbook (Forge AI-126 / Forge AI-126.3 / 0.7.4)

This runbook walks a customer's GCP project admin through granting
Forge OIDC federation trust and provisioning the brokered-action
service account via Workload Identity Federation (WIF).

The trust model is **GCP Workload Identity Federation**: an OIDC
identity pool in the customer's project trusts the Forge AI
identity-broker as an external IdP. The pool is bound to a Google
Service Account (GSA); the customer-cloud-broker exchanges a
Forge AI-signed OIDC token for a short-lived Google access token at
action time (≤15 min), impersonates the GSA, performs the action,
and discards the credential.

> **Adapter status (Forge AI-126.3 landed)**: the GCP adapter in
> `src/adapters/gcp.ts` is implemented. `probeTrust` validates
> the `cloud_trust.yaml` shape; `assume` exchanges the Forge AI JWT
> for a federated Google access token via `google-auth-library`
> ≥ 9.x with the `IdentityPoolClient` external-account credential
> provider; `perform` lazy-imports the per-service GCP SDK
> (`@google-cloud/compute`, `@google-cloud/storage`,
> `@google-cloud/resource-manager`) and dispatches the action.
> The credential is wiped after the action returns; the audit
> factory's `assertNoCredentials` is the second-line guard
> against leaks. See `test/gcp-credential-leak.test.ts` and
> the existing `memory-dump-scan.test.ts` for the property test
> that exercises this.

## 1. Pre-requisites

- The customer's GCP admin has permission to:
  - create Workload Identity Pools and Providers
    (`roles/iam.workloadIdentityPoolAdmin` or
    `roles/iam.workloadIdentityPoolAdmin` plus
    `roles/iam.workloadIdentityPoolProviderAdmin`),
  - create and bind Google Service Accounts
    (`roles/iam.serviceAccountAdmin` on the project),
  - grant IAM roles to the GSA (`roles/resourcemanager.projectIamAdmin`
    or scoped `roles/iam.securityAdmin`).
- The customer knows the **project number** (a numeric identifier,
  e.g. `123456789012` — **not** the project ID, which can be
  alphabetic). The project number is on the GCP console *Dashboard*
  → *Project info* → *Project number*.
- The Forge AI support team has confirmed the **OIDC issuer URL** for
  the tenant. By default this is
  `https://identity-broker.fora.local/auth`; a customer with a
  dedicated Forge AI instance gets a per-tenant URL.

## 2. Create the Workload Identity Pool

In the customer's GCP project (GCP Console → *IAM & Admin* →
*Workload Identity Federation* → *Create Pool*):

- **Name**: `fora-customer-cloud-broker` (or your tenant
  convention; must be 4–32 lowercase alphanumerics + dashes).
- **Pool ID**: `fora-customer-cloud-broker` (the same string —
  this is what the broker stores in `cloud_trust.yaml` as
  `workload_identity_pool`).
- **Service account email**: leave blank. The GSA binding comes in
  step 4.
- **Provider list**: click *Add a new provider* before saving (see
  step 3).

## 3. Add the OIDC provider to the pool

Still in the pool creation flow, *Add a new provider*:

- **Provider name**: `identity-broker-fora`.
- **Provider ID**: `identity-broker-fora` (the same string).
- **Issuer URL**: `https://identity-broker.fora.local/auth` (or the
  per-tenant issuer URL Forge AI support supplied).
- **Audiences**: `customer-cloud-broker` (the broker's
  client_id at the Forge AI IdP). The broker's
  `cloud_trust.yaml.expected_audience` value must match this.
- **Subject claim**: leave as `sub` (the default). The broker's
  tokens always carry `sub` at the top level.

Under *Attribute mapping*:

- `google.subject` ← `assertion.sub`
- (Optional) `attribute.fora_tenant` ← `assertion.fora_tenant` if
  the customer's broker instance includes a tenant claim.

Under *Attribute condition* (this is the prefix-match filter that
gates which Forge AI subjects can impersonate the GSA):

```
assertion.sub.startsWith("agent:deploy-agent:run-")
```

The `*` is implicit at the end of the `startsWith` match. Do not
use a regex here — the attribute condition is a CEL expression and
a regex would let attackers craft subjects that escape the prefix.
Leave the `*` for the run-id suffix and let `startsWith` enforce
the deploy-agent role prefix.

Click *Save* to create the pool and provider.

## 4. Bind the pool to a Google Service Account

Create the GSA that the broker will impersonate (GCP Console →
*IAM & Admin* → *Service Accounts* → *Create service account*):

- **Service account name**: `fora-deploy-agent` (or your tenant
  convention).
- **Service account ID**: `fora-deploy-agent` (the same string —
  this is what the broker stores in `cloud_trust.yaml` as
  `service_account`).
- **Description**: `Impersonated by the Forge AI customer-cloud-broker
  via Workload Identity Federation (Forge AI-126).`

After creation, grant the pool's principal the **Workload Identity
User** role on the GSA. From the GSA's *Permissions* tab → *Grant
Access*:

- **New principals**:
  ```
  principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/fora-customer-cloud-broker/attribute.fora_tenant/<TENANT_ID>
  ```
  If the broker instance does not emit a `fora_tenant` claim,
  bind to the entire pool instead:
  ```
  principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/fora-customer-cloud-broker/*
  ```
  The `principalSet` with `/*` is broader; the per-tenant
  `principalSet` is narrower and recommended for production.
- **Role**: *Workload Identity User* (`roles/iam.workloadIdentityUser`).

This binding is what allows the broker's federated identity to
**impersonate** the GSA. Without it, the broker receives a Google
access token but cannot exchange it for a GSA-scoped token, and
every call returns `Permission 'iam.serviceAccountTokenCreator'
denied`.

## 5. Grant the GSA the IAM roles it needs

The GSA itself needs the IAM roles the customer wants the broker to
have. This is the GCP equivalent of an inline policy on an AWS IAM
role. From *IAM & Admin* → *IAM* → *Grant Access*:

- **New principal**: the GSA's email
  (`fora-deploy-agent@<project-id>.iam.gserviceaccount.com`).
- **Role**: pick a built-in role that matches the actions you
  want the broker to perform. Common ones:

  | Scenario | Built-in role | Scope |
  |----------|---------------|-------|
  | Read GCS objects | Storage Object Viewer | Bucket |
  | Deploy compute | Compute Instance Admin (v1) | Project / zone |
  | Manage GKE | Kubernetes Engine Admin | Project |
  | Read metrics | Monitoring Viewer | Project |
  | Write logs | Logs Writer | Project |

  Avoid *Owner*, *Editor*, *Security Admin*, and *IAM Admin*. The
  deny-list at `config/customer-cloud-broker/deny_list.yaml`
  enforces this for the most dangerous primitives regardless of
  what the customer grants — see below.

> **The deny-list overrides IAM.** The platform deny-list blocks
> `iam.serviceAccountKeys.create`, `iam.serviceAccounts.create`,
> `iam.serviceAccounts.delete`, `iam.serviceAccounts.actAs`, and
> `resourcemanager.projects.setIamPolicy` regardless of the GSA's
> IAM bindings. See `docs/onboarding.md` §1 for the full
> deny-list semantics.

## 6. Record the trust in `cloud_trust.yaml`

Append a new entry under `clouds:` in
`tenants/{tenant_id}/cloud_trust.yaml`:

```yaml
version: 1
clouds:
  - cloud: aws
    account: "111122223333"
    role_ref: "arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole"
    expected_issuer: "https://identity-broker.fora.local/auth"
    expected_audience: "customer-cloud-broker"
  - cloud: gcp
    account: "123456789012"   # the project NUMBER (numeric, not the project ID)
    role_ref: "serviceAccount:fora-deploy-agent@acme-prod.iam.gserviceaccount.com"
    expected_issuer: "https://identity-broker.fora.local/auth"
    expected_audience: "customer-cloud-broker"
```

The four fields are:

- `cloud`: `gcp` (must match the adapter's `Cloud` enum in
  `src/types.ts`).
- `account`: the **project number** (digits only). The phase-1
  probe rejects anything that contains non-digits with
  `project_number_must_be_numeric`. Project IDs (which can be
  alphabetic, e.g. `acme-prod`) are **not** accepted here — GCP's
  WIF APIs require the numeric project number for
  `principalSet` and `name` construction.
- `role_ref`: the broker's internal handle to the GSA, in the form
  `serviceAccount:<gsa-email>`. The probe enforces the
  `serviceAccount:` prefix (`service_account_ref_malformed`
  otherwise). The full GSA email is
  `<service-account-id>@<project-id>.iam.gserviceaccount.com`.
- `expected_issuer` / `expected_audience`: the OIDC issuer URL and
  audience (`customer-cloud-broker`) that the WIF pool's OIDC
  provider pins to. The phase-1 probe verifies the customer's pool
  configuration actually has these values.

The `BrokeredRequest` for a GCP action also carries
`workload_identity_pool` (the pool ID from step 2),
`workload_identity_provider` (the provider ID from step 3),
and `service_account` (the GSA email from step 4). These are the
per-call target descriptors, separate from the trust record.
A pool can have multiple providers (e.g. one per trust level
— deploy vs read-only), so the provider is per-action even
though the trust record binds the broker's IdP to the pool.

## 7. Verify

The trust probe runs automatically on broker boot. To force a
re-probe:

```bash
curl -X POST http://localhost:7100/broker/probe \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","cloud":"gcp"}'
```

A successful phase-1 response shows `trust_state: "active"`. With
the Forge AI-126.3 adapter in place, the canary probe (phase 2,
Forge AI-126.4) actually exercises `assume()` against
`https://sts.googleapis.com/v1/token`; a success proves the
customer's WIF provider accepts the broker's OIDC issuer and
audience. Until Forge AI-126.4 lands, phase 1 is sufficient to mark
the tenant `active` and the first real brokered action will go
through to the GCP service.

## 7b. Per-service actions supported in v1

The adapter's `perform()` dispatches to the per-service GCP SDK
package lazily. v1 supports the following `args.service` /
`args.operation` pairs; a typo returns `unsupported_gcp_service_operation`
before the SDK is even touched.

| `service` | `operation`           | SDK package                |
|-----------|-----------------------|----------------------------|
| `compute` | `list`                | `@google-cloud/compute`    |
| `compute` | `get`                 | `@google-cloud/compute`    |
| `compute` | `aggregatedList`      | `@google-cloud/compute`    |
| `storage` | `bucket.get`          | `@google-cloud/storage`    |
| `storage` | `bucket.list`         | `@google-cloud/storage`    |
| `storage` | `object.get`          | `@google-cloud/storage`    |
| `iam`     | `projects.serviceAccounts.get`   | `@google-cloud/resource-manager` |
| `iam`     | `projects.serviceAccounts.list`  | `@google-cloud/resource-manager` |

Adding a new service is a one-line PR against
`apps/customer-cloud-broker/src/adapters/gcp.ts` (`SERVICE_OPS`
and `SERVICE_LOADERS`). Per-tenant+service rate limiting and a
circuit breaker gate every call so a single degraded customer
cannot starve other tenants.

## 7c. Credential lifetime

The broker hard-caps impersonated access tokens at 15 minutes
via `service_account_impersonation.token_lifetime_seconds = 900`
in the WIF exchange. The IAM API would otherwise default to 1
hour. The returned `expires_at_ms` in the broker's audit event
is the *minimum* of (Google's declared expiry, the 15-min cap) —
a defensive `min()` that survives any future `assume_fn` override
that tries to relax the cap.

## 8. Common mistakes

The top three failure modes observed in canary probes and pilot
tenants:

- **`account` set to the project ID, not the project number**:
  `acme-prod` is a project ID; the broker's probe requires digits
  only and returns `project_number_must_be_numeric`. The project
  ID is alphabetic and used in the GSA email, the role_ref's
  `<project-id>.iam.gserviceaccount.com` suffix, and in the
  `principalSet` URL. The numeric project number is in the GCP
  console *Project info* card — easy to confuse with the project
  ID, easy to fix once spotted.
- **Attribute condition uses a regex like `^agent:deploy-agent:run-.*$`
  with a non-prefix match**: the attribute condition is a CEL
  expression, not a regex. CEL `matches()` exists but it allows
  patterns that bypass the deploy-agent prefix. The correct
  expression is `assertion.sub.startsWith("agent:deploy-agent:run-")`.
  A pattern like `matches('^agent:.*$')` lets an agent of *any*
  role impersonate the GSA. The probe phase 1 does not catch this
  — the broker's tokens always satisfy the prefix, but a buggy or
  adversarial Forge AI agent that emits a non-conforming `sub` would
  also pass.
- **WIF pool bound to the GSA, but the GSA has no IAM roles
  granted at the target scope**: the GSA can be impersonated, but
  every API call returns `403 Permission denied`. The probe phase 1
  does not catch this either — the federation chain is wired
  correctly; the GSA simply has no permissions. Verify with
  `gcloud projects get-iam-policy <PROJECT_ID> --flatten="bindings[].members" --filter="bindings.members:fora-deploy-agent@"`
  and confirm the GSA appears in a binding with the role you
  expected. The most common form is: the customer created the GSA
  and bound the pool to it (steps 4) but never granted it an IAM
  role (step 5). Steps 4 and 5 are two separate IAM operations
  and easy to skip one of.
