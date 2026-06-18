---
title: Kubernetes (EKS)
description: The Helm chart, ArgoCD wiring, and pod-level security baseline for Forge AI on EKS.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/devops.md
generator: readme
approval_required: false
---

The Kubernetes layer of the Forge AI reference architecture. EKS 1.29+, Karpenter for autoscaling, ArgoCD for GitOps, and a pod-level security baseline that meets the [OWASP ASVS Level 2 bar](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md).

## The Helm chart

The platform chart lives in [`infra/helm/fora/`](https://github.com/fora-platform/fora/tree/main/infra/helm/fora). The values file for prod is [`infra/helm/fora/values-prod.yaml`](https://github.com/fora-platform/fora/blob/main/infra/helm/fora/values-prod.yaml).

```yaml
# values-prod.yaml (excerpt)
replicaCount: 3

image:
  repository: 123456789012.dkr.ecr.us-east-1.amazonaws.com/fora/orchestrator
  tag: v1.0.0
  pullPolicy: IfNotPresent

resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 2
    memory: 4Gi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 65532
  runAsGroup: 65532
  fsGroup: 65532
  seccompProfile:
    type: RuntimeDefault

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]

serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/fora-orchestrator
```

Every workload gets the same baseline: non-root, read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`.

## Pod layout

```bash
kubectl -n fora get deploy
# NAME                       READY   UP-TO-DATE   AVAILABLE
# orchestrator               3/3     3            3
# agent-runtime              6/6     6            6
# forge                      3/3     3            3
# mcp-jira                   2/2     2            2
# mcp-github                 2/2     2            2
# mcp-confluence             2/2     2            2
# mcp-sonarqube              2/2     2            2
# mcp-figma                  2/2     2            2
# mcp-aws                    2/2     2            2
# mcp-slack                  2/2     2            2
```

Each MCP server runs as a separate Deployment so an MCP bug can never take down the orchestrator.

## ArgoCD

ArgoCD is the GitOps controller. The platform's state lives in [`infra/argocd/`](https://github.com/fora-platform/fora/tree/main/infra/argocd):

```
infra/argocd/
├── apps/                     # ApplicationSet for every workload
├── projects/                 # AppProject definitions (RBAC)
├── repos/                    # repo credentials
└── overlays/
    ├── prod/
    └── staging/
```

`App-of-apps` syncs every workload from `infra/argocd/apps/`. Drift triggers a Slack alert.

## Karpenter

Karpenter is the autoscaler. Node pools are defined per workload class:

| Pool | Instance type | Workloads | Min | Max |
| --- | --- | --- | --- | --- |
| `system` | m6i.large | CoreDNS, ArgoCD, kube-proxy | 2 | 4 |
| `platform` | m6i.xlarge | orchestrator, forge, agent-runtime | 3 | 20 |
| `mcp` | m6i.large | MCP server pods | 2 | 30 |
| `spot` | m5.large / m5a.large | eval / scratch workloads | 0 | 50 |

## Secrets

Secrets come from **AWS Secrets Manager** via the [Secrets Store CSI Driver](https://secrets-store-csi-driver.sigs.k8s.io/). The driver mounts secrets as volumes; pods never read raw secret values at rest in etcd.

```yaml
volumes:
  - name: anthropic-secret
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: anthropic
```

## Network policies

Every namespace has a default-deny `NetworkPolicy`. Outbound traffic is restricted to:

- DNS (`kube-dns`)
- Postgres (`platform-rds:5432`)
- Redis (`platform-redis:6379`)
- The LLM provider (`api.anthropic.com:443` via the egress proxy)
- The MCP server pods (via the per-tenant proxy)
- The audit-account SQS (`sqs.us-east-1.amazonaws.com:443`)

The egress proxy is the **only** path to the public internet. It denies private CIDRs, resolves DNS itself, and logs every outbound call.

## Where to next

- **[Environment variables →](/self-host/environment/)** — every env var, every workload.
- **[Security →](/security/)** — pod security, network policies, secrets.
- **[Production deploy →](/installation/production/)** — single-node alternative.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/devops.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
