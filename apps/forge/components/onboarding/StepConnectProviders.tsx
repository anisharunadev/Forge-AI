'use client';

import * as React from 'react';
import {
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  Hexagon,
  Loader2,
  Plug,
  Plus,
  Sparkles,
  Triangle,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  PROVIDER_CATALOG,
  testProviderConnection,
  type ProviderConnection,
  type ProviderId,
  type ProviderStatus,
} from '@/lib/onboarding/data';

export interface StepConnectProvidersProps {
  connections: Record<ProviderId, ProviderConnection>;
  onChange: (next: Record<ProviderId, ProviderConnection>) => void;
}

const ICON_MAP = {
  Sparkles,
  Cpu,
  Cloud,
  Triangle,
  Hexagon,
  Plug,
} as const;

const STATUS_TONE: Record<
  ProviderStatus,
  { color: string; label: string; bg: string; border: string }
> = {
  idle: {
    color: 'var(--fg-tertiary)',
    label: 'Not connected',
    bg: 'var(--bg-inset)',
    border: 'var(--border-subtle)',
  },
  connecting: {
    color: 'var(--accent-amber)',
    label: 'Testing…',
    bg: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.30)',
  },
  connected: {
    color: 'var(--accent-emerald)',
    label: 'Connected',
    bg: 'rgba(16, 185, 129, 0.10)',
    border: 'rgba(16, 185, 129, 0.30)',
  },
  error: {
    color: 'var(--accent-rose)',
    label: 'Error',
    bg: 'rgba(244, 63, 94, 0.10)',
    border: 'rgba(244, 63, 94, 0.30)',
  },
};

/**
 * Step 3 — Connect an AI provider. Renders a 3-col grid of provider
 * cards; clicking "Connect" reveals an inline sub-form to enter
 * the API key and test the connection. The provider key is kept
 * in component state and never persisted to localStorage.
 */
export function StepConnectProviders({
  connections,
  onChange,
}: StepConnectProvidersProps) {
  const [activeProvider, setActiveProvider] = React.useState<ProviderId | null>(
    () => {
      const firstConnected = (Object.values(connections) as ProviderConnection[]).find(
        (c) => c.status === 'connected',
      );
      return firstConnected?.id ?? null;
    },
  );
  const [draftKey, setDraftKey] = React.useState('');
  const [revealKey, setRevealKey] = React.useState(false);

  const updateConnection = React.useCallback(
    (id: ProviderId, patch: Partial<ProviderConnection>) => {
      onChange({
        ...connections,
        [id]: { ...connections[id], ...patch },
      });
    },
    [connections, onChange],
  );

  const handleTest = React.useCallback(
    async (id: ProviderId) => {
      updateConnection(id, { status: 'connecting', error: undefined });
      const result = await testProviderConnection(id, draftKey);
      if (result.ok) {
        updateConnection(id, {
          status: 'connected',
          label: result.label ?? `${id}@forge`,
          apiKey: draftKey,
        });
      } else {
        updateConnection(id, {
          status: 'error',
          error: result.error ?? 'Connection failed.',
        });
      }
    },
    [draftKey, updateConnection],
  );

  const handleDisconnect = (id: ProviderId) => {
    onChange({
      ...connections,
      [id]: { id, status: 'idle' },
    });
    if (activeProvider === id) setActiveProvider(null);
    setDraftKey('');
  };

  const handleAddAnother = () => {
    const firstIdle = PROVIDER_CATALOG.find(
      (p) => connections[p.id]?.status !== 'connected',
    );
    if (firstIdle) {
      setActiveProvider(firstIdle.id);
      setDraftKey('');
    }
  };

  const connectedCount = Object.values(connections).filter(
    (c) => c.status === 'connected',
  ).length;

  return (
    <section
      className="space-y-5"
      data-testid="step-connect-providers"
    >
      <header className="space-y-1">
        <h2
          className="flex items-center gap-2"
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          <Plug className="h-4 w-4" aria-hidden="true" />
          Connect an AI provider
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Agents need a model to think with. Connect at least one
          provider to enable AI execution.{' '}
          {connectedCount > 0 ? (
            <span
              style={{
                color: 'var(--accent-emerald)',
                fontWeight: 'var(--font-weight-medium)',
              }}
            >
              {connectedCount} connected.
            </span>
          ) : (
            <span style={{ color: 'var(--fg-tertiary)' }}>
              You can also skip this step and use mock data for now.
            </span>
          )}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {PROVIDER_CATALOG.map((p) => {
          const Icon = ICON_MAP[p.icon];
          const conn = connections[p.id];
          const tone = STATUS_TONE[conn?.status ?? 'idle'];
          const active = activeProvider === p.id;
          const connected = conn?.status === 'connected';

          return (
            <button
              type="button"
              key={p.id}
              onClick={() => setActiveProvider(p.id)}
              className={cn(
                'group rounded-[var(--radius-lg)] border p-4 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                active
                  ? 'shadow-[var(--shadow-glow-primary)]'
                  : 'hover:bg-[var(--hover)]',
              )}
              style={{
                background: 'var(--bg-elevated)',
                borderColor: active
                  ? 'var(--accent-primary)'
                  : 'var(--border-subtle)',
              }}
              data-testid={`provider-card-${p.id}`}
              data-state={conn?.status ?? 'idle'}
              aria-pressed={active}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  aria-hidden="true"
                >
                  <Icon
                    className="h-4 w-4"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                </div>
                <span
                  className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-medium uppercase tracking-wide"
                  style={{
                    fontSize: 9,
                    background: tone.bg,
                    color: tone.color,
                    borderColor: tone.border,
                  }}
                >
                  {tone.label}
                </span>
              </div>
              <p
                className="mt-3"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--fg-primary)',
                }}
              >
                {p.name}
              </p>
              <p
                className="mt-1"
                style={{
                  fontSize: 10,
                  color: 'var(--fg-tertiary)',
                  lineHeight: 'var(--leading-base)',
                }}
              >
                {p.description}
              </p>
              <div className="mt-3 flex items-center justify-between">
                {connected && conn?.label ? (
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-secondary)',
                    }}
                  >
                    as {conn.label}
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
                <span
                  className="inline-flex items-center gap-1 text-xs"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {connected ? 'Manage' : 'Connect'}
                  <ChevronDown
                    className="h-3 w-3 -rotate-90"
                    aria-hidden="true"
                  />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {activeProvider ? (
        <ProviderSubForm
          providerId={activeProvider}
          connection={connections[activeProvider]}
          draftKey={draftKey}
          revealKey={revealKey}
          onDraftKeyChange={setDraftKey}
          onToggleReveal={() => setRevealKey((v) => !v)}
          onTest={() => handleTest(activeProvider)}
          onDisconnect={() => handleDisconnect(activeProvider)}
          onAddAnother={handleAddAnother}
        />
      ) : null}
    </section>
  );
}

interface ProviderSubFormProps {
  providerId: ProviderId;
  connection: ProviderConnection;
  draftKey: string;
  revealKey: boolean;
  onDraftKeyChange: (next: string) => void;
  onToggleReveal: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  onAddAnother: () => void;
}

function ProviderSubForm({
  providerId,
  connection,
  draftKey,
  revealKey,
  onDraftKeyChange,
  onToggleReveal,
  onTest,
  onDisconnect,
  onAddAnother,
}: ProviderSubFormProps) {
  const provider = PROVIDER_CATALOG.find((p) => p.id === providerId);
  if (!provider) return null;
  const Icon = ICON_MAP[provider.icon];
  const isConnecting = connection.status === 'connecting';
  const isConnected = connection.status === 'connected';
  const isError = connection.status === 'error';

  return (
    <div
      className="rounded-[var(--radius-lg)] border p-5 space-y-4"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid={`provider-subform-${providerId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon
            className="h-4 w-4"
            style={{ color: 'var(--accent-primary)' }}
            aria-hidden="true"
          />
          <h3
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            Connect {provider.name}
          </h3>
        </div>
        {isConnected ? (
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-rose)]"
            style={{ color: 'var(--fg-tertiary)' }}
            data-testid={`provider-disconnect-${providerId}`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Disconnect
          </button>
        ) : null}
      </div>

      {!isConnected ? (
        <div className="grid gap-1.5">
          <label
            htmlFor={`provider-key-${providerId}`}
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--fg-secondary)',
            }}
          >
            API key
          </label>
          <div className="relative">
            <Input
              id={`provider-key-${providerId}`}
              type={revealKey ? 'text' : 'password'}
              placeholder={provider.placeholder}
              value={draftKey}
              onChange={(e) => onDraftKeyChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="pr-10"
              style={{ fontFamily: 'var(--font-mono)' }}
              data-testid={`provider-key-${providerId}`}
            />
            <button
              type="button"
              onClick={onToggleReveal}
              aria-label={revealKey ? 'Hide API key' : 'Reveal API key'}
              className="absolute inset-y-0 right-2 flex items-center rounded-md p-1 transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              style={{ color: 'var(--fg-tertiary)' }}
            >
              {revealKey ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {isError && connection.error ? (
            <p
              role="alert"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--accent-rose)',
              }}
              data-testid={`provider-error-${providerId}`}
            >
              {connection.error}
            </p>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              onClick={onTest}
              disabled={draftKey.trim().length < 4 || isConnecting}
              data-testid={`provider-test-${providerId}`}
            >
              {isConnecting ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Testing…
                </>
              ) : (
                'Test connection'
              )}
            </Button>
            <button
              type="button"
              onClick={onAddAnother}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              style={{ color: 'var(--fg-secondary)' }}
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add another provider
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-md border p-3"
          style={{
            background: 'rgba(16, 185, 129, 0.06)',
            borderColor: 'rgba(16, 185, 129, 0.30)',
          }}
          data-testid={`provider-success-${providerId}`}
        >
          <Check
            className="h-4 w-4"
            style={{ color: 'var(--accent-emerald)' }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-primary)',
            }}
          >
            Connected successfully as{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {connection.label ?? `${providerId}@forge`}
            </span>
          </span>
          <button
            type="button"
            onClick={onAddAnother}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            style={{ color: 'var(--accent-primary)' }}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Add another provider
          </button>
        </div>
      )}
    </div>
  );
}