'use client';

/**
 * ConnectorActionButton — inline invoke button.
 *
 * Renders next to any entity (idea, story, workflow) and lists actions
 * supported by installed connectors. Hover opens an action menu; click
 * runs the action through the provider (mock-only — calls `invoke()`).
 *
 * If no connector supports the requested actions, renders a
 * `<ConnectorCredentialsBadge>` instead.
 */

import * as React from 'react';
import {
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConnectorCredentialsBadge } from './ConnectorCredentialsBadge';
import { ConnectorHealthIndicator } from './ConnectorHealthIndicator';
import { cn } from '@/lib/utils';
import {
  resolveIcon,
  useConnectorsOptional,
  type Connector,
  type ConnectorCapability,
} from '@/lib/connectors';

const ACTION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  send_message: MessageSquare,
  send_email: Mail,
  create_ticket: Plus,
  trigger_deploy: WandSparkles,
  pull_issues: Sparkles,
};

export interface ConnectorAction {
  readonly id: string;
  readonly label: string;
  readonly capability: ConnectorCapability;
  /** Optional template parameters that get passed to `invoke()`. */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ConnectorActionButtonProps {
  readonly entityLabel: string;
  readonly actions: ReadonlyArray<ConnectorAction>;
  readonly onAction?: (action: ConnectorAction, connector: Connector) => void;
  readonly variant?: 'menu' | 'inline';
  readonly className?: string;
}

interface ActionRun {
  status: 'idle' | 'running' | 'success' | 'failed';
  message?: string;
  durationMs?: number;
}

export function ConnectorActionButton({
  entityLabel,
  actions,
  onAction,
  variant = 'menu',
  className,
}: ConnectorActionButtonProps) {
  const ctx = useConnectorsOptional();
  const [open, setOpen] = React.useState(false);
  const [run, setRun] = React.useState<ActionRun>({ status: 'idle' });
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Map each requested action to the first installed connector that supports it.
  const resolved = React.useMemo(() => {
    if (!ctx) return [];
    return actions
      .map((a) => {
        const matches = ctx.byCapability(a.capability);
        return { action: a, connectors: matches };
      })
      .filter((row) => row.connectors.length > 0);
  }, [ctx, actions]);

  const trigger = (a: ConnectorAction, c: Connector) => {
    setRun({ status: 'running' });
    setOpen(false);
    if (!ctx) return;
    void ctx.invoke({ connectorId: c.id, action: a.capability, params: a.params ?? {} }).then((r) => {
      setRun({
        status: r.ok ? 'success' : 'failed',
        message: r.message,
        durationMs: r.durationMs,
      });
      setTimeout(() => setRun({ status: 'idle' }), 3200);
      onAction?.(a, c);
    });
  };

  if (!ctx) return null;

  // No connectors available — show credentials badge per action group.
  if (resolved.length === 0) {
    const cap = actions[0]?.capability ?? 'send_message';
    return (
      <ConnectorCredentialsBadge
        connectorId="__none__"
        displayName={`a ${cap.replace(/_/g, ' ')} source`}
        variant="inline"
      />
    );
  }

  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        {resolved.map(({ action, connectors }) => {
          const Icon = ACTION_ICON[action.capability] ?? WandSparkles;
          const c = connectors[0];
          const CIcon = resolveIcon(c.id);
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => trigger(action, c)}
              data-testid="connector-action-button"
              data-action-id={action.id}
              data-connector-id={c.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-fg-secondary transition-colors',
                'hover:border-[var(--accent-cyan)] hover:text-fg-primary cursor-pointer',
              )}
              title={`${action.label} via ${c.displayName}`}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              <span>{action.label}</span>
              <span className="text-fg-tertiary">·</span>
              <CIcon className="h-3 w-3" aria-hidden="true" />
              <span>{c.displayName}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        data-testid="connector-action-button-trigger"
      >
        <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Actions
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={`Actions for ${entityLabel}`}
          className={cn(
            'absolute z-30 mt-1 w-[300px] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]',
          )}
        >
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-tertiary">
            Send {entityLabel} to…
          </div>
          <ul>
            {resolved.flatMap(({ action, connectors }) =>
              connectors.map((c) => {
                const Icon = ACTION_ICON[action.capability] ?? WandSparkles;
                const CIcon = resolveIcon(c.id);
                return (
                  <li key={`${action.id}-${c.id}`}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => trigger(action, c)}
                      data-testid="connector-action-button-option"
                      data-action-id={action.id}
                      data-connector-id={c.id}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-primary transition-colors hover:bg-[var(--bg-surface)]"
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-fg-secondary">
                        <CIcon className="h-3 w-3" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{action.label}</span>
                        <span className="block truncate text-[11px] text-fg-tertiary">
                          via {c.displayName}
                        </span>
                      </span>
                      <Icon className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
                      <ConnectorHealthIndicator
                        connectorId={c.id}
                        status={c.status}
                        size="xs"
                      />
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      ) : null}

      {run.status === 'running' ? (
        <span
          role="status"
          aria-live="polite"
          className="ml-2 inline-flex items-center gap-1 text-xs text-fg-secondary"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Running…
        </span>
      ) : null}
      {run.status === 'success' ? (
        <span
          role="status"
          aria-live="polite"
          className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--accent-emerald)]"
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {run.message ?? 'Done'}
        </span>
      ) : null}
      {run.status === 'failed' ? (
        <span
          role="status"
          aria-live="polite"
          className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--accent-rose)]"
        >
          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          {run.message ?? 'Failed'}
        </span>
      ) : null}
    </div>
  );
}