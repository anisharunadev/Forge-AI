/**
 * @fora/object-store — SQS adapter.
 *
 * SQS does not have a "key" the way S3 does. The tenant-isolation surface
 * for SQS is two-fold:
 *
 *   1. **MessageDeduplicationId carries `tenant_id`** (FIFO queues only).
 *      The consumer side re-validates the dedup id against the FORA
 *      session claim and rejects messages whose dedup id's tenant does
 *      not match the bound claim. A FIFO queue with content-based
 *      deduplication is still safe because the dedup id is what the
 *      consumer checks.
 *
 *   2. **`MessageAttributes.tenant_id` is mandatory on every send.**
 *      The default value is the bound `tenant_id` from `RequestContext`,
 *      not the caller's argument. A caller can pass a different value
 *      only by passing a different `RequestContext`, which is bound to
 *      the session claim.
 *
 * The receive path also defaults the `MessageSystemAttributeNames` to
 * include `AWSTraceHeader` so per-message traces join back to the run.
 *
 * Bar: a tenant-B session cannot enqueue a message whose
 * `MessageDeduplicationId` carries `tnt_A`; the consumer rejects it
 * before the message hits any tenant-scoped handler.
 */

import { createHash } from 'node:crypto';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  type SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import {
  assertTenantPrefix,
  KeyPrefixMismatchError,
  type RequestContext,
} from './context.js';
import { silentSink, type AuditSink } from './audit.js';

// ---- Config ----------------------------------------------------------------

export interface ObjectStoreSqsConfig {
  /** FIFO queue URL. FIFO is mandatory for the dedup-id gate. */
  queue_url: string;
  /** Region the queue lives in. */
  region: string;
  /** Optional injected client. */
  sqs_client?: SQSClient;
  /** Audit sink. Defaults to silent. */
  audit_sink?: AuditSink;
}

// ---- Adapter ---------------------------------------------------------------

export interface SqsSendInput {
  /**
   * Logical message name. Must match `^tenants/{tenant_id}/...` so the
   * SQS surface is consistent with S3 and GCS. We encode the logical
   * name into `MessageDeduplicationId` and a `MessageGroupId`-like
   * attribute so the consumer can re-validate.
   */
  logical_key: string;
  body: string;
  /** Optional extras. `tenant_id` attribute is forced to ctx.tenant_id. */
  attributes?: Record<string, { DataType: 'String' | 'Number' | 'Binary'; StringValue?: string; BinaryValue?: Uint8Array }>;
}

export interface SqsReceivedMessage {
  message_id: string;
  body: string;
  tenant_id: string;
  logical_key: string;
}

export class ObjectStoreSqsAdapter {
  private readonly cfg: ObjectStoreSqsConfig;
  private readonly client: SQSClient;
  private readonly sink: AuditSink;

  constructor(cfg: ObjectStoreSqsConfig) {
    this.cfg = cfg;
    this.client = cfg.sqs_client ?? new SQSClient({ region: cfg.region });
    this.sink = cfg.audit_sink ?? silentSink;
  }

  /**
   * Send a message bound to the tenant.
   *
   * `MessageDeduplicationId` is forced to
   * `<tenant_id>:<logical_key>:<sha256(body)[:8]>` so the consumer can
   * re-validate that the message originated in the bound tenant. A
   * caller that tries to override `tenant_id` in `attributes` is
   * silently overridden (audit log emits `tenancy.allowed` with the
   * bound tenant).
   */
  async send(ctx: RequestContext, input: SqsSendInput): Promise<{ message_id: string }> {
    this.guard(ctx, input.logical_key, 'sqs.send');

    const dedup_id = makeDedupId(ctx.tenant_id, input.logical_key, input.body);
    const group_id = `${ctx.tenant_id}:${input.logical_key.split('/').slice(0, 3).join('/')}`;

    const attributes: NonNullable<SendMessageCommandInput['MessageAttributes']> = {
      // Forced attributes — cannot be overridden by caller.
      tenant_id: { DataType: 'String', StringValue: ctx.tenant_id },
      logical_key: { DataType: 'String', StringValue: input.logical_key },
      trace_id: { DataType: 'String', StringValue: ctx.trace_id },
      // Caller-supplied attributes; strip any caller-tenant_id override.
      ...stripTenantIdOverride(input.attributes ?? {}),
    };

    const res = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.cfg.queue_url,
        MessageBody: input.body,
        MessageGroupId: group_id,
        MessageDeduplicationId: dedup_id,
        MessageAttributes: attributes,
      }),
    );
    return { message_id: res.MessageId ?? '' };
  }

  /**
   * Receive up to `max` messages. Returns them with the `tenant_id` and
   * `logical_key` parsed out of the forced attributes so the consumer
   * can re-validate them.
   */
  async receive(
    _ctx: RequestContext,
    max = 10,
  ): Promise<SqsReceivedMessage[]> {
    // The receive path is not a "key access" so the prefix guard is
    // not strictly required, but we still log it under the tenant.
    this.sink({
      event: 'tenancy.allowed',
      tenant_id: _ctx.tenant_id,
      principal: _ctx.principal,
      trace_id: _ctx.trace_id,
      resource: 'object_store',
      operation: 'sqs.receive',
      log_safe_key: 'receive',
      ts: new Date().toISOString(),
    });
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.cfg.queue_url,
        MaxNumberOfMessages: max,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['MessageDeduplicationId', 'MessageGroupId', 'AWSTraceHeader'],
      }),
    );
    return (res.Messages ?? []).map((m) => {
      const attrs = m.MessageAttributes ?? {};
      return {
        message_id: m.MessageId ?? '',
        body: m.Body ?? '',
        tenant_id: (attrs.tenant_id?.StringValue as string) ?? '',
        logical_key: (attrs.logical_key?.StringValue as string) ?? '',
      };
    });
  }

  // ---- internals -----------------------------------------------------------

  private guard(ctx: RequestContext, logical_key: string, operation: 'sqs.send' | 'sqs.receive'): void {
    try {
      assertTenantPrefix(ctx.tenant_id, logical_key);
    } catch (err) {
      if (err instanceof KeyPrefixMismatchError) {
        this.sink({
          event: 'tenancy.denied',
          tenant_id: ctx.tenant_id,
          principal: ctx.principal,
          trace_id: ctx.trace_id,
          resource: 'object_store',
          operation,
          deny_reason: 'key_prefix_mismatch',
          log_safe_key: err.log_safe_key,
          ts: new Date().toISOString(),
        });
      }
      throw err;
    }
    this.sink({
      event: 'tenancy.allowed',
      tenant_id: ctx.tenant_id,
      principal: ctx.principal,
      trace_id: ctx.trace_id,
      resource: 'object_store',
      operation,
      log_safe_key: logical_key.length > 64 ? `${logical_key.slice(0, 64)}…` : logical_key,
      ts: new Date().toISOString(),
    });
  }
}

// ---- helpers ---------------------------------------------------------------

function makeDedupId(tenant_id: string, logical_key: string, body: string): string {
  // SHA-256 via Node's `crypto` module. For dedup we only need 12 hex
  // chars of collision space — SQS allows up to 128 chars on
  // MessageDeduplicationId.
  const hash = createHash('sha256').update(`${tenant_id}|${logical_key}|${body}`, 'utf8').digest('hex').slice(0, 12);
  return `${tenant_id}:${logical_key}:${hash}`.slice(0, 128);
}

function stripTenantIdOverride(
  attrs: Record<string, { DataType: 'String' | 'Number' | 'Binary'; StringValue?: string; BinaryValue?: Uint8Array }>,
): Record<string, { DataType: 'String' | 'Number' | 'Binary'; StringValue?: string; BinaryValue?: Uint8Array }> {
  const out = { ...attrs };
  // The forced attributes win. A caller who tries to override them is
  // rejected silently — the consumer will see the bound tenant anyway.
  delete out.tenant_id;
  delete out.logical_key;
  delete out.trace_id;
  return out;
}

