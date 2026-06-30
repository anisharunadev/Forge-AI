'use client';

/**
 * F-800 — Message list (Step 24 polish).
 *
 * Scrollable list of `MessageBubble` items. Auto-scrolls to the
 * bottom on new messages — but only if the user is already near the
 * bottom (so reading an older message doesn't get yank-reset on
 * every incoming token).
 *
 * Step 24 additions:
 *   - DAY SEPARATORS — sticky headers between messages from
 *     different days ("Today" / "Yesterday" / "Jun 20").
 *   - "group" wrapper around each bubble so the MessageActions
 *     toolbar can hover-reveal.
 *   - Empty state styled for "no messages yet".
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { CopilotMessageRead } from '@/lib/api/copilot';

import { MessageBubble } from './MessageBubble';

export interface MessageListProps {
  messages: CopilotMessageRead[];
  className?: string;
  /** True while the latest assistant message is streaming. */
  streaming?: boolean;
}

const STICK_THRESHOLD_PX = 64;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDayHeader(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diff = today - day;
  if (diff === 0) return 'Today';
  if (diff === 86400 * 1000) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function MessageList({ messages, className, streaming }: MessageListProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const lastLengthRef = React.useRef(messages.length);

  // Track whether the user is "near the bottom".
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
          'flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-[var(--fg-tertiary)]',
          className,
        )}
        data-testid="copilot-message-list"
        data-empty="true"
      >
        Send a message to start the conversation.
      </div>
    );
  }

  // Group messages by day for the sticky separators. The list is
  // rendered as a flat sequence with a header prepended whenever
  // the day bucket changes.
  const rendered: React.ReactNode[] = [];
  let lastBucket = '';
  messages.forEach((m, idx) => {
    const ts = m.created_at ? new Date(m.created_at).getTime() : Date.now();
    const bucket = String(startOfDay(ts));
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      rendered.push(
        <div
          key={`day-${bucket}-${idx}`}
          role="separator"
          aria-label={formatDayHeader(ts)}
          className="sticky top-0 z-[1] my-2 flex justify-center"
          data-testid="copilot-message-day-separator"
        >
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)] backdrop-blur">
            {formatDayHeader(ts)}
          </span>
        </div>,
      );
    }
    const isLastAssistant =
      streaming === true &&
      idx === messages.length - 1 &&
      m.role === 'assistant';
    rendered.push(
      <div key={m.id} className="group">
        <MessageBubble message={m} streaming={isLastAssistant} />
      </div>,
    );
  });

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={cn(
        'scrollbar-chat flex flex-1 flex-col gap-3 overflow-y-auto p-3',
        className,
      )}
      data-testid="copilot-message-list"
      data-streaming={streaming ? 'true' : 'false'}
    >
      {rendered}
    </div>
  );
}
