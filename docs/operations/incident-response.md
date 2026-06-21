# Forge AI — Incident Response (Security)

> **Purpose.** This runbook governs the response to security incidents in Forge. It defines detection sources, severity matrix, containment, eradication, recovery, post-incident, and compliance obligations.
>
> **When to use this runbook.** Open it the moment any of the [detection sources](#detection-sources) fires. Engage the L4 delegate immediately if there is any indication of unauthorized data access, cross-tenant leak, or compromise of credentials.
>
> **Authority.** The L4 CISO delegate (or designee) owns containment and eradication decisions for any incident classified as High or Critical.

## Security Posture Recap

Forge is built to be auditable and tenant-isolated by default. The relevant constitutional and architectural controls are:

| Control | Source |
|---|---|
| Multi-tenancy with RLS on every record | [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md), Rule R2 |
| Layer isolation (Organization Knowledge vs Project Intelligence) | [Architecture Overview §Layer Isolation](../architecture/overview.md#layer-isolation-model), Rule R5 |
| Append-only WORM audit log | [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md), Rule R6 |
| LiteLLM Proxy for all LLM traffic (no direct SDK) | [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md), Rule R1 |
| Human approval gates at Architecture/Security/Deployment | Rule R3 |
| Configurable everything | Rule R8 |
| AWS-only deployment with separate audit account | [ADR-001](../architecture/decisions/0001-cloud-only-aws-deployment.md) |

These controls reduce the likelihood of incidents but do not eliminate the need for incident response.

## Detection Sources

| Source | What it detects | How to monitor |
|---|---|---|
| **Audit log anomaly** | Out-of-pattern access; cross-tenant queries; impossible travel | Grafana audit dashboard; automated anomaly detection |
| **RLS bypass attempt** | Policy violations; tenant_id mismatches | PostgreSQL logs + alert rule |
| **Cost anomaly** | Token usage spikes; unexpected model usage | LiteLLM Prometheus + cost dashboard |
| **Abnormal API call** | Unrecognized endpoints; bulk data extraction | API Gateway logs + WAF |
| **Keycloak auth anomaly** | Failed logins; impossible travel; MFA bypass | Keycloak event logs |
| **Connector failure** | Connector in `failed` or `quarantined` state per the [Implementation Plan §M1 substrate](../../implementation_plan.md) | Connector Center dashboard |
| **Reviewer feedback** | Security Reviewer flags an artifact as containing sensitive content | Artifact Registry |
| **External report** | Customer or researcher reports an issue | Sponsor + security inbox |

### Detection → Triage SLA

| Detection source | Triage SLA |
|---|---|
| RLS bypass attempt | ≤15 minutes |
| Cross-tenant query observed | ≤15 minutes |
| Audit log integrity violation | ≤15 minutes |
| Cost anomaly >3x baseline | ≤1 hour |
| Connector in `quarantined` | ≤4 hours |
| Reviewer security veto | ≤24 hours |
| External report | ≤24 hours |

## Severity Matrix

| Severity | Definition | Examples | Initial responder | Time-to-contain target |
|---|---|---|---|---|
| **Critical** | Confirmed unauthorized access to tenant data; cross-tenant leak; audit log compromise | RLS bypass succeeded; data leak confirmed; WORM chain broken | L4 delegate + L3 architect | ≤1 hour |
| **High** | Suspected unauthorized access; credentials compromised; cost anomaly indicating abuse | Successful login from anomalous location; LiteLLM virtual key leaked | L4 delegate + L3 architect | ≤4 hours |
| **Medium** | Policy violation blocked but exploit attempted; connector compromise; agent policy violation | RLS policy denied cross-tenant query; agent emitted content violating F-003 policy | L3 architect | ≤24 hours |
| **Low** | Anomaly without exploit; hardening opportunity | Unusual login time; unused credential | L2 platform engineer | ≤5 business days |

### Severity Escalation Triggers

| From → To | Trigger |
|---|---|
| Low → Medium | Anomaly correlates with exploit attempt |
| Medium → High | Suspected unauthorized data access |
| High → Critical | Confirmed data leak or audit log compromise |

Severity can move up or down during the incident as more information emerges.

## Triage Procedure

| Step | Action | Owner | Recorded |
|---|---|---|---|
| 1 | Detect (alert fires or external report received) | L1 on-call | `detected_at` |
| 2 | Acknowledge and assign severity per the matrix above | L1 + L2 | `severity` |
| 3 | Engage the next tier per severity (L3 for Medium+, L4 for High+) | L1 | `escalated_at` |
| 4 | Snapshot the relevant audit log rows | L2 | `snapshot_uri` |
| 5 | Identify the affected tenant(s), users, and data scope | L3 + L4 | `scope` |
| 6 | Decide on initial containment (see below) | L4 delegate | `containment_plan` |
| 7 | Open the incident ticket | L1 | `incident_id` |
| 8 | Begin the timeline (UTC) | L1 | `timeline` |

### Initial Triage Checklist

| # | Question | Recorded |
|---|---|---|
| 1 | Was data actually accessed, or was the attempt blocked? | Yes/No/Unknown |
| 2 | Which tenants are affected? | `<tenant_ids>` |
| 3 | Which users are involved? | `<user_ids>` |
| 4 | What is the data classification? | PII / PHI / Confidential / Public |
| 5 | Is the audit log intact? | Yes/No |
| 6 | Are credentials compromised? | Yes/No/Unknown |
| 7 | Is the attack ongoing? | Yes/No/Unknown |
| 8 | Does this require external notification (GDPR, SOC2, customer contract)? | Yes/No/Unknown |

## Containment

Containment is the priority. Eradication and recovery come after the threat is contained.

### Containment Actions by Type

| Incident type | Containment |
|---|---|
| **Tenant isolation** | Disable all `forge-*` commands for the affected tenant(s); revoke RLS grants temporarily; preserve evidence |
| **Key rotation** | Rotate Keycloak client secrets, LiteLLM virtual keys, AWS IAM keys, KMS CMKs per tenant |
| **Command disable** | Pause a specific `forge-*` command (Tier-1 rollback per [rollback-procedures.md §Tier 1](rollback-procedures.md#tier-1-rollback-pause-specific-command)) |
| **Agent disable** | Disable a specific agent (Tier-2 rollback) |
| **Tenant revert** | Revert tenant to pre-incident state (Tier-3 rollback per [rollback-procedures.md §Tier 3](rollback-procedures.md#tier-3-rollback-tenant-revert)) |
| **Network isolation** | Update security groups; block IPs at WAF; rate-limit the affected endpoint |
| **Audit log preservation** | Snapshot audit_log + chain anchors; freeze S3 audit mirror with Object Lock per [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md) |

### Containment Procedure (Critical severity)

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Page L4 delegate via PagerDuty | L1 | ≤5 minutes |
| 2 | Snapshot audit log + S3 mirror | L2 | ≤15 minutes |
| 3 | Disable affected tenant commands (Tier-1) | L2 | ≤15 minutes |
| 4 | Rotate compromised credentials | L2 | ≤30 minutes |
| 5 | If cross-tenant, isolate the source tenant (Tier-3 candidate) | L3 + L4 | ≤1 hour |
| 6 | Notify sponsor per [Communication Templates](#communication-templates) | L4 delegate | ≤1 hour |
| 7 | Begin evidence preservation for forensic review | L2 | Ongoing |

### Containment Procedure (High severity)

Same as Critical but with relaxed SLAs (4 hours vs 1 hour). L4 delegate still owns the decision.

### Containment Procedure (Medium severity)

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Engage L3 architect | L2 | ≤30 minutes |
| 2 | Disable the offending command or agent (Tier-1/2) | L3 | ≤4 hours |
| 3 | Snapshot audit log + relevant artifacts | L2 | ≤4 hours |
| 4 | File a security finding for the post-incident review | L3 | ≤24 hours |

### Containment Procedure (Low severity)

| Step | Action | Owner | SLA |
|---|---|---|---|
| 2 | Document the anomaly | L1 | ≤5 business days |
| 3 | Apply hardening (rate limit, additional logging, etc.) | L2 | ≤5 business days |
| 4 | Track to closure | L2 | ≤30 days |

## Eradication

After containment, eradicate the root cause. Eradication may require:

| Action | When |
|---|---|
| **Rollback** | Revert agent code, infra config, or schema migration that introduced the vulnerability |
| **Schema migration** | Tighten RLS policy, add check constraint, fix data classification |
| **Dependency patching** | Patch a vulnerable library or OS package |
| **Key re-issuance** | Re-issue all credentials from clean material (not just rotated) |
| **Code fix** | Patch the application code that allowed the vulnerability |
| **Configuration change** | Tighten security groups, WAF rules, rate limits |

### Eradication Procedure

| Step | Action | Owner |
|---|---|---|
| 1 | Identify the root cause from forensic analysis | L3 + L4 |
| 2 | Develop the fix (rollback, patch, migration) | L3 |
| 3 | Test the fix in staging | Platform Engineer |
| 4 | Approve the fix for production | L4 delegate |
| 5 | Apply the fix during a maintenance window (or immediately if Critical) | Platform Engineer |
| 6 | Verify the fix | L3 + L4 |

## Recovery

Recovery restores service to the affected tenant(s) in a controlled way.

### Recovery Procedure

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Verify the fix is in place | L3 | Before re-enable |
| 2 | Re-enable the affected commands (reverse of containment) | L2 | After L4 approval |
| 3 | Monitor for recurrence (24h heightened monitoring) | L1 | 24 hours |
| 4 | Confirm tenant functionality restored | Pilot Owner | Before declaring closed |
| 5 | Update the incident ticket with recovery timestamp | L1 | Same day |

### Re-enable Criteria

A tenant or command can only be re-enabled if **all** of the following are true:

| # | Criterion | Owner |
|---|---|---|
| 1 | Root cause identified | L3 architect |
| 2 | Fix applied and verified | L3 architect |
| 3 | Audit log intact (or compensating controls documented) | L4 delegate |
| 4 | Tenant sponsor notified (if customer-facing impact) | Pilot Owner |
| 5 | Post-incident review scheduled | Pilot Owner |

## Post-Incident

Every Medium+ incident triggers a formal post-incident review (PIR) per [rollback-procedures.md §PIR Template](rollback-procedures.md#post-incident-review-template). High and Critical incidents add a **root cause analysis (RCA)** section.

### PIR Schedule

| Severity | PIR deadline |
|---|---|
| Critical | ≤5 business days |
| High | ≤5 business days |
| Medium | ≤10 business days |
| Low | Tracked as a finding; PIR optional |

### PIR Additions for Security Incidents

| Section | Owner |
|---|---|
| Attack timeline (UTC) | L2 platform engineer |
| Root cause + contributing factors | L3 architect |
| Data scope: tenants, users, data classification | L4 delegate |
| Detection efficacy: how was it detected, how long from exploit to detection | L1 on-call |
| Containment efficacy: time-to-contain, time-to-eradicate, time-to-recover | L4 delegate |
| Regulatory impact (GDPR, SOC2, customer contracts) | L4 delegate |
| Customer communication log | Pilot Owner |
| Action items with owners and due dates | L4 delegate |
| Lessons learned | All |

## Compliance

Forge is built for SOC2-controls-ready posture (NFR-001) and GDPR-aligned data handling. Incidents trigger specific compliance obligations.

### GDPR Breach Notification (72-hour rule)

If a security incident involves a **personal data breach** affecting EU data subjects, GDPR Article 33 requires notification to the supervisory authority within 72 hours of becoming aware of the breach.

#### Trigger Conditions

| Condition | Notification required |
|---|---|
| Personal data of EU data subjects accessed without authorization | Yes (supervisory authority + data subjects if high risk) |
| Personal data altered or destroyed without authorization | Yes |
| Personal data lost without backup | Yes |
| Pseudonymized personal data re-identified | Yes |
| Aggregated or fully anonymized data | Generally no (but document the assessment) |

#### Notification Procedure

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Confirm GDPR scope (EU data subjects involved) | L4 delegate | ≤4 hours |
| 2 | Draft the supervisory authority notification | L4 delegate | ≤48 hours |
| 3 | Notify the supervisory authority | L4 delegate | ≤72 hours from detection |
| 4 | Notify affected data subjects (if high risk) | L4 delegate | ≤72 hours from detection |
| 5 | Document the notification in the incident ticket | L1 | Same day |

#### Notification Contents (per GDPR Article 33)

| Item | Description |
|---|---|
| Nature of the breach | Categories and approximate number of data subjects; categories and approximate number of records |
| Name and contact details of DPO or contact point | L4 delegate |
| Likely consequences | Description of likely impact on data subjects |
| Measures taken or proposed | Containment, eradication, recovery, prevention |
| Cross-border considerations | Multiple Member States affected? |

### SOC2 Incident Reporting

If Forge is operating under a SOC2 attestation, certain incidents must be reported to the auditor and the trust services customers.

#### Trigger Conditions

| Condition | Notification required |
|---|---|
| Incident affects the security, availability, or confidentiality of customer data | Yes (per SOC2 trust services criteria) |
| Incident results in a material control failure | Yes |
| Incident is part of a pattern indicating systemic control weakness | Yes |

#### Notification Procedure

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Document the incident in the SOC2 incident log | L4 delegate | ≤24 hours |
| 2 | Assess impact on trust services criteria | L4 delegate | ≤48 hours |
| 3 | Notify SOC2 auditor (if under audit) | L4 delegate | Per audit schedule |
| 4 | Notify affected customers per contract | Pilot Owner + L4 | Per contract terms |
| 5 | Update the SOC2 control matrix if the incident reveals a gap | L3 architect | ≤30 days |

### Other Compliance

| Framework | Trigger | Procedure |
|---|---|---|
| **HIPAA** (if PHI processed) | PHI breach | Notify HHS Secretary; notify affected individuals; media notification if >500 individuals |
| **CCPA** (if CA residents' data) | Personal information breach | Notify CA Attorney General if >500 CA residents |
| **Customer contracts** | Data breach affecting customer | Notify customer per contract terms (often ≤24-72 hours) |
| **KnackForge internal policy** | Any security incident | Notify CISO + KnackForge leadership |

The L4 delegate owns compliance notifications. The Pilot Owner supports customer-facing communication.

## Tabletop Exercise Template (Quarterly)

Forge runs a quarterly tabletop exercise to rehearse incident response. The exercise uses a realistic scenario and walks through the runbook end-to-end.

### Exercise Format

| Item | Detail |
|---|---|
| Duration | 90 minutes |
| Participants | L1 on-call (rotating), L2 platform engineer, L3 architect, L4 delegate, Pilot Owner |
| Facilitator | L3 architect or external |
| Frequency | Quarterly |

### Exercise Scenario Bank

| # | Scenario | Tests |
|---|---|---|
| 1 | RLS bypass attempt succeeds for one query | Detection, containment, tenant isolation, GDPR notification |
| 2 | LiteLLM virtual key leaks via a misconfigured S3 bucket | Key rotation, cost anomaly, customer notification |
| 3 | Audit log hash chain drift detected | Forensic analysis, evidence preservation, recovery |
| 4 | Cross-tenant data leak via connector compromise | Tier-3 rollback, tenant revert, customer notification |
| 5 | Agent emits content violating policy (F-003) | Agent disable, Tier-2 rollback, post-incident review |
| 6 | Phishing of a Pilot Owner credential | Identity investigation, session audit, key rotation |

### Exercise Agenda (90 minutes)

| Time | Topic | Owner |
|---|---|---|
| 0:00 | Scenario presented | Facilitator |
| 0:10 | Triage walkthrough | L1 + L2 |
| 0:25 | Severity assessment | L1 + L3 |
| 0:35 | Containment decisions | L3 + L4 |
| 0:55 | Eradication + recovery walkthrough | L2 + L3 |
| 1:10 | Compliance notification walkthrough | L4 delegate |
| 1:25 | Lessons learned + runbook updates | All |
| 1:30 | Exercise close | Facilitator |

### Exercise Deliverables

| Deliverable | Owner | Due |
|---|---|---|
| Updated incident response runbook (if gaps found) | L3 architect | ≤2 weeks after exercise |
| Action items logged | Facilitator | ≤1 week after exercise |
| Exercise report | Facilitator | ≤1 week after exercise |

## Communication Templates

### Initial Notification (within 1 hour of detection)

Channel: incident Slack channel + sponsor + L4 delegate phone.

```text
Subject: [Forge Incident — <severity>] <one-line summary>

Severity: <Critical | High | Medium | Low>
Detected at: <UTC timestamp>
Detected by: <source>
Incident ID: <id>
Affected tenants: <list or "unknown">
Data scope: <description>

Initial assessment:
<one-paragraph assessment>

Next update: <timestamp>
Lead: <L4 delegate name>
```

### Containment Update (within 4 hours)

Channel: same as above.

```text
Subject: [Forge Incident — <id>] Containment update

Containment actions taken:
- <bullet>

Eradication plan:
- <bullet>

Affected services:
- <bullet>

Customer impact:
- <bullet>

Next update: <timestamp>
```

### Resolution Notice (within 24 hours of recovery)

Channel: same as above + customer leadership + auditor (if SOC2-relevant).

```text
Subject: [Forge Incident — <id>] Resolved

Incident summary:
<one-paragraph summary>

Timeline (UTC):
- <detected>
- <contained>
- <eradicated>
- <recovered>

Root cause:
<one-paragraph root cause>

Data impact:
<description>

Customers affected:
<list>

Post-incident review:
<date>

Action items:
<list with owners and due dates>
```

### GDPR Notification (to supervisory authority)

```text
To: <Supervisory authority>
From: <L4 delegate name>, Data Protection Officer (or contact point)
Date: <UTC date within 72h of detection>
Re: Personal data breach notification under GDPR Article 33

1. Nature of the breach
   <description>

2. Categories and approximate number of data subjects
   <description>

3. Categories and approximate number of records
   <description>

4. Name and contact details of DPO or contact point
   <L4 delegate name, email, phone>

5. Likely consequences
   <description>

6. Measures taken or proposed
   <description>

7. Cross-border considerations
   <description>
```

## Cross-References

- **On-call.** [oncall-runbook.md](oncall-runbook.md) — for the alert-driven detection side.
- **Rollback.** [rollback-procedures.md](rollback-procedures.md) — Tier-1/2/3 rollbacks are the primary containment tools.
- **Architecture.** [ADR-001 Cloud-only AWS](../architecture/decisions/0001-cloud-only-aws-deployment.md), [ADR-002 PostgreSQL substrate](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md), [ADR-008 Append-only audit log](../architecture/decisions/0008-append-only-worm-audit-trail.md).
- **Constitutional rules.** [Forge AI Charter](../CHARTER.md), [Architecture Overview](../architecture/overview.md).
- **Success metrics.** [success-metrics.md](success-metrics.md) — for KPIs affected by security incidents.
