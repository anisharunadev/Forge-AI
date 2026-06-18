# @fora/event-bus-bridge

The SQS+SNS bridge — subscribes to NATS JetStream on the per-tenant subject glob and republishes every event verbatim to an SNS topic so the audit account (a separate AWS account per [FORA-36 D3](/FORA/docs/adr/0001-audit-system-one-way-doors.md)) can ingest via SQS.

**Implements:** [FORA-136](/FORA/issues/FORA-136) · **Substrate:** [ADR-0006 §5](/FORA/docs/architecture/adr-0006-event-bus-nats-jetstream.md)

## Run

```sh
export FORA_NATS_URL=nats://nats.platform.svc:4222
export FORA_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:111111111111:fora-audit-events
export FORA_AWS_REGION=us-east-1
export FORA_TENANT_ID=tnt_acme        # one bridge per tenant (recommended)
export FORA_DURABLE_NAME=audit-bridge # default: audit-bridge-<tenant>
export FORA_MAX_MAJOR_VERSION=1
export FORA_RATE_RPS=200

pnpm start
```

The bridge is stateless; run one per tenant (preferred) or one per cluster.

## How it works

```
NATS JetStream (platform account)
  └── subject: fora.events.<tenant_id>.>
       └── subscribed by `audit-bridge-<tenant_id>` consumer group
            └── republish verbatim to
                 SNS topic "fora-audit-events"
                  └── account-boundary resource policy
                       └── SQS queue "fora-audit-ingest" (audit account)
                            └── audit writer worker
                                 └── audit.events (Postgres, audit account)
```

The bridge preserves the wire format. The SQS message body is the NATS event verbatim, with AWS-side message attributes carrying `fora-tenant-id`, `fora-run-id`, `fora-event-type`, `fora-event-id`, `fora-event-version`, and `MessageDeduplicationId` set to the event's `event_id` for SQS-side dedupe.

The consumer pipeline inside the bridge (`processOneEvent` from `@fora/event-bus`) does:

1. Tenant ACL — refuses events whose tenant segment ≠ `FORA_TENANT_ID`.
2. Schema-version guard — drops v2 envelopes when `FORA_MAX_MAJOR_VERSION=1`; the v1 subject continues to be served for the 30-day window.
3. Dedupe by `event_id` — redeliveries from JetStream are no-ops at the bridge.
4. Verbatim SNS publish — payload bytes are unchanged.

## SLO

- **p99 cross-account delivery: < 60 s.** Verified via the bridge's in-process `LatencyHistogram` (exposed as `metrics.p99()` for production wiring). See test/bridge.test.ts.

## Tests

```sh
pnpm test
```

| File | Covers |
| --- | --- |
| `bridge.test.ts` | `AwsSnsPublisher` carries envelope + fora-* attributes; bridge forwards every event to SNS, dedupes by `event_id`, measures p99 latency; v2 envelopes are dropped before SNS publish. |

## Failures

- **NATS down.** The bridge cannot drain. Events queue in NATS for the 7-day hot retention; on NATS recovery, the durable consumer resumes from the last acknowledged offset. No events lost.
- **SNS publish fails.** The handler throws; the bridge nacks the message; JetStream redelivers. The `event_id` dedupe makes redelivery a no-op when the message eventually reaches SNS.
- **Bridge process crashes mid-publish.** On restart, the durable consumer resumes from the last acknowledged offset; un-published events are redelivered and forwarded to SNS.
- **Bridge stuck > 7 days.** Cold-tier retention may evict messages; this is a Sev-1 alert per ADR-0006 §6.

## Conventions

- ESM, strict TS.
- Imports the public surface of `@fora/event-bus` only — no deep imports.
- AWS SDK client is mocked in tests via `aws-sdk-client-mock`.
- Production entry point checks `import.meta.url` to ensure the binary runs only when invoked directly.
