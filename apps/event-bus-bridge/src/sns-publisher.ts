/**
 * SNS publisher — the bridge's only egress.
 *
 * Per ADR-0006 §5: the publisher preserves the wire format. The SQS message
 * body is the NATS event verbatim, plus AWS-side message attributes carrying
 * `event_id` for SQS-side dedupe + an `sqs_message_id` opaque token.
 */

import { SNSClient, PublishCommand, type PublishCommandInput } from '@aws-sdk/client-sns';
import type { TypedEvent, EventType } from '@fora/event-bus';

/** Minimal publisher interface — tests substitute an in-memory fake. */
export interface SnsPublisher {
  publish(args: {
    subject: string;
    envelope: TypedEvent<EventType>;
  }): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

/** AWS-backed publisher. */
export class AwsSnsPublisher implements SnsPublisher {
  private readonly client: SNSClient;
  constructor(private readonly topicArn: string, region?: string) {
    this.client = new SNSClient(region ? { region } : {});
  }

  async publish(args: {
    subject: string;
    envelope: TypedEvent<EventType>;
  }): Promise<{ messageId: string }> {
    const { subject, envelope } = args;
    const input: PublishCommandInput = {
      TopicArn: this.topicArn,
      Subject: subject,
      Message: JSON.stringify(envelope),
      // SQS-side dedupe key — the audit writer reads it and short-circuits
      // when the same `event_id` has already landed in `audit.events`.
      MessageDeduplicationId: envelope.event_id,
      MessageGroupId: envelope.tenant_id,
      MessageAttributes: {
        'fora-tenant-id': { DataType: 'String', StringValue: envelope.tenant_id },
        'fora-run-id': { DataType: 'String', StringValue: envelope.run_id },
        'fora-event-type': { DataType: 'String', StringValue: envelope.event_type },
        'fora-event-id': { DataType: 'String', StringValue: envelope.event_id },
        'fora-event-version': { DataType: 'String', StringValue: envelope.v },
      },
    };
    const out = await this.client.send(new PublishCommand(input));
    return { messageId: out.MessageId ?? '' };
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}
