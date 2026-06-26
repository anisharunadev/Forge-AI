'use client';

/**
 * Settings — Notifications tab (Step-47 Account section).
 *
 * Two-column split:
 *   LEFT  — Channels (Email verified, Slack/Teams/Discord connect,
 *           Webhook URL, In-app + Co-pilot always-on)
 *   RIGHT — Events matrix (5 categories × per-channel toggles:
 *           Email, Slack, In-app, Co-pilot)
 *
 * Quiet hours toggle disables Email/Slack between configured
 * 10pm–8am window. "Test notifications" sends a toast to each
 * connected channel.
 */

import * as React from 'react';
import {
  Mail,
  MessageSquare as Slack,
  MessageSquare,
  Bell,
  Webhook,
  Send,
  CheckCircle2,
  Plus,
  Link2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type ChannelId = 'email' | 'slack' | 'teams' | 'discord' | 'webhook' | 'in-app' | 'copilot';

interface Channel {
  id: ChannelId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  optional?: boolean; // togglable connection
}

const CHANNELS: ReadonlyArray<Channel> = [
  { id: 'email',   label: 'Email',   icon: Mail, description: 'arun@acme.com · Verified' },
  { id: 'slack',   label: 'Slack',   icon: Slack, description: 'Forge to #forge-alerts', optional: true },
  { id: 'teams',   label: 'Microsoft Teams', icon: MessageSquare, description: 'Forge channel', optional: true },
  { id: 'discord', label: 'Discord', icon: MessageSquare, description: 'Forge server', optional: true },
  { id: 'webhook', label: 'Webhook', icon: Webhook, description: 'POST JSON to your endpoint', optional: true },
  { id: 'in-app',  label: 'In-app',  icon: Bell, description: 'Always on — bell icon in header' },
  { id: 'copilot', label: 'Co-pilot', icon: Bell, description: 'Always on — pings for important events' },
];

type EventId =
  | 'run.completed'
  | 'run.failed'
  | 'approval.requested'
  | 'policy.violation'
  | 'deployment.succeeded'
  | 'digest.weekly';

interface EventDef {
  id: EventId;
  label: string;
  description: string;
  defaultChannels: ChannelId[];
}

const EVENTS: ReadonlyArray<EventDef> = [
  { id: 'run.completed',       label: 'Run completed',      description: 'An agent run finished successfully', defaultChannels: ['email', 'in-app'] },
  { id: 'run.failed',          label: 'Run failed',         description: 'An agent run ended in error',        defaultChannels: ['email', 'slack', 'in-app', 'copilot'] },
  { id: 'approval.requested',  label: 'Approval needed',    description: 'A workflow hit an approval gate',     defaultChannels: ['email', 'slack', 'in-app'] },
  { id: 'policy.violation',    label: 'Policy violation',   description: 'A guardrail rule blocked an action',  defaultChannels: ['email', 'slack', 'in-app', 'copilot'] },
  { id: 'deployment.succeeded',label: 'Deployment succeeded',description: 'A deployment finished without errors', defaultChannels: ['slack', 'in-app'] },
  { id: 'digest.weekly',       label: 'Weekly digest',      description: 'Every Sunday at 9am',                 defaultChannels: ['email'] },
];

const STORAGE_KEY = 'forge.notifications.v1';

interface Persisted {
  matrix: Record<EventId, ChannelId[]>;
  quietHours: { enabled: boolean; start: string; end: string };
  webhookUrl: string;
  slackConnected: boolean;
  teamsConnected: boolean;
  discordConnected: boolean;
}

function loadPersisted(): Persisted {
  const matrix = EVENTS.reduce((acc, ev) => {
    acc[ev.id] = [...ev.defaultChannels];
    return acc;
  }, {} as Record<EventId, ChannelId[]>);
  const defaults: Persisted = {
    matrix,
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    webhookUrl: '',
    slackConnected: true,
    teamsConnected: false,
    discordConnected: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    return defaults;
  }
}

const OPTIONAL_CHANNELS: ReadonlyArray<ChannelId> = ['email', 'slack', 'in-app', 'copilot'];

export function NotificationsTab() {
  const { toast } = useToast();
  const [state, setState] = React.useState<Persisted>(() => loadPersisted());
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const p = loadPersisted();
    setState(p);
    setDirty(false);
  }, []);

  const update = (patch: Partial<Persisted>) => {
    setState((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const updateMatrix = (event: EventId, channel: ChannelId) => {
    setState((prev) => {
      const current = prev.matrix[event] ?? [];
      const next = current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel];
      return { ...prev, matrix: { ...prev.matrix, [event]: next } };
    });
    setDirty(true);
  };

  const onSave = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* noop */
    }
    setDirty(false);
    toast({
      title: 'Notification preferences saved',
      description: 'Quiet hours and channel matrix applied.',
    });
  };

  const onTest = () => {
    const enabled = Object.entries(state.matrix)
      .flatMap(([ev, chans]) => chans.map((c) => `${ev} → ${c}`))
      .slice(0, 3)
      .join(' · ');
    toast({
      title: 'Test notifications sent',
      description: enabled || 'No channels enabled yet.',
    });
  };

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="notifications-tab"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT: Channels */}
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          data-testid="notifications-channels"
        >
          <header className="pb-4">
            <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
              Channels
            </h3>
            <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
              Where Forge can reach you.
            </p>
          </header>

          <ul className="flex flex-col gap-3">
            {CHANNELS.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                connected={
                  c.id === 'slack'
                    ? state.slackConnected
                    : c.id === 'teams'
                      ? state.teamsConnected
                      : c.id === 'discord'
                        ? state.discordConnected
                        : c.id === 'webhook'
                          ? state.webhookUrl.length > 0
                          : true
                }
                webhookUrl={state.webhookUrl}
                onConnect={() => {
                  if (c.id === 'slack') update({ slackConnected: true });
                  if (c.id === 'teams') update({ teamsConnected: true });
                  if (c.id === 'discord') update({ discordConnected: true });
                }}
                onDisconnect={() => {
                  if (c.id === 'slack') update({ slackConnected: false });
                  if (c.id === 'teams') update({ teamsConnected: false });
                  if (c.id === 'discord') update({ discordConnected: false });
                }}
                onWebhookChange={(v) => update({ webhookUrl: v })}
              />
            ))}
          </ul>

          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                  Quiet hours
                </span>
                <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                  Pause Email + Slack during this window
                </p>
              </div>
              <Switch
                checked={state.quietHours.enabled}
                onCheckedChange={(v) =>
                  update({ quietHours: { ...state.quietHours, enabled: v } })
                }
                data-testid="notifications-quiet-toggle"
              />
            </div>
            {state.quietHours.enabled ? (
              <div className="mt-3 flex items-center gap-2 text-[var(--text-sm)] text-[var(--fg-secondary)]">
                <Input
                  type="time"
                  value={state.quietHours.start}
                  onChange={(e) =>
                    update({ quietHours: { ...state.quietHours, start: e.target.value } })
                  }
                  className="w-28"
                  data-testid="notifications-quiet-start"
                />
                <span>to</span>
                <Input
                  type="time"
                  value={state.quietHours.end}
                  onChange={(e) =>
                    update({ quietHours: { ...state.quietHours, end: e.target.value } })
                  }
                  className="w-28"
                  data-testid="notifications-quiet-end"
                />
              </div>
            ) : null}
          </div>
        </section>

        {/* RIGHT: Events */}
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          data-testid="notifications-events"
        >
          <header className="flex items-start justify-between gap-3 pb-4">
            <div>
              <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
                Events
              </h3>
              <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
                Choose which channels fire for each event.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onTest}
              data-testid="notifications-test"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Test
            </Button>
          </header>

          <div className="flex flex-col gap-3">
            <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] sm:grid">
              <span>Event</span>
              <span>Email</span>
              <span>Slack</span>
              <span>In-app</span>
              <span>Co-pilot</span>
            </div>
            {EVENTS.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
                data-testid={`event-${ev.id}`}
              >
                <div>
                  <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                    {ev.label}
                  </p>
                  <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                    {ev.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {OPTIONAL_CHANNELS.map((ch) => {
                    const enabled = state.matrix[ev.id]?.includes(ch) ?? false;
                    return (
                      <ChannelToggle
                        key={ch}
                        label={ch}
                        enabled={enabled}
                        onChange={() => updateMatrix(ev.id, ch)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 px-4 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setState(loadPersisted());
            setDirty(false);
          }}
          data-testid="notifications-reset"
        >
          Reset
        </Button>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={onSave}
          data-testid="notifications-save"
        >
          Save preferences
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Channel Row ---------------- */

interface ChannelRowProps {
  channel: Channel;
  connected: boolean;
  webhookUrl: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onWebhookChange: (v: string) => void;
}

function ChannelRow({
  channel,
  connected,
  webhookUrl,
  onConnect,
  onDisconnect,
  onWebhookChange,
}: ChannelRowProps) {
  const Icon = channel.icon;
  const isOptional = channel.optional;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3',
        connected ? 'bg-[var(--bg-inset)]' : 'bg-transparent',
      )}
      data-testid={`channel-row-${channel.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
          <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
            {channel.label}
          </span>
          {connected ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-emerald)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-emerald)]"
              data-testid={`channel-status-${channel.id}`}
            >
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {channel.id === 'email' ? 'Verified' : 'Connected'}
            </span>
          ) : (
            <span
              className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]"
              data-testid={`channel-status-${channel.id}`}
            >
              Not connected
            </span>
          )}
        </div>
        {isOptional ? (
          connected ? (
            <Button variant="ghost" size="sm" onClick={onDisconnect} data-testid={`channel-disconnect-${channel.id}`}>
              Disconnect
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onConnect} data-testid={`channel-connect-${channel.id}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Connect
            </Button>
          )
        ) : null}
      </div>

      {channel.id === 'email' ? (
        <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
          arun@acme.com ·{' '}
          <button
            type="button"
            className="text-[var(--accent-primary)] underline-offset-2 hover:underline"
            data-testid="channel-change-email"
          >
            Change
          </button>
        </p>
      ) : null}

      {channel.id === 'webhook' ? (
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <Input
            placeholder="https://hooks.example.com/forge"
            value={webhookUrl}
            onChange={(e) => onWebhookChange(e.target.value)}
            className="flex-1"
            data-testid="channel-webhook-input"
          />
        </div>
      ) : null}
    </li>
  );
}

/* ---------------- Channel Toggle ---------------- */

function ChannelToggle({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={enabled}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        enabled
          ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
      )}
      data-testid={`channel-toggle-${label}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', enabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--fg-tertiary)]')} />
      {label}
    </button>
  );
}
