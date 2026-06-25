/**
 * `/persona` — server component that renders the persona-keyed
 * memory panel for the persona stored in the `forge.persona` cookie
 * (Forge AI-440 / Pillar 1 Phase 3).
 *
 * The cookie is read via `next/headers`' `cookies()` (server-only).
 * If the cookie is absent the page renders a hint to set it via the
 * `<PersonaSetForm>` rather than forcing a redirect — the user may
 * not have set a persona yet, and a hard redirect would silently
 * break tab refreshes.
 *
 * Initial memory data is fetched server-side via
 * `readPersonaMemory('coding')` so the panel renders with content on
 * the first paint; the client-side `usePersonaMemory` hook then takes
 * over for live updates + invalidation on append.
 */

import { cookies } from 'next/headers';

import { AdminShell } from '@/components/admin/AdminShell';
import { PersonaMemoryPanel } from '@/components/persona/PersonaMemoryPanel';
import {
  FORGE_PERSONA_COOKIE,
  FORGE_PERSONA_DEFAULT,
} from '@/middleware';
import {
  readPersonaMemory,
  type PersonaMemoryEntry,
} from '@/lib/persona/data';

export const dynamic = 'force-dynamic';

interface PersonaPageData {
  readonly persona: string;
  readonly body: string;
  readonly recentEntries: ReadonlyArray<PersonaMemoryEntry>;
}

async function loadPersonaMemory(persona: string): Promise<PersonaPageData> {
  // The Phase 3 panel renders the `coding` memory slot by default —
  // matches the most common persona entry point and keeps the page
  // copy stable across personas. Future: a persona-aware sidebar
  // could expand to all six slots (coding / architecture / security
  // / ideation / qa / devops).
  try {
    const memory = await readPersonaMemory('coding');
    return {
      persona,
      body: memory.body,
      recentEntries: memory.recent_entries,
    };
  } catch {
    // Orchestrator unreachable / no memory yet — render the panel
    // with an empty body so the operator can still append.
    return { persona, body: '', recentEntries: [] };
  }
}

function readPersonaCookie(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function PersonaPage() {
  const cookieStore = await cookies();
  const cookiePersona = readPersonaCookie(
    cookieStore.get(FORGE_PERSONA_COOKIE)?.value,
  );

  if (!cookiePersona) {
    return (
      <AdminShell>
        <div
          className="mx-auto flex max-w-2xl flex-col gap-4 rounded-lg border border-forge-700/60 bg-forge-900/40 p-6"
          data-testid="persona-no-cookie-hint"
        >
          <h1 className="text-lg font-semibold">No persona set</h1>
          <p className="text-sm text-muted-foreground">
            Persona memory is shared across every user of the same
            persona in this tenant. Set a persona to start writing
            shared notes.
          </p>
          <p className="text-xs text-forge-400">
            The default persona is{' '}
            <code className="rounded bg-forge-800 px-1 py-0.5">
              {FORGE_PERSONA_DEFAULT}
            </code>{' '}
            — it will be applied automatically once any request carries
            a <code>forge.persona</code> cookie.
          </p>
          <form
            action="/api/persona"
            method="post"
            className="flex items-center gap-2"
          >
            <input
              name="persona"
              type="text"
              placeholder="developer"
              aria-label="Persona name"
              className="rounded-md border border-forge-700 bg-forge-950 px-3 py-1.5 text-sm"
              data-testid="persona-input"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              data-testid="persona-submit"
            >
              Set persona
            </button>
          </form>
        </div>
      </AdminShell>
    );
  }

  const data = await loadPersonaMemory(cookiePersona);

  return (
    <AdminShell>
      <div
        className="mx-auto flex max-w-3xl flex-col gap-6"
        data-testid="persona-page"
      >
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Persona
          </p>
          <h1 className="text-2xl font-semibold">{data.persona}</h1>
          <p className="text-sm text-muted-foreground">
            Showing the <code>coding</code> memory slot. Switch the{' '}
            <code>forge.persona</code> cookie to render a different
            persona&apos;s notes.
          </p>
        </header>
        <PersonaMemoryPanel
          persona={data.persona}
          memoryKey="coding"
          initialBody={data.body}
          initialRecentEntries={data.recentEntries}
        />
      </div>
    </AdminShell>
  );
}