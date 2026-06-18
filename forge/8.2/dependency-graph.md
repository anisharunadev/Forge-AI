# Dependency Graph — github:legacy-corp/billing-monolith@main

- Generated: `2026-06-18T00:00:00Z`
- Graph: `dep-graph/0.1.0` (schema v1)
- Repo fingerprint: `c6cac1a26669eddf`
- Runtime: 0.39 ms  |  Cost: $0.00  |  Deterministic: True

## Top-line

- Files (nodes): **22**  |  Edges: **8**  |  Cycles: **0**
- Services (svc nodes): **8**  |  Service edges: **4**  |  Clusters: **0**

## Service-level dependency graph (Mermaid)

```mermaid
flowchart LR
  classDef cluster fill:#fef3c7,stroke:#92400e,stroke-width:1px;
  classDef cycle   fill:#fee2e2,stroke:#991b1b,stroke-width:1px;
  classDef danger  fill:#fecaca,stroke:#7f1d1d,stroke-width:1px;

  <unassigned>["<unassigned><br/>4 files / 105 LoC<br/>in=0 out=0<br/>blast=4"]
  billing["billing<br/>10 files / 1330 LoC<br/>in=2 out=1<br/>blast=24"]
  jobs["jobs<br/>1 files / 180 LoC<br/>in=0 out=1<br/>blast=6"]
  notifications["notifications<br/>1 files / 40 LoC<br/>in=0 out=0<br/>blast=1"]
  reporting["reporting<br/>1 files / 300 LoC<br/>in=0 out=0<br/>blast=1"]
  reports["reports<br/>1 files / 140 LoC<br/>in=0 out=1<br/>blast=6"]
  shared["shared<br/>2 files / 250 LoC<br/>in=1 out=0<br/>blast=2"]
  web["web<br/>2 files / 80 LoC<br/>in=0 out=0<br/>blast=2"]
  billing -->|1| shared
  jobs -->|1| billing
  reports -->|1| billing
```


## Top 10 fan-in files

| Path | Service | fan-in | fan-out | blast_radius |
| --- | --- | ---: | ---: | ---: |
| `src/main/java/com/billingcorp/monolith/BillingService.java` | billing | 4 | 4 | 5 |
| `src/main/java/com/billingcorp/models/rds/LegacyInvoiceRow.java` | billing | 1 | 0 | 1 |
| `src/main/java/com/billingcorp/monolith/Customer.java` | billing | 1 | 0 | 1 |
| `src/main/java/com/billingcorp/monolith/Invoice.java` | billing | 1 | 0 | 1 |
| `src/main/java/com/billingcorp/util/LegacyDb.java` | shared | 1 | 0 | 1 |

## Top 10 fan-out files

| Path | Service | fan-out | fan-in | blast_radius |
| --- | --- | ---: | ---: | ---: |
| `src/main/java/com/billingcorp/monolith/BillingService.java` | billing | 4 | 4 | 5 |
| `src/main/java/com/billingcorp/api/BillingController.java` | billing | 1 | 0 | 6 |
| `src/main/java/com/billingcorp/jobs/MonthlyRollup.java` | jobs | 1 | 0 | 6 |
| `src/main/java/com/billingcorp/monolith/ReportsService.java` | reports | 1 | 0 | 6 |
| `src/main/java/com/billingcorp/pipeline/InvoicePipeline.java` | billing | 1 | 0 | 6 |

## Top 10 blast-radius files

| Path | Service | blast_radius | fan-in | fan-out |
| --- | --- | ---: | ---: | ---: |
| `src/main/java/com/billingcorp/api/BillingController.java` | billing | 6 | 0 | 1 |
| `src/main/java/com/billingcorp/jobs/MonthlyRollup.java` | jobs | 6 | 0 | 1 |
| `src/main/java/com/billingcorp/monolith/ReportsService.java` | reports | 6 | 0 | 1 |
| `src/main/java/com/billingcorp/pipeline/InvoicePipeline.java` | billing | 6 | 0 | 1 |
| `src/main/java/com/billingcorp/monolith/BillingService.java` | billing | 5 | 4 | 4 |
| `Dockerfile` | <unassigned> | 1 | 0 | 0 |
| `README.md` | <unassigned> | 1 | 0 | 0 |
| `config/application.yml` | <unassigned> | 1 | 0 | 0 |
| `helm/Chart.yaml` | <unassigned> | 1 | 0 | 0 |
| `lambdas/notify_customer.py` | notifications | 1 | 0 | 0 |

---

_Report ID: `e7032361-09cf-489b-8fd4-936cea64c656`_
