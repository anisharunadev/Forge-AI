# Customer-cloud-broker onboarding playbook (FORA-126 / 0.7.4)

This document tells a customer's cloud admin how to grant Forge OIDC
federation trust and provision per-action roles. The full procedure
differs per cloud; this page covers the shared model and points at the
per-cloud runbooks.

## 1. What the customer is granting

The customer grants Forge **OIDC federation trust**. Forge does **not**
receive a long-lived access key. Instead, the customer configures their
cloud IAM to accept a short-lived, signed token issued by the Forge
identity-broker. The customer-cloud-broker exchanges that token for a
short-lived cloud-native credential at action time (≤15 min), performs
the action, and discards the credential.

The trust chain:

```
FORA identity-broker
   │ (signs short-lived FORA-issued JWT, ~5 min)
   ▼
FORA customer-cloud-broker
   │ (exchanges the FORA JWT via cloud-native federation)
   ▼
Customer's pre-provisioned IAM role / app registration / WIF pool
   │ (mints cloud-native STS / federated token, ≤15 min)
   ▼
Cloud API call
```

The customer's role policy must allow only the actions the customer
wants the broker to perform on their behalf. The platform deny-list
(`config/customer-cloud-broker/deny_list.yaml`) is the second line of
defence — actions like `iam:DeleteUser` are denied regardless of the
customer's policy.

## 2. Pre-requisites

- A working FORA tenant (`tenants/{tenant_id}/policy.yaml` exists).
- The customer's cloud admin has permission to create IAM roles, federated
  identities, workload identity pools, and inline policies.
- The customer's IdP is already federated to Forge (FORA-123).

## 3. Per-cloud runbooks

| Cloud  | Runbook |
|--------|---------|
| AWS    | [`onboarding-aws.md`](./onboarding-aws.md) |
| Azure  | [`onboarding-azure.md`](./onboarding-azure.md) |
| GCP    | [`onboarding-gcp.md`](./onboarding-gcp.md) |

## 4. Recording the trust in `cloud_trust.yaml`

After the customer's IAM trust is in place, the FORA tenant admin
records the trust in `tenants/{tenant_id}/cloud_trust.yaml`:

```yaml
version: 1
clouds:
  - cloud: aws
    account: "111122223333"
    role_ref: "arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole"
    expected_issuer: "https://identity-broker.fora.local/auth"
    expected_audience: "customer-cloud-broker"
```

The four fields are:

- `cloud`: which cloud (`aws`, `azure`, `gcp`).
- `account`: cloud-native account/subscription/project identifier.
- `role_ref`: the role / app registration / WIF pool that the broker
  will assume.
- `expected_issuer` / `expected_audience`: the OIDC issuer URL and
  audience claim that the customer's trust policy pins to. The trust
  probe verifies the customer's policy actually pins to these values.

## 5. Verification

The trust probe runs:

- on broker boot,
- on every PATCH to `cloud_trust.yaml` (when watch is enabled), and
- on a periodic re-probe (default 5 min).

A successful probe sets `trust_state: active`. A failed probe sets
`cloud_disabled` with a `disabled_reason` that points at the missing
piece (e.g. `expected_issuer_mismatch`, `role_arn_malformed`,
`probe_no_canary_jwt`).

The probe runs in two phases:

1. **Phase 1 — config check.** The trust record parses, the role ARN
   parses, the issuer/audience match what the broker mints. Fast,
   no-network.
2. **Phase 2 — canary assume.** The broker signs a synthetic FORA JWT
   and attempts to assume the customer's role. A success proves the
   customer's trust policy is wired correctly.

Phase 2 requires the customer's trust policy to allow an assume from
the broker's IdP issuer; see the per-cloud runbook for the exact
policy template.

## 6. Revoking access

Two paths revoke a customer's brokered-cloud access:

1. **Customer-initiated**: the customer removes the trust policy or the
   role. The next probe flips the tenant to `cloud_disabled`.
2. **Forge-initiated**: FORA support marks the tenant as `cloud_disabled`
   in the trust store, OR removes the `cloud_trust.yaml` entry. Both
   have immediate effect — in-flight brokered actions complete; new
   actions are refused with `response_code = cloud_disabled`.

The platform deny-list (`config/customer-cloud-broker/deny_list.yaml`)
is the global kill-switch for dangerous actions. Adding an entry is a
one-line PR with CEO + Security sign-off (per ADR-0003 §6.3).

## 7. Auditing

Every brokered action emits a `cloud.brokered` audit event with:

- `actor` (the agent type + trace_id)
- `tenant_id`
- `cloud`
- `account`
- `cloud_action`
- `response_code`
- `duration_ms`
- `role_fingerprint` (NOT the credential)
- `trace_id`

The audit event never contains an AWS access key, secret, or session
token. This is enforced by:

- the type system (`BrokeredResult` has no credential fields),
- a runtime guard in `audit.ts::assertNoCredentials`,
- a property test (`test/memory-dump-scan.test.ts`).

## 8. Operational runbook

| Symptom | First check | Resolution |
|---------|-------------|------------|
| Tenant's actions return `cloud_disabled` | Trust probe result | Repair `cloud_trust.yaml` or customer's IAM trust; re-probe |
| Specific action returns `deny_listed_action` | `config/customer-cloud-broker/deny_list.yaml` | If the deny is wrong, open a PR to remove (CEO + Security sign-off) |
| High p99 broker latency | Metrics `broker_cloud_duration_ms` | Adapter-specific — check AWS STS / Azure federated / GCP token exchange |
| Audit log writes fail | Sink health | `JsonlAuditSink` writes to local disk in v1; check disk space |
