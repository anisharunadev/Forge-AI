'use client';

/**
 * Step 45 — Story detail QA Agent entry point.
 *
 * Rendered inside the Story detail page so QA Agent can be invoked
 * from a PR-linked story without leaving Project Intelligence.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ScanEye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { captureScreenshot } from '@/lib/verify/browser';

export interface StoryQaAgentButtonProps {
  storyId: string;
}

export function StoryQaAgentButton({ storyId }: StoryQaAgentButtonProps) {
  const [busy, setBusy] = React.useState(false);
  const handleLaunch = async () => {
    setBusy(true);
    try {
      // The "preview URL" is conventionally derived from the story id
      // until the real PR-pre wiring lands. forge-browser gracefully
      // degrades when the package is missing.
      const url = `/stories/${storyId}/preview`;
      const result = await captureScreenshot(url);
      if (result.ran_visually) {
        toast.success('QA Agent captured screenshots.');
      } else {
        toast.info('QA Agent ran in degraded mode (forge-browser not installed).');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-end" data-testid="story-qa-agent">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={handleLaunch}
        data-story-id={storyId}
      >
        <ScanEye className="mr-2 h-3.5 w-3.5" aria-hidden />
        {busy ? 'Running QA Agent…' : 'Run QA Agent'}
      </Button>
    </div>
  );
}