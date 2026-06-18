# Runbook: reference-service

**Service:** `reference-service`
**Tenant:** `fora`
**Owner:** Platform Team / CTO
**Contract:** `docs/agents/artifact-generator.md` v0.2 §10 (rollback)

---

## 1. Deployment

The service is deployed via the **artifact-generator** (DevOps / stage 6.1) +
**deploy-agent** (stage 6.2). Both agents open PRs; **no direct push to `main`
or `release/*`** is permitted (MCP gate §5.2).

### 1.1 Standard flow
1. The 5.x (Security) stage emits a stage-handoff JSON. The
   `artifact-generator` opens a PR on a `forge/6.1/fora/reference-service/art-…`
   branch.
2. The PR runs the 7-stage CI in `.github/workflows/reference-service.yml`,
   including `terraform-plan-dev` (OIDC, `AWS_ROLE_DEV`, **plan only — no
   apply**). The plan output is posted as a PR comment.
3. After review + green CI, the PR is merged. The `apply-dev` job in the same
   workflow (post-merge trigger) runs `terraform apply` and reconciles via
   ArgoCD. (Out of scope for the 6.1.a child ticket — handled by Epic 6.2.)

### 1.2 Manual image bump (out-of-band)
If a new image tag must be rolled without a full artifact run:
1. Open a PR that updates `infra/argocd/dev/reference-service.yaml` and
   `infra/charts/reference-service/values-dev.yaml` with the new tag.
2. CI must re-run the `lint` and `conftest` jobs (no `:latest`).
3. After merge, ArgoCD auto-syncs within 3 minutes.

---

## 2. Verification

### 2.1 Health
```bash
kubectl -n dev port-forward svc/reference-service 8080:80
curl -s http://localhost:8080/health
# expected: {"status":"UP"}
```

### 2.2 Metrics
Prometheus scrapes `/metrics` on the same port. Confirm via the tenant
dashboard: `dashboards/reference-service`.

### 2.3 Logs
CloudWatch log group: `/fora/dev/reference-service` (output
`log_group_name` from Terraform). Search:
```
fields @timestamp | filter service="reference-service" | …
```

### 2.4 Audit
Every artefact change emits an `AuditEvent` (artifact-generator v0.2 §6) with
`tenant_id`, `run_id`, `agent_id`, `ref`, and the artefact diff. The audit
sink is **append-only**; verify the handoff chain by running
`tests/devops/test_audit_completeness.py` (FORA-214).

---

## 3. Rollback (artifact-generator v0.2 §10)

Rollback is the inverse of generation. **Do not** manually `terraform destroy`
or `kubectl rollout undo` — both are anti-patterns auto-flagged by the
reviewer (`workspace/memory/devops.md §13`).

### 3.1 Revert the PR
```bash
gh pr revert <pr-url> --branch forge/6.1/fora/reference-service/art-<id>-revert
```
The revert PR runs the same 7-stage CI and lands via the same branch pattern.
Each reverted file emits an `artifact.rolled_back` audit event with
`prev_hash` = the original run's `diff_hash`.

### 3.2 ArgoCD reconciles automatically
The ArgoCD `Application` tracks the PR branch, so reverting the PR
reconciles the cluster to the previous chart revision within 3 minutes
(default ArgoCD sync window). Verify:
```bash
argocd app history reference-service-dev
```

### 3.3 Image retention
The previous image tag is retained for 30 days
(`workspace/memory/devops.md §4`). After 30 days, rollback is a chart pin
to the previous digest — not an image pull.

### 3.4 Audit chain
The `AuditEvent` log is the source of truth. The rollback run has a `run_id`
of the form `art-…-revert`; its `prev_hash` is the `diff_hash` of the
original run, so the chain is fully linked.

---

## 4. Troubleshooting

| Symptom | First check |
| --- | --- |
| `ImagePullBackOff` | Image exists in `ghcr.io/fora-org/reference-service:<tag>`? Tag pinned? |
| `CrashLoopBackOff` | CloudWatch logs for the previous boot — usually a missing `valueFrom` secret or a `403` from the IRSA role. |
| IAM `AccessDenied` on a secret | Verify `serviceAccount.irsaRoleArn` matches `terraform output iam_role_arn` for the target env. |
| ArgoCD `OutOfSync` for >10 min | `argocd app history reference-service-dev` — the diff should match the latest merged PR. If not, file a 6.1 follow-up. |
| Audit chain broken | `tests/devops/test_audit_completeness.py` will tell you which `audit_log_entry_id` is missing. The audit-sink forwarder is `audit/` (FORA-36). |

---

## 5. Owner contact

- **Primary:** Platform Team
- **Escalation:** CTO
- **Incident channel:** `#incidents` (per `workspace/memory/observability.md`)
