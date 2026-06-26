'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  REGIONS,
  TIMEZONES,
  type TenantForm,
} from '@/lib/onboarding/data';

export interface StepTenantSetupProps {
  value: TenantForm;
  onChange: (next: TenantForm) => void;
  onBlur?: () => void;
}

/**
 * Step 1 — Tenant setup. Section title + 2-col field grid + divider +
 * two policy switches. Inline validation runs on blur (red border +
 * helper text) per the UX skill's "validate on blur" rule.
 */
export function StepTenantSetup({ value, onChange, onBlur }: StepTenantSetupProps) {
  const tenantNameError =
    value.tenantName.trim().length === 0
      ? 'Tenant name is required — it appears in URL paths.'
      : !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i.test(value.tenantName.trim())
        ? 'Use letters, digits, and dashes only (max 40 chars).'
        : null;
  const costCeilingNum = Number.parseFloat(value.costCeilingUsd);
  const costCeilingError =
    value.costCeilingUsd.trim().length === 0
      ? 'Cost ceiling is required.'
      : !Number.isFinite(costCeilingNum) || costCeilingNum <= 0
        ? 'Enter a positive amount.'
        : null;

  const showTenantNameError = tenantNameError != null && value.tenantName.length > 0;
  const showCostCeilingError =
    costCeilingError != null && value.costCeilingUsd.length > 0;

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-tenant-setup"
    >
      <header className="space-y-1">
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          Tenant setup
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Configure the tenant-level identity, region, and cost ceiling.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Tenant name"
          htmlFor="tenant-name"
          required
          error={showTenantNameError ? tenantNameError : null}
        >
          <Input
            id="tenant-name"
            value={value.tenantName}
            onChange={(e) => onChange({ ...value, tenantName: e.target.value })}
            onBlur={onBlur}
            placeholder="acme-corp"
            aria-invalid={showTenantNameError}
            aria-describedby="tenant-name-error"
            className={cn(
              'font-mono',
              showTenantNameError &&
                'border-[var(--accent-rose)] focus-visible:ring-[var(--accent-rose)]',
            )}
            data-testid="tenant-name"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </Field>

        <Field label="Region" htmlFor="tenant-region">
          <SearchableSelect
            id="tenant-region"
            value={value.region}
            options={REGIONS as unknown as string[]}
            onChange={(v) => onChange({ ...value, region: v })}
            placeholder="Search regions…"
          />
        </Field>

        <Field label="Default timezone" htmlFor="tenant-tz">
          <SearchableSelect
            id="tenant-tz"
            value={value.defaultTimezone}
            options={TIMEZONES as unknown as string[]}
            onChange={(v) => onChange({ ...value, defaultTimezone: v })}
            placeholder="Search timezones…"
          />
        </Field>

        <Field
          label="Cost ceiling"
          htmlFor="tenant-ceiling"
          required
          helper="Daily USD cap across all agents."
          error={showCostCeilingError ? costCeilingError : null}
          prefix="$"
          suffix="/day"
        >
          <Input
            id="tenant-ceiling"
            type="number"
            inputMode="decimal"
            min={0}
            step="10"
            value={value.costCeilingUsd}
            onChange={(e) =>
              onChange({ ...value, costCeilingUsd: e.target.value })
            }
            onBlur={onBlur}
            aria-invalid={showCostCeilingError}
            className={cn(
              'pl-7 pr-12',
              showCostCeilingError &&
                'border-[var(--accent-rose)] focus-visible:ring-[var(--accent-rose)]',
            )}
            data-testid="tenant-ceiling"
          />
        </Field>
      </div>

      <div
        className="my-2 h-px w-full"
        style={{ background: 'var(--border-subtle)' }}
        aria-hidden="true"
      />

      <div className="space-y-4">
        <ToggleRow
          id="tenant-sandbox"
          label="Enable sandbox runtimes"
          helper="Spin up ephemeral containers for untrusted code execution."
          checked={value.enableSandbox}
          onChange={(c) => onChange({ ...value, enableSandbox: c })}
        />
        <ToggleRow
          id="tenant-quarantine"
          label="Auto-quarantine unhealthy connectors"
          helper="When a connector fails health checks twice, isolate it for review."
          checked={value.enableQuarantine}
          onChange={(c) => onChange({ ...value, enableQuarantine: c })}
        />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Small field wrappers — Label + control + optional helper/error text.
 * ------------------------------------------------------------------------- */

function Field({
  label,
  htmlFor,
  required,
  helper,
  error,
  prefix,
  suffix,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  helper?: string;
  error?: string | null;
  prefix?: string;
  suffix?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={htmlFor}
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--fg-primary)',
        }}
      >
        {label}
        {required ? (
          <span
            aria-hidden="true"
            style={{ color: 'var(--accent-rose)', marginLeft: 4 }}
          >
            *
          </span>
        ) : null}
      </Label>
      <div className="relative">
        {prefix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-2 flex items-center"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {prefix}
          </span>
        ) : null}
        {children}
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
            }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--accent-rose)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          {error}
        </p>
      ) : helper ? (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-tertiary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  helper,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  helper: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label
          htmlFor={id}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--fg-primary)',
            cursor: 'pointer',
          }}
        >
          {label}
        </Label>
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-tertiary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          {helper}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        data-testid={id}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * SearchableSelect — Combobox-style picker for region/timezone. Uses the
 * native <datalist> + <input list> pairing for zero-dependency search.
 * ------------------------------------------------------------------------- */

function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = React.useState(value);
  const [open, setOpen] = React.useState(false);

  // Keep input synced if the parent updates `value` from elsewhere.
  React.useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: 'var(--fg-tertiary)' }}
          aria-hidden="true"
        />
        <input
          id={id}
          list={`${id}-list`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit the typed value back to the parent if it matches.
            // The blur timeout lets the click register on an option first.
            window.setTimeout(() => setOpen(false), 120);
            onChange(query);
          }}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-md border px-7 py-1.5 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-default)',
            color: 'var(--fg-primary)',
            fontFamily: 'var(--font-mono)',
          }}
          data-testid={id}
        />
        <datalist id={`${id}-list`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>
      {open && filtered.length > 0 ? (
        <ul
          role="listbox"
          aria-label={placeholder}
          className="thin-scrollbar absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border shadow-lg"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {filtered.slice(0, 50).map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(o);
                onChange(o);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-1.5 text-xs transition-colors hover:bg-[var(--hover)]"
              style={{
                color: 'var(--fg-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}