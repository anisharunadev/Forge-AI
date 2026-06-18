# Azure onboarding runbook (FORA-126 / 0.7.4)

This runbook walks a customer's Azure admin through granting FORA
OIDC federation trust and provisioning the brokered-action role on
Microsoft Entra ID (Azure AD).

The trust model is **Workload Identity Federation**: a service
principal in the customer's Entra tenant trusts a federated credential
issued by the FORA identity-broker. The customer-cloud-broker
exchanges a FORA-signed OIDC token for a short-lived Microsoft
identity token at action time (≤15 min), performs the action, and
discards the credential.

> **Adapter status**: the Azure adapter in
> `src/adapters/azure.ts` is fully implemented as of
> [FORA-126.2](/FORA/issues/FORA-126.2). `assume()` exchanges the
> FORA-issued JWT for an ARM access token via `@azure/identity`
> ≥ 4.x's `ClientAssertionCredential` (the federated-assertion
> primitive behind the `DefaultAzureCredential` /
> `WorkloadIdentityCredential` chain). `perform()` lazy-imports
> `@azure/arm-{compute,storage,network,authorization}` per
> `args.service` and returns the action intent envelope (the actual
> ARM dispatch is the `azure-deploy` MCP server's responsibility).
> The full action envelope carries no raw access token — see §7
> Auditing below.

## 1. Pre-requisites

- The customer's Azure admin has permission to:
  - create App Registrations and federated credentials
    (`Application.ReadWrite.All` or a custom role),
  - grant Azure RBAC role assignments at the chosen scope
    (`User Access Administrator` or `Owner` on the subscription /
    resource group).
- The customer knows the **subscription ID** (a UUID, e.g.
  `b2c5e8a0-1234-4def-9abc-000000000000`) they want Forge to act on.
- The FORA support team has confirmed the **OIDC issuer URL** for the
  tenant. By default this is
  `https://identity-broker.fora.local/auth`; a customer with a
  dedicated FORA instance gets a per-tenant URL.

## 2. Create the App Registration

In the customer's Entra tenant (Azure Portal → *Microsoft Entra ID*
→ *App registrations* → *New registration*):

- **Name**: `FORA customer-cloud-broker` (or your tenant convention).
- **Supported account types**: *Accounts in this organizational
  directory only* (single tenant).
- **Redirect URI**: leave blank. The broker does not use OAuth
  redirect — it uses the federated-credential path.

After creation, note two values from the **Overview** page:

- **Application (client) ID** — a UUID. The broker stores this in
  `cloud_trust.yaml` as `app_registration_client_id` and in the
  `BrokeredRequest.args`.
- **Directory (tenant) ID** — needed only for your own bookkeeping;
  the broker does not require it.

You do **not** need to create a client secret. Federated credentials
are keyless.

## 3. Add the federated credential

In the App Registration → *Certificates & secrets* → *Federated
credentials* tab → *Add credential*:

- **Federated credential scenario**: *Other issuer*.
- **Issuer**: `https://identity-broker.fora.local/auth` (or the
  per-tenant issuer URL FORA support supplied).
- **Subject identifier**: `agent:deploy-agent:run-*` (a prefix
  match; the broker's `sub` claim is
  `<agent-type>:<role-prefix>:<run-id>`, and the federated credential
  matches with a `*` suffix on the prefix).
- **Audience**: `api://AzureADTokenExchange` (Microsoft's
  well-known audience for federated identity exchange — required,
  do not change).
- **Name**: `FORA deploy-agent run-*` (descriptive only).
- **Description**: `OIDC federation trust for the FORA
  customer-cloud-broker (FORA-126).`

Entra validates the credential by fetching the issuer's OIDC
discovery document and checking the JWT signature, `iss`, `aud`, and
`sub` against the values you entered. The credential is now active
and the App Registration's service principal will accept short-lived
federated tokens issued by the FORA identity-broker.

## 4. Grant the federated identity an Azure RBAC role

The App Registration is a service principal. Grant it a built-in or
custom Azure RBAC role **at the scope you want Forge to act on**:

- **Subscription-scoped** (recommended for prod): *Subscriptions* →
  *Access control (IAM)* → *Add role assignment*. Pick a role that
  matches the actions you want the broker to perform — for example
  *Storage Blob Data Reader* (read-only on storage), *Virtual Machine
  Contributor* (deploy VMs), or *Website Contributor* (App Service).
  Avoid *Owner* and *User Access Administrator* (those let the
  principal grant itself more roles).
- **Resource group-scoped** (narrowest): grant on a single resource
  group when Forge only needs to act on resources in that group.

The **built-in roles the broker ships with** for common scenarios:

| Scenario | Built-in role | Scope |
|----------|---------------|-------|
| Read S3-like blobs | Storage Blob Data Reader | Storage account |
| Deploy compute | Virtual Machine Contributor | Resource group |
| Manage App Service | Website Contributor | Resource group |
| Read metrics | Monitoring Reader | Subscription |

> **The deny-list overrides RBAC.** The platform deny-list at
> `config/customer-cloud-broker/deny_list.yaml` blocks
> `Microsoft.Authorization/roleAssignments/write`,
> `Microsoft.Authorization/roleDefinitions/write`, and
> `Microsoft.Authorization/roleDefinitions/delete` regardless of what
> the customer's role assignment allows. See
> `docs/onboarding.md` §1 for the full deny-list semantics.

## 5. Record the trust in `cloud_trust.yaml`

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
  - cloud: azure
    account: "b2c5e8a0-1234-4def-9abc-000000000000"  # the subscription ID
    role_ref: "mi://b2c5e8a0-1234-4def-9abc-000000000000/<app-registration-client-id>"
    expected_issuer: "https://identity-broker.fora.local/auth"
    expected_audience: "customer-cloud-broker"
```

The four fields are:

- `cloud`: `azure` (must match the adapter's `Cloud` enum in
  `src/types.ts`).
- `account`: the **subscription ID** (a UUID). The phase-1 probe
  rejects anything that is not a UUID with
  `subscription_id_malformed`.
- `role_ref`: the broker's internal handle to the App Registration's
  service principal, in the form
  `mi://<subscription_id>/<app-registration-client-id>`. The probe
  enforces the `mi://` prefix (`managed_identity_ref_malformed`
  otherwise). The customer does not need to know this string — the
  FORA onboarding automation generates it from the App Registration
  client ID and the subscription ID.
- `expected_issuer` / `expected_audience`: the OIDC issuer URL and
  audience (`customer-cloud-broker`) that the App Registration's
  federated credential pins to. The phase-1 probe verifies the
  customer's federated credential actually has these values.

## 6. Verify

The trust probe runs automatically on broker boot. To force a
re-probe:

```bash
curl -X POST http://localhost:7100/broker/probe \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","cloud":"azure"}'
```

A successful phase-1 response shows `trust_state: "active"`. The
phase-2 canary assume (FORA-126.4 follow-up — not yet shipped) is
what actually proves the customer's federated credential accepts
the broker's issuer end-to-end. Until phase-2 ships, the
[FORA-126.2](/FORA/issues/FORA-126.2) adapter is itself the
end-to-end check: the first real brokered action on the tenant
exercises the full federated token exchange. A successful action
emits a `cloud.brokered` audit event with `response_code = "ok"`
and `cloud = "azure"`.

### Per-action contract

Each brokered action carries the following on `BrokeredRequest.args`
(the `AzureActionArgs` shape, see `src/types.ts`):

| Field | Description |
|-------|-------------|
| `cloud` | Literal `"azure"`. |
| `subscription_id` | The customer's Azure subscription id (UUID). |
| `resource_group` | Optional. The target resource group, when applicable. |
| `aad_tenant_id` | The customer's **Entra ID tenant id** (UUID) hosting the App Registration. New in FORA-126.2; the broker uses it to construct `ClientAssertionCredential(tenantId, clientId, getAssertion)`. The agent populates this from the customer's Entra setup (e.g. `tenants/{tenant_id}/policy.yaml`). |
| `app_registration_client_id` | The customer's App Registration client id (UUID). |
| `service` | One of `compute`, `storage`, `network`, `authorization`. |
| `operation` | ARM operation name (e.g. `VirtualMachines/List`). |
| `params` | Operation parameters. Must NOT contain credentials. |

> **The broker does not log the FORA JWT, the Azure access token, or
> the federated credential's `api://AzureADTokenExchange` audience.**
> See §7 for the audit-event guarantees and the property test that
> enforces them.

## 7. Common mistakes

The top three failure modes observed in canary probes and pilot
tenants:

- **Federated credential subject prefix too narrow**: Entra matches
  the federated credential's subject against the token's `sub` claim
  *exactly* (or with a single trailing `*` for prefix matching). If
  the customer enters `agent:deploy-agent:run-prod-1`, only runs
  with that exact `sub` are accepted. The correct value is
  `agent:deploy-agent:run-*` so the broker's run-scoped subjects
  (`agent:deploy-agent:run-<run-id>`) all match. A subject prefix
  typo yields `assume_failed: AADSTS70021: No matching federated
  identity record found`.
- **Audience set to `customer-cloud-broker` instead of
  `api://AzureADTokenExchange`**: Entra requires the federated
  credential's audience to be its own well-known value, not the
  broker's `customer-cloud-broker` audience. The customer's Entra
  app validates the JWT's `aud` claim against this value at exchange
  time. Using the broker's audience yields `AADSTS700016: Application
  with identifier '<client-id>' was not found in the directory`. The
  broker's `customer-cloud-broker` audience is the value stored in
  `cloud_trust.yaml.expected_audience` (which the broker's probe
  checks); the federated credential's audience is a separate
  Entra-side field.
- **Role granted at wrong scope (or no role at all)**: RBAC
  assignments are scope-bound. Granting *Storage Blob Data Reader*
  on subscription A but the broker's action targets a storage
  account in subscription B returns
  `RequestDisallowedByAzure: This request is not authorized to
  perform this operation`. The probe phase 1 does not catch this —
  it passes as soon as the federated credential and trust record are
  valid. Verify with a brokered action (`POST /broker/action` with
  a read-only `service` / `operation` pair scoped to the target
  resource) or a manual `az role assignment list --assignee
  <client-id>`.

## 8. Operational runbook

| Symptom | First check | Resolution |
|---------|-------------|------------|
| Azure actions return `cloud_disabled` | Trust probe result | Repair `cloud_trust.yaml` or the federated credential config; re-probe |
| Azure actions return `assume_failed` with `AADSTS70021/22` | Federated credential `subject` / `issuer` | Match the agent's `sub` claim and FORA's OIDC issuer URL exactly |
| Azure actions return `assume_failed` with `AADSTS700016` | Federated credential `audience` | Must be `api://AzureADTokenExchange`, not the broker's `customer-cloud-broker` audience |
| Azure actions return `credential_too_long` | Adapter log | The mint's `expiresOnTimestamp` exceeded the 15-min cap; usually a misconfigured `arm_scope` or a token-endpoint clock skew |
| Specific Azure action returns `deny_listed_action` | `config/customer-cloud-broker/deny_list.yaml` | If the deny is wrong, open a PR to remove (CEO + Security sign-off) |
| High p99 Azure broker latency | Metrics `broker_cloud_duration_ms{cloud="azure"}` | Check Entra ID token endpoint reachability; check `arm_scope` is `https://management.azure.com/.default` |
| Audit log writes fail | Sink health | `JsonlAuditSink` writes to local disk in v1; check disk space |
