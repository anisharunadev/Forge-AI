# DevOps Agent

Stage 6 of the Forge AI SDLC pipeline.

## Mission
Merge → verified deploy on the customer's cloud. Human approval required.

## Components

### 1. `artifact-generator` (Epic 6.1)
Generates build-time and deploy-time artefacts for a merge-ready PR.
- **Dockerfile:** Multi-stage, non-root, pinned base.
- **Terraform:** Infrastructure modules for the service.
- **Helm:** Charts for Kubernetes deployment.
- **GitHub Actions:** CI/CD workflow definitions.
- **ArgoCD:** Application manifests.
- **Runbook:** Deploy and rollback documentation.

### 2. `deploy-agent` (Epic 6.2)
Executes and verifies the deployment.
- **OIDC Apply:** Assumes cloud roles via GitHub Actions OIDC.
- **ArgoCD Sync:** Triggers the deployment.
- **Smoke Test:** Post-deploy verification.
- **Rollback:** Automatic rollback on failure.
- **Human Gate:** Mandatory approval for `prod` deploys.

## Contracts
See `agents/devops/schemas.py` for structured I/O.

## Knowledge Layer
- `workspace/memory/devops.md` — Stage-specific steering rules and anti-patterns.
- `workspace/project/tech-stack.md` — Service framework and cloud target hints.
