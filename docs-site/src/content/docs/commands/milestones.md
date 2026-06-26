---
draft: false
title: Milestones Commands
description: The 4 milestones commands — cut, tag, changelog, archive.
---

The milestones category has 4 commands that turn a deployed release into a durable record.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-milestone-cut` | admin | yes | Cut a release branch and bump versions |
| `forge-milestone-tag` | admin | yes | Tag the release commit |
| `forge-milestone-changelog` | user | no | Render the changelog for a release |
| `forge-milestone-archive` | admin | yes | Archive artifacts and notes for a release |

## What is this category for?

Milestones are the durable outputs of an SDLC cycle. After `forge-deploy-prod`, the team cuts a release, tags it, generates a changelog, and archives the artifacts. The archived bundle is what auditors and post-mortem reviewers read.

## How to use

### Cut (admin, requires approval)

```bash
pnpm forge:exec forge-milestone-cut \
  --args '{"version":"2026.06.21","bump_strategy":"minor","from_branch":"main"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Cuts a release branch from `main` (or the named source branch), bumps versions per the strategy, and opens a PR to the release branch. Admin + approval because the branch state change is hard to reverse.

### Tag (admin, requires approval)

```bash
pnpm forge:exec forge-milestone-tag \
  --args '{"version":"2026.06.21","sha":"<commit-sha>","sign":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Tags the release commit. `sign=true` signs with Sigstore and produces a verifiable provenance attestation.

### Changelog

```bash
pnpm forge:exec forge-milestone-changelog \
  --args '{"version":"2026.06.21","format":"keep-a-changelog"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Renders the changelog. Pulls from the typed artifacts accepted during the cycle: ADRs, API Contract changes, Task Breakdown entries, Risk Register entries, Security Reports, Deployment Plans.

### Archive (admin, requires approval)

```bash
pnpm forge:exec forge-milestone-archive \
  --args '{"version":"2026.06.21","retention":"7y"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Bundles the release artifacts into a tamper-evident archive stored in S3 with Object Lock. Retention defaults to 7 years for SOC2 posture.

## Output

- `forge-milestone-cut` → Release branch + version bump PR
- `forge-milestone-tag` → Git tag + Sigstore attestation
- `forge-milestone-changelog` → Changelog document
- `forge-milestone-archive` → Signed bundle in S3

## When to use

| Scenario | Command |
|---|---|
| Release train | `forge-milestone-cut` (admin) |
| Tag a release | `forge-milestone-tag` (admin) |
| Communicate a release | `forge-milestone-changelog` |
| Long-term retention | `forge-milestone-archive` (admin) |

## Retention

Default retentions:

| Artifact | Retention |
|---|---|
| Audit ledger | Forever (audit account) |
| Release archive | 7 years (configurable per tenant) |
| Deployment plan | 3 years |
| Changelog | Forever (in repo) |

## Related

- [Deployment commands](/commands/deployment/)
- [Learning commands](/commands/learning/) — capture lessons from the release
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
