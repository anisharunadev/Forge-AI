# AWS Transform Wave Plan — github:legacy-corp/billing-monolith@main

- Generated: `2026-06-18T00:00:00Z`
- Planner: `wave-planner/0.1.0` (schema v1)
- Repo fingerprint: `c6cac1a26669eddf`
- Runtime: 0.43 ms  |  Cost: $0.00

## Top-line

- Waves: **7**  |  Scheduled files: **18**  |  Skipped: **4**
- Cycle breaks: **0**  |  Cluster breaks: **0**  |  High-risk waves: **6**
- Total estimated effort: **5.07 person-days**

## Tier counts (wave count)

| Tier | Waves |
| --- | ---: |
| `T1` | 1 |
| `T2` | 1 |
| `T3` | 1 |
| `T4` | 1 |

## Unit counts (file count, scheduled)

| Unit | Files |
| --- | ---: |
| `api_gateway` | 1 |
| `aurora` | 2 |
| `cloudfront` | 2 |
| `container` | 5 |
| `ec2` | 3 |
| `lambda` | 1 |
| `rds` | 1 |
| `step_functions` | 1 |

## Waves

### Wave 0 — preflight  (`preflight`, tier `skip`, service `—`)

_Pre-flight: probe tenant credentials, canary MGN reachability, verify secret rotation, register the repo with AWS Migration Hub._

**AWS services:** migrationhub, secretsmanager

**Gates (2):**
- `wave-0.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-0.secret-inventory` [secret_rotate_check, blocking] via `mcp-servers/secrets`

**Commands (1):**
- `wave-0.cmd-0` `migrationhub.MigrationHub.create_application_component` via `customer-cloud-broker/audit` (audit: `aws.migrationhub.create_component`)

**Audit action:** `transform.preflight`  |  **Effort:** 0.00 person-days

---

### Wave 1 — tier-T1-<unassigned>  (`tier_wave`, tier `T1`, service `<unassigned>`)

_Migrate 5 T1 ec2 file(s) in service `<unassigned>` via AWS mgn, ec2, migrationhub._

**AWS services:** mgn, ec2, migrationhub

**Files (5):**
- `src/main/java/com/billingcorp/jobs/MonthlyRollup.java`
- `src/main/java/com/billingcorp/util/weblogic/BillingBridge.java`
- `web/app.js`
- `web/index.html`
- `zzz_legacy/old_reporting/ReportAggregator.java`

**Gates (3):**
- `wave-tier-T1-<unassigned>.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-tier-T1-<unassigned>.secret-rotate` [secret_rotate_check, blocking] via `mcp-servers/secrets`
- `wave-tier-T1-<unassigned>.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-tier-T1-<unassigned>.cmd-0` `ec2.MGN.start_replication` via `customer-cloud-broker/dispatch:ec2` (audit: `aws.mgn.create`)

**Audit action:** `aws.mgn`  |  **Effort:** 1.66 person-days

---

### Wave 2 — tier-T2-<unassigned>  (`tier_wave`, tier `T2`, service `<unassigned>`)

_Migrate 4 T2 lambda file(s) in service `<unassigned>` via AWS lambda, apigateway._

**AWS services:** lambda, apigateway

**Files (4):**
- `lambdas/notify_customer.py`
- `src/main/java/com/billingcorp/models/rds/LegacyInvoiceRow.java`
- `src/main/java/com/billingcorp/monolith/Customer.java`
- `src/main/java/com/billingcorp/monolith/Invoice.java`

**Gates (3):**
- `wave-tier-T2-<unassigned>.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-tier-T2-<unassigned>.secret-rotate` [secret_rotate_check, blocking] via `mcp-servers/secrets`
- `wave-tier-T2-<unassigned>.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-tier-T2-<unassigned>.cmd-0` `lambda.Lambda.create_function` via `customer-cloud-broker/dispatch:lambda` (audit: `aws.lambda.create`)

**Audit action:** `aws.lambda`  |  **Effort:** 0.45 person-days

---

### Wave 3 — tier-T3-<unassigned>  (`tier_wave`, tier `T3`, service `<unassigned>`)

_Migrate 6 T3 api_gateway file(s) in service `<unassigned>` via AWS apigateway, lambda._

**AWS services:** apigateway, lambda

**Files (6):**
- `src/main/java/com/billingcorp/api/BillingController.java`
- `src/main/java/com/billingcorp/monolith/ReportsService.java`
- `src/main/java/com/billingcorp/pipeline/InvoicePipeline.java`
- `src/main/java/com/billingcorp/util/LegacyDb.java`
- `src/main/java/com/billingcorp/util/UnusedHelper.java`
- `target/classes/com/billingcorp/monolith/BillingService.class`

**Gates (3):**
- `wave-tier-T3-<unassigned>.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-tier-T3-<unassigned>.secret-rotate` [secret_rotate_check, blocking] via `mcp-servers/secrets`
- `wave-tier-T3-<unassigned>.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-tier-T3-<unassigned>.cmd-0` `api_gateway.APIGateway.create_api` via `customer-cloud-broker/dispatch:apigateway` (audit: `aws.apigateway.create`)

**Audit action:** `aws.apigateway`  |  **Effort:** 1.31 person-days

---

### Wave 4 — tier-T4-<unassigned>  (`tier_wave`, tier `T4`, service `<unassigned>`)

_Migrate 1 T4 container file(s) in service `<unassigned>` via AWS ecs, fargate, ecr._

**AWS services:** ecs, fargate, ecr

**Files (1):**
- `src/main/java/com/billingcorp/monolith/BillingService.java`

**Gates (3):**
- `wave-tier-T4-<unassigned>.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-tier-T4-<unassigned>.secret-rotate` [secret_rotate_check, blocking] via `mcp-servers/secrets`
- `wave-tier-T4-<unassigned>.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-tier-T4-<unassigned>.cmd-0` `container.ECS.create_service` via `customer-cloud-broker/dispatch:ecs` (audit: `aws.ecs.create`)

**Audit action:** `aws.ecs`  |  **Effort:** 1.15 person-days

---

### Wave 5 — cutover  (`cutover`, tier `skip`, service `—`)

_Cutover: flip DNS / routing to point at the migrated AWS footprint. Refuses to flip if any canary-probe fails._

**AWS services:** route53, cloudfront, migrationhub

**Gates (2):**
- `wave-cutover.canary-probe` [canary_probe, blocking] via `customer-cloud-broker/probe-signer`
- `wave-cutover.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-cutover.cmd-0` `route53.Route53.change_resource_record_sets` via `customer-cloud-broker/dispatch:route53` (audit: `aws.route53.cutover`)

**Audit action:** `transform.cutover`  |  **Effort:** 0.25 person-days

---

### Wave 6 — validation  (`validation`, tier `skip`, service `—`)

_Validation: smoke test + synthetic canary against the cutover footprint. Refuses to close if either fails._

**AWS services:** cloudwatch, synthetics, migrationhub

**Gates (2):**
- `wave-validation.unit-test` [unit_test, blocking] via `customer-cloud-broker/audit`
- `wave-validation.audit-completeness` [audit_completeness_check, blocking] via `customer-cloud-broker/audit`

**Commands (1):**
- `wave-validation.cmd-0` `cloudwatch.Synthetics.create_canary` via `customer-cloud-broker/audit` (audit: `aws.synthetics.canary_create`)

**Audit action:** `transform.validation`  |  **Effort:** 0.25 person-days

---

## Cycle breaks

| Break ID | Members | Wave |
| --- | ---: | ---: |

## Cluster breaks

| Break ID | Services | Wave |
| --- | ---: | ---: |

---

_Report ID: `2ceac2cd-28de-46ad-b965-80951a4f4c82`_
