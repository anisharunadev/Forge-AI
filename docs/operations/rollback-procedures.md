# Forge AI — Rollback Procedures

> **Purpose.** When things go wrong, this runbook is the playbook. It defines trigger conditions, three tiers of rollback, decision authority, communication templates, and post-incident review.
>
> **When to use this runbook.** Open it the moment any of the trigger conditions below is observed, or any time a Pilot Owner, Platform Engineer, or Architect (L3) believes a rollback may be needed.
>
> **Cross-link.** All security-related triggers also engage [incident-response.md](incident-response.md). All alert-driven triggers also engage [oncall-runbook.md](oncall-runbook.md).

## Rollback Philosophy

Forge follows a **layered rollback** strategy: prefer the smallest rollback that resolves the issue. A regression in one `forge-*` command should not require disabling the entire platform.

### Guiding Principles

| Principle | Meaning |
|---|---|
| **Smallest viable rollback** | Tier-1 before Tier-2 before Tier-3 |
| **Reversible** | Every rollback must be reversible |
| **Audited** | Every rollback must produce an audit log row |
| **Communicated** | Stakeholders are notified before the rollback completes (except Tier-1 emergencies) |
| **Reviewed** | Every rollback triggers a post-incident review within 5 business days |

## Trigger Conditions

Each trigger has a tier; the tier determines the rollback path.

### Cost Overrun

| Signal | Tier |
|---|---|
| Single cycle cost >2x median | Tier-1 (pause cost-attributing command) |
| Per-tenant weekly budget at 80% | Tier-1 (alert + investigation) |
| Per-tenant weekly budget at 100% | Tier-1 (pause non-critical commands) |
| Per-tenant weekly budget at 120% | Tier-2 (disable offending agent) |
| Cross-tenant cost spike >3x baseline | Tier-2 + immediate L3 escalation |
| Sustained cost anomaly across multiple cycles | Tier-3 (revert tenant to pre-pilot state) |

### Low Acceptance

| Signal | Tier |
|---|---|
| Acceptance rate drops below 70% for one cycle type | Tier-1 (pause that `forge-*` command) |
| Acceptance rate drops below 60% across all types | Tier-2 (disable the affected agent, fall back to previous version) |
| Acceptance rate below 50% for two consecutive weeks | Tier-3 (tenant freeze, return to manual) |

### Security Incident

| Signal | Tier |
|---|---|
| Suspected RLS bypass attempt | Tier-2 + immediate L4 escalation per [incident-response.md](incident-response.md) |
| Audit log integrity violation | Tier-3 + immediate L4 escalation |
| Confirmed data leak across tenants | Tier-3 + immediate L4 escalation + breach notification |
| Compromised credentials | Tier-2 (rotate keys) + Tier-3 if cross-tenant |

### Performance Degradation

| Signal | Tier |
|---|---|
| LiteLLM Proxy p99 latency >10s | Tier-1 (alert + throttle) |
| LiteLLM Proxy p99 latency >30s | Tier-2 (failover to secondary provider) |
| PostgreSQL connection pool exhaustion | Tier-1 (alert + throttle) per [oncall-runbook.md](oncall-runbook.md) |
| PostgreSQL connection pool exhaustion (sustained) | Tier-2 (reduce concurrent cycles) |
| Redis pub/sub lag >5 minutes | Tier-1 (alert + investigation) |
| Redis pub/sub lag >30 minutes | Tier-2 (restart terminal sessions) |
| Audit log write failures | Tier-2 (quarantine affected workflows) |

### Output Quality Regression

| Signal | Tier |
|---|---|
| Single artifact fails twice in a row | Tier-1 (pause that `forge-*` command) |
| All artifacts of a type fail for ≥3 cycles | Tier-2 (disable the agent for that type) |
| Agent emits content that violates policy (F-003) | Tier-2 (disable agent immediately) |

### Pilot-Specific Triggers

| Signal | Tier |
|---|---|
| P1.5 acceptance rate <50% after 7 artifacts | Halt (re-scope P0/P1) — not a rollback per se |
| P2 mid-pilot review decision = Halt | Tier-3 for the affected pilot scope |
| P3 recommendation = Stop | Tier-3 (pilot archive, no further expansion) |

## Tier Definitions

### Tier 1 — Pause Specific Command

**Scope.** Pause a single `forge-*` command for one tenant (or globally if needed). Routing goes back to manual for that command.

| Property | Value |
|---|---|
| Blast radius | One command, one tenant (typically) |
| Reversibility | High — re-enable the command |
| Approver | L2 platform engineer (on-call) |
| Execution time | <5 minutes |
| Audit | Required |

#### Procedure

| Step | Action | Owner | Recorded |
|---|---|---|---|
| 1 | Identify the offending command and tenant | L2 | `trigger_command`, `trigger_tenant` |
| 2 | Notify Pilot Owner and reviewer on duty | L2 | `notified_at` |
| 3 | Disable the command at the Command Center | L2 | `disabled_at` |
| 4 | Route the affected work to manual | Pilot Owner | `manual_routed_at` |
| 5 | Write audit log row `command.disabled` | L2 | `audit_row_id` |
| 6 | Communicate to stakeholders | Pilot Owner | `comm_id` |

#### Example

```text
Tier 1 rollback — 2026-07-15
Command: forge-arch-risks
Tenant: forge-pilot-cmc
Reason: 4 of last 5 risk registers scored <50 (rejection)
Approver: L2 platform engineer (on-call)
Disabled at: 2026-07-15T14:32Z
Work routed to: manual risk register via Dev Lead
Audit row: audit-2026-07-15-0042
```

### Tier 2 — Disable Specific Agent

**Scope.** Disable a specific agent (e.g., the architecture agent or the security-report agent) and fall back to the previous version (if available) or to manual.

| Property | Value |
|---|---|
| Blast radius | One agent, all tenants |
| Reversibility | High — re-enable the agent |
| Approver | L3 architect + Pilot Owner |
| Execution time | <30 minutes |
| Audit | Required |

#### Procedure

| Step | Action | Owner | Recorded |
|---|---|---|---|
| 1 | Identify the offending agent | L3 architect | `agent_id` |
| 2 | Notify Pilot Owner and sponsor | L3 architect | `notified_at` |
| 3 | Check for a previous version; if available, fall back | Platform Engineer | `previous_version` |
| 4 | Disable the agent at the Agent Center | Platform Engineer | `disabled_at` |
| 5 | Route affected workflows to fallback | Pilot Owner | `routed_to` |
| 6 | Write audit log row `agent.disabled` | Platform Engineer | `audit_row_id` |
| 7 | Communicate to all tenants affected | Pilot Owner | `comm_id` |

#### Example

```text
Tier 2 rollback — 2026-07-22
Agent: architecture-agent v2.3.1
Reason: regression causing ADR acceptance to drop from 82% to 54% over 3 cycles
Approver: L3 architect + Pilot Owner
Previous version: v2.3.0 (last known good)
Disabled at: 2026-07-22T11:15Z
Fallback: manual ADR via Architect on rotation
Audit row: audit-2026-07-22-0118
```

### Tier 3 — Revert Tenant to Pre-Pilot State

**Scope.** Revert an entire tenant to its pre-pilot state. The tenant's Forge data is archived (read-only) and the tenant is removed from active service.

| Property | Value |
|---|---|
| Blast radius | One tenant |
| Reversibility | Low — the tenant must be re-onboarded from the archive |
| Approver | L3 architect + Pilot Owner + L4 delegate |
| Execution time | <4 hours |
| Audit | Required (WORM) |
| Communication | All stakeholders + sponsor |

#### Procedure

| Step | Action | Owner | Recorded |
|---|---|---|---|
| 1 | Confirm the trigger and document | L3 architect | `trigger_doc` |
| 2 | Get sign-off from L3 + Pilot Owner + L4 | L3 architect | `signoffs` |
| 3 | Snapshot the tenant's current state to S3 (cold archive) | Platform Engineer | `archive_uri` |
| 4 | Disable all `forge-*` commands for the tenant | Platform Engineer | `commands_disabled_at` |
| 5 | Rotate all tenant credentials (Keycloak, LiteLLM, KMS CMK) | Platform Engineer | `rotation_log` |
| 6 | Remove RLS grant for the tenant | Platform Engineer | `rls_revoked_at` |
| 7 | Mark tenant as `archived` in `tenants` table | Platform Engineer | `archived_at` |
| 8 | Write audit log row `tenant.archived` (WORM) | Platform Engineer | `audit_row_id` |
| 9 | Communicate to all stakeholders | Pilot Owner + sponsor | `comm_id` |
| 10 | Schedule post-incident review within 5 business days | Pilot Owner | `pir_date` |

#### Example

```text
Tier 3 rollback — 2026-08-05
Tenant: forge-pilot-cmc
Reason: confirmed cross-tenant data leak via RLS bypass; L4 delegate authorized
Approvers: L3 architect, Pilot Owner, L4 CISO delegate
Archived at: 2026-08-05T17:00Z
Archive URI: s3://forge-cold-archive/forge-pilot-cmc-2026-08-05.tar.gz
Credentials rotated: yes (Keycloak, LiteLLM, KMS CMK)
Audit row: audit-2026-08-05-0244 (WORM)
Post-incident review: 2026-08-10
```

## Decision Authority

The decision authority matrix below is the binding chain. It is also documented in [README.md §Decision Authority](README.md#decision-authority).

| Tier | Authority | Backup | Notes |
|---|---|---|---|
| **Tier 1** | L2 platform engineer | L3 architect | L2 can act unilaterally on Tier 1; L3 reviews within 24h |
| **Tier 2** | L3 architect + Pilot Owner | L4 delegate (if no Pilot Owner available) | Two-signature required |
| **Tier 3** | L3 architect + Pilot Owner + L4 delegate | None — escalate to CISO if L4 unavailable | Three-signature required; L4 delegate owns the decision |

Security triggers override these authorities: any L4-engaging trigger allows L4 to act unilaterally.

## Communication Templates

### Tier 1 Communication

Channel: pilot Slack/Teams channel + email to PO.

```text
Subject: [Forge Rollback T1] <command> paused for <tenant>

Heads up — we've paused the `forge-<command>` command for <tenant> due to <reason>.
Work is being routed to manual for now.

Trigger: <signal>
Disabled at: <timestamp>
Approver: <L2 name>
Manual owner: <name>
ETA to re-enable: <estimate>

Questions: ping #forge-oncall.
```

### Tier 2 Communication

Channel: pilot channel + all reviewer channels + sponsor email.

```text
Subject: [Forge Rollback T2] <agent> disabled

The <agent> agent has been disabled due to <reason>. We are falling back to <previous version | manual>.

Trigger: <signal>
Disabled at: <timestamp>
Approvers: <L3 name>, <PO name>
Fallback: <description>
Impact: <affected commands, affected tenants>
ETA to re-enable: <estimate>

Post-incident review will be scheduled within 5 business days.
```

### Tier 3 Communication

Channel: all-hands + sponsor + customer leadership.

```text
Subject: [Forge Rollback T3] <tenant> archived

We have archived the <tenant> tenant due to <reason>. The tenant's data has been
preserved in cold storage and the tenant is no longer active in Forge.

Trigger: <signal>
Archived at: <timestamp>
Archive URI: <uri>
Approvers: <L3 name>, <PO name>, <L4 name>
Credentials rotated: yes
Impact: <scope of impact>

Post-incident review will be held on <date>.
```

## Post-Incident Review Template

Every rollback triggers a post-incident review (PIR) within 5 business days.

### PIR Template

```text
# Post-Incident Review — <date>

## Summary
- Tier: <1 | 2 | 3>
- Trigger: <signal>
- Affected: <commands, agents, tenants>
- Rollback completed at: <timestamp>
- Approvers: <names>

## Timeline (UTC)
- <trigger detected>
- <first responder paged>
- <decision to rollback>
- <rollback executed>
- <stakeholders notified>
- <stabilized>

## Root Cause
<one-paragraph root cause>

## Contributing Factors
- <bullet>

## What Went Well
- <bullet>

## What Went Wrong
- <bullet>

## Action Items
| # | Action | Owner | Due |
|---|---|---|---|
| 1 | <action> | <name> | <date> |
| 2 | <action> | <name> | <date> |

## Prevention
- <what we will change to prevent recurrence>

## Sign-off
- Pilot Owner: ____________________  Date: __________
- Architect (L3): ____________________  Date: __________
- (L4 if Tier 3): ____________________  Date: __________
```

## Rollback Decision Tree

```text
Trigger observed
    |
    v
Is this a security incident?
    |
    +--> YES --> Engage [incident-response.md]; L4 delegate owns decision
    |
    +--> NO
         |
         v
    Is the trigger one command / one tenant?
         |
         +--> YES --> Tier 1 (L2 platform engineer)
         |
         +--> NO
              |
              v
         Is the trigger one agent across tenants?
              |
              +--> YES --> Tier 2 (L3 + PO)
              |
              +--> NO
                   |
                   v
              Is the trigger cross-tenant or systemic?
                   |
                   +--> YES --> Tier 3 (L3 + PO + L4)
                   |
                   +--> NO --> Re-evaluate; may be Tier 2 with broader scope
```

## Cross-References

- **On-call alerts.** [oncall-runbook.md](oncall-runbook.md) — covers the alert side of trigger detection.
- **Incident response.** [incident-response.md](incident-response.md) — security incident specifics.
- **Decision authority.** [README.md §Decision Authority](README.md#decision-authority).
- **Pilot phases.** Each phase runbook has its own halt/recommendation path that may engage a Tier rollback.
- **Architecture.** [ADR-008 Append-only audit log](../architecture/decisions/0008-append-only-worm-audit-trail.md) governs the audit requirements.
