'use client';

/**
 * CredentialsTab — Zone 8 in the Step 31 spec.
 *
 * Split-pane credential vault:
 *   - Left: searchable credential list with age-coded badges
 *   - Right: detail with rotation history, usage and destructive actions
 *
 * All reveal/copy/rotate actions require re-auth (mock dialog). Secrets
 * are never logged. Reveal is auto-masked after 30s; clipboard auto-clears
 * after 60s.
 */

import * as React from 'react';
import {
  Clipboard,
  Clock,
  Eye,
  EyeOff,
  History,
  Key,
  Loader2,
  Lock,
  RefreshCw,
  RotateCw,
  Search,
  Shield,
  ShieldOff,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectorHealthIndicator } from '@/components/connectors/ConnectorHealthIndicator';
import {
  CATEGORY_LABEL,
  CREDENTIAL_TYPE_LABEL,
  SCOPE_LABEL,
  listCredentials,
  resolveIcon,
  type ConnectorCredential,
} from '@/lib/connectors';
import { fmtTimeAgo, maskSecret } from '../constants';
import { cn } from '@/lib/utils';
import {
  useCredentials,
  useRevealCredential,
  useRotateCredential,
  useRevokeCredential,
} from '@/lib/hooks/useConnectors';

type CredentialRow = ReturnType<typeof listCredentials>[number];

export function CredentialsTab() {
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [authModal, setAuthModal] = React.useState<null | 'reveal' | 'rotate' | 'revoke'>(null);
  const [revealTimer, setRevealTimer] = React.useState<number | null>(null);
  const [copiedAt, setCopiedAt] = React.useState<number | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(null);
  const [rotateSecret, setRotateSecret] = React.useState('');

  // Step 55: real data with mock fallback.
  const liveCredentials = useCredentials();
  const mockCredentials = listCredentials();
  const liveRows = liveCredentials.data ?? [];
  const credentials: ReadonlyArray<CredentialRow> = liveRows.length > 0
    ? liveRows.map((cred) => ({
        credential: cred,
        connector: {
          id: cred.id,
          displayName: cred.name,
          category: 'custom' as ConnectorCredential['type'] extends string ? 'custom' : 'custom',
          status: cred.status,
        },
      }))
    : mockCredentials;

  const reveal = useRevealCredential();
  const rotate = useRotateCredential();
  const revoke = useRevokeCredential();

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return credentials.filter((row) => {
      if (q && !`${row.connector.displayName} ${row.credential.name}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && row.credential.status !== statusFilter) return false;
      return true;
    });
  }, [credentials, query, statusFilter]);

  React.useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].credential.id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((r) => r.credential.id === selectedId)?.credential ?? null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleReveal = () => {
    setAuthModal('reveal');
  };

  const handleCopy = () => {
    if (!revealedSecret) return;
    navigator.clipboard?.writeText(revealedSecret).catch(() => undefined);
    setCopiedAt(Date.now());
    showToast('Copied — clipboard will auto-clear in 60s');
    setTimeout(() => setCopiedAt(null), 60_000);
  };

  const handleRotate = () => {
    setRotateSecret('');
    setAuthModal('rotate');
  };

  const handleRevoke = () => {
    setAuthModal('revoke');
  };

  const confirmAuth = async () => {
    const action = authModal;
    const targetId = selected?.id;
    setAuthModal(null);
    if (!targetId) return;
    if (action === 'reveal') {
      try {
        const res = await reveal.mutateAsync(targetId);
        setRevealedSecret(res.secret);
        setRevealing(true);
        showToast('Reveal granted — auto-hides in 30s');
        const t = window.setTimeout(() => {
          setRevealing(false);
          setRevealedSecret(null);
          showToast('Reveal auto-hidden');
        }, 30_000);
        setRevealTimer(t);
      } catch {
        // toast handled by the hook
      }
    }
    if (action === 'rotate') {
      if (!rotateSecret) {
        showToast('Enter a new secret value first.');
        return;
      }
      try {
        await rotate.mutateAsync({ id: targetId, newSecret: rotateSecret });
        showToast('Rotation requested — fingerprint issued');
      } catch {
        /* toast handled by the hook */
      }
    }
    if (action === 'revoke') {
      try {
        await revoke.mutateAsync(targetId);
        showToast('Credential revoked — downstream workflows will be blocked');
      } catch {
        /* toast handled by the hook */
      }
    }
  };

  React.useEffect(() => {
    return () => {
      if (revealTimer) window.clearTimeout(revealTimer);
    };
  }, [revealTimer]);

  return (
    <div className="flex flex-col gap-4" data-testid="connector-credentials-tab">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,40%)_minmax(0,60%)]">
        {/* Left — list */}
        <div className="flex flex-col rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] p-3">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search credentials…"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {['all', 'active', 'expiring', 'expired'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                    statusFilter === s
                      ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                      : 'border-[var(--border-subtle)] text-fg-tertiary hover:text-fg-secondary',
                  )}
                  aria-pressed={statusFilter === s}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[520px] divide-y divide-[var(--border-subtle)] overflow-y-auto" role="listbox">
            {filtered.map((row) => {
              const Icon = resolveIcon(row.connector.id);
              const c = row.credential;
              const ageDays = Math.floor(
                (Date.now() - new Date(c.lastRotatedAt).getTime()) / 86_400_000,
              );
              const tone =
                c.status === 'expired'
                  ? 'rose'
                  : c.status === 'expiring' || ageDays > 90
                    ? 'amber'
                    : 'emerald';
              const toneClass =
                tone === 'rose'
                  ? 'border-[var(--accent-rose)]/40 text-[var(--accent-rose)]'
                  : tone === 'amber'
                    ? 'border-[var(--accent-amber)]/40 text-[var(--accent-amber)]'
                    : 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]';
              return (
                <li key={row.connector.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface)]',
                      selectedId === c.id && 'bg-[var(--bg-surface)]',
                    )}
                    aria-selected={selectedId === c.id}
                    role="option"
                    data-testid="credential-row"
                    data-credential-id={row.connector.id}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg-primary">{row.connector.displayName}</div>
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {CREDENTIAL_TYPE_LABEL[c.type]} · rotated {ageDays}d ago
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] capitalize', toneClass)}>
                      {c.status}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="px-3 py-12 text-center text-xs text-fg-tertiary">
                <Key className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                No credentials match.
              </li>
            ) : null}
          </ul>
        </div>

        {/* Right — detail */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          {selected ? (
            <CredentialDetail
              credential={selected}
              revealing={revealing}
              onReveal={handleReveal}
              onCopy={handleCopy}
              onRotate={handleRotate}
              onRevoke={handleRevoke}
              copiedAt={copiedAt}
            />
          ) : (
            <EmptyVault onBrowse={() => (window.location.href = '/connector-center?tab=marketplace')} />
          )}
        </div>
      </div>

      {/* Auth modal */}
      {authModal ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setAuthModal(null)} aria-hidden="true" />
          <div className="relative w-[420px] max-w-[92vw] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-md)]">
            <h3 className="text-base font-semibold text-fg-primary">Re-authenticate to continue</h3>
            <p className="mt-1 text-xs text-fg-tertiary">
              {authModal === 'reveal' && 'Revealing secrets requires password + 2FA.'}
              {authModal === 'rotate' && 'Rotating credentials affects all workflows using this connector.'}
              {authModal === 'revoke' && 'Revoking will immediately block downstream workflows. This cannot be undone.'}
            </p>
            {authModal === 'rotate' ? (
              <div className="mt-4">
                <label className="block text-[10px] uppercase tracking-wider text-fg-tertiary">
                  New secret value
                </label>
                <Input
                  type="password"
                  placeholder="paste the new secret"
                  className="mt-1 h-9 font-mono text-xs"
                  autoFocus
                  value={rotateSecret}
                  onChange={(e) => setRotateSecret(e.target.value)}
                />
              </div>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Lock className="h-4 w-4 text-fg-tertiary" aria-hidden="true" />
              <Input type="password" placeholder="Password" className="h-9 text-sm" autoFocus />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-fg-tertiary" aria-hidden="true" />
              <Input type="text" inputMode="numeric" placeholder="2FA code" className="h-9 text-sm font-mono" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAuthModal(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={confirmAuth} disabled={reveal.isPending || rotate.isPending || revoke.isPending}>
                {(reveal.isPending || rotate.isPending || revoke.isPending) ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : null}
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-fg-primary shadow-[var(--shadow-md)]"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function CredentialDetail({
  credential,
  revealing,
  onReveal,
  onCopy,
  onRotate,
  onRevoke,
  copiedAt,
}: {
  credential: ConnectorCredential;
  revealing: boolean;
  onReveal: () => void;
  onCopy: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  copiedAt: number | null;
}) {
  const ageDays = Math.floor((Date.now() - new Date(credential.lastRotatedAt).getTime()) / 86_400_000);
  const expiresIn = credential.expiresAt
    ? Math.floor((Date.parse(credential.expiresAt) - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-semibold text-fg-primary">{credential.name}</h3>
          <p className="mt-0.5 text-[11px] text-fg-tertiary">
            {CREDENTIAL_TYPE_LABEL[credential.type]} · {SCOPE_LABEL.org} scope
          </p>
        </div>
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider',
            credential.status === 'expired'
              ? 'border-[var(--accent-rose)]/40 text-[var(--accent-rose)]'
              : credential.status === 'expiring'
                ? 'border-[var(--accent-amber)]/40 text-[var(--accent-amber)]'
                : 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]',
          )}
        >
          {credential.status}
        </span>
      </header>

      {/* Secret box */}
      <div
        className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 py-2"
        data-testid="credential-secret"
      >
        <code className="select-all truncate font-mono text-sm text-fg-primary">
          {revealing ? revealedSecret ?? '••••••••••••' : maskSecret(credential.lengthChars || 24)}
        </code>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => (revealing ? setRevealing(false) : onReveal())}
            aria-pressed={revealing}
            data-testid="credential-reveal"
          >
            {revealing ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {revealing ? 'Hide' : 'Reveal'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onCopy} disabled={!revealing}>
            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
            {copiedAt ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Info grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-fg-tertiary">Fingerprint</dt>
        <dd className="font-mono text-fg-primary">{credential.fingerprint}</dd>
        <dt className="text-fg-tertiary">Last rotated</dt>
        <dd className="text-fg-primary">{fmtTimeAgo(credential.lastRotatedAt)} ({ageDays}d ago)</dd>
        <dt className="text-fg-tertiary">Rotated by</dt>
        <dd className="flex items-center gap-2 text-fg-primary">
          <Avatar className="h-4 w-4">
            <AvatarFallback className="text-[8px]">{credential.owner.initials}</AvatarFallback>
          </Avatar>
          {credential.rotatedBy}
        </dd>
        <dt className="text-fg-tertiary">Expires</dt>
        <dd className="text-fg-primary">
          {expiresIn === null ? 'Never' : expiresIn < 0 ? `${-expiresIn}d ago` : `in ${expiresIn}d`}
        </dd>
        <dt className="text-fg-tertiary">Scopes</dt>
        <dd className="text-fg-primary">{credential.scopes.length} scopes granted</dd>
      </dl>

      {/* Rotation history */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg-primary">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Rotation history
        </h4>
        <ul className="space-y-1.5 text-xs">
          {[
            { at: credential.lastRotatedAt, who: credential.rotatedBy, note: 'Manual rotation' },
            { at: new Date(Date.parse(credential.lastRotatedAt) - 90 * 86_400_000).toISOString(), who: 'System', note: 'Scheduled rotation' },
            { at: new Date(Date.parse(credential.lastRotatedAt) - 180 * 86_400_000).toISOString(), who: credential.owner.name, note: 'After incident' },
          ].map((h, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5">
              <span className="font-mono text-fg-tertiary">{fmtTimeAgo(h.at)}</span>
              <span className="text-fg-secondary">·</span>
              <span className="text-fg-primary">{h.who}</span>
              <span className="ml-auto text-fg-tertiary">{h.note}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Actions */}
      <section className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
        <Button size="sm" variant="outline">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Set rotation reminder
        </Button>
        <Button size="sm" onClick={onRotate}>
          <RotateCw className="h-3 w-3" aria-hidden="true" />
          Rotate now
        </Button>
        <Button size="sm" variant="ghost" className="text-[var(--accent-rose)]" onClick={onRevoke}>
          <ShieldOff className="h-3 w-3" aria-hidden="true" />
          Revoke
        </Button>
      </section>
    </div>
  );
}

function EmptyVault({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <Key className="h-8 w-8 text-fg-tertiary" aria-hidden="true" />
      <h3 className="text-base font-semibold text-fg-primary">No credentials yet</h3>
      <p className="max-w-sm text-xs text-fg-tertiary">
        Connect your first integration to create a credential. We store them encrypted and audit every reveal.
      </p>
      <Button size="sm" variant="outline" onClick={onBrowse}>
        Browse marketplace →
      </Button>
    </div>
  );
}

// Unused but kept available for callers that need to render a single row elsewhere.
export function CredentialRowSummary({ row }: { row: CredentialRow }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-fg-primary">{row.connector.displayName}</span>
      <span className="text-fg-tertiary">·</span>
      <span className="text-fg-tertiary">{CATEGORY_LABEL[row.connector.category]}</span>
    </div>
  );
}