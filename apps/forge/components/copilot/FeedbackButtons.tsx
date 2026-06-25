'use client';

/**
 * F-800 — Feedback buttons.
 *
 * Thumbs up/down on each assistant message. Click up/down to send
 * immediate feedback; click again to expand a comment textarea.
 * Submits via `useSubmitFeedback`.
 */

import * as React from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSubmitFeedback } from '@/hooks/use-copilot-mutations';
import type { CopilotFeedbackRating } from '@/lib/api/copilot';
import { cn } from '@/lib/utils';

export interface FeedbackButtonsProps {
  messageId: string;
  conversationId?: string | null;
  currentRating: CopilotFeedbackRating | null;
}

/**
 * Two-button feedback row. After a rating is submitted, a small
 * textarea appears for an optional comment. Submitting clears the
 * form; clicking the same thumb again re-toggles the comment box.
 */
export function FeedbackButtons({
  messageId,
  conversationId,
  currentRating,
}: FeedbackButtonsProps) {
  const submit = useSubmitFeedback();
  const [expanded, setExpanded] = React.useState(false);
  const [pendingRating, setPendingRating] =
    React.useState<CopilotFeedbackRating | null>(null);
  const [comment, setComment] = React.useState('');

  const handleRate = React.useCallback(
    (rating: CopilotFeedbackRating) => {
      if (currentRating === rating) {
        // Toggle off — keep expanded state intact.
        return;
      }
      setPendingRating(rating);
      setExpanded(true);
      submit.mutate({ messageId, rating, conversationId });
    },
    [currentRating, submit, messageId, conversationId],
  );

  const handleSubmitComment = React.useCallback(() => {
    if (!pendingRating) return;
    submit.mutate(
      { messageId, rating: pendingRating, comment, conversationId },
      {
        onSuccess: () => {
          setComment('');
          setExpanded(false);
          setPendingRating(null);
        },
      },
    );
  }, [pendingRating, comment, submit, messageId, conversationId]);

  return (
    <div
      className="flex flex-col items-end gap-1"
      data-testid="copilot-feedback-buttons"
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6',
            currentRating === 'up' && 'text-emerald-400',
          )}
          onClick={() => handleRate('up')}
          aria-label="Thumbs up"
          aria-pressed={currentRating === 'up'}
          data-testid="copilot-feedback-up"
          data-rating="up"
        >
          <ThumbsUp className="h-3 w-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6',
            currentRating === 'down' && 'text-destructive',
          )}
          onClick={() => handleRate('down')}
          aria-label="Thumbs down"
          aria-pressed={currentRating === 'down'}
          data-testid="copilot-feedback-down"
          data-rating="down"
        >
          <ThumbsDown className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
      {expanded ? (
        <div className="flex w-full flex-col items-end gap-1">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1 text-xs"
            data-testid="copilot-feedback-comment"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleSubmitComment}
            disabled={submit.isPending}
            className="h-6 px-2 text-[11px]"
            data-testid="copilot-feedback-submit"
          >
            {submit.isPending ? 'Saving…' : 'Save comment'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}