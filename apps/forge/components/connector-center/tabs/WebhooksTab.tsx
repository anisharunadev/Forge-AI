'use client';

/**
 * WebhooksTab — Zone 9 in the Step 31 spec.
 *
 * Two sub-tabs (Inbound / Outbound) + collapsible delivery log. Wizard
 * for inbound triggers (pick connector → event → generated URL) and a
 * form for outbound (URL + auth + retry policy).
 */

import * as React from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Plus,
  Send,
  Webhook,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  resolveIcon,
  type Connector,
} from '@/lib/connectors';
import { fmtTimeAgo } from '../constants';
import { cn } from '@/lib/utils';

type SubTab = 'inbound' | 'outbound';

interface WebhookRow {
  id: string;
  name: string;
  source: string;            // connector id for inbound, URL for outbound
  url: string;
  events: ReadonlyArray<string>;
  lastSent: string;
  status: 'active' | 'paused' | 'failing';
  successRate: number;
  recentDeliveries: ReadonlyArray<{
    at: string;
    status: 'success' | 'failed' | 'pending';
    code: number;
    latencyMs: number;
  }>;
}

const INBOUND: ReadonlyArray<WebhookRow> = [
  {
    id: 'wb-in-1',
    name: 'GitHub PR events',
    source: 'github',
    url: 'https://forge.acme.com/api/webhooks/in/gh_2c91a4f7',
    events: ['pull_request.opened', 'pull_request.closed', 'pull_request.review_requested'],
    lastSent: new Date(Date.now() - 4 * 60_000).toISOString(),
    status: 'active',
    successRate: 0.998,
    recentDeliveries: [
      { at: new Date(Date.now() - 4 * 60_000).toISOString(), status: 'success', code: 200, latencyMs: 142 },
      { at: new Date(Date.now() - 60 * 60_000).toISOString(), status: 'success', code: 200, latencyMs: 188 },
      { at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), status: 'success', code: 200, latencyMs: 162 },
    ],
  },
  {
    id: 'wb-in-2',
    name: 'Stripe payments',
    source: 'stripe',
    url: 'https://forge.acme.com/api/webhooks/in/stripe_4f9b81',
    events: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded'],
    lastSent: new Date(Date.now() - 22 * 60_000).toISOString(),
    status: 'active',
    successRate: 1.0,
    recentDeliveries: [
      { at: new Date(Date.now() - 22 * 60_000).toISOString(), status: 'success', code: 200, latencyMs: 88 },
    ],
  },
  {
    id: 'wb-in-3',
    name: 'Jira issue updates',
    source: 'jira',
    url: 'https://forge.acme.com/api/webhooks/in/jira_8a21cd',
    events: ['jira:issue_updated'],
    lastSent: new Date(Date.now() - 11 * 60_000).toISOString(),
    status: 'failing',
    successRate: 0.84,
    recentDeliveries: [
      { at: new Date(Date.now() - 11 * 60_000).toISOString(), status: 'failed', code: 401, latencyMs: 412 },
      { at: new Date(Date.now() - 38 * 60_000).toISOString(), status: 'success', code: 200, latencyMs: 198 },
    ],
  },
];

const OUTBOUND: ReadonlyArray<WebhookRow> = [
  {
    id: 'wb-out-1',
    name: 'Deploy notifications → Slack #deploys',
    source: 'https://hooks.slack.com/services/T0/B0/abc',
    url: 'https://hooks.slack.com/services/T0/B0/abc',
    events: ['deploy.started', 'deploy.finished', 'deploy.failed'],
    lastSent: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
    successRate: 0.998,
    recentDeliveries: [
      { at: new Date(Date.now() - 60_000).toISOString(), status: 'success', code: 200, latencyMs: 142 },
    ],
  },
  {
    id: 'wb-out-2',
    name: 'Incident webhooks → PagerDuty',
    source: 'https://events.pagerduty.com/v2/enqueue',
    url: 'https://events.pagerduty.com/v2/enqueue',
    events: ['incident.opened', 'incident.escalated'],
    lastSent: new Date(Date.now() - 9 * 60_000).toISOString(),
    status: 'active',
    successRate: 0.99,
    recentDeliveries: [
      { at: new Date(Date.now() - 9 * 60_000).toISOString(), status: 'success', code: 202, latencyMs: 188 },
    ],
  },
];

export function WebhooksTab() {
  const [sub, setSub] = React.useState<SubTab>('inbound');
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ReadonlyArray<WebhookRow>>(INBOUND);

  React.useEffect(() => {
    setRows(sub === 'inbound' ? INBOUND : OUTBOUND);
  }, [sub]);

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
          Inbound ({INBOUND.length})
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
          Outbound ({OUTBOUND.length})
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
        {rows.map((row) => (
          <WebhookCard
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
          />
        ))}
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border-default)] p-8 text-center text-xs text-fg-tertiary">
            <Webhook className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
            No webhooks configured.
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
  const Icon = resolveIcon(row.source) ?? Webhook;
  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="webhook-row"
      data-webhook-id={row.id}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-fg-secondary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-medium text-fg-primary">{row.name}</h3>
            <p className="break-all font-mono text-[11px] text-fg-tertiary">{row.url}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.events.slice(0, 3).map((evt) => (
                <span key={evt} className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-fg-secondary">
                  {evt}
                </span>
              ))}
              {row.events.length > 3 ? (
                <span className="text-[10px] text-fg-tertiary">+{row.events.length - 3} more</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
              row.status === 'active'
                ? 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]'
                : row.status === 'failing'
                  ? 'border-[var(--accent-rose)]/40 text-[var(--accent-rose)]'
                  : 'border-[var(--border-default)] text-fg-tertiary',
            )}
          >
            {row.status}
          </span>
          <span className="text-[10px] text-fg-tertiary">
            {(row.successRate * 100).toFixed(1)}% success · last {fmtTimeAgo(row.lastSent)}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onToggle}>
              {expanded ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {expanded ? 'Hide' : 'View'} log
            </Button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
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
              {row.recentDeliveries.map((d, i) => (
                <tr key={i}>
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
                  <td className="px-2 py-1 font-mono text-fg-secondary">{d.code}</td>
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
        </div>
      ) : null}
    </div>
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

  const steps = sub === 'inbound'
    ? ['Pick connector', 'Pick event type', 'Generated URL + secret']
    : ['Target URL', 'Events to subscribe', 'Auth + retry policy'];

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
            >
              {['github', 'gitlab', 'jira', 'slack', 'stripe'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
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
            <Button size="sm" variant="outline" className="w-full">
              <Send className="h-3 w-3" aria-hidden="true" />
              Send test trigger
            </Button>
          </div>
        ) : null}

        {step === 0 && sub === 'outbound' ? (
          <div>
            <label className="mb-2 block text-xs text-fg-secondary">Target URL</label>
            <Input
              placeholder="https://example.com/api/hook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
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
            <Button size="sm" onClick={onCreate}>
              <Check className="h-3 w-3" aria-hidden="true" />
              Create webhook
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}