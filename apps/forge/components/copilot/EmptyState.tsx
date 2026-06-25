'use client';

/**
 * Co-pilot empty state.
 *
 * Shown when there is no active conversation. Welcome message +
 * four suggested prompts that fill the composer draft on click
 * (no API call yet — Plan 3 wires up the actual send).
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

const SUGGESTED_PROMPTS = [
  'What can Forge do?',
  'Show me recent activity',
  'Help me write an ADR',
  'Connect my first repo',
] as const;

export function EmptyState() {
  const setDraft = useCopilotStore((s) => s.setDraft);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Hi, I'm your Forge Co-pilot.</h2>
        <p className="text-sm text-muted-foreground">
          I can help you understand your project, draft artifacts, and navigate
          Forge. Ask me anything.
        </p>
      </div>

      <div className="grid w-full gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            size="sm"
            className="justify-start text-left"
            onClick={() => setDraft(prompt)}
            data-testid="copilot-suggested-prompt"
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}
