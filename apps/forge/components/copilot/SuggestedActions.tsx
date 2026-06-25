'use client';

/**
 * F-800 — Suggested actions.
 *
 * Clickable chips for `CopilotSuggestedAction` items. Each chip
 * dispatches on `action_type`:
 *   - `navigate`      → router.push(payload.url)
 *   - `run_command`   → open CommandConfirmModal (wired in Plan 3)
 *   - `draft`         → open DraftReviewModal (wired in Plan 3)
 *   - `open_modal`    → fire a synthetic `copilot:open_modal` event
 *
 * Modal open state lives in the parent (`CopilotPanel`) so the
 * modals mount once and survive the message list re-rendering.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileEdit, Play, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CopilotSuggestedAction } from '@/lib/api/copilot';

export interface SuggestedActionsProps {
  actions: CopilotSuggestedAction[];
  /** Called when a `run_command` action is clicked. */
  onRunCommand?: (action: CopilotSuggestedAction) => void;
  /** Called when a `draft` action is clicked. */
  onDraft?: (action: CopilotSuggestedAction) => void;
  className?: string;
}

/**
 * Returns the event name to dispatch for a given action_type so the
 * parent panel (which owns modal state) can listen centrally.
 */
function eventNameFor(actionType: CopilotSuggestedAction['action_type']): string | null {
  switch (actionType) {
    case 'draft':
      return 'copilot:open_draft';
    case 'run_command':
      return 'copilot:run_command';
    case 'open_modal':
      return 'copilot:open_modal';
    case 'navigate':
      return null;
  }
}

const ICON: Record<CopilotSuggestedAction['action_type'], React.ReactNode> = {
  navigate: <ArrowRight className="h-3 w-3" aria-hidden="true" />,
  run_command: <Play className="h-3 w-3" aria-hidden="true" />,
  draft: <FileEdit className="h-3 w-3" aria-hidden="true" />,
  open_modal: <Sparkles className="h-3 w-3" aria-hidden="true" />,
};

/**
 * Render a row of clickable chips, one per suggested action.
 * Dispatches based on `action_type` — `navigate` uses `next/navigation`,
 * the other three delegate to parent handlers.
 */
export function SuggestedActions({
  actions,
  onRunCommand,
  onDraft,
  className,
}: SuggestedActionsProps) {
  const router = useRouter();

  const handleClick = React.useCallback(
    (action: CopilotSuggestedAction) => {
      switch (action.action_type) {
        case 'navigate': {
          const url = (action.payload as { url?: string }).url;
          if (url) router.push(url);
          break;
        }
        case 'run_command':
          onRunCommand?.(action);
          break;
        case 'draft':
          onDraft?.(action);
          break;
        case 'open_modal': {
          // Synthetic event so other surfaces (e.g. a side panel) can
          // register modal-open handlers without prop-drilling.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('copilot:open_modal', {
                detail: { label: action.label, payload: action.payload },
              }),
            );
          }
          break;
        }
      }
      // Also fire the panel-bridge event so the centrally-owned modals
      // (DraftReview / CommandConfirm) can open. The handler no-ops if
      // there's no listener, so this is safe even when the panel is
      // closed.
      const eventName = eventNameFor(action.action_type);
      if (eventName && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(eventName, { detail: action }));
      }
    },
    [router, onRunCommand, onDraft],
  );

  if (actions.length === 0) return null;

  return (
    <div
      className={cn('flex flex-wrap gap-1.5', className)}
      data-testid="copilot-suggested-actions"
    >
      {actions.map((a, i) => (
        <Button
          key={`${a.label}-${i}`}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => handleClick(a)}
          data-testid={
            a.action_type === 'draft' || a.action_type === 'run_command'
              ? `copilot-suggested-action-${a.action_type}`
              : 'copilot-suggested-action'
          }
          data-action-type={a.action_type}
        >
          {ICON[a.action_type]}
          <span>{a.label}</span>
        </Button>
      ))}
    </div>
  );
}