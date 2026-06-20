---
title: DevOps
description: The DevOps agent — the sixth stage. Pipeline config, deploy, release notes, and verification.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/devops.md
generator: readme
approval_required: false
---

The **DevOps agent** is the sixth stage. It wakes when Security passes and produces the **pipeline config**, the **deploy**, the **release notes**, and the **deploy verification**.

## What it reads

- The PR diff + ADR from earlier stages.
- The pipeline config in `infra/`.
- The release-train schedule.
- The Helm values in `infra/helm/`.

## What it produces

| Artefact | Storage |
| --- | --- |
| Pipeline config | `infra/.github/workflows/<workflow>.yml` |
| Helm values | `infra/helm/fora/values-<env>.yaml` |
| Release notes | `docs/release-notes/RELEASE_NOTES_<v>.md` |
| Changelog entry | `CHANGELOG.md` |
| Deploy verification | Sentry / Datadog + CloudWatch alarms |
| Cost report | Cost agent's table |

## The release train

Per [`memory/devops.md` §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/devops.md):

1. **Tag** — A release candidate tag is cut from `main` after the QA + Security stages pass.
2. **Stage** — The RC is deployed to staging via ArgoCD.
3. **Bake** — A 10-minute bake window runs against staging; any SLO violation auto-rollbacks.
4. **Prod** — The RC is deployed to prod via ArgoCD.
5. **Verify** — The deploy verification runs (synthetic checks, SLO metrics, error budget consumption).
6. **Communicate** — Slack #releases + customer channels (where pinned).

## The customer-pinned release

A customer-pinned release is a tag the customer references in their own change management (per [`customer/conventions.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/customer/conventions.md)). It:

- Is tagged `v<MAJOR>.<MINOR>.<PATCH>-<CUSTOMER>-<NNN>`.
- Ships release notes **5 business days in advance**.
- Is announced in the customer's preferred channel (email, Slack Connect, customer portal).

## The deploy

```bash
# tag a release
git tag -a v1.4.2 -m "Release v1.4.2"

# push the tag
git push origin v1.4.2

# ArgoCD picks up the new image tag
argocd app sync fora-prod
```

The DevOps agent writes the tag, the GitHub Actions workflow builds the image, the ECR push triggers ArgoCD, and the rollout proceeds.

## The bake window

The bake window is **10 minutes by default** (configurable per release). The SLO checks during the bake:

- HTTP 5xx rate < 0.1%
- p99 latency < 2× baseline
- Error budget consumption < 5%
- No new PagerDuty alerts

A failed bake triggers an **auto-rollback** to the previous revision.

## The cost ceiling at deploy time

A deploy that would push the per-run cost above the **$50 hard ceiling** is **paused** before the deploy. A human approval is required to proceed.

## When it fails

| Failure | Behaviour |
| --- | --- |
| Bake window SLO violation | Auto-rollback |
| Health check fails post-deploy | Auto-rollback |
| Pipeline can't build the image | Halt; return to Dev |
| Release notes not generated | Halt; return to Docs |

## Where to next

- **[Security →](/agents/security/)** — the previous stage.
- **[Documentation →](/agents/documentation/)** — the next stage.
- **[Architecture → Staged workflow →](/architecture/staged-workflow/)** — the full pipeline.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/devops.md</code> + <code>workspace/customer/conventions.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
