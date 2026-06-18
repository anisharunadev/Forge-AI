# DevOps Memory

**Scope:** CI/CD, environments, observability, deployment, and on-call.
**Audience:** Every engineer and every DevOps / Platform sub-agent.
**Stage injection:** Inject into **DevOps**, **Developer** (for the deploy pipeline), and **Security** (for the IAM/egress surface).

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** This file is the deploy and observability bar; the README is how you walk in.
- **The CI pipeline in §2 runs inside the Dev stage** of the staged workflow in [architecture.md §3](./architecture.md#3-the-staged-workflow-the-spine). The seven stages there are the product pipeline; the six stages here (`lint → typecheck → unit → integration → e2e → build`) are the gates a PR crosses. Do not conflate them.
- **An alert is actionable or it is not an alert.** Every page carries a runbook link and a `run_id` (§5.5). If you cannot act on it, do not page on it.

---

## 1. Environment topology

| Env | Purpose | Data | Deploys from | Refresh cadence |
| --- | --- | --- | --- | --- |
| `local` | Engineer laptop | Synthetic seed data | N/A | On demand |
| `dev` | Shared dev cluster | Synthetic + opt-in real snapshots (redacted) | `main` | Continuous (auto) |
| `staging` | Pre-prod, mirrors prod | Anonymised copy of prod | `release/*` branches | On every release candidate |
| `prod` | Customer-facing | Real customer data | Tagged releases only | Per release train |

**Promotion path:** `local` → `dev` (auto on PR merge) → `staging` (auto on RC tag) → `prod` (manual, see §4).

No environment is reachable from the public internet except `prod` (and only through the CDN/WAF). `dev` and `staging` are behind VPN + SSO.

## 2. CI/CD pipeline

A pipeline has exactly six stages. Adding a stage is a one-way door.

```
lint → typecheck → unit → integration → e2e → build
```

After `build`, a separate `deploy` pipeline runs per environment.

- **`lint`** — Prettier/ESLint/Ruff. < 30 s. Blocks on warning.
- **`typecheck`** — `tsc --noEmit`, `mypy --strict`. < 2 min. Blocks on error.
- **`unit`** — Vitest / pytest. < 5 min. Blocks on failure or coverage regression.
- **`integration`** — Testcontainers-based. < 10 min. Blocks on failure.
- **`e2e`** — Playwright + recorded fixtures. < 15 min. Blocks on failure.
- **`build`** — Container build, scan, sign, push. < 5 min. Blocks on high CVE or unsigned image.

### Required checks on every PR

- [ ] All six stages green.
- [ ] Coverage on changed files ≥ project median.
- [ ] No high/critical CVE in the new dependency graph.
- [ ] Eval cases updated if prompt/contract/agent changes.
- [ ] Migration has a forward + rollback script (if schema change).
- [ ] `Risk & Rollback` filled in (see [coding.md §9](./coding.md)).

### Release train

- One release train per week, Wednesdays 14:00 UTC.
- The release manager is whoever owns the most-recently-merged feature in the train; defaults to the DevOps on-call.
- Hot-fixes branch off the current `prod` tag and are merged back into `main` the same day.

## 3. Infrastructure as Code

- **Terraform** for AWS, with a separate state file per environment and per account.
- **Helm** for Kubernetes workloads. Charts live in `infra/charts/<service>`.
- **ArgoCD** for GitOps deploys. The cluster state is a checkout of `infra/argocd/<env>/`.
- **No click-ops.** A change made in the AWS console is a P1 incident and gets reverted by IaC the same day.
- **State file access** is logged; only the platform team can `terraform apply`.

## 4. Deployment

- **Default strategy:** rolling update with a 10-min bake. If error rate > 1 % during the bake, automatic rollback.
- **Database migrations:** expand → migrate → contract. The old and new app versions must both work against the new schema. Never `ALTER TABLE` in a way that locks a busy table.
- **Feature flags:** LaunchDarkly (or self-hosted Unleash if cost-sensitive). Every new feature ships behind a flag; the flag is removed within 30 days of full rollout.
- **Manual `prod` deploy** requires (a) a green pipeline on the release tag, (b) one human approver from the owning team, (c) the deploy window (Tue–Thu 14:00–18:00 UTC; Fri–Mon deploys need CTO approval).
- **Rollback** is a single ArgoCD sync to the previous revision. The previous revision's container image is retained for 30 days.

## 5. Observability

The three pillars, in order of usefulness:

### 5.1 Logs (structured JSON, see [coding.md §7](./coding.md))

- Aggregated in Loki / CloudWatch; searchable by `run_id`, `tenant_id`, `stage`, `tool`.
- Retention: 30 days hot, 1 year cold.

### 5.2 Metrics (Prometheus → Grafana)

Every service exposes `/metrics` with the four golden signals:

- **Rate** — requests per second, broken down by endpoint and status.
- **Errors** — 4xx and 5xx rate, with `error_code` label.
- **Duration** — p50, p95, p99 latency, broken down by endpoint.
- **Saturation** — CPU, memory, connection pool, queue depth.

Plus the platform-specific signals:

- `agent_runs_started_total{stage="..."}`
- `agent_runs_completed_total{stage="...", outcome="success|failure|paused"}`
- `agent_run_duration_seconds{stage="...", quantile="0.5|0.95|0.99"}`
- `agent_tokens_total{stage="...", direction="input|output"}`
- `agent_cost_usd_total{stage="..."}`
- `mcp_tool_calls_total{tool="...", outcome="..."}`

### 5.3 Traces (OpenTelemetry → Tempo / Jaeger)

- Every request gets a trace ID; the trace ID is the `run_id` for agent runs.
- Sampling: 100 % of errored requests, 10 % of successful requests, 1 % of background jobs.
- Spans always include: `tenant_id`, `run_id`, `stage`, `agent_id`, `tool`, `attempt`, `model`, `token_count`.

### 5.4 Dashboards

Every service has a dashboard in Grafana with: the four golden signals, the platform signals, the deploy markers, and the last 24 h of error budget consumption. The dashboard is owned by the service owner; a stale dashboard is a P2 bug.

### 5.5 Alerts

An alert is **actionable** or it is not an alert. The alert payload contains the link to the runbook and the run_id. We do not page on symptoms we cannot act on.

| Alert | Condition | Page? | Runbook |
| --- | --- | --- | --- |
| `ProdErrorRateHigh` | 5xx > 1 % for 5 min | Yes | `docs/runbooks/5xx-spike.md` |
| `AgentRunHung` | p99 stage duration > 3× p99 over 24 h | Yes | `docs/runbooks/run-hung.md` |
| `BudgetNearLimit` | daily spend > 80 % of cap | No (Slack) | `docs/runbooks/budget.md` |
| `MCPServerDown` | MCP tool error rate > 50 % for 5 min | Yes (vendor first) | `docs/runbooks/mcp-down.md` |
| `DiskPressure` | disk > 85 % | No (auto-scale) | `docs/runbooks/disk.md` |

### 5.5.1 Sample alert payload

The shape below is what Alertmanager delivers to PagerDuty and Slack. Every field is required; an alert that omits `runbook` or `run_id` is rejected at the alert-lint check in CI. The `severity` is one of `page`, `ticket`, or `notify`; the `condition` is the PromQL expression that fired; the `labels` are passed through from the Prometheus rule.

```json
{
  "alert": "AgentRunHung",
  "severity": "page",
  "status": "firing",
  "starts_at": "2026-06-16T18:42:11Z",
  "ends_at": null,
  "tenant_id": "acme-corp",
  "run_id": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "stage": "dev",
  "agent_id": "agent:developer",
  "condition": "histogram_quantile(0.99, sum(rate(agent_run_duration_seconds_bucket{stage=\"dev\"}[5m])) by (le)) > 3 * histogram_quantile(0.99, sum(rate(agent_run_duration_seconds_bucket{stage=\"dev\"}[24h])) by (le))",
  "threshold": "p99 stage duration > 3× p99 over 24 h",
  "runbook": "https://runbooks.fora.internal/run-hung",
  "dashboard": "https://grafana.fora.internal/d/agent-runs/agent-runs?var-run_id=run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "labels": {
    "stage": "dev",
    "tenant_id": "acme-corp",
    "env": "prod"
  },
  "annotations": {
    "summary": "Agent run hung in dev stage (p99 > 3× baseline)",
    "description": "Run run_01J7Z3R8M4F1Q9B2C7D5E6H7K0 for tenant acme-corp has been in the dev stage for 14m 22s, exceeding the 3× p99 baseline of 4m 30s. Check the runbook before paging."
  }
}
```

A `severity: "ticket"` alert posts to the on-call queue (no page); a `severity: "notify"` alert posts to a Slack channel (no ticket, no page). Both still require `runbook` and `dashboard`.

## 6. On-call

- **Rotation:** weekly, Mon 09:00 UTC → Mon 09:00 UTC. Two people on primary, one on secondary. The CTO is the tertiary unless explicitly off-rotation.
- **Page budget:** 10 pages per week per on-call is the upper bound. Hitting it triggers a process review, not a punishment.
- **Hand-off:** the outgoing on-call writes a 5-line summary of open issues to the incoming on-call, in the team channel, by 09:00 UTC Monday.
- **Every page produces a retro.** A page that did not result in action is a P2 bug in the alert itself.

## 7. Incident response (the play)

1. **Acknowledge** the page in < 5 min. Silence is the worst answer.
2. **Open the runbook.** The runbook is the only acceptable response. Improvisation is for after the runbook is exhausted.
3. **Mitigate first, fix later.** Rollback > forward-fix when customer impact is active.
4. **Communicate.** Status page update within 15 min for customer-impacting incidents. Internal Slack channel in `#inc-<id>` for the war room.
5. **Postmortem within 5 business days.** Blameless. The postmortem lists contributing factors, the systemic fix, and the owner with a date.

## 8. Backup, restore, DR

- **DB:** point-in-time recovery, 35-day retention, 5-min RPO. Backups verified nightly by a restore-into-staging test.
- **Object store:** cross-region replication, 7-year retention for audit artefacts.
- **Audit log:** cross-account, write-only from the runtime account, replicate to a separate region.
- **DR runbook:** `docs/runbooks/disaster-recovery.md`. Game-day exercise quarterly.

## 9. Cost discipline

- **Per-tenant cost attribution.** Every billable action carries a `tenant_id`; the cost is rolled up to the tenant hourly.
- **Budgets are enforced, not displayed.** A run that exceeds its budget halts; an account that exceeds its monthly cap alerts Finance and the CTO.
- **FinOps review** monthly. The top-5 most expensive services each get a one-page "is this still worth it" writeup.
- **Right-sizing** is a standing ticket in the backlog; instances older than 90 days without a right-sizing review are auto-flagged.

## 10. DevOps anti-patterns (auto-flag in review)

- A service that ships without a dashboard, a runbook, or an alert.
- A change to IAM, security groups, or egress that is not in Terraform.
- A deploy that requires manual steps not in the pipeline.
- A "temporary" SSH tunnel or bastion that lives past the incident.
- A new service that does not declare its p50/p99/RPS budget.
- An alert without a runbook link, or a runbook that has not been touched in 6 months.

## 11. Related

- Coding standards this builds on: see [coding.md](./coding.md)
- IAM, secrets, and egress controls: see [security.md](./security.md)
- The staged workflow that this pipeline serves: see [architecture.md §3](./architecture.md)
- The concrete tech: see [project/tech-stack.md](../project/tech-stack.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it adds or removes a CI pipeline stage (§2), changes the deploy strategy (§4), changes the alert payload shape (§5.5.1), or changes the incident severity matrix (§7 of devops). A change that loosens a deploy gate, a backup RPO/RTO, or an alert runbook link is rejected. The CTO owns merges to this file. The Stage contract in §12 lives under Epic 6 and is versioned separately.

---

## 12. Stage contract — Epic 6 (DevOps stage)

This section is the **handoff contract** between Epic 5 (Security) and Epic 7 (Docs); the DevOps stage is what actually moves code into the customer cloud. The full plan lives on the epic; this section is the engineer-facing summary.

**Stage placement:** 6th of 7 (`Ideation → Architect → Dev → QA → Security → DevOps → Docs`). No new stages — DevOps is the last stage that touches the cloud.

**Sub-goals:**
- **6.1 Artifact generation** — `artifact-generator` (DevOps). Dockerfile, Terraform, Helm, GitHub Actions, ArgoCD app. Delivered as a PR. MCPs: GitHub MCP, AWS/Azure/GCP MCP (read-only), Confluence MCP. Issue: [FORA-40](/FORA/issues/FORA-40). Blocked by [FORA-19 Epic 3](/FORA/issues/FORA-19) and [FORA-21 Epic 5](/FORA/issues/FORA-21).
- **6.2 Deployment** — `deploy-agent` (Cloud Architect). ArgoCD sync + post-deploy verification + audit log entry + stage-handoff JSON to Epic 7. MCPs: AWS / Azure / GCP MCP, GitHub MCP, Slack/Teams MCP, Confluence MCP. Issue: [FORA-44](/FORA/issues/FORA-44). Blocked by [FORA-40](/FORA/issues/FORA-40).

**Hard rules (the "no surprises" rules):**
1. The agent has **no IAM role of its own** — all `apply` happens via GitHub Actions OIDC into a per-env least-privilege role. Console access is denied.
2. The agent **cannot `git push` to `main` or `release/*`** — PR creation only, enforced at the MCP permission layer.
3. **`prod` deploys require a recorded human approver** — Slack/Teams thread, audit log entry, OR a resolved `request_board_approval` interaction. The agent cannot bypass this gate. Fri–Mon deploys need a CTO approver in addition.
4. **No shared context with the Developer agent** — the DevOps stage inherits the same isolation rule as Security (per the plan).
5. **No new stages** — adding a "post-deploy verification" or "rollback" stage is rejected; both live inside 6.2.

**Stage-handoff JSON (5 → 6.1):** `{ tenant_id, service, image: { repo, tag }, customer: { cloud, region, k8s }, security_clearance: { secrets, deps, iac } }`. See `/docs/agents/artifact-generator.md` (TBD on [FORA-40](/FORA/issues/FORA-40)) for the full schema.

**Stage-handoff JSON (6.1 → 6.2):** adds `helm_overrides`, `rollback: { previous_tag }`, `deploy_window: { allowed, needs_cto }`.

**Stage-handoff JSON (6.2 → 7):** the release notes seed — what shipped, where, when, with the image tag and the run_id.

**Rollback contract:** single command, ≤ 5 minutes, automatic on a failed post-deploy verify. Previous image retained for 30 days.

**Cost budget (per run, target ceiling):**
- `artifact-generator` small change: ≤ 1 000 tokens
- `artifact-generator` new service: ≤ 4 000 tokens
- `deploy-agent` decision: ≤ 500 tokens
- Per-tenant per-day cap enforced by the [cost-agent] (Epic 0.6).

**Acceptance for the epic:** [FORA-40](/FORA/issues/FORA-40) done + [FORA-44](/FORA/issues/FORA-44) done + audit log captures pre/post hashes + a real customer deploy behind the gate.

**The full plan (rev 1):** [Epic 6 — DevOps Stage Plan](/FORA/issues/FORA-22#document-devops-stage-plan).

## 13. DevOps anti-patterns — extended for the stage

- An agent that holds an AWS access key. (No — OIDC only.)
- A "manual override" in the deploy workflow that skips the human-approval gate. (No — wire it through `request_board_approval` if you really need one.)
- A deploy PR merged on a Friday. (No — window enforcement; CTO required Fri–Mon.)
- A `prod` deploy with no audit log entry. (No — the audit log is the receipt; the deploy is invalid without it.)
- A rollback that requires a human to remember a previous tag. (No — `argocd app rollback --revision <previous>` is the only allowed path.)
- A post-deploy smoke test that takes > 5 minutes. (No — if you can't verify in 5, the change is too big; split it.)
