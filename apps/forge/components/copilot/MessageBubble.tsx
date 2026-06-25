'use client';

/**
 * F-800 — Message bubble.
 *
 * Renders a single message — user, assistant, system, or tool. User
 * messages render plain text; assistant messages get the markdown
 * pipeline (via `lib/markdown.tsx`), confidence indicator, citation
 * chips, tool-call cards, and suggested actions. System messages
 * are muted. Tool messages are shown as a compact callout.
 */

import * as React from 'react';

import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import type { CopilotMessageRead } from '@/lib/api/copilot';

import { CitationChip } from './CitationChip';
import { ConfidenceIndicator } from './ConfidenceIndicator';
import { FeedbackButtons } from './FeedbackButtons';
import { SuggestedActions } from './SuggestedActions';
import { ToolCallCard } from './ToolCallCard';

export interface MessageBubbleProps {
  message: CopilotMessageRead;
}

/**
 * Single message bubble. Pure render — parent (`MessageList`) owns
 * the auto-scroll behavior so the bubble can be used in isolation
 * (e.g. in the streaming V1.1 component).
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div
        className="ml-auto max-w-[85%] rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
        data-testid="copilot-message"
        data-role="user"
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground"
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
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        data-testid="copilot-message"
        data-role="tool"
      >
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide">
          tool
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">
          {message.content}
        </pre>
      </div>
    );
  }

  // Assistant
  return (
    <div
      className={cn(
        'mr-auto flex max-w-[90%] flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm',
      )}
      data-testid="copilot-message"
      data-role="assistant"
    >
      <div className="prose prose-sm max-w-none text-foreground">
        {renderMarkdown(message.content)}
      </div>

      {message.tool_calls.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {message.tool_calls.map((tc, i) => (
            <ToolCallCard key={`${tc.tool}-${i}`} toolCall={tc} />
          ))}
        </div>
      ) : null}

      {message.citations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <CitationChip key={c.id} citation={c} />
          ))}
        </div>
      ) : null}

      {message.suggested_actions.length > 0 ? (
        <SuggestedActions actions={message.suggested_actions} />
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        {message.confidence ? (
          <ConfidenceIndicator confidence={message.confidence} />
        ) : (
          <span />
        )}
        {message.role === 'assistant' ? (
          <FeedbackButtons
            messageId={message.id}
            conversationId={message.conversation_id}
            currentRating={message.feedback_rating}
          />
        ) : null}
      </div>
    </div>
  );
}