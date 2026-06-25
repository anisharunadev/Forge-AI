'use client';

/**
 * `<PersonaMemoryPanel>` — the persona-keyed memory surface for
 * `/persona` (Forge AI-440 / Pillar 1 Phase 3).
 *
 * Renders three regions:
 *
 *   1. The stable Markdown body for the persona's memory slot
 *      (e.g. `developer/coding.md`). Rendered as raw text in a `<pre>`
 *      block — `react-markdown` is not in `apps/forge/package.json`
 *      and the task brief explicitly allows the `<pre>` fallback.
 *   2. The "Recent entries" append log — last 24h of writes from
 *      `persona_memory_history`. Each entry shows the timestamp + the
 *      Markdown body in a small `<article>` so operators can audit
 *      recent changes without leaving the page.
 *   3. An append textarea + submit button wired to
 *      `useAppendPersonaMemory(persona, key)`.
 *
 * Data-testids:
 *   - `persona-memory-panel`              — the panel root.
 *   - `persona-memory-body`               — the body `<pre>`.
 *   - `persona-memory-append-textarea`    — the append textarea.
 *   - `persona-memory-append-submit`      — the submit button.
 *   - `persona-memory-recent-entries`     — the recent entries section.
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppendPersonaMemory } from '@/lib/hooks/usePersonaMemory';
import type { PersonaMemoryEntry } from '@/lib/persona/data';

export interface PersonaMemoryPanelProps {
  readonly persona: string;
  /**
   * The persona-keyed memory slot — one of the six canonical keys
   * (`coding`, `architecture`, `security`, `ideation`, `qa`, `devops`).
   * Named `memoryKey` instead of `key` so React's reserved `key` prop
   * is not shadowed.
   */
  readonly memoryKey: string;
  readonly initialBody: string;
  readonly initialRecentEntries: ReadonlyArray<PersonaMemoryEntry>;
}

const FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return FORMATTER.format(parsed);
}

/**
 * Decide whether the supplied timestamp falls within the last 24 hours.
 *
 * The append log is intentionally capped at 24h on the server (the
 * `persona_memory_history` table holds every write ever; the API
 * filters by `written_at >= now() - interval '24 hours'`). Defensive
 * client-side filter so a stale clock or a misconfigured server still
 * keeps the section clean.
 */
function isWithinLast24h(iso: string, now: number): boolean {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return false;
  return now - parsed <= 24 * 60 * 60 * 1000;
}

export function PersonaMemoryPanel({
  persona,
  memoryKey,
  initialBody,
  initialRecentEntries,
}: PersonaMemoryPanelProps) {
  const [draft, setDraft] = React.useState('');
  const [body, setBody] = React.useState(initialBody);
  const [recentEntries, setRecentEntries] = React.useState<
    ReadonlyArray<PersonaMemoryEntry>
  >(initialRecentEntries);

  const appendMutation = useAppendPersonaMemory(persona, memoryKey);

  // After a successful append the query cache invalidates and the
  // parent re-mounts with fresh `initialBody` / `initialRecentEntries`.
  // We also push the just-written entry into the local list so the
  // operator sees their own write appear immediately.
  React.useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

  React.useEffect(() => {
    setRecentEntries(initialRecentEntries);
  }, [initialRecentEntries]);

  const now = React.useMemo(() => Date.now(), []);
  const last24h = React.useMemo(
    () => recentEntries.filter((entry) => isWithinLast24h(entry.written_at, now)),
    [recentEntries, now],
  );

  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !appendMutation.isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    const optimisticEntry: PersonaMemoryEntry = {
      written_at: new Date().toISOString(),
      entry_md: trimmedDraft,
    };

    void appendMutation
      .mutateAsync({ entry_md: trimmedDraft })
      .then(() => {
        setRecentEntries((entries) => [optimisticEntry, ...entries]);
        setDraft('');
      })
      .catch(() => {
        /* keep the draft so the operator can retry; mutation.isError
         * surfaces the message below. */
      });
  };

  return (
    <section
      className="flex flex-col gap-6 rounded-lg border border-forge-700/60 bg-forge-900/40 p-6"
      data-testid="persona-memory-panel"
      aria-label={`Persona memory: ${persona} / ${memoryKey}`}
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Persona memory
        </p>
        <h2 className="text-lg font-semibold">
          {persona} <span className="text-forge-400">/ {memoryKey}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Shared across every user of the same persona in this tenant.
          Org Knowledge — never per-user.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Stable memory</h3>
        <pre
          data-testid="persona-memory-body"
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-forge-700/60 bg-forge-950/60 p-4 text-xs leading-relaxed text-forge-100"
        >
          {body || '(empty — start by adding an entry below)'}
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Recent entries (last 24h)</h3>
        <div
          data-testid="persona-memory-recent-entries"
          className="flex flex-col gap-2"
        >
          {last24h.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No entries in the last 24 hours.
            </p>
          ) : (
            last24h.map((entry, index) => (
              <article
                key={`${entry.written_at}-${index}`}
                className="rounded-md border border-forge-700/60 bg-forge-950/40 p-3 text-xs"
              >
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-forge-400">
                  {formatTimestamp(entry.written_at)}
                </p>
                <p className="whitespace-pre-wrap text-forge-100">
                  {entry.entry_md}
                </p>
              </article>
            ))
          )}
        </div>
      </div>

      <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
        <label
          htmlFor="persona-memory-append-textarea"
          className="text-sm font-semibold"
        >
          Append a Markdown entry
        </label>
        <Textarea
          id="persona-memory-append-textarea"
          data-testid="persona-memory-append-textarea"
          aria-label="Append a Markdown entry to persona memory"
          placeholder="e.g. `ADR-008` requires TLS 1.2+ for all connector callbacks."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          disabled={appendMutation.isPending}
        />
        {appendMutation.isError ? (
          <p
            className="text-xs text-destructive"
            role="alert"
            data-testid="persona-memory-append-error"
          >
            {appendMutation.error?.message ?? 'Failed to append entry.'}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            data-testid="persona-memory-append-submit"
            disabled={!canSubmit}
            aria-label="Append persona memory entry"
          >
            {appendMutation.isPending ? 'Appending…' : 'Append entry'}
          </Button>
        </div>
      </form>
    </section>
  );
}