# Risk Register — github:legacy-corp/billing-monolith@main

- Generated: `2026-06-18T00:00:00Z`
- Analyzer: `code-analyzer/0.1.0` (schema v1)
- Repo fingerprint: `c6cac1a26669eddf`
- Runtime: 1.23 ms  |  Cost: $0.00

## Top-line

- Files: **22**  |  LoC: **2425**  |  Services: **7**
- Languages: `{'dockerfile': 1, 'html': 1, 'java': 15, 'javascript': 1, 'markdown': 1, 'python': 1, 'yaml': 2}`
- Dominant tier: **T3**  |  Dominant risk: **low**
- Estimated migration effort: **4.87 person-days**

## Category counts

| Category | Files |
| --- | ---: |
| `keep_as_is` | 6 |
| `refactor_in_place` | 7 |
| `remove` | 7 |
| `replace` | 1 |
| `rewrite` | 1 |

## AWS Transform unit counts

| Unit | Files |
| --- | ---: |
| `api_gateway` | 1 |
| `aurora` | 2 |
| `cloudfront` | 2 |
| `container` | 5 |
| `ec2` | 3 |
| `lambda` | 1 |
| `rds` | 1 |
| `s3` | 2 |
| `skip` | 4 |
| `step_functions` | 1 |

## Tier counts

| Tier | Files |
| --- | ---: |
| `T1` | 5 |
| `T2` | 4 |
| `T3` | 6 |
| `T4` | 1 |
| `skip` | 6 |

## Top 10 risk files

| Path | Risk | Score | Effort (days) | Factors |
| --- | --- | ---: | ---: | --- |
| `src/main/java/com/billingcorp/monolith/BillingService.java` | high | 10.00 | 1.15 | fan_in=3; fan_out=3; loc=480; role=service; no_tests |
| `src/main/java/com/billingcorp/jobs/MonthlyRollup.java` | high | 8.94 | 0.43 | fan_out=1; loc=180; role=service; entrypoint; no_tests |
| `zzz_legacy/old_reporting/ReportAggregator.java` | high | 8.50 | 0.72 | loc=300; role=service; no_tests; deprecated_path |
| `src/main/java/com/billingcorp/util/weblogic/BillingBridge.java` | high | 7.90 | 0.43 | loc=180; role=service; entrypoint; no_tests |
| `src/main/java/com/billingcorp/util/LegacyDb.java` | high | 6.73 | 0.48 | fan_in=1; loc=200; role=service; no_tests |
| `src/main/java/com/billingcorp/api/BillingController.java` | high | 6.64 | 0.29 | fan_out=1; loc=120; role=controller; entrypoint |
| `src/main/java/com/billingcorp/models/rds/LegacyInvoiceRow.java` | high | 6.08 | 0.17 | fan_in=1; loc=70; role=model; no_tests |
| `lambdas/notify_customer.py` | medium | 5.20 | 0.04 | loc=40; role=service; entrypoint |
| `src/main/java/com/billingcorp/util/UnusedHelper.java` | medium | 4.25 | 0.08 | loc=50; role=service; no_tests |
| `src/main/java/com/billingcorp/monolith/Invoice.java` | medium | 4.13 | 0.13 | fan_in=1; loc=80; role=model |

---

_Report ID: `cd5db7fa-0e6f-48dd-b336-ed5c94d87fe1`_
