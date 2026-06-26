'use client';

/**
 * Settings — SSO tab (Step-47 Enterprise section).
 *
 * Shows current SSO status (or "not configured"). A multi-step
 * wizard configures the IdP (provider → IdP details → attribute
 * mapping → JIT/SCIM provisioning → test → enable → force SSO).
 *
 * IP allowlist and session policies sit in collapsible sections
 * below the wizard.
 */

import * as React from 'react';
import {
  ShieldCheck,
  ShieldOff,
  Plus,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Provider = 'saml' | 'oidc' | 'google' | 'okta' | 'azure' | 'custom';

interface SSOConfig {
  enabled: boolean;
  provider: Provider;
  ssoUrl: string;
  entityId: string;
  certificate: string;
  mapping: { email: string; name: string; role: string };
  provisioning: 'jit' | 'scim';
  forceSso: boolean;
  ipAllowlist: ReadonlyArray<string>;
  session: { timeout: '1h' | '8h' | '24h' | '7d'; idle: '15m' | '1h' | '4h' | '1d' };
}

const DEFAULTS: SSOConfig = {
  enabled: false,
  provider: 'saml',
  ssoUrl: '',
  entityId: '',
  certificate: '',
  mapping: { email: 'user.email', name: 'user.name', role: 'user.role' },
  provisioning: 'jit',
  forceSso: false,
  ipAllowlist: [],
  session: { timeout: '24h', idle: '1h' },
};

const STORAGE_KEY = 'forge.sso.v1';

function loadConfig(): SSOConfig {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SSOConfig>) };
  } catch {
    return DEFAULTS;
  }
}

const PROVIDERS: ReadonlyArray<{ id: Provider; label: string }> = [
  { id: 'saml', label: 'SAML 2.0' },
  { id: 'oidc', label: 'OIDC' },
  { id: 'google', label: 'Google Workspace' },
  { id: 'okta', label: 'Okta' },
  { id: 'azure', label: 'Azure AD' },
  { id: 'custom', label: 'Custom' },
];

const STEPS = [
  { id: 'provider', label: 'Choose provider' },
  { id: 'idp', label: 'Identity provider setup' },
  { id: 'mapping', label: 'Attribute mapping' },
  { id: 'provisioning', label: 'User provisioning' },
  { id: 'test', label: 'Test with one user' },
  { id: 'enable', label: 'Enable for all users' },
  { id: 'force', label: 'Force SSO' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function SSOTab() {
  const [config, setConfig] = React.useState<SSOConfig>(DEFAULTS);
  const [step, setStep] = React.useState<StepId>('provider');
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [ipDraft, setIpDraft] = React.useState('');
  const [policyOpen, setPolicyOpen] = React.useState(false);

  React.useEffect(() => {
    setConfig(loadConfig());
  }, []);

  const update = (patch: Partial<SSOConfig>) =>
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });

  const currentIdx = STEPS.findIndex((s) => s.id === step);
  const canNext =
    (step === 'provider' && true) ||
    (step === 'idp' && config.ssoUrl.length > 0 && config.entityId.length > 0) ||
    step === 'mapping' ||
    step === 'provisioning' ||
    step === 'test' ||
    step === 'enable' ||
    step === 'force';

  return (
    <div className="flex flex-col gap-6" data-testid="sso-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Single Sign-On
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Connect an identity provider so your team signs in with the same credentials they use
            for email and other internal tools.
          </p>
        </div>
        <Button
          variant={wizardOpen ? 'outline' : 'default'}
          onClick={() => setWizardOpen((o) => !o)}
          data-testid="sso-toggle-wizard"
        >
          {wizardOpen ? 'Close wizard' : 'Configure SSO'}
        </Button>
      </header>

      <CurrentStatusCard
        config={config}
        onDisable={() => update({ enabled: false, forceSso: false })}
      />

      {wizardOpen ? (
        <SSOWizard
          config={config}
          step={step}
          setStep={setStep}
          update={update}
          currentIdx={currentIdx}
          canNext={!!canNext}
        />
      ) : null}

      <IPAllowlistCard
        allowlist={config.ipAllowlist}
        draft={ipDraft}
        setDraft={setIpDraft}
        onAdd={() => {
          const v = ipDraft.trim();
          if (!v) return;
          update({ ipAllowlist: [...config.ipAllowlist, v] });
          setIpDraft('');
        }}
        onRemove={(i) =>
          update({ ipAllowlist: config.ipAllowlist.filter((_, idx) => idx !== i) })
        }
      />

      <SessionPoliciesCard
        session={config.session}
        onChange={(patch) => update({ session: { ...config.session, ...patch } })}
        open={policyOpen}
        onToggle={() => setPolicyOpen((o) => !o)}
      />
    </div>
  );
}

/* ---------------- Current status ---------------- */

function CurrentStatusCard({
  config,
  onDisable,
}: {
  config: SSOConfig;
  onDisable: () => void;
}) {
  const providerLabel = PROVIDERS.find((p) => p.id === config.provider)?.label ?? '—';
  return (
    <section
      className={cn(
        'rounded-[var(--radius-lg)] border p-5',
        config.enabled
          ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/5'
          : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
      )}
      data-testid="sso-status-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {config.enabled ? (
            <ShieldCheck
              className="mt-0.5 h-5 w-5 text-[var(--accent-emerald)]"
              aria-hidden="true"
            />
          ) : (
            <ShieldOff
              className="mt-0.5 h-5 w-5 text-[var(--fg-tertiary)]"
              aria-hidden="true"
            />
          )}
          <div className="flex flex-col">
            <span className="text-[var(--text-base)] font-semibold text-[var(--fg-primary)]">
              {config.enabled ? `SSO is active via ${providerLabel}` : 'SSO is not configured'}
            </span>
            <span className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
              {config.enabled
                ? config.forceSso
                  ? 'Password login is disabled for all users.'
                  : 'Users can sign in with SSO or password.'
                : 'Run the wizard to connect your identity provider.'}
            </span>
          </div>
        </div>
        {config.enabled ? (
          <Button variant="outline" size="sm" onClick={onDisable} data-testid="sso-disable">
            Disable SSO
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------- Wizard ---------------- */

interface WizardProps {
  config: SSOConfig;
  step: StepId;
  setStep: (s: StepId) => void;
  update: (patch: Partial<SSOConfig>) => void;
  currentIdx: number;
  canNext: boolean;
}

function SSOWizard({ config, step, setStep, update, currentIdx, canNext }: WizardProps) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
      data-testid="sso-wizard"
    >
      <div className="flex items-center gap-2 overflow-x-auto pb-4" data-testid="sso-wizard-steps">
        {STEPS.map((s, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => idx <= currentIdx && setStep(s.id)}
                disabled={idx > currentIdx}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors',
                  done && 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
                  active && 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
                  !done && !active && 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                )}
                data-testid={`sso-step-${s.id}`}
              >
                {done ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Circle className="h-3 w-3" aria-hidden="true" />
                )}
                {s.label}
              </button>
              {idx < STEPS.length - 1 ? (
                <ArrowRight className="h-3 w-3 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-5">
        {step === 'provider' ? (
          <div className="flex flex-col gap-3">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              Choose your identity provider
            </span>
            <div className="grid gap-2 sm:grid-cols-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ provider: p.id })}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors',
                    config.provider === p.id
                      ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                  )}
                  data-testid={`sso-provider-${p.id}`}
                >
                  <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'idp' ? (
          <div className="grid gap-3">
            <Field label="SSO URL" htmlFor="sso-url">
              <Input
                id="sso-url"
                value={config.ssoUrl}
                onChange={(e) => update({ ssoUrl: e.target.value })}
                placeholder="https://idp.example.com/sso"
                data-testid="sso-url-input"
              />
            </Field>
            <Field label="Entity ID" htmlFor="sso-entity">
              <Input
                id="sso-entity"
                value={config.entityId}
                onChange={(e) => update({ entityId: e.target.value })}
                placeholder="urn:forge:acme"
                data-testid="sso-entity-input"
              />
            </Field>
            <Field label="X.509 certificate" htmlFor="sso-cert">
              <textarea
                id="sso-cert"
                value={config.certificate}
                onChange={(e) => update({ certificate: e.target.value })}
                rows={3}
                placeholder="-----BEGIN CERTIFICATE-----"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="sso-cert-input"
              />
            </Field>
            <Button variant="outline" size="sm" className="self-start" data-testid="sso-test-connection">
              Test connection
            </Button>
          </div>
        ) : null}

        {step === 'mapping' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email →" htmlFor="map-email">
              <Input
                id="map-email"
                value={config.mapping.email}
                onChange={(e) =>
                  update({ mapping: { ...config.mapping, email: e.target.value } })
                }
                data-testid="sso-map-email"
              />
            </Field>
            <Field label="Name →" htmlFor="map-name">
              <Input
                id="map-name"
                value={config.mapping.name}
                onChange={(e) =>
                  update({ mapping: { ...config.mapping, name: e.target.value } })
                }
                data-testid="sso-map-name"
              />
            </Field>
            <Field label="Role →" htmlFor="map-role">
              <Input
                id="map-role"
                value={config.mapping.role}
                onChange={(e) =>
                  update({ mapping: { ...config.mapping, role: e.target.value } })
                }
                data-testid="sso-map-role"
              />
            </Field>
          </div>
        ) : null}

        {step === 'provisioning' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(['jit', 'scim'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => update({ provisioning: p })}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors',
                  config.provisioning === p
                    ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                )}
                data-testid={`sso-provisioning-${p}`}
              >
                <span className="text-[var(--text-sm)] font-medium uppercase tracking-wider text-[var(--fg-primary)]">
                  {p === 'jit' ? 'JIT (Just-In-Time)' : 'SCIM'}
                </span>
                <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                  {p === 'jit'
                    ? 'Users are created the first time they sign in via SSO.'
                    : 'Sync users and groups continuously from your IdP.'}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 'test' ? (
          <div className="flex flex-col gap-3">
            <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
              Send a test sign-in to one user to validate attribute mapping and IdP connectivity
              before enabling.
            </p>
            <Field label="Test user email" htmlFor="sso-test-email">
              <Input
                id="sso-test-email"
                type="email"
                placeholder="you@acme.com"
                data-testid="sso-test-email"
              />
            </Field>
            <Button className="self-start" data-testid="sso-run-test">
              Send test sign-in
            </Button>
          </div>
        ) : null}

        {step === 'enable' ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                Enable for all users
              </span>
              <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                All existing members will be required to sign in with SSO on next session.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
              data-testid="sso-enable-toggle"
            />
          </div>
        ) : null}

        {step === 'force' ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                Force SSO (disable password login)
              </span>
              <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                Personal access tokens still work. Only the web sign-in form is disabled.
              </p>
            </div>
            <Switch
              checked={config.forceSso}
              onCheckedChange={(v) => update({ forceSso: v })}
              data-testid="sso-force-toggle"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            const prev = STEPS[Math.max(0, currentIdx - 1)];
            if (prev) setStep(prev.id);
          }}
          disabled={currentIdx === 0}
          data-testid="sso-step-prev"
        >
          Back
        </Button>
        <Button
          onClick={() => {
            const next = STEPS[Math.min(STEPS.length - 1, currentIdx + 1)];
            if (next) setStep(next.id);
          }}
          disabled={!canNext}
          data-testid="sso-step-next"
        >
          {currentIdx === STEPS.length - 1 ? 'Finish' : 'Continue'}
        </Button>
      </div>
    </section>
  );
}

/* ---------------- IP Allowlist ---------------- */

interface IPAllowlistProps {
  allowlist: ReadonlyArray<string>;
  draft: string;
  setDraft: (s: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}

function IPAllowlistCard({ allowlist, draft, setDraft, onAdd, onRemove }: IPAllowlistProps) {
  const [open, setOpen] = React.useState(false);
  const [blockUnknown, setBlockUnknown] = React.useState(false);
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="sso-ip-allowlist"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
        aria-expanded={open}
        data-testid="sso-ip-allowlist-toggle"
      >
        <div className="flex flex-col">
          <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
            IP allowlist
          </h3>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Restrict SSO sign-ins to known IP ranges (CIDR notation).
          </p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-[var(--fg-secondary)] transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="border-t border-[var(--border-subtle)] p-5">
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="192.168.1.0/24"
              className="flex-1"
              data-testid="sso-ip-input"
            />
            <Button onClick={onAdd} data-testid="sso-ip-add">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add range
            </Button>
          </div>
          {allowlist.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {allowlist.map((cidr, i) => (
                <li
                  key={cidr}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 font-mono text-[11px] text-[var(--fg-secondary)]"
                  data-testid={`sso-ip-${i}`}
                >
                  {cidr}
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)]"
                    aria-label={`Remove ${cidr}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
            <div>
              <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                Block unrecognized IPs
              </span>
              <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                Reject any sign-in from an IP outside the allowlist above.
              </p>
            </div>
            <Switch
              checked={blockUnknown}
              onCheckedChange={setBlockUnknown}
              data-testid="sso-block-unknown"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- Session Policies ---------------- */

interface SessionPoliciesProps {
  session: SSOConfig['session'];
  onChange: (patch: Partial<SSOConfig['session']>) => void;
  open: boolean;
  onToggle: () => void;
}

function SessionPoliciesCard({ session, onChange, open, onToggle }: SessionPoliciesProps) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="sso-session"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
        aria-expanded={open}
        data-testid="sso-session-toggle"
      >
        <div className="flex flex-col">
          <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
            Session policies
          </h3>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Idle timeout and absolute session length for SSO users.
          </p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-[var(--fg-secondary)] transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-[var(--border-subtle)] p-5 sm:grid-cols-2">
          <Field label="Session timeout" htmlFor="sess-timeout">
            <Segmented
              id="sess-timeout"
              value={session.timeout}
              options={[
                { v: '1h', label: '1h' },
                { v: '8h', label: '8h' },
                { v: '24h', label: '24h' },
                { v: '7d', label: '7d' },
              ]}
              onChange={(v) => onChange({ timeout: v as SSOConfig['session']['timeout'] })}
              testIdPrefix="sess-timeout"
            />
          </Field>
          <Field label="Idle timeout" htmlFor="sess-idle">
            <Segmented
              id="sess-idle"
              value={session.idle}
              options={[
                { v: '15m', label: '15m' },
                { v: '1h', label: '1h' },
                { v: '4h', label: '4h' },
                { v: '1d', label: '1d' },
              ]}
              onChange={(v) => onChange({ idle: v as SSOConfig['session']['idle'] })}
              testIdPrefix="sess-idle"
            />
          </Field>
          <Button
            variant="outline"
            className="sm:col-span-2"
            data-testid="sso-sign-out-all"
          >
            Sign out all sessions
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- Field helper ---------------- */

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

interface SegmentedProps<T extends string> {
  id: string;
  value: T;
  options: ReadonlyArray<{ v: T; label: string }>;
  onChange: (v: T) => void;
  testIdPrefix: string;
}

function Segmented<T extends string>({ value, options, onChange, testIdPrefix }: SegmentedProps<T>) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'inline-flex h-8 items-center rounded-md border px-3 text-[var(--text-xs)] font-medium transition-colors',
            value === o.v
              ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
          )}
          data-testid={`${testIdPrefix}-${o.v}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
