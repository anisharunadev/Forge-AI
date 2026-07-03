'use client';

/**
 * Settings — Branding tab (Step-47 Enterprise section).
 *
 * Two-column layout: config on the left, live preview on the right.
 *
 * Config controls: company name, logo + favicon upload (drag-drop),
 * primary + accent color pickers, login background, custom domain
 * + DNS instructions, email "from" name + reply-to, terms &
 * privacy URLs, support email, custom CSS.
 *
 * Live preview renders a mock login page and dashboard tile using
 * the in-progress config so you can see the brand before saving.
 */

import * as React from 'react';
import {
  Upload,
  ImageIcon,
  Check,
  Copy,
  Palette,
  Mail,
  Globe,
  Code2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useBranding, useUpdateBranding } from '@/lib/hooks/useSettings';
import { useAuth } from '@/lib/api/auth';

const FALLBACK_TENANT_ID = 'tenant-acme-demo';

interface BrandingState {
  // step 73: 5 backend-mapped fields (logoUrl, primaryColor, accentColor, faviconUrl, supportEmail)
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
  primary: string;
  accent: string;
  supportEmail: string;
  // step 73: local-only — no backend field
  companyName: string;
  loginBgDataUrl: string | null;
  customDomain: string;
  emailFromName: string;
  emailReplyTo: string;
  termsUrl: string;
  privacyUrl: string;
  customCss: string;
}

const DEFAULTS: BrandingState = {
  logoDataUrl: null,
  faviconDataUrl: null,
  primary: '#6366F1',
  accent: '#22D3EE',
  supportEmail: 'support@acme.com',
  companyName: 'Acme Corp',
  loginBgDataUrl: null,
  customDomain: '',
  emailFromName: 'Acme Forge',
  emailReplyTo: 'no-reply@acme.com',
  termsUrl: '',
  privacyUrl: '',
  customCss: '',
};

// step 73: local-only fields persist here (they have no backend mapping).
const LOCAL_KEY = 'forge.branding.local.v1';

function loadLocal(state: BrandingState): BrandingState {
  if (typeof window === 'undefined') return state;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return state;
    return { ...state, ...(JSON.parse(raw) as Partial<BrandingState>) };
  } catch {
    return state;
  }
}

export function BrandingTab() {
  const { toast } = useToast();
  const tenantId = useAuth((s) => s.tenant?.id ?? null) ?? FALLBACK_TENANT_ID;
  const brandingQ = useBranding(tenantId);
  const patchMut = useUpdateBranding(tenantId);
  const [b, setB] = React.useState<BrandingState>(() => loadLocal(DEFAULTS));
  const [original, setOriginal] = React.useState<BrandingState>(() => loadLocal(DEFAULTS));
  const [copied, setCopied] = React.useState<string | null>(null);

  // Hydrate the 5 backend-mapped fields once data lands; preserve local-only state.
  React.useEffect(() => {
    if (!brandingQ.data) return;
    const mapped: Partial<BrandingState> = {
      logoDataUrl: brandingQ.data.logoUrl,
      faviconDataUrl: brandingQ.data.faviconUrl,
      primary: brandingQ.data.primaryColor ?? DEFAULTS.primary,
      accent: brandingQ.data.accentColor ?? DEFAULTS.accent,
      supportEmail: brandingQ.data.supportEmail ?? DEFAULTS.supportEmail,
    };
    setB((prev) => ({ ...prev, ...mapped }));
    setOriginal((prev) => ({ ...prev, ...mapped }));
  }, [brandingQ.data]);

  const dirty = JSON.stringify(b) !== JSON.stringify(original);

  const update = <K extends keyof BrandingState>(key: K, value: BrandingState[K]) => {
    setB((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = () => {
    // step 73: persist the 5 mappable fields via the backend mutation.
    patchMut.mutate(
      {
        logoUrl: b.logoDataUrl,
        primaryColor: b.primary,
        accentColor: b.accent,
        faviconUrl: b.faviconDataUrl,
        supportEmail: b.supportEmail,
      },
      {
        onSuccess: () => {
          // step 73: local-only fields still write to localStorage.
          try {
            window.localStorage.setItem(
              LOCAL_KEY,
              JSON.stringify({
                companyName: b.companyName,
                loginBgDataUrl: b.loginBgDataUrl,
                customDomain: b.customDomain,
                emailFromName: b.emailFromName,
                emailReplyTo: b.emailReplyTo,
                termsUrl: b.termsUrl,
                privacyUrl: b.privacyUrl,
                customCss: b.customCss,
              }),
            );
          } catch {
            /* noop */
          }
          setOriginal(b);
          toast({ title: 'Branding saved' });
        },
        onError: (err) => {
          toast({ title: 'Branding save failed', description: err.message });
        },
      },
    );
  };

  const onReset = () => setB(original);

  const onFile = (key: 'logoDataUrl' | 'faviconDataUrl' | 'loginBgDataUrl') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => update(key, reader.result as string);
      reader.readAsDataURL(file);
    };

  const onCopy = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="branding-tab">
      <header>
        <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
          Branding
        </h2>
        <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
          White-label your workspace. Changes are applied to the live preview on the right and saved
          to your tenant on submit.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* LEFT: Config */}
        <section className="flex flex-col gap-4" data-testid="branding-config">
          <Field label="Company name" htmlFor="brand-company">
            <Input
              id="brand-company"
              value={b.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              data-testid="brand-company"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <ImageUpload
              label="Logo (256×256)"
              testId="brand-logo"
              value={b.logoDataUrl}
              onChange={(v) => update('logoDataUrl', v)}
            />
            <ImageUpload
              label="Favicon"
              testId="brand-favicon"
              value={b.faviconDataUrl}
              onChange={(v) => update('faviconDataUrl', v)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary color" htmlFor="brand-primary">
              <ColorRow
                testId="brand-primary"
                value={b.primary}
                onChange={(v) => update('primary', v)}
              />
            </Field>
            <Field label="Accent color" htmlFor="brand-accent">
              <ColorRow
                testId="brand-accent"
                value={b.accent}
                onChange={(v) => update('accent', v)}
              />
            </Field>
          </div>

          <ImageUpload
            label="Login background"
            testId="brand-bg"
            value={b.loginBgDataUrl}
            onChange={(v) => update('loginBgDataUrl', v)}
          />

          <Field label="Custom domain" htmlFor="brand-domain">
            <Input
              id="brand-domain"
              placeholder="forge.example.com"
              value={b.customDomain}
              onChange={(e) => update('customDomain', e.target.value)}
              data-testid="brand-domain"
            />
            <div
              className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 font-mono text-[11px] text-[var(--fg-secondary)]"
              data-testid="brand-dns-instructions"
            >
              <p className="mb-1 text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                DNS records
              </p>
              <p>CNAME &nbsp;forge.example.com &nbsp;→&nbsp; forge.acme-cdn.io</p>
              <p>TXT &nbsp;&nbsp;&nbsp;_forge-verify.example.com &nbsp;→&nbsp; forge-verify=&lt;token&gt;</p>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email 'from' name" htmlFor="brand-from-name">
              <Input
                id="brand-from-name"
                value={b.emailFromName}
                onChange={(e) => update('emailFromName', e.target.value)}
                data-testid="brand-from-name"
              />
            </Field>
            <Field label="Reply-to" htmlFor="brand-replyto">
              <Input
                id="brand-replyto"
                type="email"
                value={b.emailReplyTo}
                onChange={(e) => update('emailReplyTo', e.target.value)}
                data-testid="brand-replyto"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Terms of service URL" htmlFor="brand-terms">
              <Input
                id="brand-terms"
                value={b.termsUrl}
                onChange={(e) => update('termsUrl', e.target.value)}
                placeholder="https://acme.com/terms"
                data-testid="brand-terms"
              />
            </Field>
            <Field label="Privacy policy URL" htmlFor="brand-privacy">
              <Input
                id="brand-privacy"
                value={b.privacyUrl}
                onChange={(e) => update('privacyUrl', e.target.value)}
                placeholder="https://acme.com/privacy"
                data-testid="brand-privacy"
              />
            </Field>
          </div>

          <Field label="Support email" htmlFor="brand-support">
            <Input
              id="brand-support"
              type="email"
              value={b.supportEmail}
              onChange={(e) => update('supportEmail', e.target.value)}
              data-testid="brand-support"
            />
          </Field>

          <Field label="Custom CSS (advanced)" htmlFor="brand-css">
            <Textarea
              id="brand-css"
              value={b.customCss}
              onChange={(e) => update('customCss', e.target.value)}
              className="min-h-24 font-mono text-[var(--text-xs)]"
              placeholder=":root { --header-height: 56px; }"
              data-testid="brand-css"
            />
          </Field>

          <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-end gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 px-4 py-3 backdrop-blur">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty}
              onClick={onReset}
              data-testid="brand-reset"
            >
              Reset
            </Button>
            <Button size="sm" disabled={!dirty} onClick={onSave} data-testid="brand-save">
              Save branding
            </Button>
          </div>
        </section>

        {/* RIGHT: Live preview */}
        <aside
          className="lg:sticky lg:top-6 lg:self-start"
          data-testid="branding-preview"
        >
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center gap-2 pb-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              <Palette className="h-3 w-3" aria-hidden="true" />
              Live preview
            </div>

            {/* Mock login */}
            <div
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
              style={{
                backgroundImage: b.loginBgDataUrl
                  ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${b.loginBgDataUrl})`
                  : 'linear-gradient(135deg, #0E0E11, #1A1A1F)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              data-testid="preview-login"
            >
              <div className="p-5">
                <div className="flex items-center gap-2">
                  {b.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={b.logoDataUrl}
                      alt={`${b.companyName} logo`}
                      className="h-8 w-8 rounded"
                    />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded text-sm font-bold text-white"
                      style={{ backgroundColor: b.primary }}
                    >
                      {b.companyName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-semibold text-white">{b.companyName}</span>
                </div>
                <div className="mt-4 rounded bg-black/30 p-3 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-widest text-white/60">Sign in</p>
                  <p className="mt-1 text-sm font-medium text-white">Welcome back</p>
                  <div className="mt-3 h-7 rounded bg-white/20" />
                  <div className="mt-2 h-7 rounded bg-white/20" />
                  <button
                    type="button"
                    className="mt-3 h-8 w-full rounded text-xs font-semibold text-white"
                    style={{ backgroundColor: b.primary }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>

            {/* Mock dashboard tile */}
            <div
              className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
              data-testid="preview-dashboard"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                  Dashboard tile
                </span>
                <span className="text-[10px] text-[var(--fg-tertiary)]">{b.customDomain || 'forge.example.com'}</span>
              </div>
              <div
                className="mt-2 rounded p-2 text-xs font-semibold text-white"
                style={{ backgroundColor: b.accent, color: '#0E0E11' }}
              >
                {b.companyName} — Active runs
              </div>
            </div>

            {/* Mock email */}
            <div
              className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
              data-testid="preview-email"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
                <Mail className="h-3 w-3" aria-hidden="true" />
                Email header
              </div>
              <div className="mt-2 flex items-center gap-2">
                {b.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoDataUrl} alt="logo" className="h-5 w-5 rounded" />
                ) : (
                  <div
                    className="h-5 w-5 rounded text-[10px] font-bold text-white flex items-center justify-center"
                    style={{ backgroundColor: b.primary }}
                  >
                    {b.companyName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-xs font-semibold" style={{ color: b.primary }}>
                  {b.emailFromName}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                From: {b.emailFromName} &lt;{b.emailReplyTo}&gt;
              </p>
            </div>

            {/* Custom domain */}
            {b.customDomain ? (
              <button
                type="button"
                onClick={() => onCopy(b.customDomain)}
                className="mt-3 flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-left text-[var(--text-xs)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                data-testid="preview-domain-copy"
              >
                <span className="flex items-center gap-2">
                  <Globe className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
                  {b.customDomain}
                </span>
                {copied === b.customDomain ? (
                  <Check className="h-3 w-3 text-[var(--accent-emerald)]" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden="true" />
                )}
              </button>
            ) : null}

            {b.customCss.trim().length > 0 ? (
              <div
                className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
                data-testid="preview-css"
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
                  <Code2 className="h-3 w-3" aria-hidden="true" />
                  Custom CSS preview
                </div>
                <pre className="mt-2 max-h-24 overflow-auto rounded bg-[var(--bg-surface)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">
                  {b.customCss}
                </pre>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Image upload ---------------- */

interface ImageUploadProps {
  label: string;
  testId: string;
  value: string | null;
  onChange: (v: string | null) => void;
}

function ImageUpload({ label, testId, value, onChange }: ImageUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[var(--text-sm)] text-[var(--fg-primary)]">{label}</Label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex h-24 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-inset)] px-3 text-[var(--text-xs)] text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-primary)]/40 hover:text-[var(--accent-primary)]',
        )}
        data-testid={testId}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full max-h-20 w-auto rounded object-contain" />
        ) : (
          <>
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Click to upload
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(reader.result as string);
          reader.readAsDataURL(file);
        }}
        data-testid={`${testId}-input`}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="self-start text-[11px] text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--accent-rose)] hover:underline"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

/* ---------------- Color row ---------------- */

interface ColorRowProps {
  testId: string;
  value: string;
  onChange: (v: string) => void;
}

const PRESETS = ['#6366F1', '#22D3EE', '#10B981', '#F59E0B', '#A855F7', '#F43F5E'];

function ColorRow({ testId, value, onChange }: ColorRowProps) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      {PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Set color to ${c}`}
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-all',
            value.toLowerCase() === c.toLowerCase()
              ? 'border-[var(--fg-primary)] scale-110'
              : 'border-transparent hover:scale-105',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 cursor-pointer rounded-full border border-[var(--border-subtle)] bg-transparent"
        aria-label="Custom color"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-24 rounded-md border border-input bg-transparent px-2 font-mono text-[11px]"
        data-testid={`${testId}-hex`}
      />
      <Upload className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
    </div>
  );
}

/* ---------------- Field ---------------- */

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[var(--text-sm)] text-[var(--fg-primary)]">
        {label}
      </Label>
      {children}
    </div>
  );
}
