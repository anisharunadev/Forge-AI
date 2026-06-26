'use client';

/**
 * ForgeSkillCard — ZONE 9 of the brief.
 *
 * Card rendering one skill from `packages/forge-core/`. Used in
 * Catalog mode (and re-usable from "Add to spec" pickers).
 *
 * Skill influence:
 *   - `02-typography.md` — mono IDs, sans labels.
 *   - `03-color.md` — phase accent drives the chip color.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { Plus, Play, Clock } from 'lucide-react';
import { Icon } from '@/lib/command-center/icons';
import { PHASE_ACCENT, compactNumber, friendlyDuration } from '@/lib/command-center/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ForgeSkill } from '@/lib/forge-core/manifest';
import { usageFor } from '@/lib/forge-core/manifest';

export interface ForgeSkillCardProps {
  skill: ForgeSkill;
  onRun?: (skill: ForgeSkill) => void;
  onAddToSpec?: (skill: ForgeSkill) => void;
  onTriggerFromTicket?: (skill: ForgeSkill) => void;
  highlighted?: boolean;
}

export function ForgeSkillCard({
  skill,
  onRun,
  onAddToSpec,
  onTriggerFromTicket,
  highlighted,
}: ForgeSkillCardProps) {
  const phase = PHASE_ACCENT[skill.phase];
  const usage = usageFor(skill.id);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      data-testid={`fcc-skill-${skill.id}`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'group relative flex flex-col gap-3 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-4 transition-[border,transform,box-shadow] duration-200 ease-out-soft',
        'hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
        highlighted
          ? 'border-[var(--accent-primary)] shadow-[var(--shadow-md)]'
          : 'border-[var(--border-subtle)]',
      )}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
            phase.bg,
            phase.fg,
          )}
          aria-hidden
        >
          <Icon name={skill.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold leading-tight text-[var(--fg-primary)]">
            {skill.label}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
            /{skill.id}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            phase.chip,
          )}
        >
          {phase.label}
        </span>
      </header>

      <p className="line-clamp-2 text-sm text-[var(--fg-secondary)]">
        {skill.description}
      </p>

      {skill.argumentHint ? (
        <p className="line-clamp-1 rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
          {skill.argumentHint}
        </p>
      ) : null}

      <footer className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-1 font-mono">
            <Clock className="h-2.5 w-2.5" aria-hidden />
            {friendlyDuration(skill.estimatedDurationSec)}
          </span>
          {usage ? (
            <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">
              {compactNumber(usage.runCount)} runs
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {onAddToSpec ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAddToSpec(skill)}
              aria-label={`Add ${skill.label} to spec`}
              data-testid={`fcc-add-to-spec-${skill.id}`}
              className="h-7 px-2 text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Spec
            </Button>
          ) : null}
          {onTriggerFromTicket ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onTriggerFromTicket(skill)}
              aria-label={`Trigger ${skill.label} from ticket`}
              data-testid={`fcc-trigger-from-ticket-${skill.id}`}
              className="h-7 px-2 text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Ticket
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => onRun?.(skill)}
            data-testid={`fcc-run-${skill.id}`}
            className="h-7 gap-1 bg-[var(--accent-primary)] px-2.5 text-[11px] text-white hover:opacity-90"
          >
            <Play className="h-3 w-3" aria-hidden />
            Run
          </Button>
        </div>
      </footer>
    </motion.article>
  );
}
