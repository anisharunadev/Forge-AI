# AWS onboarding runbook (Forge AI-126 / 0.7.4)

This runbook walks a customer's AWS admin through granting Forge
OIDC federation trust and provisioning the brokered-deploy role.

## 1. Create the OIDC identity provider in IAM

If the customer has not already federated Forge's identity-broker to
AWS IAM, do so:

```json
{
  "Type": "open-id-connect-provider",
  "Url": "https://identity-broker.fora.local/auth",
  "ClientIdList": ["customer-cloud-broker"],
  "ThumbprintList": ["<Forge AI OIDC TLS cert thumbprint — supplied by Forge AI support>"]
}
```

## 2. Create the Forge-brokered role

Create an IAM role whose trust policy pins to the OIDC provider:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/identity-broker.fora.local/auth"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "identity-broker.fora.local/auth:aud": "customer-cloud-broker",
          "identity-broker.fora.local/auth:sub": "agent:deploy-agent:run-*"
        }
      }
    }
  ]
}
```

**Mandatory**:

- `MaxSessionDuration` ≤ 3600 seconds (1 hour). The broker caps the
  assume to 900 seconds (15 min) regardless; a longer setting is a
  signal of misconfiguration.
- The trust condition must pin the OIDC `aud` to `customer-cloud-broker`
  and the `sub` claim to the deploy-agent role prefix.

## 3. Attach an inline policy

Attach an inline policy granting only the actions the customer wants
the broker to perform. Example (read-only on S3, scoped to a single
bucket):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::acme-prod",
        "arn:aws:s3:::acme-prod/*"
      ]
    }
  ]
}
```

The platform deny-list (`config/customer-cloud-broker/deny_list.yaml`)
overrides anything the customer allows here. `iam:DeleteUser`,
`iam:CreateAccessKey`, `iam:PassRole`, and other privilege-escalation
primitives are denied regardless of the customer's policy.

## 4. Record the trust in `cloud_trust.yaml`

```yaml
version: 1
clouds:
  - cloud: aws
    account: "ACCOUNT_ID"
    role_ref: "arn:aws:iam::ACCOUNT_ID:role/ForgeBrokeredDeployRole"
    expected_issuer: "https://identity-broker.fora.local/auth"
    expected_audience: "customer-cloud-broker"
```

## 5. Verify

The trust probe runs automatically on broker boot. To force a
re-probe, call:

```bash
curl -X POST http://localhost:7100/broker/probe \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","cloud":"aws"}'
```

A successful response shows `trust_state: "active"`.

## 6. Common mistakes

- **Trust policy with no `Condition`**: AWS rejects `sts:AssumeRoleWithWebIdentity`
  on an unconditioned trust. The customer's role policy must pin the
  OIDC `aud` and `sub` claims.
- **`MaxSessionDuration` > 3600**: AWS caps at 12 hours; the broker
  enforces ≤ 15 min via the `DurationSeconds` parameter. A role set
  above 15 min still works (the broker assumes for ≤ 15 min) but a
  future ADR may auto-reject higher values.
- **Role policy too broad**: granting `*:*` defeats the broker's
  least-privilege model. The deny-list is the second line of defence,
  not a replacement for a tight inline policy.
