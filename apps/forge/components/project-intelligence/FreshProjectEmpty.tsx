'use client';

/**
 * FreshProjectEmpty — full empty state for a brand-new project
 * (Step 20). Centered Step 3 full EmptyState with Sparkles illustration.
 */

import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/src/components/empty-state';

export interface FreshProjectEmptyProps {
  onCaptureFirstIdea?: () => void;
  onHowProjectsWork?: () => void;
}

export function FreshProjectEmpty({
  onCaptureFirstIdea,
  onHowProjectsWork,
}: FreshProjectEmptyProps) {
  return (
    <div
      className="mx-auto max-w-3xl py-16"
      data-testid="project-fresh-empty"
    >
      <EmptyState
        illustration={<Sparkles size={40} strokeWidth={1.5} />}
        title="This project is fresh"
        description="Start by approving an idea, drafting a PRD, or creating your first epic. Each artifact unlocks the next step."
        primaryAction={
          onCaptureFirstIdea
            ? { label: 'Capture first idea', onClick: onCaptureFirstIdea }
            : undefined
        }
        secondaryAction={
          onHowProjectsWork
            ? { label: 'How projects work', onClick: onHowProjectsWork }
            : undefined
        }
      />
    </div>
  );
}
