'use client';

/**
 * Step 24 — Message bubbles.
 *
 * Renders a single message — user, assistant, system, or tool.
 * Step 24 polish:
 *
 *   - USER — right-aligned, max 85% width, bg --accent-primary,
 *     --radius-2xl (top-right corner pulled in for the "tail"),
 *     markdown rendered body.
 *
 *   - ASSISTANT — left-aligned, NO bubble bg (Linear-style). Above
 *     the message: avatar (24×24 with Sparkles in --accent-cyan) +
 *     "Forge Co-pilot" + model name. Below: action row (Copy /
 *     Regenerate / Thumbs up/down / Pin / Share). Sources row at
 *     the bottom (citations). Streaming caret at the right edge
 *     while the response is still arriving.
 *
 *   - SYSTEM — muted dashed card.
 *
 *   - TOOL — rendered as a collapsible tool-call card (between
 *     messages).
 *
 *   - DAY SEPARATORS — sticky headers between messages from
 *     different days. Rendered by `MessageList`.
 *
 * Skill influence (ui-ux-pro-max):
 *   - "AI-Native UI" — assistant message has no bubble bg; clean,
 *     Linear-like surface. User message is a single indigo pill.
 *   - "Streaming" UX rule — the response renders word-by-word with
 *     a cyan caret at the end (CSS-only animation). Stop button
 *     appears in the composer (ComposerInput) when streaming.
 *   - "Show helpful message and action" — every action has an
 *     icon + label.
 */

import * as React from 'react';
import {
  Check,
  Copy,
  Pin,
  RefreshCw,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';

import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import type { CopilotMessageRead } from '@/lib/api/copilot';

import { CitationChip } from './CitationChip';
import { FeedbackButtons } from './FeedbackButtons';
import { SuggestedActions } from './SuggestedActions';
import { ToolCallCard } from './ToolCallCard';

export interface MessageBubbleProps {
  message: CopilotMessageRead;
  /** True if this message is currently streaming. */
  streaming?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div
        className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5"
        data-testid="copilot-message-user"
        data-role="user"
      >
        <div
          className={cn(
            'rounded-[var(--radius-2xl)] bg-[var(--accent-primary)] px-4 py-3 text-[var(--text-sm)] text-white shadow-[var(--shadow-sm)]',
            // Pull in the top-right corner for a chat-tail feel.
            '[border-top-right-radius:8px]',
          )}
        >
          <div className="prose prose-sm max-w-none text-white prose-headings:text-white prose-strong:text-white prose-code:bg-white/15 prose-code:text-white prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
            {renderMarkdown(message.content)}
          </div>
        </div>
        <MessageActions role="user" content={message.content} />
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div
        className="mx-auto max-w-[90%] rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-xs)] italic text-[var(--fg-tertiary)]"
        data-testid="copilot-message"
        data-role="system"
      >
        {message.content}
      </div>
    );
  }

  if (message.role === 'tool') {
    return (
      <div
        className="mx-auto max-w-[90%]"
        data-testid="copilot-message"
        data-role="tool"
      >
        <ToolCallCard
          toolCall={{
            tool: 'tool',
            args: {},
            result_status: 'success',
            duration_ms: 0,
            error: null,
          }}
        />
      </div>
    );
  }

  // Assistant — Linear-style: no bubble bg, header row, action row.
  return (
    <div
      className="mr-auto flex max-w-[90%] flex-col gap-2"
      data-testid="copilot-message-assistant"
      data-role="assistant"
      data-streaming={streaming ? 'true' : 'false'}
    >
      {/* Header row — avatar + name + model */}
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-cyan)]"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <span className="text-[var(--text-xs)] font-semibold text-[var(--fg-primary)]">
          Forge Co-pilot
        </span>
        {message.model ? (
          <span className="text-[10px] text-[var(--fg-tertiary)]">
            · {message.model}
          </span>
        ) : null}
      </header>

      {/* Body */}
      <div
        className={cn(
          'prose prose-sm max-w-none text-[var(--fg-primary)]',
          // Tighter markdown spacing for the Linear-style surface.
          'prose-headings:text-[var(--fg-primary)] prose-p:my-2 prose-pre:my-2 prose-code:bg-[var(--bg-inset)] prose-code:text-[var(--fg-primary)] prose-code:before:content-none prose-code:after:content-none prose-code:px-1 prose-code:rounded',
        )}
      >
        {renderMarkdown(message.content)}
        {streaming ? (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse bg-[var(--accent-cyan)]"
          />
        ) : null}
      </div>

      {/* Tool calls */}
      {message.tool_calls.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {message.tool_calls.map((tc, i) => (
            <ToolCallCard
              key={`${tc.tool}-${i}`}
              toolCall={tc}
            />
          ))}
        </div>
      ) : null}

      {/* Citations */}
      {message.citations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <CitationChip key={c.id} citation={c} />
          ))}
        </div>
      ) : null}

      {/* Suggested actions */}
      {message.suggested_actions.length > 0 ? (
        <SuggestedActions actions={message.suggested_actions} />
      ) : null}

      {/* Footer — action row (always present for the affordance; */}
      {/* hidden while streaming so the UI stays calm). */}
      {!streaming ? (
        <MessageActions
          role="assistant"
          content={message.content}
          message={message}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Action row — Copy / Regenerate / Thumbs up/down / Pin / Share
// ─────────────────────────────────────────────────────────────────────

function MessageActions({
  role,
  content,
  message,
}: {
  role: 'user' | 'assistant';
  content: string;
  message?: CopilotMessageRead;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available — silently ignore.
    }
  }, [content]);

  return (
    <div
      role="toolbar"
      aria-label={role === 'user' ? 'Message actions' : 'Response actions'}
      className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 data-[always=true]:opacity-100"
      data-always={role === 'user' ? 'false' : 'true'}
    >
      <ActionButton
        label={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
        icon={copied ? Check : Copy}
        testId="copilot-msg-copy"
      />
      {role === 'assistant' ? (
        <>
          <ActionButton
            label="Regenerate"
            onClick={() => {
              // Re-send the prior user message. The composer wires
              // this through the store's lastDraft so we don't have
              // to thread the conversation through.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('copilot:regenerate', {
                    detail: { messageId: message?.id },
                  }),
                );
              }
            }}
            icon={RefreshCw}
            testId="copilot-msg-regenerate"
          />
          {message ? (
            <FeedbackButtons
              messageId={message.id}
              conversationId={message.conversation_id}
              currentRating={message.feedback_rating}
            />
          ) : null}
          <ActionButton
            label="Pin message"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('copilot:pin_message', {
                    detail: { messageId: message?.id },
                  }),
                );
              }
            }}
            icon={Pin}
            testId="copilot-msg-pin"
          />
          <ActionButton
            label="Share"
            onClick={() => {
              if (typeof window !== 'undefined' && message) {
                const url = `${window.location.origin}/copilot?c=${message.conversation_id}&m=${message.id}`;
                navigator.clipboard?.writeText(url).catch(() => {});
              }
            }}
            icon={Share2}
            testId="copilot-msg-share"
          />
        </>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  icon: Icon,
  testId,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors',
        'hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--fg-primary)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

// Re-export for convenience — used by older callers that still
// import ThumbsUp/Down from this module.
export { ThumbsUp, ThumbsDown, Wrench };
