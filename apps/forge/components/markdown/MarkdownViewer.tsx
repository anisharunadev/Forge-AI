'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';

export interface MarkdownViewerProps {
  source: string;
  className?: string;
  /** Optional label shown above the rendered content. */
  caption?: string;
}

/**
 * Read-only markdown renderer used by the Command Center's View dialog and
 * any other place that needs to display a saved .md file.
 *
 * The renderer is intentionally dep-free (no react-markdown) to keep the
 * bundle small and avoid HTML sanitization concerns.
 */
export function MarkdownViewer({
  source,
  className,
  caption,
}: MarkdownViewerProps) {
  return (
    <div
      data-testid="markdown-viewer"
      className={cn(
        'flex max-h-[60vh] flex-col gap-2 overflow-auto rounded-md border border-border bg-card p-4',
        className,
      )}
    >
      {caption ? (
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {caption}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">{renderMarkdown(source)}</div>
    </div>
  );
}
