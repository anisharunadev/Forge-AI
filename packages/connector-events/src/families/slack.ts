/**
 * Slack family — FORA-484 AC #2.
 *
 * Four event types per Plan 3 §3:
 *   slack.message.received
 *   slack.command.executed
 *   slack.notification.sent
 *   slack.thread.summarized
 */

import type { ConnectorFamily } from '../envelope.js';

export const SLACK_FAMILY: ConnectorFamily = 'slack';

export const SLACK_EVENT_TYPES = [
  'slack.message.received',
  'slack.command.executed',
  'slack.notification.sent',
  'slack.thread.summarized',
] as const;
export type SlackEventType = (typeof SLACK_EVENT_TYPES)[number];

export function isSlackEvent(event_type: string): boolean {
  return (SLACK_EVENT_TYPES as readonly string[]).includes(event_type);
}

export const SLACK_OPS = [
  'message.receive',
  'command.execute',
  'notification.send',
  'thread.summarize',
] as const;
export type SlackOp = (typeof SLACK_OPS)[number];

export function slackEventFor(op: SlackOp): SlackEventType {
  switch (op) {
    case 'message.receive':
      return 'slack.message.received';
    case 'command.execute':
      return 'slack.command.executed';
    case 'notification.send':
      return 'slack.notification.sent';
    case 'thread.summarize':
      return 'slack.thread.summarized';
  }
}