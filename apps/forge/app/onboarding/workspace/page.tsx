'use client';

/**
 * /onboarding/workspace — step-61 Zone 6.
 *
 * The "Create new workspace" CTA in the ``TenantSwitcher`` links
 * here. The form posts to ``POST /tenants`` and, on success, calls
 * ``POST /tenants/{id}/switch`` to mint a fresh access token and
 * reload the page so every TanStack Query / Zustand store keyed on
 * tenant-id refetches against the new tenant.
 *
 * Skill rules applied:
 *   - Rule 15 (empty states): the form has explicit value-prop copy
 *     + cancel + submit; not a bare "Create".
 *   - Rule 16 (wizard): name→slug auto-derive keeps the cognitive
 *     load to "type a name" instead of two fields.
 *   - Rule 18 (docs): referenced by the "Create workspace" docs
 *     page under ``docs-site/src/content/docs/``.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Loader2,
  Sparkles,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api/client';
import { useAuth, type Tenant } from '@/lib/api/auth';
import { toast } from 'sonner';

const REGIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU West (Ireland)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
];

const PLANS: ReadonlyArray<{
  value: 'free' | 'pro' | 'enterprise';
  label: string;
  desc: string;
}> = [
  { value: 'free', label: 'Free', desc: 'Up to 5 users, $50/mo LLM spend' },
  { value: 'pro', label: 'Pro', desc: 'Up to 50 users, $500/mo LLM spend' },
  {
    value: 'enterprise',
    label: 'Enterprise',
    desc: 'Unlimited users, custom spend',
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export default function CreateWorkspacePage() {
  const router = useRouter();
  const { switchTenant } = useAuth();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [region, setRegion] = React.useState('us-east-1');
  const [plan, setPlan] = React.useState<'free' | 'pro' | 'enterprise'>('pro');
  const [submitting, setSubmitting] = React.useState(false);

  // Auto-derive slug from the name until the user edits the slug
  // manually. Once they've typed in the slug field we leave it alone.
  React.useEffect(() => {
    if (slugTouched) return;
    setSlug(slugify(name));
  }, [name, slugTouched]);

  const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
  const slugError =
    slug.length === 0
      ? 'Slug is required.'
      : !slugPattern.test(slug)
        ? 'Use lowercase letters, digits, and dashes only.'
        : null;
  const nameError = name.trim().length < 2 ? 'Name must be at least 2 characters.' : null;
  const canSubmit = !slugError && !nameError && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const created = await api.post<Tenant>('/tenants', {
        name: name.trim(),
        slug,
        region,
        plan,
      });

      toast.success(`Workspace "${created.name}" created`);

      // Switch to the new tenant — this mints a fresh access token
      // and reloads the page so every tenant-scoped query refetches.
      // The reload is intentional (documented in TenantSwitcher).
      await switchTenant(created.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(`Slug "${slug}" is already taken — try another`);
      } else if (err instanceof ApiError) {
        toast.error(`Could not create workspace: ${err.message}`);
      } else {
        toast.error(
          `Could not create workspace: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6"
      data-testid="create-workspace-page"
    >
      <header className="space-y-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-sm"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          Onboarding
        </div>
        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--fg-primary)',
            lineHeight: 1.2,
          }}
        >
          Create your workspace
        </h1>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          A workspace holds your projects, agents, connectors, and audit
          logs. You can create more later from the top-bar switcher.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-[var(--radius-lg)] border p-6"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
        data-testid="create-workspace-form"
      >
        <div className="space-y-2">
          <Label htmlFor="ws-name">
            Workspace name
            <span
              aria-hidden="true"
              style={{ color: 'var(--accent-rose)', marginLeft: 4 }}
            >
              *
            </span>
          </Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            required
            autoFocus
            aria-invalid={Boolean(nameError && name.length > 0)}
            data-testid="workspace-name"
          />
          {nameError && name.length > 0 ? (
            <p
              role="alert"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--accent-rose)',
              }}
            >
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-slug">
            URL slug
            <span
              aria-hidden="true"
              style={{ color: 'var(--accent-rose)', marginLeft: 4 }}
            >
              *
            </span>
          </Label>
          <div
            className="flex items-center gap-2 rounded-md border px-2"
            style={{
              borderColor: 'var(--border-default)',
              background: 'var(--bg-elevated)',
            }}
          >
            <span
              className="font-mono text-xs"
              style={{ color: 'var(--fg-tertiary)' }}
            >
              forge.dev/
            </span>
            <Input
              id="ws-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="acme-corp"
              required
              aria-invalid={Boolean(slugError && slug.length > 0)}
              data-testid="workspace-slug"
              className="border-0 bg-transparent focus-visible:ring-0"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
            }}
          >
            Lowercase letters, digits, and dashes only.
          </p>
          {slugError && slug.length > 0 ? (
            <p
              role="alert"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--accent-rose)',
              }}
            >
              {slugError}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-region">Region</Label>
          <select
            id="ws-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="h-10 w-full rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-default)',
              color: 'var(--fg-primary)',
            }}
            data-testid="workspace-region"
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <Label>Plan</Label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {PLANS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPlan(p.value)}
                className="rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                style={{
                  background:
                    plan === p.value ? 'rgba(99,102,241,0.10)' : 'var(--bg-elevated)',
                  borderColor:
                    plan === p.value
                      ? 'var(--accent-primary)'
                      : 'var(--border-subtle)',
                }}
                data-testid={`plan-${p.value}`}
                aria-pressed={plan === p.value}
              >
                <div
                  className="flex items-center gap-2 font-semibold"
                  style={{ color: 'var(--fg-primary)' }}
                >
                  {p.label}
                  {p.value === 'pro' ? (
                    <Sparkles
                      className="h-3.5 w-3.5"
                      style={{ color: 'var(--accent-amber)' }}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <div
                  className="mt-1 text-xs"
                  style={{ color: 'var(--fg-tertiary)' }}
                >
                  {p.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex items-center justify-between border-t pt-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={submitting}
            data-testid="workspace-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            data-testid="workspace-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              <>
                Create workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}