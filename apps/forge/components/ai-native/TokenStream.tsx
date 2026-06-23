'use client';

import * as React from 'react';
import { Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Animated token stream — renders partial model output with a blinking
 * caret. While `isStreaming`, a Stop button appears next to the caret
 * (wired to `onStop`).
 *
 * Used inside the agent execution view to show live model output.
 */
export interface TokenStreamProps {
  readonly text: string;
  readonly isStreaming?: boolean;
  readonly onStop?: () => void;
  readonly className?: string;
}

export function TokenStream({
  text,
  isStreaming = false,
  onStop,
  className,
}: TokenStreamProps) {
  return (
    <div
      data-testid="token-stream"
      data-streaming={isStreaming}
      className={cn('flex flex-col gap-2', className)}
    >
      <pre
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-3 font-mono text-13 leading-relaxed text-foreground"
        data-testid="token-stream-body"
      >
        {text}
        {isStreaming ? (
          <span
            aria-hidden="true"
            data-testid="token-stream-caret"
            className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse-agent bg-execution"
          />
        ) : null}
      </pre>
      {isStreaming && onStop ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={onStop}
            data-testid="token-stream-stop"
          >
            <Square className="h-3 w-3" aria-hidden="true" />
            Stop
          </Button>
        </div>
      ) : null}
    </div>
  );
}
