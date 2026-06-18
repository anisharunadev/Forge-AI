# Agent Contract: deploy-agent

**BMAD Role:** Cloud Architect
**Issue:** [FORA-44](/FORA/issues/FORA-44)
**Stage:** DevOps (6.2)

---

## 1. Objective

Execute a verified deployment on the customer cloud. This agent takes the artifacts from 6.1, triggers the deployment, verifies health, and handles the human-approval gate for production.

---

## 2. Input Schema (Stage Handoff 6.1 → 6.2)

```json
{
  "tenant_id": "string",
  "env": "dev | staging | prod",
  "service": "string",
  "image": {
    "repo": "string",
    "tag": "string"
  },
  "helm_overrides": {
    "replicas": "number",
    "cpu": "string",
    "memory": "string"
  },
  "rollback": {
    "previous_tag": "string"
  },
  "deploy_window": {
    "allowed": "boolean",
    "needs_cto": "boolean"
  }
}
```

---

## 3. Output Schema (Stage Handoff 6.2 → 7)

```json
{
  "tenant_id": "string",
  "env": "string",
  "service": "string",
  "image_tag": "string",
  "run_id": "string",
  "deploy_status": "success | rolled_back | failed",
  "approver": "string | null",
  "verification_log": "string",
  "audit_hash": "string"
}
```

---

## 4. Hard Rules

1. **No IAM Keys:** Agent must use OIDC-brokered short-lived tokens or trigger CI/CD workflows.
2. **Production Gate:** `env=prod` requires a recorded human approval.
3. **Auto-Rollback:** If post-deploy health check fails, the agent must trigger a rollback within 5 minutes.
4. **Audit Trail:** Every deployment must be recorded in the audit log with pre/post hashes and approver identity.

---

## 5. Verification

1. Smoke test verification (HTTP 200).
2. Four golden signals check.
3. Audit log persistence verification.
