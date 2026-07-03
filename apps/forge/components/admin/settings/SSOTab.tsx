'use client';

/**
 * Settings — SSO tab (Step-47 Enterprise section).
 *
 * step 73: SSO is read-only. Configure via OIDC_* env vars. The backend
 * exposes a `SsoConfig` (provider, issuer, client_id, scopes, enabled)
 * derived from env. Future step will add a tenant-scoped POST endpoint.
 */

import * as React from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSsoConfig } from '@/lib/hooks/useSettings';

export function SSOTab() {
  const ssoQ = useSsoConfig();
  const cfg = ssoQ.data;

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
      </header>

      {/* step 73: SSO is read-only. Configure via OIDC_* env vars. */}
      <div
        className="rounded-[var(--radius-md)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 px-4 py-3 text-[var(--text-sm)] text-[var(--fg-secondary)]"
        data-testid="sso-readonly-banner"
      >
        SSO configuration is environment-driven (OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_SCOPES).
        Editing here is disabled in this release. Pending step-74 for tenant-scoped overrides.
      </div>

      <section
        className={cn(
          'rounded-[var(--radius-lg)] border p-5',
          cfg?.enabled
            ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/5'
            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
        )}
        data-testid="sso-status-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {cfg?.enabled ? (
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
            <div className="flex flex-col gap-1">
              <span className="text-[var(--text-base)] font-semibold text-[var(--fg-primary)]">
                {cfg?.enabled
                  ? `SSO is active via ${cfg.provider}`
                  : 'SSO is not configured'}
              </span>
              <span className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
                {cfg?.enabled
                  ? 'Users can sign in via the configured identity provider.'
                  : 'Set OIDC_* env vars and restart the backend to enable SSO.'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        data-testid="sso-config-card"
      >
        <header className="pb-4">
          <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
            Identity provider
          </h3>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
            These values are read from the environment and cannot be changed here.
          </p>
        </header>

        <dl className="grid gap-4 sm:grid-cols-2" data-testid="sso-config-fields">
          <ConfigField label="Provider" value={cfg?.provider ?? '—'} testId="sso-field-provider" />
          <ConfigField label="Issuer" value={cfg?.issuer ?? '—'} testId="sso-field-issuer" />
          <ConfigField label="Client ID" value={cfg?.clientId ?? '—'} testId="sso-field-client" />
          <ConfigField
            label="Enabled"
            value={cfg?.enabled ? 'Yes' : 'No'}
            testId="sso-field-enabled"
          />
          <div className="sm:col-span-2">
            <dt className="text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Scopes
            </dt>
            <dd className="mt-1 flex flex-wrap gap-2" data-testid="sso-field-scopes">
              {cfg?.scopes?.length
                ? cfg.scopes.map((s) => (
                    <span
                      key={s}
                      className="inline-flex h-5 items-center rounded-full bg-[var(--bg-inset)] px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]"
                    >
                      {s}
                    </span>
                  ))
                : <span className="text-[var(--text-sm)] text-[var(--fg-tertiary)]">—</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* IP allowlist + session policies UI shells retained as disabled placeholders. */}
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        data-testid="sso-ip-allowlist"
      >
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          IP allowlist
        </h3>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Restrict SSO sign-ins to known IP ranges (CIDR notation).
        </p>
        <p className="mt-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]" data-testid="sso-ip-pending">
          // pending step-74
        </p>
      </section>

      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        data-testid="sso-session"
      >
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          Session policies
        </h3>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Idle timeout and absolute session length for SSO users.
        </p>
        <p className="mt-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]" data-testid="sso-session-pending">
          // pending step-74
        </p>
      </section>
    </div>
  );
}

/* ---------------- Read-only config field ---------------- */

function ConfigField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div>
      <dt className="text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd
        className="mt-1 font-mono text-[var(--text-sm)] text-[var(--fg-primary)]"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}
