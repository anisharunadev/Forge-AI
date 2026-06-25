'use client';

/**
 * F-800 — Citation chip.
 *
 * Small clickable badge that links to the source URL for a single
 * citation. Used inline in assistant messages (renders as a chip)
 * and inside the citation popover (future). Type label colored by
 * the citation type for at-a-glance scanning.
 */

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CopilotCitation } from '@/lib/api/copilot';

const TYPE_TONE: Record<CopilotCitation['type'], string> = {
  service: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  adr: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  standard: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  template: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  doc: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  kg_node: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  command: 'border-pink-500/40 bg-pink-500/10 text-pink-300',
};

export interface CitationChipProps {
  citation: CopilotCitation;
  className?: string;
}

/**
 * Clickable citation chip. Opens the source URL in a new tab.
 * Renders a `Badge` with the citation type label + a small external
 * link icon. The label is the human-readable citation title.
 */
export function CitationChip({ citation, className }: CitationChipProps) {
  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent/30',
        TYPE_TONE[citation.type] ?? TYPE_TONE.doc,
        className,
      )}
      title={citation.snippet}
      data-testid="copilot-citation"
      data-citation-type={citation.type}
    >
      <span className="truncate">{citation.label}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}