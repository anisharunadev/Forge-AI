# Forge AI — On-Call (thin canonical)

> **Purpose.** Quick severity/escalation reference for the on-call
> engineer. The authoritative day-2 remediation steps live in
> [`../operations/oncall-runbook.md`](../operations/oncall-runbook.md);
> this file is the index entry that the runbook cross-references.

## Severity → Response Time

| Severity | Definition | Ack target | Page channel |
|---|---|---|---|
| **P0** | Platform down; data loss in progress; security incident | ≤ 15 min | PagerDuty 24/7 |
| **P1** | Degraded but serving; tenant-visible bug; cost anomaly | ≤ 1 hour | PagerDuty business hours |
| **P2** | Cosmetic; non-tenant-visible; follow-up ticket | ≤ next business day | Slack |

## Escalation Ladder

L1 on-call → L2 platform engineer → L3 architect → L4 CISO delegate

## See also

- [operations/oncall-runbook.md](../operations/oncall-runbook.md) — full remediation steps per alert
- [incident-response.md](./incident-response.md)
- [disaster-recovery.md](./disaster-recovery.md)
- [backup-restore.md](./backup-restore.md)
