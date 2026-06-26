'use client';

/**
 * SectionShell — per-section Save button that only enables when the
 * section is dirty (Phase 0.5-09 settings redesign).
 *
 * Wraps any section with a sticky bottom-right Save / Reset pair.
 * The Save button is disabled until `dirty` becomes true. Reset
 * calls `onReset()` (which callers wire to `form.reset()`).
 */

import * as React from 'react';
import { Loader2, Save, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface SectionShellProps {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onReset?: () => void;
  saveLabel?: string;
  /** Optional override for the testid. */
  testId?: string;
}

export function SectionShell({
  dirty,
  saving = false,
  onSave,
  onReset,
  saveLabel = 'Save changes',
  testId = 'section-shell',
}: SectionShellProps) {
  return (
    <div
      className="sticky bottom-0 z-10 mt-4 flex items-center justify-end gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 px-4 py-3 backdrop-blur"
      data-testid={testId}
    >
      {onReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!dirty || saving}
          data-testid={`${testId}-reset`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={!dirty || saving}
        data-testid={`${testId}-save`}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {saving ? 'Saving…' : saveLabel}
      </Button>
    </div>
  );
}