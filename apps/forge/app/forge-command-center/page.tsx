'use client';

/**
 * Forge Command Center — developer workbench.
 *
 * Three modes wired through the Zustand store:
 *   - Ticket  (default) — paste a Jira/GitHub/Linear ticket, AI
 *     orchestrates the SDLC pipeline end-to-end.
 *   - Spec    — full spec-driven workflow with editor + side panel.
 *   - Catalog — browse every forge-* skill grouped by GSD phase.
 *
 * Persistent overlays:
 *   - My Work drawer (right slide-in)
 *   - Command palette (⌘K)
 *   - Shortcuts panel (⌘/)
 *   - Phase execution drawer (live streaming + activity feed)
 *   - GSD phase widget (bottom-left beacon)
 *
 * Skill influence (per `.claude/design-system/`):
 *   - `02-typography.md` — Plus Jakarta / Inter for body, JetBrains
 *     Mono for IDs, hashes, and command names.
 *   - `03-color.md` — dark-mode OLED base, indigo primary, cyan
 *     accent for ticket flow, violet for AI suggestions.
 *   - `04-ux-guideline.md` — sequential heading levels (h1 → h2),
 *     accessible focus, no skipped levels.
 *   - `06-keyboard-ux.md` — focus rings, Esc closes dialogs,
 *     logical tab order.
 *   - `08-empty-ux.md` — first-run welcome with helpful actions.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';

import { CommandCenterHeader } from '@/components/command-center/CommandCenterHeader';
import { ModeSwitcher } from '@/components/command-center/ModeSwitcher';
import { TicketMode } from '@/components/command-center/TicketMode';
import { SpecMode } from '@/components/command-center/SpecMode';
import { CatalogMode } from '@/components/command-center/CatalogMode';
import { ForgeSkillPicker } from '@/components/forge-commands/ForgeSkillPicker';
import { MyWorkDrawer } from '@/components/command-center/MyWorkDrawer';
import { CommandPalette } from '@/components/command-center/CommandPalette';
import { ShortcutsPanel } from '@/components/command-center/ShortcutsPanel';
import { GsdPhaseWidget } from '@/components/command-center/GsdPhaseWidget';
import { PhaseExecutionDrawerConnector } from '@/components/command-center/PhaseExecutionDrawer';
import { FirstRunState } from '@/components/command-center/FirstRunState';
import { useCommandCenter } from '@/lib/command-center/store';
import { FORGE_PHASES } from '@/lib/forge-core/manifest';
import { SAMPLE_LIVE_RUNS, SAMPLE_TICKETS } from '@/lib/command-center/sample-data';

const ACTIVE_WORK_COUNT =
  SAMPLE_LIVE_RUNS.length +
  SAMPLE_TICKETS.filter(
    (t) => t.status === 'in-progress' || t.status === 'in-review',
  ).length;

const NOTIFICATION_COUNT = 2;

export default function ForgeCommandCenterPage() {
  const {
    mode,
    setMode,
    hasOnboarded,
    completeOnboarding,
    setMyWorkOpen,
    setCommandPaletteOpen,
    setShortcutsOpen,
    setExecutionOpen,
    setActivePhase,
    execution,
    executionOpen,
  } = useCommandCenter();

  /* ---------- Keyboard shortcuts ---------- */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K — command palette
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      // ⌘/ — shortcuts
      if (meta && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // ⌘T — new ticket (focus the input in Ticket mode)
      if (meta && (e.key === 't' || e.key === 'T') && !e.shiftKey) {
        e.preventDefault();
        setMode('ticket');
        window.setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>(
            '[data-testid="fcc-ticket-input-field"]',
          );
          el?.focus();
        }, 80);
        return;
      }
      // ⌘⇧S — new spec
      if (meta && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setMode('spec');
        toast.info('Spec wizard coming online', {
          description: 'Step 1: pick a source.',
        });
        return;
      }
      // ⌘R — run last command (no-op for now; placeholder for "last run" tracking)
      if (meta && (e.key === 'r' || e.key === 'R') && !e.shiftKey) {
        e.preventDefault();
        if (execution.status !== 'running') {
          setExecutionOpen(true);
          toast.info('No previous command queued');
        }
        return;
      }
      // ⌘⇧N — next phase
      if (meta && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const order = FORGE_PHASES.map((p) => p.id);
        const i = order.indexOf(useCommandCenter.getState().activePhase);
        const next = order[Math.min(order.length - 1, i + 1)];
        if (next) {
          setActivePhase(next);
          toast.success(`Active phase → ${next}`, { duration: 1500 });
        }
        return;
      }
      // ⌘⇧P — previous phase
      if (meta && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const order = FORGE_PHASES.map((p) => p.id);
        const i = order.indexOf(useCommandCenter.getState().activePhase);
        const prev = order[Math.max(0, i - 1)];
        if (prev) {
          setActivePhase(prev);
          toast.success(`Active phase → ${prev}`, { duration: 1500 });
        }
        return;
      }
      // ⌘M — toggle My Work
      if (meta && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setMyWorkOpen(true);
        return;
      }
      // ⌘E — toggle Phase Execution drawer
      if (meta && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setExecutionOpen(!executionOpen);
        return;
      }
      // ⌘1-7 — jump to phase (and ⌘1-3 — switch modes)
      if (meta && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const phase = FORGE_PHASES[idx];
        if (!phase) return;
        if (idx < 3) {
          setMode(['ticket', 'spec', 'catalog'][idx] as typeof mode);
          setActivePhase(phase.id);
        } else {
          setActivePhase(phase.id);
        }
      }
      // Esc — close any open panel (drawer first, then modals)
      if (e.key === 'Escape') {
        const s = useCommandCenter.getState();
        if (s.executionOpen) {
          setExecutionOpen(false);
          return;
        }
        if (s.commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (s.shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (s.myWorkOpen) {
          setMyWorkOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    setMode,
    setMyWorkOpen,
    setCommandPaletteOpen,
    setShortcutsOpen,
    setExecutionOpen,
    setActivePhase,
    execution.status,
    executionOpen,
  ]);

  const tenantLabel = 'acme-corp';

  return (
    <div
      className="mx-auto flex w-full max-w-[1600px] flex-col gap-6"
      data-testid="forge-command-center"
    >
      <CommandCenterHeader
        activeWorkCount={ACTIVE_WORK_COUNT}
        notificationCount={NOTIFICATION_COUNT}
        onOpenMyWork={() => setMyWorkOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        tenantLabel={tenantLabel}
        userInitials="AR"
      />

      {!hasOnboarded ? (
        <FirstRunState
          onPick={(m) => {
            completeOnboarding();
            setMode(m);
          }}
          onDismiss={completeOnboarding}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <ModeSwitcher value={mode} onChange={setMode} />
        <p className="hidden text-xs text-[var(--fg-tertiary)] lg:block">
          Tip: paste a ticket ID and Forge orchestrates the SDLC.{' '}
          <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono text-[10px]">
            ⌘K
          </kbd>{' '}
          for the palette.
        </p>
      </div>

      <AnimatePresence>
        <motion.section
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          aria-label={`${mode} mode`}
          data-testid={`fcc-mode-pane-${mode}`}
        >
          {mode === 'ticket' && <TicketMode />}
          {mode === 'spec' && <SpecMode />}
          {mode === 'catalog' && (
            <>
              <CatalogMode />
              <section
                aria-labelledby="forge-3-package-heading"
                className="mt-6 border-t border-[var(--border-subtle)] pt-6"
              >
                <header className="mb-3 flex items-center justify-between">
                  <div>
                    <h2
                      id="forge-3-package-heading"
                      className="text-base font-semibold text-[var(--fg-primary)]"
                    >
                      3-Package Spec-Driven Stack
                    </h2>
                    <p className="text-xs text-[var(--fg-tertiary)]">
                      Skills across forge-core, forge-pi, and forge-browser.
                    </p>
                  </div>
                </header>
                <ForgeSkillPicker />
              </section>
            </>
          )}
        </motion.section>
      </AnimatePresence>

      <footer className="mt-2 border-t border-[var(--border-subtle)] pt-4 text-[10px] text-[var(--fg-tertiary)]">
        <p>
          Forge Command Center v3 · backed by{' '}
          <code className="rounded bg-[var(--bg-inset)] px-1 font-mono">
            packages/forge-core/
          </code>{' '}
          (GSD-core) · 69 skills · 7 phases. Press{' '}
          <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono">⌘/</kbd>{' '}
          for shortcuts.
        </p>
      </footer>

      <MyWorkDrawer />
      <CommandPalette />
      <ShortcutsPanel />
      <PhaseExecutionDrawerConnector />
      <GsdPhaseWidget />
    </div>
  );
}
