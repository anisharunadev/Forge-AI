#!/usr/bin/env node
/**
 * FORA event-bus bridge — the cross-account transport to the audit account.
 *
 * Per ADR-0006 §5: subscribes to NATS JetStream on the per-tenant subject
 * glob, publishes each event verbatim to SNS. The SNS topic's resource policy
 * limits subscribers to the audit account's SQS ARN; the audit writer in the
 * audit account consumes the SQS queue and writes to `audit.events`.
 *
 * The bridge is small (~200 LOC) and stateless. It can be replaced without
 * touching the Orchestrator or the audit account.
 *
 * Run one bridge per tenant (preferred for blast-radius control).
 */

import { connect, StringCodec } from 'nats';
import {
  consumerSubjectFor,
  InMemoryDedupeStore,
  TokenBucketRateLimiter,
  processOneEvent,
  type ProcessOutcome,
} from '@fora/event-bus';
import { loadConfigFromEnv, type BridgeConfig } from './config.js';
import { AwsSnsPublisher, type SnsPublisher } from './sns-publisher.js';

export { AwsSnsPublisher, type SnsPublisher };

const sc = StringCodec();

/** Latency histogram — p99 < 60 s per FORA-50 spec §5.1 acceptance. */
class LatencyHistogram {
  private readonly samples: number[] = [];
  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > 10000) this.samples.shift();
  }
  p50(): number {
    return this.percentile(0.5);
  }
  p99(): number {
    return this.percentile(0.99);
  }
  private percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx]!;
  }
}

function defaultLogger(line: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...line }));
}

export interface BridgeRunnerOptions {
  readonly config: BridgeConfig;
  /** Override for tests. */
  readonly publisher: SnsPublisher;
  /** Override for tests — substitute the real NATS subscribe loop. */
  readonly subscribe: (
    handler: (raw: Uint8Array, subject: string, redelivered: boolean) => Promise<void>,
  ) => Promise<() => Promise<void>>;
  /** Override for tests. */
  readonly logger?: (line: Record<string, unknown>) => void;
}

/**
 * The bridge runner. Wires the NATS consumer pipeline → SNS publisher. Returns
 * a handle the caller can use to stop the bridge.
 */
export async function startBridge(opts: BridgeRunnerOptions): Promise<{
  stop: () => Promise<void>;
  metrics: { p50: () => number; p99: () => number };
}> {
  const log = opts.logger ?? defaultLogger;
  const histogram = new LatencyHistogram();
  const dedupe = new InMemoryDedupeStore();
  const rateLimiter = new TokenBucketRateLimiter(opts.config.rateRps * 2, opts.config.rateRps);

  // After every successful processOneEvent that yields a parsed envelope,
  // publish it to SNS. The consumer pipeline is event-agnostic (the bridge
  // does not care about event semantics); we re-parse the envelope here from
  // the raw bytes so the SNS message is byte-identical to what the bus saw.
  const unsubscribe = await opts.subscribe(async (raw, subject, redelivered) => {
    const start = Date.now();
    const outcome = await processOneEvent(raw, { subject, redelivered }, {
      tenantId: opts.config.tenantId,
      durableName: opts.config.durableName,
      maxMajorVersion: opts.config.maxMajorVersion,
      dedupe,
      rateLimiter,
      onError: (o: ProcessOutcome) => log({ level: 'warn', component: 'bridge.consumer', ...o }),
    });
    histogram.record(Date.now() - start);
    if (outcome.status === 'unsupported_version' || outcome.status === 'validation_failed' || outcome.status === 'rate_limited') {
      log({ level: 'warn', component: 'bridge.outcome', ...outcome });
      return;
    }
    if (outcome.status === 'deduplicated') {
      // Don't re-publish — the audit writer already saw this event_id.
      log({ level: 'debug', component: 'bridge.dedupe', event_id: outcome.event_id });
      return;
    }
    // Re-publish to SNS verbatim — the audit writer is in another account and
    // dedupes on `event_id` (the unique constraint on audit.events.event_id).
    try {
      const envelope = JSON.parse(sc.decode(raw instanceof Uint8Array ? raw : Buffer.from(raw)));
      await opts.publisher.publish({ subject, envelope });
    } catch (e) {
      log({ level: 'error', component: 'bridge.sns_publish', subject, error: String(e) });
      throw e;
    }
  });

  log({ level: 'info', component: 'bridge.started', tenant_id: opts.config.tenantId, durable: opts.config.durableName });

  return {
    stop: async () => {
      await unsubscribe();
      await opts.publisher.close();
    },
    metrics: { p50: () => histogram.p50(), p99: () => histogram.p99() },
  };
}

/**
 * Production entry point — wires the real NATS client + AWS SNS.
 */
async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const nc = await connect({ servers: config.natsUrl });
  const publisher = new AwsSnsPublisher(config.snsTopicArn, config.awsRegion);

  const subject = consumerSubjectFor(config.tenantId);

  const { stop } = await startBridge({
    config,
    publisher,
    subscribe: async (handler) => {
      const sub = nc.subscribe(subject, { queue: config.durableName });
      (async () => {
        for await (const m of sub) {
          try {
            // Core NATS does not surface redelivery on the Msg type;
            // JetStream redelivery would be a JsMsg. We default to false here;
            // the consumer pipeline's event_id dedupe is what protects us
            // against cross-source duplicates (SNS, JetStream, SQS).
            await handler(m.data, m.subject, false);
          } catch (e) {
            defaultLogger({ level: 'error', component: 'bridge.handler', subject: m.subject, error: String(e) });
          }
        }
      })().catch((e) => defaultLogger({ level: 'error', component: 'bridge.subscribe', error: String(e) }));
      return async () => {
        await sub.drain();
      };
    },
  });

  process.on('SIGTERM', () => {
    stop()
      .then(() => nc.drain().then(() => process.exit(0)))
      .catch((e) => {
        defaultLogger({ level: 'error', component: 'bridge.shutdown', error: String(e) });
        process.exit(1);
      });
  });
}

// Only run when invoked as a binary.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    defaultLogger({ level: 'error', component: 'bridge.fatal', error: String(e) });
    process.exit(1);
  });
}
