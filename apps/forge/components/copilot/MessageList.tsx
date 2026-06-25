'use client';

/**
 * F-800 — Message list.
 *
 * Scrollable list of `MessageBubble` items. Auto-scrolls to the
 * bottom on new messages — but only if the user is already near the
 * bottom (so reading an older message doesn't get yank-reset on
 * every incoming token).
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { CopilotMessageRead } from '@/lib/api/copilot';

import { MessageBubble } from './MessageBubble';

export interface MessageListProps {
  messages: CopilotMessageRead[];
  className?: string;
}

const STICK_THRESHOLD_PX = 64;

/**
 * Renders a list of messages with auto-stick-to-bottom behavior.
 * Keeps scroll position when the user has scrolled up to read older
 * messages; snaps to the bottom when they send a new message.
 */
export function MessageList({ messages, className }: MessageListProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const lastLengthRef = React.useRef(messages.length);

  // Track whether the user is "near the bottom" — if so, new
  // messages should snap us back down. If they have scrolled up to
  // read, we leave the viewport alone.
  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICK_THRESHOLD_PX;
  }, []);

  // When new messages arrive, snap to bottom if we're still sticking.
  React.useEffect(() => {
    if (messages.length === lastLengthRef.current) return;
    lastLengthRef.current = messages.length;
    if (!stickToBottomRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground',
          className,
        )}
        data-testid="copilot-message-list"
        data-empty="true"
      >
        Send a message to start the conversation.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={cn(
        'flex flex-1 flex-col gap-3 overflow-y-auto p-3',
        className,
      )}
      data-testid="copilot-message-list"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}