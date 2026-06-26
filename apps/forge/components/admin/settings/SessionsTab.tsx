'use client';

/**
 * Settings — Sessions tab (Step-47 Account section).
 *
 * Active sessions list (current device highlighted with "This device"
 * badge; "Sign out" per other session; bulk "Sign out all other
 * sessions" with confirm Dialog). Device management (trusted
 * devices) sits in a collapsible.
 *
 * Mock data persists to localStorage so a hard refresh keeps the
 * signed-out state during a session.
 */

import * as React from 'react';
import {
  Laptop,
  Smartphone,
  Tablet,
  Globe,
  LogOut,
  ShieldOff,
  ChevronDown,
  MapPin,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type DeviceKind = 'desktop' | 'mobile' | 'tablet';

interface Session {
  id: string;
  device: DeviceKind;
  browser: string;
  os: string;
  ip: string;
  city: string;
  country: string;
  lastActive: string; // ISO
  current: boolean;
}

const SEED: ReadonlyArray<Session> = [
  {
    id: 's-current',
    device: 'desktop',
    browser: 'Chrome 128',
    os: 'macOS 15.0',
    ip: '103.21.244.18',
    city: 'Bengaluru',
    country: 'India',
    lastActive: new Date(Date.now() - 1000 * 30).toISOString(),
    current: true,
  },
  {
    id: 's-2',
    device: 'mobile',
    browser: 'Safari 17',
    os: 'iOS 18.1',
    ip: '49.36.112.4',
    city: 'Bengaluru',
    country: 'India',
    lastActive: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    current: false,
  },
  {
    id: 's-3',
    device: 'desktop',
    browser: 'Firefox 130',
    os: 'Ubuntu 24.04',
    ip: '157.45.21.99',
    city: 'London',
    country: 'United Kingdom',
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    current: false,
  },
  {
    id: 's-4',
    device: 'tablet',
    browser: 'Safari 17',
    os: 'iPadOS 18',
    ip: '203.0.113.42',
    city: 'Singapore',
    country: 'Singapore',
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    current: false,
  },
];

const STORAGE_KEY = 'forge.sessions.v1';

function loadSessions(): Session[] {
  if (typeof window === 'undefined') return [...SEED];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED];
    return JSON.parse(raw) as Session[];
  } catch {
    return [...SEED];
  }
}

function persistSessions(s: Session[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

function DeviceIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  if (kind === 'mobile') return <Smartphone className={className} aria-hidden="true" />;
  if (kind === 'tablet') return <Tablet className={className} aria-hidden="true" />;
  return <Laptop className={className} aria-hidden="true" />;
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

export function SessionsTab() {
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>(SEED);
  const [confirmAll, setConfirmAll] = React.useState(false);
  const [confirmOne, setConfirmOne] = React.useState<Session | null>(null);
  const [trustedOpen, setTrustedOpen] = React.useState(false);
  const [trusted, setTrusted] = React.useState<ReadonlyArray<string>>(['s-current']);

  React.useEffect(() => {
    setSessions(loadSessions());
  }, []);

  const others = sessions.filter((s) => !s.current);
  const othersCount = others.length;

  const revokeOne = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    persistSessions(next);
    setConfirmOne(null);
  };

  const revokeAllOthers = () => {
    const next = sessions.filter((s) => s.current);
    setSessions(next);
    persistSessions(next);
    setConfirmAll(false);
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col gap-6"
      data-testid="sessions-tab"
    >
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        data-testid="sessions-active-card"
      >
        <header className="flex items-start justify-between gap-4 pb-4">
          <div>
            <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
              Active sessions
            </h3>
            <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
              Devices currently signed in to your account. Sign out of any
              session you don't recognize.
            </p>
          </div>
          {othersCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAll(true)}
              data-testid="sessions-sign-out-all"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out all other sessions
            </Button>
          ) : null}
        </header>

        <ul className="flex flex-col gap-3" data-testid="sessions-list">
          {sessions.map((s) => (
            <li
              key={s.id}
              className={cn(
                'flex items-center justify-between gap-4 rounded-[var(--radius-md)] border p-4 transition-colors',
                s.current
                  ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/5'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-inset)]',
              )}
              data-testid={`session-row-${s.id}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border',
                    s.current
                      ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)]',
                  )}
                >
                  <DeviceIcon kind={s.device} className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
                      {s.browser} · {s.os}
                    </span>
                    {s.current ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-emerald)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-emerald)]"
                        data-testid="session-current-badge"
                      >
                        This device
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-0.5 flex items-center gap-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {s.city}, {s.country}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Globe className="h-3 w-3" aria-hidden="true" />
                      {s.ip}
                    </span>
                    <span>· Last active {timeAgo(s.lastActive)}</span>
                  </span>
                </div>
              </div>
              {s.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmOne(s)}
                  data-testid={`session-signout-${s.id}`}
                  aria-label={`Sign out ${s.browser} on ${s.os}`}
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        data-testid="sessions-trusted-card"
      >
        <button
          type="button"
          onClick={() => setTrustedOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={trustedOpen}
          data-testid="sessions-trusted-toggle"
        >
          <div className="flex flex-col">
            <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
              Trusted devices
            </h3>
            <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
              Devices that bypass 2FA challenges for 30 days.
            </p>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-[var(--fg-secondary)] transition-transform',
              trustedOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>

        {trustedOpen ? (
          <ul className="mt-4 flex flex-col gap-2" data-testid="sessions-trusted-list">
            {sessions
              .filter((s) => trusted.includes(s.id))
              .map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
                  data-testid={`trusted-${s.id}`}
                >
                  <div className="flex items-center gap-3">
                    <DeviceIcon kind={s.device} className="h-4 w-4 text-[var(--fg-secondary)]" />
                    <span className="text-[var(--text-sm)] text-[var(--fg-primary)]">
                      {s.browser} · {s.os}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTrusted(trusted.filter((id) => id !== s.id))}
                    data-testid={`trusted-revoke-${s.id}`}
                  >
                    Revoke trust
                  </Button>
                </li>
              ))}
            {trusted.length === 0 ? (
              <li className="text-[var(--text-sm)] text-[var(--fg-tertiary)]">
                No trusted devices. Sign in with 2FA on a new device, then mark it trusted to skip
                the challenge next time.
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      {/* Confirm sign-out-one */}
      <Dialog
        open={confirmOne !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmOne(null);
        }}
      >
        <DialogContent data-testid="sessions-confirm-one">
          <DialogHeader>
            <DialogTitle>Sign out this session?</DialogTitle>
            <DialogDescription>
              {confirmOne
                ? `${confirmOne.browser} on ${confirmOne.os} (${confirmOne.city}, ${confirmOne.country}) will be signed out immediately.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOne(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmOne && revokeOne(confirmOne.id)}
              data-testid="sessions-confirm-one-button"
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm sign-out-all */}
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent data-testid="sessions-confirm-all">
          <DialogHeader>
            <DialogTitle>Sign out {othersCount} other session{othersCount === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              You'll need to log in again on those devices. Your current session will stay active.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={revokeAllOthers}
              data-testid="sessions-confirm-all-button"
            >
              Sign out all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
