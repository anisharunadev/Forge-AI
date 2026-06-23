'use client';

import * as React from 'react';
import { StatusPill } from '@/components/shell';
import type { PulseKind, StateGlyph, StatusTone } from '@/lib/design-system/status';
import type { ADRStatus } from '@/lib/architecture/data';

/**
 * ApprovalStatusBadge — ADR approval state, delegating to <StatusPill>.
 *
 * Mapping:
 *   - proposed   → review   ◑  (slow pulse — needs attention)
 *   - draft      → idle     ○
 *   - approved   → success  ✓
 *   - published  → success  ✓
 *   - superseded → danger   ✕
 *
 * Back-compat testid/data-status preserved.
 */
const TONE: Record<ADRStatus, StatusTone> = {
  proposed:   'review',
  draft:      'idle',
  approved:   'success',
  published:  'success',
  superseded: 'danger',
};

const GLYPH: Record<ADRStatus, StateGlyph> = {
  proposed:   '◑',
  draft:      '○',
  approved:   '✓',
  published:  '✓',
  superseded: '✕',
};

const PULSE: Record<ADRStatus, PulseKind> = {
  proposed:   'slow',
  draft:      'none',
  approved:   'none',
  published:  'none',
  superseded: 'none',
};

export interface ApprovalStatusBadgeProps {
  status: ADRStatus;
  className?: string;
}

export function ApprovalStatusBadge({
  status,
  className,
}: ApprovalStatusBadgeProps) {
  return (
    <StatusPill
      tone={TONE[status]}
      glyph={GLYPH[status]}
      pulse={PULSE[status]}
      label={status}
      size="sm"
      data-testid="approval-status-badge"
      data-status={status}
      className={className}
    />
  );
}
