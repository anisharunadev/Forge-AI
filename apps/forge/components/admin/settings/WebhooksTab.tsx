'use client';

/**
 * Settings — Webhooks tab (Step-47 Enterprise section).
 *
 * Webhooks list (name + URL + status pulse + events chips +
 * last-triggered + Test / 3-dot menu). "Add webhook" Dialog with
 * name, URL, multi-select events grouped by category, auth method,
 * retry policy.
 *
 * Each row has a collapsible delivery log (last 50 deliveries with
 * status, response code, latency, re-deliver).
 */

import * as React from 'react';
import {
  Plus,
  MoreHorizontal,
  Play,
  Pause,
  Trash2,
  Pencil,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Webhook,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type WebhookStatus = 'active' | 'paused' | 'failing';

interface WebhookDelivery {
  id: string;
  timestamp: string;
  status: number;
  latencyMs: number;
  event: string;
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  status: WebhookStatus;
  events: ReadonlyArray<string>;
  authType: 'none' | 'basic' | 'bearer' | 'hmac';
  lastTriggeredAt: string;
  lastTriggeredStatus: number;
  deliveries: ReadonlyArray<WebhookDelivery>;
}

const SEED: ReadonlyArray<Webhook> = [
  {
    id: 'w-1',
    name: 'Acme deploy bot',
    url: 'https://hooks.acme.com/forge/events',
    status: 'active',
    events: ['run.completed', 'deployment.succeeded', 'deployment.failed'],
    authType: 'hmac',
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    lastTriggeredStatus: 200,
    deliveries: [
      { id: 'd-1', timestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(), status: 200, latencyMs: 142, event: 'deployment.succeeded' },
      { id: 'd-2', timestamp: new Date(Date.now() - 1000 * 60 * 32).toISOString(), status: 200, latencyMs: 121, event: 'run.completed' },
      { id: 'd-3', timestamp: new Date(Date.now() - 1000 * 60 * 51).toISOString(), status: 502, latencyMs: 10021, event: 'deployment.failed' },
    ],
  },
  {
    id: 'w-2',
    name: 'Linear mirror',
    url: 'https://api.linear.app/graphql',
    status: 'failing',
    events: ['approval.requested'],
    authType: 'bearer',
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 41).toISOString(),
    lastTriggeredStatus: 401,
    deliveries: [
      { id: 'd-4', timestamp: new Date(Date.now() - 1000 * 60 * 41).toISOString(), status: 401, latencyMs: 89, event: 'approval.requested' },
      { id: 'd-5', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), status: 200, latencyMs: 110, event: 'approval.requested' },
    ],
  },
];

const STORAGE_KEY = 'forge.webhooks.v1';

function loadWebhooks(): Webhook[] {
  if (typeof window === 'undefined') return [...SEED];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED];
    return JSON.parse(raw) as Webhook[];
  } catch {
    return [...SEED];
  }
}

function persistWebhooks(w: Webhook[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* noop */
  }
}

const EVENT_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  events: ReadonlyArray<{ id: string; label: string }>;
}> = [
  {
    id: 'runs',
    label: 'Runs',
    events: [
      { id: 'run.started', label: 'run.started' },
      { id: 'run.completed', label: 'run.completed' },
      { id: 'run.failed', label: 'run.failed' },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    events: [
      { id: 'approval.requested', label: 'approval.requested' },
      { id: 'approval.granted', label: 'approval.granted' },
      { id: 'approval.rejected', label: 'approval.rejected' },
    ],
  },
  {
    id: 'deployments',
    label: 'Deployments',
    events: [
      { id: 'deployment.started', label: 'deployment.started' },
      { id: 'deployment.succeeded', label: 'deployment.succeeded' },
      { id: 'deployment.failed', label: 'deployment.failed' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    events: [
      { id: 'workspace.member_added', label: 'workspace.member_added' },
      { id: 'workspace.member_removed', label: 'workspace.member_removed' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    events: [
      { id: 'artifact.created', label: 'artifact.created' },
      { id: 'artifact.updated', label: 'artifact.updated' },
    ],
  },
];

export function WebhooksTab() {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = React.useState<ReadonlyArray<Webhook>>(SEED);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [secretFor, setSecretFor] = React.useState<Webhook | null>(null);
  const [openDeliveries, setOpenDeliveries] = React.useState<string | null>(null);

  React.useEffect(() => {
    setWebhooks(loadWebhooks());
  }, []);

  const setStatus = (id: string, status: WebhookStatus) => {
    const next = webhooks.map((w) => (w.id === id ? { ...w, status } : w));
    setWebhooks(next);
    persistWebhooks(next);
  };

  const deleteOne = (id: string) => {
    const next = webhooks.filter((w) => w.id !== id);
    setWebhooks(next);
    persistWebhooks(next);
    toast({ title: 'Webhook deleted' });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="webhooks-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Webhooks
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Webhooks let external services receive events from Forge in real time. We sign every
            payload with HMAC-SHA256 when HMAC auth is enabled.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="webhooks-create">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add webhook
        </Button>
      </header>

      <ul className="flex flex-col gap-4">
        {webhooks.map((w) => (
          <WebhookRow
            key={w.id}
            webhook={w}
            openDeliveries={openDeliveries === w.id}
            onToggleDeliveries={() =>
              setOpenDeliveries((prev) => (prev === w.id ? null : w.id))
            }
            onPause={() => setStatus(w.id, w.status === 'paused' ? 'active' : 'paused')}
            onTest={() => {
              toast({ title: 'Test payload sent', description: `→ ${w.url}` });
            }}
            onCopy={() => {
              try {
                navigator.clipboard.writeText(w.url);
                toast({ title: 'URL copied' });
              } catch {
                /* noop */
              }
            }}
            onRotateSecret={() => setSecretFor(w)}
            onDelete={() => deleteOne(w.id)}
          />
        ))}
      </ul>

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(created) => {
          const next: Webhook[] = [
            {
              ...created,
              id: `w-${Date.now()}`,
              status: 'active',
              lastTriggeredAt: new Date().toISOString(),
              lastTriggeredStatus: 200,
              deliveries: [],
            },
            ...webhooks,
          ];
          setWebhooks(next);
          persistWebhooks(next);
          setCreateOpen(false);
          setSecretFor({ ...next[0]! });
        }}
      />

      <SecretDialog webhook={secretFor} onClose={() => setSecretFor(null)} />
    </div>
  );
}

/* ---------------- Webhook Row ---------------- */

interface WebhookRowProps {
  webhook: Webhook;
  openDeliveries: boolean;
  onToggleDeliveries: () => void;
  onPause: () => void;
  onTest: () => void;
  onCopy: () => void;
  onRotateSecret: () => void;
  onDelete: () => void;
}

function WebhookRow({
  webhook: w,
  openDeliveries,
  onToggleDeliveries,
  onPause,
  onTest,
  onCopy,
  onRotateSecret,
  onDelete,
}: WebhookRowProps) {
  const statusTone =
    w.status === 'active'
      ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
      : w.status === 'paused'
        ? 'bg-[var(--fg-tertiary)]/15 text-[var(--fg-tertiary)]'
        : 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]';

  const statusLabel = w.status === 'active' ? 'Active' : w.status === 'paused' ? 'Paused' : 'Failing';

  return (
    <li
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
      data-testid={`webhook-row-${w.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
            <span className="truncate text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
              {w.name}
            </span>
            <span
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider',
                statusTone,
                w.status === 'active' && 'animate-pulse-agent',
              )}
              data-testid={`webhook-status-${w.id}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[var(--text-xs)] text-[var(--fg-secondary)]">
            <span className="truncate">{w.url}</span>
            <button
              type="button"
              onClick={onCopy}
              className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
              aria-label="Copy webhook URL"
              data-testid={`webhook-copy-${w.id}`}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {w.events.map((ev) => (
              <span
                key={ev}
                className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
              >
                {ev}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-[var(--fg-tertiary)]">
            Last triggered {timeAgo(w.lastTriggeredAt)} · {w.lastTriggeredStatus}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onTest} data-testid={`webhook-test-${w.id}`}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Test
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid={`webhook-menu-${w.id}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPause}>
                {w.status === 'paused' ? (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    Pause
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleDeliveries}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                View deliveries
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotateSecret}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Rotate secret
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-[var(--accent-rose)] focus:text-[var(--accent-rose)]"
                data-testid={`webhook-delete-${w.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {openDeliveries ? (
        <div
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
          data-testid={`webhook-deliveries-${w.id}`}
        >
          <button
            type="button"
            onClick={onToggleDeliveries}
            className="flex w-full items-center justify-between text-left text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]"
            data-testid="webhook-deliveries-toggle"
          >
            <span>Recent deliveries</span>
            <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
          </button>
          {w.deliveries.length === 0 ? (
            <p className="mt-2 text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              No deliveries yet — trigger a test from the menu.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {w.deliveries.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-b-0"
                  data-testid={`delivery-${d.id}`}
                >
                  <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--fg-secondary)]">
                    {d.status >= 200 && d.status < 300 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent-emerald)]" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-[var(--accent-rose)]" aria-hidden="true" />
                    )}
                    <span>{d.event}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--fg-tertiary)]">
                    <span>{d.status}</span>
                    <span>{d.latencyMs}ms</span>
                    <span>{timeAgo(d.timestamp)}</span>
                    {d.status >= 400 ? (
                      <button
                        type="button"
                        className="text-[var(--accent-primary)] underline-offset-2 hover:underline"
                        data-testid={`delivery-redeliver-${d.id}`}
                      >
                        Re-deliver
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ---------------- Create Webhook Dialog ---------------- */

interface CreateWebhookParams {
  name: string;
  url: string;
  events: ReadonlyArray<string>;
  authType: Webhook['authType'];
  retryPolicy: '3x-exp' | '5x-linear' | 'none';
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (p: CreateWebhookParams) => void;
}) {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<ReadonlyArray<string>>([]);
  const [authType, setAuthType] = React.useState<Webhook['authType']>('hmac');
  const [retryPolicy, setRetryPolicy] = React.useState<CreateWebhookParams['retryPolicy']>('3x-exp');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setUrl('');
      setEvents([]);
      setAuthType('hmac');
      setRetryPolicy('3x-exp');
      setError(null);
    }
  }, [open]);

  const toggleEvent = (id: string) => {
    setEvents((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const submit = () => {
    if (!name.trim()) return setError('Name is required.');
    if (!url.trim() || !/^https?:\/\//.test(url)) return setError('Enter a valid http(s) URL.');
    if (events.length === 0) return setError('Subscribe to at least one event.');
    onCreate({ name: name.trim(), url: url.trim(), events, authType, retryPolicy });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]" data-testid="webhooks-create-dialog">
        <DialogHeader>
          <DialogTitle>Add webhook</DialogTitle>
          <DialogDescription>
            Forge will POST JSON payloads to the URL below whenever one of the selected events fires.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="webhook-name" required>
            <Input
              id="webhook-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme deploy bot"
              data-testid="webhook-name-input"
            />
          </Field>
          <Field label="URL" htmlFor="webhook-url" required>
            <Input
              id="webhook-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.example.com/forge"
              data-testid="webhook-url-input"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              Events to subscribe
            </span>
            <div className="grid max-h-56 gap-3 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 sm:grid-cols-2">
              {EVENT_GROUPS.map((group) => (
                <div key={group.id} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    {group.label}
                  </span>
                  {group.events.map((ev) => (
                    <label key={ev.id} className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                      <Checkbox
                        checked={events.includes(ev.id)}
                        onCheckedChange={() => toggleEvent(ev.id)}
                        data-testid={`webhook-event-${ev.id}`}
                      />
                      <span className="font-mono">{ev.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <Field label="Auth" htmlFor="webhook-auth">
            <div className="flex flex-wrap gap-2">
              {(['none', 'basic', 'bearer', 'hmac'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAuthType(a)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full border px-3 text-[var(--text-xs)] font-medium capitalize transition-colors',
                    authType === a
                      ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
                  )}
                  data-testid={`webhook-auth-${a}`}
                >
                  {a === 'hmac' ? 'HMAC signature' : a}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Retry policy" htmlFor="webhook-retry">
            <div className="flex flex-wrap gap-2">
              {[
                { v: '3x-exp', label: '3 retries · exponential backoff' },
                { v: '5x-linear', label: '5 retries · linear backoff' },
                { v: 'none', label: 'No retries' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setRetryPolicy(opt.v as typeof retryPolicy)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full border px-3 text-[var(--text-xs)] font-medium transition-colors',
                    retryPolicy === opt.v
                      ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
                  )}
                  data-testid={`webhook-retry-${opt.v}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          {error ? (
            <p className="text-[var(--text-xs)] text-[var(--accent-rose)]" data-testid="webhook-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} data-testid="webhook-create-submit">
            Create webhook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Secret Dialog (one-time) ---------------- */

function SecretDialog({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const secret = React.useMemo(() => {
    if (!webhook) return '';
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = 'whsec_';
    for (let i = 0; i < 32; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }, [webhook?.id]);

  const [copied, setCopied] = React.useState(false);

  if (!webhook) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[520px]" data-testid="webhook-secret-dialog">
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
          <DialogDescription>
            Save this secret now. Forge will sign every payload with HMAC-SHA256 using this key, and
            we won't show it again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 p-3">
          <code className="flex-1 break-all font-mono text-[var(--text-sm)] text-[var(--fg-primary)]" data-testid="webhook-secret">
            {secret}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                navigator.clipboard.writeText(secret);
                setCopied(true);
              } catch {
                /* noop */
              }
            }}
            data-testid="webhook-secret-copy"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="webhook-secret-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Field helper ---------------- */

interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, htmlFor, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[var(--text-sm)] text-[var(--fg-primary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--accent-rose)]">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
