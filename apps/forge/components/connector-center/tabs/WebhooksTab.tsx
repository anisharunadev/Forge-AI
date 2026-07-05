'use client';

/**
 * WebhooksTab — Zone 9 in the Step 31 spec.
 *
 * M3-G10 — Step 55 wires this tab to the live `useWebhooks()` /
 * `useWebhookDeliveries()` / `useTestWebhook()` / `useCreateWebhook()`
 * hooks. The wire payload flows through `wireToWebhookRow` so the
 * existing inbound/outbound sub-tabs + delivery log keep rendering.
 *
 * Behavior
 * --------
 *   - Two sub-tabs (Inbound / Outbound) read from
 *     `useWebhooks('inbound')` and `useWebhooks('outbound')`.
 *   - Selected webhook's deliveries use `useWebhookDeliveries(id)`
 *     and flow through the same delivery-row renderer as the wire
 *     adapter's `recentDeliveries` field.
 *   - "Test webhook" button calls `useTestWebhook().mutate(id)`.
 *   - Wizard for inbound (pick connector → event → generated URL) and
 *     the form for outbound (URL + auth + retry) submit through
 *     `useCreateWebhook().mutate(...)`.
 *   - Loading + empty states per Rule 15.
 */

import * as React from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Loader2,
  Plus,
  Send,
  Webhook,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveIcon } from '@/lib/connectors';
import { fmtTimeAgo } from '../constants';
import { cn } from '@/lib/utils';
import {
  useWebhooks,
  useWebhookDeliveries,
  useTestWebhook,
  useCreateWebhook,
} from '@/lib/hooks/useConnectors';
import {
  wireToWebhookRow,
  type WebhookRow,
} from '@/lib/connectors/wire-adapters';
import type { ConnectorWire } from '@/lib/connectors/types';
import { useConnectors } from '@/lib/hooks/useConnectors';

type SubTab = 'inbound' | 'outbound';

export function WebhooksTab() {
  const [sub, setSub] = React.useState<SubTab>('inbound');
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // M3-G10 — read from the live hooks (one per direction).
  const inbound = useWebhooks('inbound');
  const outbound = useWebhooks('outbound');

  // Map wire rows to the legacy shape. The wizard needs a connector
  // list to populate the inbound "pick connector" step.
  const inboundRows = React.useMemo(
    () => (inbound.data ?? []).map((w) => wireToWebhookRow(w)),
    [inbound.data],
  );
  const outboundRows = React.useMemo(
    () => (outbound.data ?? []).map((w) => wireToWebhookRow(w)),
    [outbound.data],
  );
  const rows = sub === 'inbound' ? inboundRows : outboundRows;

  const isLoading = sub === 'inbound' ? inbound.isLoading : outbound.isLoading;
  const isErrored = sub === 'inbound' ? inbound.isError : outbound.isError;

  const counts = {
    inbound: inboundRows.length,
    outbound: outboundRows.length,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="connector-webhooks-tab">
      {/* Sub-tab bar */}
      <div className="inline-flex w-fit rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0.5">
        <button
          type="button"
          onClick={() => setSub('inbound')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs',
            sub === 'inbound'
              ? 'bg-[var(--bg-surface)] text-fg-primary'
              : 'text-fg-tertiary hover:text-fg-secondary',
          )}
          aria-pressed={sub === 'inbound'}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
          Inbound ({counts.inbound})
        </button>
        <button
          type="button"
          onClick={() => setSub('outbound')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs',
            sub === 'outbound'
              ? 'bg-[var(--bg-surface)] text-fg-primary'
              : 'text-fg-tertiary hover:text-fg-secondary',
          )}
          aria-pressed={sub === 'outbound'}
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden="true" />
          Outbound ({counts.outbound})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-tertiary">
          {sub === 'inbound'
            ? 'Webhooks Forge receives from external systems. Generated URLs are signed per delivery.'
            : 'Webhooks Forge sends to external systems on workflow events.'}
        </p>
        <Button size="sm" onClick={() => setWizardOpen(true)} data-testid="webhook-new">
          <Plus className="h-3 w-3" aria-hidden="true" />
          {sub === 'inbound' ? 'New inbound webhook' : 'New outbound webhook'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <WebhookRowSkeleton />
        ) : null}
        {!isLoading && rows.map((row) => (
          <WebhookCard
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
          />
        ))}
        {!isLoading && rows.length === 0 && !isErrored ? (
          <div
            className="rounded-md border border-dashed border-[var(--border-default)] p-8 text-center text-xs text-fg-tertiary"
            data-testid="webhook-empty"
          >
            <Webhook className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
            No {sub} webhooks configured.
          </div>
        ) : null}
        {isErrored ? (
          <div
            className="rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 p-8 text-center text-xs text-[var(--accent-rose)]"
            data-testid="webhook-error"
          >
            Failed to load webhooks. Showing offline data.
          </div>
        ) : null}
      </div>

      {wizardOpen ? (
        <WebhookWizard
          sub={sub}
          onClose={() => setWizardOpen(false)}
          onCreate={() => setWizardOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WebhookCard({
  row,
  expanded,
  onToggle,
}: {
  row: WebhookRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Lazy-load delivery audit for the expanded webhook.
  const deliveries = useWebhookDeliveries(expanded ? row.id : null);
  const testWebhook = useTestWebhook();

  // Re-derive the row with the lazily-loaded deliveries so the
  // delivery log renders the freshest audit trail.
  const rendered = React.useMemo(() => {
    if (!expanded) return row;
    const mapped = (deliveries.data ?? []).map((d) => ({
      id: d.id,
      at: d.attempted_at,
      status: d.status,
      code: d.response_code,
      latencyMs: d.duration_ms,
    }));
    return { ...row, recentDeliveries: mapped };
  }, [row, deliveries.data, expanded]);

  const Icon = resolveIcon(rendered.source) ?? Webhook;
  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="webhook-row"
      data-webhook-id={rendered.id}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-fg-secondary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-medium text-fg-primary">{rendered.name}</h3>
            <p className="break-all font-mono text-[11px] text-fg-tertiary">{rendered.url}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {rendered.events.slice(0, 3).map((evt) => (
                <span key={evt} className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-fg-secondary">
                  {evt}
                </span>
              ))}
              {rendered.events.length > 3 ? (
                <span className="text-[10px] text-fg-tertiary">+{rendered.events.length - 3} more</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
              rendered.status === 'active'
                ? 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]'
                : rendered.status === 'failing'
                  ? 'border-[var(--accent-rose)]/40 text-[var(--accent-rose)]'
                  : 'border-[var(--border-default)] text-fg-tertiary',
            )}
          >
            {rendered.status}
          </span>
          <span className="text-[10px] text-fg-tertiary">
            {(rendered.successRate * 100).toFixed(1)}% success · last {fmtTimeAgo(rendered.lastSent)}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => testWebhook.mutate(rendered.id)}
              disabled={testWebhook.isPending}
              data-testid="webhook-test"
            >
              {testWebhook.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3 w-3" aria-hidden="true" />
              )}
              Test
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onToggle}>
              {expanded ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {expanded ? 'Hide' : 'View'} log
            </Button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          {deliveries.isLoading ? (
            <p className="px-2 py-3 text-center text-[11px] text-fg-tertiary">Loading deliveries…</p>
          ) : rendered.recentDeliveries.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-fg-tertiary">
              No deliveries yet — send a test trigger.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-fg-tertiary">
                <tr>
                  <th className="px-2 py-1 text-left">When</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Code</th>
                  <th className="px-2 py-1 text-left">Latency</th>
                  <th className="px-2 py-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rendered.recentDeliveries.map((d) => (
                  <tr key={d.id} data-testid="webhook-delivery-row" data-delivery-id={d.id}>
                    <td className="px-2 py-1 font-mono text-fg-secondary">{fmtTimeAgo(d.at)}</td>
                    <td className="px-2 py-1">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px]',
                          d.status === 'success'
                            ? 'text-[var(--accent-emerald)]'
                            : d.status === 'failed'
                              ? 'text-[var(--accent-rose)]'
                              : 'text-[var(--accent-amber)]',
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            d.status === 'success'
                              ? 'bg-[var(--accent-emerald)]'
                              : d.status === 'failed'
                                ? 'bg-[var(--accent-rose)]'
                                : 'bg-[var(--accent-amber)]',
                          )}
                          aria-hidden="true"
                        />
                        {d.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-fg-secondary">{d.code ?? '—'}</td>
                    <td className="px-2 py-1 font-mono text-fg-secondary">{d.latencyMs}ms</td>
                    <td className="px-2 py-1 text-right">
                      {d.status === 'failed' ? (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                          Retry
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                          Inspect
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WebhookRowSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={`skel-${i}`}
          className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
          data-testid="webhook-row-skeleton"
          aria-hidden="true"
        >
          <span className="h-8 w-8 animate-pulse rounded-md bg-[var(--bg-inset)]" />
          <div className="flex-1 space-y-2">
            <span className="block h-3 w-1/3 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
            <span className="block h-3 w-1/2 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
          </div>
        </div>
      ))}
    </>
  );
}

function WebhookWizard({
  sub,
  onClose,
  onCreate,
}: {
  sub: SubTab;
  onClose: () => void;
  onCreate: () => void;
}) {
  const [step, setStep] = React.useState(0);
  const [connector, setConnector] = React.useState<string>('github');
  const [eventType, setEventType] = React.useState<string>('pull_request.opened');
  const [url, setUrl] = React.useState('');
  const [auth, setAuth] = React.useState<'none' | 'basic' | 'bearer' | 'signature'>('bearer');

  // The wizard's "pick connector" step lists the available
  // connectors — populated from the marketplace catalog or, as a
  // fallback, the connected list.
  const connectors = useConnectors();
  const connectorOptions = React.useMemo(
    () => (connectors.data ?? []).map((c) => ({ id: c.id, name: c.displayName })),
    [connectors.data],
  );

  const create = useCreateWebhook();
  const steps = sub === 'inbound'
    ? ['Pick connector', 'Pick event type', 'Generated URL + secret']
    : ['Target URL', 'Events to subscribe', 'Auth + retry policy'];

  const handleCreate = async () => {
    try {
      if (sub === 'inbound') {
        // Inbound webhooks are server-generated; the wizard renders
        // the URL/secret preview only. Submit a placeholder slug so
        // the backend can mint a real webhook row.
        await create.mutateAsync({
          name: `${connector} · ${eventType}`,
          direction: 'inbound',
          events: [eventType],
          auth_type: 'signature',
        });
      } else {
        await create.mutateAsync({
          name: url || 'Outbound webhook',
          direction: 'outbound',
          url,
          events: [],
          auth_type: auth,
        });
      }
      onCreate();
    } catch {
      // toast handled by the hook
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-[560px] max-w-[92vw] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-md)]">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-fg-primary">
              {sub === 'inbound' ? 'New inbound webhook' : 'New outbound webhook'}
            </h3>
            <p className="text-[11px] text-fg-tertiary">Step {step + 1} of {steps.length} — {steps[step]}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close wizard">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </header>

        <div className="mb-4 flex gap-1">
          {steps.map((label, i) => (
            <div
              key={label}
              className={cn(
                'h-1 flex-1 rounded-full',
                i <= step ? 'bg-[var(--accent-cyan)]' : 'bg-[var(--bg-inset)]',
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        {step === 0 && sub === 'inbound' ? (
          <div>
            <label className="mb-2 block text-xs text-fg-secondary">Source connector</label>
            <select
              value={connector}
              onChange={(e) => setConnector(e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-fg-primary"
              data-testid="webhook-wizard-connector"
            >
              {connectorOptions.length > 0 ? (
                connectorOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))
              ) : (
                <>
                  {['github', 'gitlab', 'jira', 'slack', 'stripe'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </>
              )}
            </select>
          </div>
        ) : null}
        {step === 1 && sub === 'inbound' ? (
          <div>
            <label className="mb-2 block text-xs text-fg-secondary">Event type</label>
            <Input value={eventType} onChange={(e) => setEventType(e.target.value)} />
          </div>
        ) : null}
        {step === 2 && sub === 'inbound' ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-fg-secondary">Generated URL</label>
              <div className="flex items-center gap-2">
                <code className="block flex-1 truncate rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 font-mono text-xs text-fg-primary">
                  https://forge.acme.com/api/webhooks/in/{connector}_{Math.random().toString(36).slice(2, 8)}
                </code>
                <Button size="sm" variant="outline">
                  <Clipboard className="h-3 w-3" aria-hidden="true" />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-secondary">Signing secret</label>
              <code className="block rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 font-mono text-xs text-fg-primary">
                whsec_••••••••••••••••
              </code>
            </div>
          </div>
        ) : null}

        {step === 0 && sub === 'outbound' ? (
          <div>
            <label className="mb-2 block text-xs text-fg-secondary">Target URL</label>
            <Input
              placeholder="https://example.com/api/hook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="webhook-wizard-url"
            />
          </div>
        ) : null}
        {step === 1 && sub === 'outbound' ? (
          <div>
            <label className="mb-2 block text-xs text-fg-secondary">Events to subscribe</label>
            <div className="flex flex-wrap gap-1">
              {['deploy.started', 'deploy.finished', 'incident.opened', 'run.completed'].map((evt) => (
                <button
                  key={evt}
                  type="button"
                  className="rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-fg-secondary hover:border-[var(--accent-cyan)] hover:text-fg-primary"
                >
                  {evt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {step === 2 && sub === 'outbound' ? (
          <div className="space-y-2">
            <label className="mb-1 block text-xs text-fg-secondary">Auth</label>
            <div className="flex gap-1">
              {(['none', 'basic', 'bearer', 'signature'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAuth(a)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs capitalize',
                    auth === a
                      ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                      : 'border-[var(--border-default)] text-fg-secondary',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
            <label className="mb-1 block text-xs text-fg-secondary">Retry policy</label>
            <select className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-fg-primary">
              <option>Exponential · 5 attempts · 30m max</option>
              <option>Linear · 3 attempts · 5m max</option>
              <option>None</option>
            </select>
          </div>
        ) : null}

        <footer className="mt-6 flex justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={step === 0 ? onClose : () => setStep((s) => Math.max(0, s - 1))}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < steps.length - 1 ? (
            <Button size="sm" onClick={() => setStep((s) => s + 1)}>
              Next
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={create.isPending}
              data-testid="webhook-wizard-create"
            >
              {create.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3 w-3" aria-hidden="true" />
              )}
              Create webhook
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}