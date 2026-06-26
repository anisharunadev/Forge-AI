'use client';

/**
 * Settings — Profile tab (Step-47 Account section).
 *
 * Three stacked sections inside a single scroll container:
 *   1. Profile info  — avatar (48×48, click-to-upload), display name,
 *                      email + verified badge, bio (200 char max),
 *                      timezone + locale Comboboxes, theme (Dark /
 *                      System sync), accent color picker
 *   2. Security      — change-password Dialog, 2FA toggle + QR
 *                      setup wizard with 10 recovery codes
 *   3. Connected accounts — Google / GitHub / GitLab / Microsoft
 *                      OAuth connect/disconnect (mocked; persisted
 *                      to localStorage)
 *
 * All persistence is mocked against localStorage; the real
 * /v1/account/* endpoint integration lands with sub-plan A.
 *
 * Sticky save pattern: a `dirty` flag toggles the Save button via
 * the shared SectionShell.
 */

import * as React from 'react';
import {
  Camera,
  Lock,
  ShieldCheck,
  QrCode,
  Copy,
  Download,
  Check,
  Mail,
  Code2 as Github,
  Globe as Chrome,
  Laptop,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { SectionShell } from './SectionShell';

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
] as const;

const LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'hi-IN', label: 'हिन्दी' },
] as const;

const ACCENT_PRESETS = [
  { name: 'Indigo',  value: '#6366F1' },
  { name: 'Cyan',    value: '#22D3EE' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Amber',   value: '#F59E0B' },
  { name: 'Violet',  value: '#A855F7' },
  { name: 'Rose',    value: '#F43F5E' },
] as const;

interface ProfileForm {
  displayName: string;
  email: string;
  bio: string;
  timezone: string;
  locale: string;
  theme: 'dark' | 'system';
  accent: string;
}

const DEFAULT_PROFILE: ProfileForm = {
  displayName: 'Arun Achalam',
  email: 'arun@acme.com',
  bio: 'Founding engineer at Acme Corp — building the agentic SDLC platform.',
  timezone: 'Asia/Kolkata',
  locale: 'en-US',
  theme: 'dark',
  accent: '#6366F1',
};

const STORAGE_KEY = 'forge.profile.v1';

function loadProfile(): ProfileForm {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<ProfileForm>) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function generateRecoveryCodes(count = 10): string[] {
  const words = ['sun', 'maple', 'forge', 'echo', 'tide', 'river', 'comet', 'orbit', 'pine', 'flint',
                 'coral', 'spark', 'glade', 'crest', 'amber', 'north', 'lunar', 'storm', 'beacon', 'cipher'];
  return Array.from({ length: count }, () => {
    const a = words[Math.floor(Math.random() * words.length)];
    const b = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(1000 + Math.random() * 9000);
    return `${a}-${b}-${n}`;
  });
}

const OAUTH_PROVIDERS = [
  { id: 'google',   name: 'Google',   icon: Chrome, color: '#EA4335' },
  { id: 'github',   name: 'GitHub',   icon: Github, color: '#FFFFFF' },
  { id: 'gitlab',   name: 'GitLab',   icon: Github, color: '#FC6D26' },
  { id: 'microsoft',name: 'Microsoft',icon: Laptop, color: '#00A4EF' },
] as const;

type OAuthId = (typeof OAUTH_PROVIDERS)[number]['id'];

interface OAuthConnection {
  provider: OAuthId;
  email: string;
  connectedAt: string; // ISO
}

const DEFAULT_CONNECTIONS: OAuthConnection[] = [
  { provider: 'github', email: 'arun@acme.com', connectedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString() },
];

export function ProfileTab() {
  const [profile, setProfile] = React.useState<ProfileForm>(DEFAULT_PROFILE);
  const [original, setOriginal] = React.useState<ProfileForm>(DEFAULT_PROFILE);
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const [connections, setConnections] = React.useState<OAuthConnection[]>(DEFAULT_CONNECTIONS);
  const [twoFactorEnabled, setTwoFactorEnabled] = React.useState(false);

  // Mount: hydrate from localStorage
  React.useEffect(() => {
    setProfile(loadProfile());
    setOriginal(loadProfile());
    try {
      const savedAvatar = window.localStorage.getItem('forge.profile.avatar');
      if (savedAvatar) setAvatar(savedAvatar);
      const saved2fa = window.localStorage.getItem('forge.profile.2fa');
      if (saved2fa === '1') setTwoFactorEnabled(true);
    } catch {
      /* noop */
    }
  }, []);

  const dirty = React.useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(original),
    [profile, original],
  );

  const onSave = () => {
    setOriginal(profile);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      /* noop */
    }
  };

  const onReset = () => setProfile(original);

  const onAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatar(dataUrl);
      try {
        window.localStorage.setItem('forge.profile.avatar', dataUrl);
      } catch {
        /* noop */
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col gap-6"
      data-testid="profile-tab"
    >
      <ProfileInfoCard
        profile={profile}
        setProfile={setProfile}
        avatar={avatar}
        onAvatarPick={onAvatarPick}
      />

      <SecurityCard
        twoFactorEnabled={twoFactorEnabled}
        setTwoFactorEnabled={(v) => {
          setTwoFactorEnabled(v);
          try {
            window.localStorage.setItem('forge.profile.2fa', v ? '1' : '0');
          } catch {
            /* noop */
          }
        }}
      />

      <ConnectedAccountsCard
        connections={connections}
        setConnections={setConnections}
      />

      <SectionShell
        dirty={dirty}
        onSave={onSave}
        onReset={onReset}
        saveLabel="Save changes"
        testId="profile-save-bar"
      />
    </div>
  );
}

/* ---------------- Profile Info Card ---------------- */

interface ProfileInfoCardProps {
  profile: ProfileForm;
  setProfile: React.Dispatch<React.SetStateAction<ProfileForm>>;
  avatar: string | null;
  onAvatarPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function ProfileInfoCard({ profile, setProfile, avatar, onAvatarPick }: ProfileInfoCardProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8"
      data-testid="profile-info-card"
    >
      <header className="flex flex-col gap-1 pb-4">
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          Profile information
        </h3>
        <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Your name, photo, and personal details are visible across your workspace.
        </p>
      </header>

      <div className="flex items-center gap-4 border-y border-[var(--border-subtle)] py-6">
        <button
          type="button"
          className="group relative"
          onClick={() => fileRef.current?.click()}
          aria-label="Upload new avatar"
          data-testid="profile-avatar-button"
        >
          <Avatar className="h-12 w-12">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="Profile" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <AvatarFallback className="bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]">
                {initials(profile.displayName)}
              </AvatarFallback>
            )}
          </Avatar>
          <span
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            <Camera className="h-4 w-4 text-white" />
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onAvatarPick}
            className="hidden"
            data-testid="profile-avatar-input"
          />
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
            {profile.displayName}
          </span>
          <span className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
            {profile.email}
          </span>
        </div>
      </div>

      <div className="grid gap-4 pt-6 sm:grid-cols-2">
        <Field label="Display name" htmlFor="profile-display-name">
          <Input
            id="profile-display-name"
            value={profile.displayName}
            onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            data-testid="profile-display-name"
          />
        </Field>

        <Field
          label="Email"
          htmlFor="profile-email"
          right={
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-emerald)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-emerald)]"
              data-testid="profile-email-verified"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              Verified
            </span>
          }
        >
          <Input
            id="profile-email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            data-testid="profile-email"
          />
        </Field>

        <Field label="Bio" htmlFor="profile-bio" className="sm:col-span-2">
          <Textarea
            id="profile-bio"
            value={profile.bio}
            onChange={(e) => {
              const v = e.target.value.slice(0, 200);
              setProfile({ ...profile, bio: v });
            }}
            maxLength={200}
            className="min-h-20"
            data-testid="profile-bio"
          />
          <p className="text-right text-[11px] text-[var(--fg-tertiary)]">
            {profile.bio.length}/200
          </p>
        </Field>

        <Field label="Timezone" htmlFor="profile-timezone">
          <Select
            value={profile.timezone}
            onValueChange={(v) => setProfile({ ...profile, timezone: v })}
          >
            <SelectTrigger id="profile-timezone" data-testid="profile-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Locale" htmlFor="profile-locale">
          <Select
            value={profile.locale}
            onValueChange={(v) => setProfile({ ...profile, locale: v })}
          >
            <SelectTrigger id="profile-locale" data-testid="profile-locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Theme" htmlFor="profile-theme">
          <Select
            value={profile.theme}
            onValueChange={(v) =>
              setProfile({ ...profile, theme: v as ProfileForm['theme'] })
            }
          >
            <SelectTrigger id="profile-theme" data-testid="profile-theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">Sync with system</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Accent color" htmlFor="profile-accent">
          <div className="flex items-center gap-2" data-testid="profile-accent-row">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                aria-label={preset.name}
                onClick={() => setProfile({ ...profile, accent: preset.value })}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-all',
                  profile.accent === preset.value
                    ? 'border-[var(--fg-primary)] scale-110'
                    : 'border-transparent hover:scale-105',
                )}
                style={{ backgroundColor: preset.value }}
                data-testid={`profile-accent-${preset.name.toLowerCase()}`}
              />
            ))}
            <input
              id="profile-accent"
              type="color"
              value={profile.accent}
              onChange={(e) => setProfile({ ...profile, accent: e.target.value })}
              className="h-6 w-6 cursor-pointer rounded-full border border-[var(--border-subtle)] bg-transparent"
              data-testid="profile-accent-input"
              aria-label="Custom accent color"
            />
          </div>
        </Field>
      </div>
    </section>
  );
}

/* ---------------- Security Card ---------------- */

interface SecurityCardProps {
  twoFactorEnabled: boolean;
  setTwoFactorEnabled: (v: boolean) => void;
}

function SecurityCard({ twoFactorEnabled, setTwoFactorEnabled }: SecurityCardProps) {
  const [pwOpen, setPwOpen] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8"
      data-testid="profile-security-card"
    >
      <header className="flex flex-col gap-1 pb-4">
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          Security
        </h3>
        <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Password and two-factor authentication keep your account safe.
        </p>
      </header>

      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-4">
        <div className="flex items-center gap-3">
          <Lock className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              Password
            </span>
            <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              Last changed 32 days ago
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPwOpen(true)}
          data-testid="profile-change-password"
        >
          Change password
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              Two-factor authentication
            </span>
            <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              {twoFactorEnabled
                ? 'Authenticator app + recovery codes active'
                : 'Add an extra layer of security to your account'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={twoFactorEnabled}
            onCheckedChange={(v) => {
              if (v) setQrOpen(true);
              else setTwoFactorEnabled(false);
            }}
            data-testid="profile-2fa-toggle"
          />
          {twoFactorEnabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQrOpen(true)}
              data-testid="profile-view-2fa"
            >
              Manage
            </Button>
          ) : null}
        </div>
      </div>

      <div className="pt-4">
        <Button variant="link" className="h-auto p-0 text-[var(--text-sm)]" data-testid="profile-security-log">
          View security log →
        </Button>
      </div>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <TwoFactorSetupDialog
        open={qrOpen}
        onOpenChange={(o) => {
          setQrOpen(o);
          if (!o && !twoFactorEnabled) {
            /* user closed without enabling */
          }
        }}
        onEnable={() => setTwoFactorEnabled(true)}
      />
    </section>
  );
}

/* ---------------- Change Password Dialog ---------------- */

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  }, [open]);

  const mismatch = next !== confirm;
  const tooShort = next.length > 0 && next.length < 12;
  const valid = current.length > 0 && next.length >= 12 && !mismatch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="profile-change-password-dialog">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Use a passphrase of 12+ characters for the best security.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Current password" htmlFor="pw-current">
            <Input
              id="pw-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              data-testid="pw-current"
            />
          </Field>
          <Field label="New password" htmlFor="pw-next">
            <Input
              id="pw-next"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              data-testid="pw-next"
            />
            {tooShort ? (
              <p className="text-[11px] text-[var(--accent-amber)]" data-testid="pw-too-short">
                Minimum 12 characters.
              </p>
            ) : null}
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm">
            <Input
              id="pw-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="pw-confirm"
            />
            {mismatch ? (
              <p className="text-[11px] text-[var(--accent-rose)]" data-testid="pw-mismatch">
                Passwords do not match.
              </p>
            ) : null}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="pw-cancel">
            Cancel
          </Button>
          <Button disabled={!valid} data-testid="pw-update">
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 2FA Setup Dialog ---------------- */

function TwoFactorSetupDialog({
  open,
  onOpenChange,
  onEnable,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEnable: () => void;
}) {
  const [step, setStep] = React.useState<'qr' | 'codes'>('qr');
  const [codes, setCodes] = React.useState<string[]>([]);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setStep('qr');
      setCodes(generateRecoveryCodes(10));
      setCopied(false);
    }
  }, [open]);

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [`Forge recovery codes — generated ${new Date().toISOString()}\n\n${codes.join('\n')}\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forge-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="profile-2fa-dialog">
        <DialogHeader>
          <DialogTitle>
            {step === 'qr' ? 'Set up two-factor authentication' : 'Save your recovery codes'}
          </DialogTitle>
          <DialogDescription>
            {step === 'qr'
              ? 'Scan the QR code with your authenticator app, then enter the 6-digit code.'
              : 'Keep these codes somewhere safe — each one can be used once if you lose access.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'qr' ? (
          <div className="flex flex-col items-center gap-4">
            <div
              className="flex h-48 w-48 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-white p-4"
              data-testid="2fa-qr"
            >
              <QrCode className="h-40 w-40 text-black" aria-hidden="true" />
            </div>
            <p className="text-center text-[11px] text-[var(--fg-tertiary)]">
              Can't scan? Enter this secret manually:&nbsp;
              <code className="rounded bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[10px]">
                JBSWY3DPEHPK3PXP
              </code>
            </p>
            <Field label="Verification code" htmlFor="2fa-code">
              <Input
                id="2fa-code"
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
                className="text-center font-mono tracking-[0.3em]"
                data-testid="2fa-code"
              />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ul
              className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4 font-mono text-[var(--text-sm)]"
              data-testid="2fa-codes"
            >
              {codes.map((code) => (
                <li key={code} className="text-[var(--fg-primary)]">
                  {code}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={copyCodes}
                className="flex-1"
                data-testid="2fa-copy"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy codes'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadCodes}
                className="flex-1"
                data-testid="2fa-download"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'qr' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="2fa-cancel">
                Cancel
              </Button>
              <Button onClick={() => setStep('codes')} data-testid="2fa-next">
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="2fa-close">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onEnable();
                  onOpenChange(false);
                }}
                data-testid="2fa-enable"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Enable 2FA
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Connected Accounts Card ---------------- */

interface ConnectedAccountsCardProps {
  connections: OAuthConnection[];
  setConnections: React.Dispatch<React.SetStateAction<OAuthConnection[]>>;
}

function ConnectedAccountsCard({ connections, setConnections }: ConnectedAccountsCardProps) {
  const [confirming, setConfirming] = React.useState<OAuthId | null>(null);

  const connect = (id: OAuthId) => {
    const provider = OAUTH_PROVIDERS.find((p) => p.id === id);
    if (!provider) return;
    setConnections((prev) => [
      ...prev,
      { provider: id, email: 'arun@acme.com', connectedAt: new Date().toISOString() },
    ]);
  };

  const disconnect = (id: OAuthId) => {
    setConnections((prev) => prev.filter((c) => c.provider !== id));
    setConfirming(null);
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8"
      data-testid="profile-connections-card"
    >
      <header className="flex flex-col gap-1 pb-4">
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          Connected accounts
        </h3>
        <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Link external OAuth providers to sign in faster and share context across tools.
        </p>
      </header>

      <ul className="flex flex-col" data-testid="profile-connections-list">
        {OAUTH_PROVIDERS.map((p, idx) => {
          const conn = connections.find((c) => c.provider === p.id);
          const Icon = p.icon;
          const isLast = idx === OAUTH_PROVIDERS.length - 1;
          return (
            <li
              key={p.id}
              className={cn(
                'flex items-center justify-between gap-3 py-3',
                !isLast && 'border-b border-[var(--border-subtle)]',
              )}
              data-testid={`profile-connection-${p.id}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)]"
                  style={{ color: p.color }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="flex flex-col">
                  <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                    {p.name}
                  </span>
                  <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                    {conn ? (
                      <>
                        {conn.email} · Connected {timeAgo(conn.connectedAt)}
                      </>
                    ) : (
                      'Not connected'
                    )}
                  </span>
                </div>
              </div>
              {conn ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(p.id)}
                  data-testid={`profile-disconnect-${p.id}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => connect(p.id)}
                  data-testid={`profile-connect-${p.id}`}
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Connect {p.name}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
      >
        <DialogContent data-testid="profile-disconnect-dialog">
          <DialogHeader>
            <DialogTitle>Disconnect account?</DialogTitle>
            <DialogDescription>
              You'll need to use your password to sign in next time. Active sessions on this provider
              will be revoked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirming && disconnect(confirming)}
              data-testid="profile-disconnect-confirm"
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------------- Field helper ---------------- */

interface FieldProps {
  label: string;
  htmlFor: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, right, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor} className="text-[var(--text-sm)] text-[var(--fg-primary)]">
          {label}
        </Label>
        {right}
      </div>
      {children}
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
