# Agent Contract: artifact-generator

**BMAD Role:** DevOps Engineer (DevOps stage, 6.1)
**Issue:** [FORA-40](/FORA/issues/FORA-40)
**Stage:** DevOps (Epic 6)
**Schema version:** `0.2.0`
**Owner:** CTO (until a dedicated DevOps agent is hired)

---

## 1. Objective

Translate a stage-5 (Security) stage-handoff into a merge-ready IaC + CI/CD Pull
Request under `infra/` in the customer repo. The agent never merges and never
pushes to protected branches — it opens a PR and hands the diff off to a human
reviewer and to Epic 6.2 (deploy-agent).

**In scope (this agent):** Dockerfile, Terraform module, Helm chart, GitHub
Actions workflow, ArgoCD Application manifest, Confluence runbook page,
`AuditEvent` per artefact.

**Out of scope:** the actual `terraform apply` (Epic 6.2 / `deploy-agent`),
cross-region failover (separate DR ticket), and any human-approval gate on the
deploy (6.2 owns that).

---

## 2. Stage-handoff INPUT (5 → 6.1)

The artifact-generator consumes the exact JSON shape that the Security stage
already emits. Every field is required unless marked `optional`.

```json
{
  "schema_version": "1.0.0",
  "tenant_id": "acme-corp",
  "service": "billing-api",
  "image": {
    "repo": "ghcr.io/fora-org/billing-api",
    "tag": "v1.4.0-rc.2"
  },
  "customer": {
    "cloud": "aws",
    "region": "us-east-1",
    "k8s": "eks"
  },
  "security_clearance": {
    "secrets": "clean",
    "deps": "clean",
    "iac": "clean",
    "findings_waived": []
  },
  "ci": {
    "pr_url": "https://github.com/fora-org/billing-api/pull/118",
    "commit_sha": "9f3c1e2b4a5d6e7f8091a2b3c4d5e6f7a8b9c0d1",
    "stages_passed": ["lint", "typecheck", "unit", "integration", "e2e", "build"]
  },
  "profile": {
    "language": "typescript",
    "framework": "node20-fastify",
    "ports": [3000]
  }
}
```

**Validation rules.** A handoff is rejected (status `failed`, no PR opened) if:

- `schema_version` ≠ `"1.0.0"`.
- Any of `secrets | deps | iac` is `"flagged"` **and** the same finding is not
  listed in `findings_waived` with a `waived_by` user-id.
- `stages_passed` is missing any of the six stages from
  [`workspace/memory/devops.md §2`](../memory/devops.md).
- `image.tag` does not resolve to a digest in the customer GHCR/ECR.
- `customer.cloud` is not in `{aws, azure, gcp}` (no on-prem in v0.2).

---

## 3. Stage-handoff OUTPUT (6.1 → 6.2)

This is the JSON the deploy-agent consumes. Schema is versioned; a 6.1 PR that
emits an older version is rejected by the 6.2 broker.

```json
{
  "schema_version": "1.0.0",
  "run_id": "art-3a1f9c2e8b40",
  "tenant_id": "acme-corp",
  "service": "billing-api",
  "artifact_set": {
    "pr_url": "https://github.com/fora-org/billing-api/pull/121",
    "pr_branch": "forge/6.1/acme-corp/billing-api/art-3a1f9c2e8b40",
    "commit_sha": "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
    "files": [
      {"path": "infra/docker/billing-api/Dockerfile",      "kind": "dockerfile",     "diff_hash": "sha256:…"},
      {"path": "infra/terraform/billing-api/main.tf",      "kind": "terraform",      "diff_hash": "sha256:…"},
      {"path": "infra/terraform/billing-api/iam.tf",       "kind": "terraform",      "diff_hash": "sha256:…"},
      {"path": "infra/charts/billing-api/values.yaml",     "kind": "helm",           "diff_hash": "sha256:…"},
      {"path": ".github/workflows/billing-api.yml",        "kind": "github_actions", "diff_hash": "sha256:…"},
      {"path": "infra/argocd/dev/billing-api.yaml",        "kind": "argocd",         "diff_hash": "sha256:…"},
      {"path": "infra/argocd/staging/billing-api.yaml",    "kind": "argocd",         "diff_hash": "sha256:…"},
      {"path": "docs/runbooks/billing-api.md",             "kind": "runbook",        "diff_hash": "sha256:…"}
    ],
    "iam_role_arn": "arn:aws:iam::123456789012:role/acme-corp-dev-billing-api-role",
    "image": {
      "repo": "ghcr.io/fora-org/billing-api",
      "tag":  "v1.4.0-rc.2",
      "digest": "sha256:…"
    }
  },
  "cost": {
    "tokens_in":  780,
    "tokens_out": 220,
    "tokens_total": 1000,
    "budget_class": "small"
  },
  "audit_log_entry_ids": [
    "audit-3a1f9c2e8b40-dockerfile",
    "audit-3a1f9c2e8b40-terraform",
    "audit-3a1f9c2e8b40-helm",
    "audit-3a1f9c2e8b40-github_actions",
    "audit-3a1f9c2e8b40-argocd",
    "audit-3a1f9c2e8b40-runbook"
  ]
}
```

`pr_url` is the only field 6.2 strictly requires to schedule a deploy; the rest
is material for the audit trail and for the rollback contract.

---

## 4. Hard rules

These are non-negotiable. The CI lint job **fails the build** if any of them
fires.

1. **No direct push to `main` or `release/*`.** The agent only creates a PR via
   the GitHub MCP `create_pull_request` tool. Any `git push` or MCP call whose
   target is a protected branch returns `403 PROTECTED_BRANCH_BLOCKED` from the
   MCP permission layer (see §5.2) and aborts the run.
2. **No IAM keys in code or in the agent's runtime env.** The agent's only
   path to AWS / Azure / GCP is **read-only** at first; mutating calls route
   through the GitHub Actions OIDC role attached to the `apply` job. Long-lived
   credentials are blocked by `iam-boundary` (`FORA-125`).
3. **Pinned versions.** Base image digests, provider versions, and Helm chart
   `appVersion` are pinned to a specific value (not `latest`, not `*`).
4. **Non-root containers.** The Dockerfile runs as `runAsUser != 0` and drops
   all Linux capabilities; the Helm chart enforces
   `securityContext.runAsNonRoot: true` and `readOnlyRootFilesystem: true`.
5. **No secrets in code.** Every secret reference is `aws_secretsmanager_secret`
   (or Azure Key Vault / GCP Secret Manager) and is never inlined. The
   `secrets:` block in the agent prompt is forbidden (`FORA-128.d`).
6. **Least-privilege IAM.** The service role grants only the permissions the
   service uses; `iam:PassRole` is scoped to the deploy role's ARN.
7. **PII / cross-tenant isolation.** Every resource is namespaced by
   `tenant_id`; the broker enforces `tenants/{tenant_id}/…` prefixes
   (`FORA-164`).

---

## 5. MCPs and permission layer

### 5.1 Allowed MCPs

| MCP | Tools used in 6.1 | Mode |
| --- | --- | --- |
| `github` | `create_branch`, `create_or_update_file`, `create_pull_request`, `get_pull_request`, `list_pull_request_files`, `add_pull_request_review_comment` | write to a feature branch only |
| `aws` (and `azure` / `gcp` per `customer.cloud`) | `pricing:get-products`, `ec2:describe-vpcs`, `eks:describe-cluster`, `secretsmanager:list-secrets` | **read-only**; OIDC-brokered via `customer-cloud-broker` (`FORA-126`) |
| `confluence` | `create_page`, `update_page` (under `customers/{tenant}/runbooks/{service}`) | write to a customer-scoped space only |
| `jira` | `add_comment`, `attach_link` (for the 6.1 PR link) | write to the `tenant`-scoped project only |
| `audit` | `audit.append` | append-only sink (`FORA-36`) |

### 5.2 Branch-protection enforcement (AC #3)

The `github` MCP server runs an in-process `BranchProtectionPolicy`:

```python
PROTECTED_REFS = {"refs/heads/main"} | {f"refs/heads/release/{m}" for m in MONTHS}
PROTECTED_ACTIONS = {"push_ref", "create_or_update_file_on_protected_ref"}

def gate(tool, args):
    if tool in PROTECTED_ACTIONS and args.get("ref") in PROTECTED_REFS:
        return _403("PROTECTED_BRANCH_BLOCKED",
                    extra={"ref": args["ref"], "tool": tool})
    if tool == "create_pull_request" and args.get("base") in PROTECTED_REFS:
        # PR creation is allowed; head must be a feature branch (forge/6.1/...).
        if not args.get("head", "").startswith(f"forge/6.1/{args['tenant_id']}/"):
            return _403("PROTECTED_BRANCH_BLOCKED",
                        extra={"head": args["head"], "expected_prefix":
                               f"forge/6.1/{args['tenant_id']}/"})
    return _ok()
```

`PROTECTED_REFS` is recomputed at MCP startup; the protected set is the union
of `main` and every `release/<yyyy-mm>` branch that has shipped in the last 30
days. The contract test (`tests/devops/test_branch_gate.py`) enumerates the
protected set and asserts every `forge/6.1/...` head is accepted while
`forge/6.1/.../main` and `forge/6.1/.../release/*` are rejected.

### 5.3 IAM-boundary gate (cross-cuts `iam-boundary`)

Any MCP call that would result in mutating customer-cloud state from the agent
runtime is rejected with `403 IAM_BOUNDARY_VIOLATION` unless it goes through the
GitHub Actions `apply` job's OIDC role. Read-only calls are allowed under
`iam-boundary:read`. This is enforced by `customer-cloud-broker`
(`FORA-126`) and is not an artifact-generator concern except for the contract
test in `tests/devops/test_iam_boundary.py`.

---

## 6. Audit log (AC #4)

Every artefact change appends an `AuditEvent` to the runtime audit sink
(`FORA-36`, JSONL append-only). The event shape is fixed; the broker
redacts `secrets`, `tokens`, and `bearer` fields at append time
(`FORA-128.f`, `FORA-189`).

```json
{
  "event":         "artifact.changed",
  "schema_version": "1.0.0",
  "tenant_id":     "acme-corp",
  "run_id":        "art-3a1f9c2e8b40",
  "agent_id":      "agent:artifact-generator",
  "stage":         "devops",
  "sub_stage":     "6.1",
  "service":       "billing-api",
  "ref": {
    "repo":   "fora-org/billing-api",
    "branch": "forge/6.1/acme-corp/billing-api/art-3a1f9c2e8b40",
    "sha":    "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
  },
  "artifact": {
    "path":       "infra/terraform/billing-api/main.tf",
    "kind":       "terraform",
    "diff_hash":  "sha256:…",
    "prev_hash":  "sha256:…",
    "diff_bytes": 4821
  },
  "policy": {
    "mcp_permission_layer": "forge/branch-protection/v1",
    "iam_boundary": "iam-boundary:read",
    "branch_gate": "PROTECTED_BRANCH_BYPASS_NOT_USED"
  },
  "ts":        "2026-06-18T19:42:11.012Z",
  "request_id": "req-…"
}
```

A run is **invalid** if the audit log is missing any of the expected
`audit_log_entry_ids` listed in the 6.1 → 6.2 handoff. The verification
property lives in `tests/devops/test_audit_completeness.py`.

---

## 7. Cost budget (AC #5)

| Class | Token target (input + output) | Hard ceiling |
| --- | --- | --- |
| `small` (≤ 3 artefact kinds changed) | ≤ 1 000 | 1 500 |
| `new`  (new service, all 7 kinds) | ≤ 4 000 | 6 000 |
| `rerun` (idempotent re-run, no schema delta) | ≤ 250 | 500 |

Per-tenant per-day cap: **50 000 tokens** across all 6.1 runs. The cap is
enforced by the cost-agent (`FORA-75`); a run that would push the tenant over
the cap aborts with `429 TENANT_BUDGET_EXCEEDED` and the operator is paged.

The cost block in the 6.1 → 6.2 handoff (§3) is the source of truth for what
gets billed. The broker adds a `cost.actual` field at 6.2 commit time if the
deploy added cloud spend; 6.1 cannot know that.

---

## 8. Verification (AC #6 part 1)

The reference-service PR must run the following CI jobs, all green, before
`in_review`:

1. `lint` — `pnpm lint`, `helm lint`, `tflint`.
2. `terraform validate` + `terraform plan -var-file=dev.tfvars` against the
   dev account (read-only plan, OIDC role `AWS_ROLE_DEV`).
3. `helm template` against the chart, with all `values-<env>.yaml` overlays.
4. `conftest` policy check against the Open Policy Agent bundle in
   `policy/devops/*.rego` (deny-on: `:latest` image, `runAsRoot`, plaintext
   secret).
5. `audit_completeness` — runs the property test that the audit log entry
   count matches the handoff.

A `terraform plan` failure **blocks merge**; the run returns
`status: "failed"`, the PR is left open with a comment that includes the
`plan` output, and a new child issue is opened (`FORA-44X`) to triage the
delta.

---

## 9. Failure modes

| Mode | Detection | Behaviour |
| --- | --- | --- |
| `security_clearance.flagged` and not in `findings_waived` | handoff validator (§2) | Abort with `status: "failed"`, no PR opened, audit event `artifact.rejected.security`. |
| `stages_passed` missing a stage | handoff validator | Same as above; audit event `artifact.rejected.ci`. |
| MCP call hits `PROTECTED_BRANCH_BLOCKED` | MCP gate (§5.2) | Abort, audit event `artifact.rejected.branch`. **The agent must never retry with a different branch.** |
| `terraform plan` fails | CI job | PR left open with the plan output, status `failed`, child issue opened. |
| `helm template` fails | CI job | PR left open, status `failed`. |
| `conftest` rego denies a resource | CI job | PR left open, status `failed`. |
| `AuditEvent` append fails (sink unavailable) | broker | Abort before opening the PR, status `failed`, audit event `artifact.rejected.audit_unavailable`. |
| `TENANT_BUDGET_EXCEEDED` | cost-agent | Abort, no PR, audit event `artifact.rejected.budget`. |
| Confluence page creation fails | MCP error | PR is **still opened**; runbook publish is retried by a follow-up child issue. PR does not block on Confluence. |
| `image.tag` not in registry | handoff validator | Abort before any MCP call. |

All failure modes emit exactly one `artifact.rejected.*` or
`artifact.failed.*` audit event with the `tenant_id`, `run_id`, `agent_id`,
and the reason.

---

## 10. Rollback (AC #6 part 2)

Rollback is the inverse of generation:

1. **Revert the PR.** `gh pr revert <pr_url>` produces a revert PR; the
   revert runs the same CI suite, lands via the same `forge/6.1/...` branch
   pattern, and emits `artifact.rolled_back` audit events for each file.
2. **ArgoCD.** Because every ArgoCD `Application` tracks a specific Git ref,
   reverting the PR automatically reconciles the cluster to the previous
   chart revision within 3 minutes (ArgoCD default sync window).
3. **Image retention.** The previous image tag is retained for 30 days
   (`workspace/memory/devops.md §4`). After 30 days, the rollback is a chart
   pin to the previous digest, not an image pull.
4. **Audit.** The audit chain (`AuditEvent` per artefact change) is the
   source of truth. The rollback run is a new 6.1 invocation with
   `run_id` of the form `art-…-revert`; its `prev_hash` field is the
   `diff_hash` of the original run, so the chain is fully linked.
5. **What we do not do.** No `terraform destroy` of a service. No manual
   `kubectl rollout undo`. Both are anti-patterns auto-flagged by the
   reviewer (`workspace/memory/devops.md §13`).

The full rollback procedure is also embedded in the customer runbook
(`docs/runbooks/{service}.md`) so an on-call engineer can execute it
without a 6.1 invocation.

---

## 11. Sample I/O (AC #6 part 3)

### 11.1 Input — small change

```json
{
  "schema_version": "1.0.0",
  "tenant_id": "acme-corp",
  "service": "billing-api",
  "image": {"repo": "ghcr.io/fora-org/billing-api", "tag": "v1.4.0-rc.2"},
  "customer": {"cloud": "aws", "region": "us-east-1", "k8s": "eks"},
  "security_clearance": {"secrets": "clean", "deps": "clean", "iac": "clean", "findings_waived": []},
  "ci": {"pr_url": "https://github.com/fora-org/billing-api/pull/118", "commit_sha": "9f3c1e2b4a5d6e7f8091a2b3c4d5e6f7a8b9c0d1", "stages_passed": ["lint", "typecheck", "unit", "integration", "e2e", "build"]},
  "profile": {"language": "typescript", "framework": "node20-fastify", "ports": [3000]}
}
```

### 11.2 Output (small change, 4 artefact kinds)

```json
{
  "schema_version": "1.0.0",
  "run_id": "art-3a1f9c2e8b40",
  "tenant_id": "acme-corp",
  "service": "billing-api",
  "artifact_set": {
    "pr_url":   "https://github.com/fora-org/billing-api/pull/121",
    "pr_branch":"forge/6.1/acme-corp/billing-api/art-3a1f9c2e8b40",
    "commit_sha":"1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
    "files": [
      {"path":"infra/charts/billing-api/values.yaml",     "kind":"helm",           "diff_hash":"sha256:7c1f…"},
      {"path":".github/workflows/billing-api.yml",        "kind":"github_actions", "diff_hash":"sha256:9a0e…"},
      {"path":"infra/argocd/dev/billing-api.yaml",        "kind":"argocd",         "diff_hash":"sha256:b1c2…"},
      {"path":"docs/runbooks/billing-api.md",             "kind":"runbook",        "diff_hash":"sha256:d34d…"}
    ],
    "iam_role_arn": "arn:aws:iam::123456789012:role/acme-corp-dev-billing-api-role",
    "image": {"repo":"ghcr.io/fora-org/billing-api","tag":"v1.4.0-rc.2","digest":"sha256:feed…"}
  },
  "cost": {"tokens_in": 612, "tokens_out": 188, "tokens_total": 800, "budget_class": "small"},
  "audit_log_entry_ids": [
    "audit-3a1f9c2e8b40-helm",
    "audit-3a1f9c2e8b40-github_actions",
    "audit-3a1f9c2e8b40-argocd",
    "audit-3a1f9c2e8b40-runbook"
  ]
}
```

### 11.3 Input — failure mode (`security_clearance.flagged`)

```json
{
  "schema_version": "1.0.0",
  "tenant_id": "acme-corp",
  "service": "billing-api",
  "image": {"repo": "ghcr.io/fora-org/billing-api", "tag": "v1.4.0-rc.2"},
  "customer": {"cloud": "aws", "region": "us-east-1", "k8s": "eks"},
  "security_clearance": {"secrets": "flagged", "deps": "clean", "iac": "clean", "findings_waived": []}
}
```

→ **No PR opened.** Audit event:

```json
{
  "event": "artifact.rejected.security",
  "tenant_id": "acme-corp",
  "run_id": "art-7d2e0c4b9a81",
  "agent_id": "agent:artifact-generator",
  "stage": "devops",
  "sub_stage": "6.1",
  "reason": "security_clearance.secrets=flagged not in findings_waived",
  "ts": "2026-06-18T19:50:02.114Z"
}
```

---

## 12. Acceptance-criteria map

| AC | Owner | Evidence |
| --- | --- | --- |
| 1. Spec merged at `/docs/agents/artifact-generator.md` with full I/O schema and 6.1 → 6.2 handoff | this file (v0.2.0) | §2, §3 |
| 2. Reference-service PR (no direct commit) with CI: lint + `terraform plan` against dev | `forge/6.1/reference-service/...` PR, dispatched as child of FORA-40 | child issue `FORA-212` |
| 3. Agent cannot `git push` to `main` or `release/*` — only PR creation | MCP `BranchProtectionPolicy` (§5.2) | `tests/devops/test_branch_gate.py` |
| 4. Audit log captures every change with `tenant_id`, `run_id`, `agent_id`, full diff | `AuditEvent` shape (§6) | `tests/devops/test_audit_completeness.py` |
| 5. Cost ≤ 1k small / ≤ 4k new; per-tenant per-day cap | Cost budget table (§7) | `tests/devops/test_cost_class.py` |
| 6. Sample I/O, failure modes, rollback path | §9, §10, §11 | this section |

---

## 13. Versioning

- **0.2.0** (this revision): full I/O schema, MCP gate contract, audit shape,
  cost budget, failure-mode table, rollback, sample I/O, AC map.
- **0.1.0** (earlier draft): high-level intent, hard rules, verification list.
  Retired.

A change is a major version bump if it adds/removes an MCP, an artefact kind,
an audit-event shape, a hard rule (§4), a failure mode that flips the merge
decision, or a cost cap. A change to a sample, an example, or a documentation
clarification is a patch. The CTO owns merges to this file until a DevOps
agent is hired (`HIRING_PLAN §5`).
