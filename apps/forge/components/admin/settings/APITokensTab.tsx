'use client';

/**
 * Settings — API Tokens tab (Step-47 Account section).
 *
 * Active tokens list (virtualized-feeling table; render up to ~50
 * rows without lag). Each row shows: name + scope chip, truncated
 * token prefix with copy, created/last-used/expires, used-by
 * count, and a 3-dot menu (Rename / Regenerate / Revoke).
 *
 * "Create token" opens a Dialog with name + scope + expiration +
 * multi-select API scopes. After Generate the full token is shown
 * ONCE inside a yellow callout with copy.
 *
 * Best practices card recaps the security guidance from the goal
 * spec.
 */

import * as React from 'react';
import {
  Plus,
  Copy,
  Check,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  AlertTriangle,
  KeyRound,
  ShieldAlert,
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

type TokenScope = 'read' | 'read-write' | 'admin';

interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  prefix: string; // forge_pat_abc…
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  requestsToday: number;
  apiScopes: ReadonlyArray<string>;
}

const ALL_API_SCOPES = [
  'forge-core',
  'forge-pi',
  'forge-browser',
  'forge-knowledge',
  'forge-audit',
  'forge-billing',
] as const;

const SEED_TOKENS: ReadonlyArray<ApiToken> = [
  {
    id: 't-1',
    name: 'CI deploy',
    scope: 'read-write',
    prefix: 'forge_pat_a8f2c1…',
    createdAt: '2026-04-12T08:14:00Z',
    lastUsedAt: '2026-06-27T03:11:00Z',
    expiresAt: '2026-07-12T08:14:00Z',
    requestsToday: 412,
    apiScopes: ['forge-core', 'forge-pi'],
  },
  {
    id: 't-2',
    name: 'Local dev',
    scope: 'admin',
    prefix: 'forge_pat_b9d3e7…',
    createdAt: '2026-01-04T14:02:00Z',
    lastUsedAt: '2026-06-27T05:48:00Z',
    expiresAt: null,
    requestsToday: 87,
    apiScopes: [...ALL_API_SCOPES],
  },
  {
    id: 't-3',
    name: 'GitHub Actions',
    scope: 'read',
    prefix: 'forge_pat_c0e4f8…',
    createdAt: '2026-03-21T11:30:00Z',
    lastUsedAt: '2026-06-26T22:09:00Z',
    expiresAt: '2026-09-21T11:30:00Z',
    requestsToday: 14,
    apiScopes: ['forge-core'],
  },
];

const STORAGE_KEY = 'forge.api-tokens.v1';

function loadTokens(): ApiToken[] {
  if (typeof window === 'undefined') return [...SEED_TOKENS];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED_TOKENS];
    return JSON.parse(raw) as ApiToken[];
  } catch {
    return [...SEED_TOKENS];
  }
}

function persistTokens(t: ApiToken[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* noop */
  }
}

function randomToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'forge_pat_';
  for (let i = 0; i < 24; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function scopeLabel(s: TokenScope): string {
  return s === 'read' ? 'Read' : s === 'read-write' ? 'Read-Write' : 'Admin';
}

function scopeTone(s: TokenScope): string {
  return s === 'read'
    ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]'
    : s === 'read-write'
      ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
      : 'bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]';
}

export function APITokensTab() {
  const { toast } = useToast();
  const [tokens, setTokens] = React.useState<ReadonlyArray<ApiToken>>(SEED_TOKENS);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revealed, setRevealed] = React.useState<{ id: string; token: string } | null>(null);
  const [revokeConfirm, setRevokeConfirm] = React.useState<ApiToken | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<ApiToken | null>(null);

  React.useEffect(() => {
    setTokens(loadTokens());
  }, []);

  const onRevoke = (id: string) => {
    const next = tokens.filter((t) => t.id !== id);
    setTokens(next);
    persistTokens(next);
    setRevokeConfirm(null);
    toast({ title: 'Token revoked', description: 'The token can no longer access the API.' });
  };

  const onRegenerate = (id: string) => {
    const next = tokens.map((t) =>
      t.id === id ? { ...t, prefix: `${randomToken().slice(0, 14)}…` } : t,
    );
    setTokens(next);
    persistTokens(next);
    toast({ title: 'Token regenerated', description: 'Save the new token now — it will not be shown again.' });
  };

  const onRename = (id: string, name: string) => {
    const next = tokens.map((t) => (t.id === id ? { ...t, name } : t));
    setTokens(next);
    persistTokens(next);
    setRenameTarget(null);
    toast({ title: 'Token renamed' });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="api-tokens-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            API tokens
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Personal access tokens authenticate scripts and CI/CD pipelines to the Forge API. Treat
            them like passwords.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="api-tokens-create">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Create token
        </Button>
      </header>

      <BestPracticesCard />

      <section
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        data-testid="api-tokens-list"
      >
        <div className="hidden grid-cols-[1.4fr_0.7fr_2fr_0.9fr_0.9fr_0.6fr_auto] gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-inset)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] sm:grid">
          <span>Name</span>
          <span>Scope</span>
          <span>Token</span>
          <span>Created</span>
          <span>Last used</span>
          <span>Requests</span>
          <span />
        </div>
        <ul>
          {tokens.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              onCopy={() => {
                try {
                  navigator.clipboard.writeText(t.prefix);
                  toast({ title: 'Copied token prefix' });
                } catch {
                  /* noop */
                }
              }}
              onRename={() => setRenameTarget(t)}
              onRegenerate={() => onRegenerate(t.id)}
              onRevoke={() => setRevokeConfirm(t)}
            />
          ))}
        </ul>
      </section>

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(params) => {
          const id = `t-${Date.now()}`;
          const token = randomToken();
          const newToken: ApiToken = {
            id,
            name: params.name,
            scope: params.scope,
            prefix: `${token.slice(0, 14)}…`,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            expiresAt: params.expiresAt,
            requestsToday: 0,
            apiScopes: params.apiScopes,
          };
          const next = [newToken, ...tokens];
          setTokens(next);
          persistTokens(next);
          setCreateOpen(false);
          setRevealed({ id, token });
        }}
      />

      <RevealTokenDialog
        revealed={revealed}
        onClose={() => setRevealed(null)}
        onCopy={() => {
          if (!revealed) return;
          try {
            navigator.clipboard.writeText(revealed.token);
            toast({ title: 'Token copied to clipboard' });
          } catch {
            /* noop */
          }
        }}
      />

      <RenameTokenDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => renameTarget && onRename(renameTarget.id, name)}
      />

      <Dialog
        open={revokeConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setRevokeConfirm(null);
        }}
      >
        <DialogContent data-testid="api-tokens-revoke-dialog">
          <DialogHeader>
            <DialogTitle>Revoke token?</DialogTitle>
            <DialogDescription>
              "{revokeConfirm?.name}" will be deleted immediately and any client using it will lose
              access within seconds. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeConfirm && onRevoke(revokeConfirm.id)}
              data-testid="api-tokens-revoke-confirm"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Revoke token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Token Row ---------------- */

interface TokenRowProps {
  token: ApiToken;
  onCopy: () => void;
  onRename: () => void;
  onRegenerate: () => void;
  onRevoke: () => void;
}

function TokenRow({ token, onCopy, onRename, onRegenerate, onRevoke }: TokenRowProps) {
  const created = new Date(token.createdAt).toLocaleDateString();
  const lastUsed = token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : '—';
  return (
    <li
      className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 sm:grid-cols-[1.4fr_0.7fr_2fr_0.9fr_0.9fr_0.6fr_auto] sm:items-center sm:gap-3"
      data-testid={`token-row-${token.id}`}
    >
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
        <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
          {token.name}
        </span>
      </div>
      <span
        className={cn(
          'inline-flex h-5 w-fit items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider',
          scopeTone(token.scope),
        )}
      >
        {scopeLabel(token.scope)}
      </span>
      <div className="flex items-center gap-2">
        <code className="rounded bg-[var(--bg-inset)] px-2 py-1 font-mono text-[var(--text-xs)] text-[var(--fg-secondary)]">
          {token.prefix}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
          aria-label="Copy token prefix"
          data-testid={`token-copy-${token.id}`}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">{created}</span>
      <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">{lastUsed}</span>
      <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
        {token.requestsToday} today
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" data-testid={`token-menu-${token.id}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename} data-testid={`token-rename-${token.id}`}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRegenerate} data-testid={`token-regenerate-${token.id}`}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Regenerate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRevoke}
            className="text-[var(--accent-rose)] focus:text-[var(--accent-rose)]"
            data-testid={`token-revoke-${token.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Revoke
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/* ---------------- Best Practices ---------------- */

function BestPracticesCard() {
  const items = [
    'Use one token per integration — never share tokens between tools.',
    'Set an expiration so leaked tokens become inert automatically.',
    'Use the least-privilege scope: read-only unless you need writes.',
    'Audit regularly — the Last Used column tells you what is still active.',
  ];
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-5"
      data-testid="api-tokens-best-practices"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h3 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
            Best practices
          </h3>
          <ul className="flex flex-col gap-1 text-[var(--text-xs)] text-[var(--fg-secondary)]">
            {items.map((it) => (
              <li key={it} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--accent-amber)]" />
                {it}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Create Token Dialog ---------------- */

interface CreateParams {
  name: string;
  scope: TokenScope;
  expiresAt: string | null;
  apiScopes: ReadonlyArray<string>;
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (params: CreateParams) => void;
}) {
  const [name, setName] = React.useState('');
  const [scope, setScope] = React.useState<TokenScope>('read-write');
  const [expiration, setExpiration] = React.useState<'30' | '90' | '365' | 'never'>('90');
  const [apiScopes, setApiScopes] = React.useState<ReadonlyArray<string>>(['forge-core']);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setScope('read-write');
      setExpiration('90');
      setApiScopes(['forge-core']);
      setError(null);
    }
  }, [open]);

  const toggleScope = (s: string) => {
    setApiScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const submit = () => {
    if (!name.trim()) {
      setError('Token name is required.');
      return;
    }
    if (apiScopes.length === 0) {
      setError('Select at least one API scope.');
      return;
    }
    const expiresAt =
      expiration === 'never'
        ? null
        : new Date(Date.now() + Number(expiration) * 86400 * 1000).toISOString();
    onCreate({ name: name.trim(), scope, expiresAt, apiScopes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]" data-testid="api-tokens-create-dialog">
        <DialogHeader>
          <DialogTitle>Create personal access token</DialogTitle>
          <DialogDescription>
            Pick the scope and APIs this token can access. You will see the full token only once.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Name" htmlFor="token-name" required>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. CI deploy"
              data-testid="token-name-input"
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              Scope
            </legend>
            {(['read', 'read-write', 'admin'] as const).map((s) => (
              <label
                key={s}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 transition-colors',
                  scope === s
                    ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] hover:border-[var(--border-default)]',
                )}
                data-testid={`token-scope-${s}`}
              >
                <input
                  type="radio"
                  name="token-scope"
                  checked={scope === s}
                  onChange={() => setScope(s)}
                  className="mt-1"
                />
                <div className="flex flex-col">
                  <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                    {scopeLabel(s)}
                  </span>
                  <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                    {s === 'read'
                      ? 'Read-only: list projects, fetch runs, view audit.'
                      : s === 'read-write'
                        ? 'Read + create/update runs and artifacts.'
                        : 'Full workspace control including member management.'}
                  </span>
                </div>
              </label>
            ))}
          </fieldset>

          <Field label="Expiration" htmlFor="token-expiration">
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {[
                { v: '30', label: '30 days' },
                { v: '90', label: '90 days' },
                { v: '365', label: '1 year' },
                { v: 'never', label: 'Never' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  role="radio"
                  aria-checked={expiration === opt.v}
                  onClick={() => setExpiration(opt.v as typeof expiration)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full border px-3 text-[var(--text-xs)] font-medium transition-colors',
                    expiration === opt.v
                      ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                  )}
                  data-testid={`token-expiration-${opt.v}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              API scopes
            </span>
            <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 sm:grid-cols-3">
              {ALL_API_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                  <Checkbox
                    checked={apiScopes.includes(s)}
                    onCheckedChange={() => toggleScope(s)}
                    data-testid={`token-api-scope-${s}`}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <p className="text-[var(--text-xs)] text-[var(--accent-rose)]" data-testid="token-create-error">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="token-create-cancel">
            Cancel
          </Button>
          <Button onClick={submit} data-testid="token-create-generate">
            Generate token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Reveal Token Dialog (one-time) ---------------- */

function RevealTokenDialog({
  revealed,
  onClose,
  onCopy,
}: {
  revealed: { id: string; token: string } | null;
  onClose: () => void;
  onCopy: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    setCopied(false);
  }, [revealed?.id]);

  if (!revealed) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px]" data-testid="api-tokens-reveal-dialog">
        <DialogHeader>
          <DialogTitle>Save your new token</DialogTitle>
          <DialogDescription>
            You will not see this token again. Copy it now and store it somewhere safe.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--accent-amber)]" aria-hidden="true" />
          <code className="flex-1 break-all font-mono text-[var(--text-sm)] text-[var(--fg-primary)]" data-testid="revealed-token">
            {revealed.token}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onCopy();
              setCopied(true);
            }}
            data-testid="revealed-copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="revealed-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Rename Token Dialog ---------------- */

function RenameTokenDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: ApiToken | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    setName(target?.name ?? '');
  }, [target]);

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="api-tokens-rename-dialog">
        <DialogHeader>
          <DialogTitle>Rename token</DialogTitle>
          <DialogDescription>
            Updating the label does not rotate the secret.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name" htmlFor="token-rename-input">
          <Input
            id="token-rename-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="token-rename-input"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => onSubmit(name.trim())}
            data-testid="token-rename-submit"
          >
            Save
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
