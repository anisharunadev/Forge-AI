'use client';

/**
 * `<DestinationsTab>` — Step 28.
 *
 * Grid of sync destinations (Jira, Confluence, AI agent via MCP, Slack,
 * Teams, email digest, GitHub mirror). Mirrors the layout of
 * `<SourcesTab>` for visual consistency.
 */

import * as React from 'react';
import {
  BookOpen, CheckCircle2,
  Code,
  Cog,
  Mail,
  MessageSquare,
  Plug,
  Settings,
  // Slack,
  Sparkles,
  // Trello
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { DESTINATIONS, type Destination } from '@/lib/ideation/pipeline-data';

function accentClasses(accent: Destination['accent']): {
  ring: string;
  bg: string;
  text: string;
} {
  switch (accent) {
    case 'cyan':
      return { ring: 'ring-[rgba(34,211,238,0.35)]', bg: 'bg-[rgba(34,211,238,0.10)]', text: 'text-[var(--accent-cyan)]' };
    case 'amber':
      return { ring: 'ring-[rgba(245,158,11,0.35)]', bg: 'bg-[rgba(245,158,11,0.10)]', text: 'text-[var(--accent-amber)]' };
    case 'indigo':
      return { ring: 'ring-[rgba(99,102,241,0.35)]', bg: 'bg-[rgba(99,102,241,0.10)]', text: 'text-[var(--accent-primary)]' };
    case 'violet':
      return { ring: 'ring-[rgba(168,85,247,0.35)]', bg: 'bg-[rgba(168,85,247,0.10)]', text: 'text-[var(--accent-violet)]' };
    case 'rose':
      return { ring: 'ring-[rgba(244,63,94,0.35)]', bg: 'bg-[rgba(244,63,94,0.10)]', text: 'text-[var(--accent-rose)]' };
    case 'emerald':
      return { ring: 'ring-[rgba(16,185,129,0.35)]', bg: 'bg-[rgba(16,185,129,0.10)]', text: 'text-[var(--accent-emerald)]' };
  }
}

function destIconNode(name: Destination['icon']): React.ReactNode {
  switch (name) {
    case 'Trello':
      // Trello glyph was dropped during lint cleanup — fall back to Code (which
      // is already imported and reads as "project board").
      return <Code className="h-5 w-5" aria-hidden="true" />;
    case 'BookOpen':
      return <BookOpen className="h-5 w-5" aria-hidden="true" />;
    case 'Sparkles':
      return <Sparkles className="h-5 w-5" aria-hidden="true" />;
    case 'Slack':
      // Slack glyph was dropped during lint cleanup — fall back to MessageSquare.
      return <MessageSquare className="h-5 w-5" aria-hidden="true" />;
    case 'Github':
      return <Code className="h-5 w-5" aria-hidden="true" />;
    case 'Mail':
      return <Mail className="h-5 w-5" aria-hidden="true" />;
    case 'MessageSquare':
      return <MessageSquare className="h-5 w-5" aria-hidden="true" />;
  }
}

function DestinationCardGrid({ destination }: { destination: Destination }) {
  const accent = accentClasses(destination.accent);
  const connected = destination.status === 'connected';

  return (
    <article
      data-testid="destination-card"
      data-destination-id={destination.id}
      data-destination-status={destination.status}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-[border,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)]',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md ring-1',
              accent.bg,
              accent.text,
              accent.ring,
            )}
          >
            {destIconNode(destination.icon)}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{destination.name}</h3>
            <p className="line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">
              {destination.description}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider',
            connected
              ? 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]'
              : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
          )}
        >
          {connected ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Plug className="h-3 w-3" aria-hidden="true" />
          )}
          {connected ? 'connected' : 'available'}
        </span>
      </header>

      {connected ? (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
            <div className="text-[var(--fg-tertiary)]">Last sync</div>
            <div className="font-mono text-[var(--fg-primary)]">{destination.lastSync}</div>
          </div>
          {destination.metric ? (
            <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
              <div className="text-[var(--fg-tertiary)]">{destination.metric.label}</div>
              <div className="font-mono text-[var(--fg-primary)]">{destination.metric.value}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-inset)] p-3 text-[11px] text-[var(--fg-tertiary)]">
          Connect to start syncing.
        </div>
      )}

      <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-[10px] font-mono text-[var(--fg-secondary)]">
        {destination.kpi}
      </div>

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {destination.kind === 'pm' && 'Project management'}
          {destination.kind === 'docs' && 'Docs'}
          {destination.kind === 'ide' && 'IDE execution'}
          {destination.kind === 'chat' && 'Notifications'}
          {destination.kind === 'digest' && 'Email'}
          {destination.kind === 'mirror' && 'Mirror'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`destination-configure-${destination.id}`}
            onClick={() => toast.info(`Configure ${destination.name}`)}
            className="text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Cog className="h-3.5 w-3.5" aria-hidden="true" />
            Configure
          </Button>
          {connected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`destination-disconnect-${destination.id}`}
              onClick={() => toast.info(`Disconnect ${destination.name}`)}
              className="text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.10)] hover:text-[var(--accent-rose)]"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              data-testid={`destination-connect-${destination.id}`}
              onClick={() => toast.success(`Mock OAuth: ${destination.name} connected`, {
                description: 'Real OAuth lands in a follow-up step.',
              })}
              className="bg-[var(--accent-primary)] text-white hover:opacity-90"
            >
              <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              Connect
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}

export interface DestinationsTabProps {
  readonly onAddCustom?: () => void;
}

export function DestinationsTab({ onAddCustom }: DestinationsTabProps) {
  const connected = DESTINATIONS.filter((d) => d.status === 'connected');
  const available = DESTINATIONS.filter((d) => d.status !== 'connected');

  return (
    <section aria-label="Sync destinations" data-testid="destinations-tab" className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Destinations
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            Where Forge pushes results
          </h2>
          <p className="text-xs text-[var(--fg-tertiary)]">
            {connected.length} connected · {available.length} available
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddCustom ?? (() => toast.info('Custom destination picker opens in a follow-up.'))}
          className="border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          Custom destination
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <DestinationCardGrid key={d.id} destination={d} />
        ))}
      </div>
    </section>
  );
}