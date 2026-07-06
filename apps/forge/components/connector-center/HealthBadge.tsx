'use client';

import * as React from 'react';
import { StatusPill } from '@/components/shell';
import type { PulseKind, StateGlyph, StatusTone } from '@/lib/design-system/status';
import type { ConnectorHealthStatus } from '@/lib/connector-center/data';

/**
 * HealthBadge — connector health state, delegating to <StatusPill>.
 *
 * Mapping (per curated spec §6):
 *   - healthy      → success  ✓
 *   - syncing      → info     ◐  (blue, "active" work)
 *   - stale        → warn     ◑
 *   - failed       → danger   ✕
 *   - quarantined  → review   ◑
 *
 * The original testid/data-status/aria-label attributes are preserved.
 */
const TONE: Record<ConnectorHealthStatus, StatusTone> = {
  healthy:     'success',
  syncing:     'info',
  stale:       'warn',
  failed:      'danger',
  quarantined: 'review',
  paused:      'idle',
};

const GLYPH: Record<ConnectorHealthStatus, StateGlyph> = {
  healthy:     '✓',
  syncing:     '◐',
  stale:       '◑',
  failed:      '✕',
  quarantined: '◑',
  paused:      '‖',
};

const PULSE: Record<ConnectorHealthStatus, PulseKind> = {
  healthy:     'none',
  syncing:     'slow',
  stale:       'none',
  failed:      'none',
  quarantined: 'slow',
  paused:      'none',
};

const LABEL: Record<ConnectorHealthStatus, string> = {
  healthy:     'Healthy',
  syncing:     'Syncing',
  stale:       'Stale',
  failed:      'Failed',
  quarantined: 'Quarantined',
  paused:      'Paused',
};

export interface HealthBadgeProps {
  status: ConnectorHealthStatus;
  className?: string;
}

export function HealthBadge({ status, className }: HealthBadgeProps) {
  return (
    <StatusPill
      tone={TONE[status]}
      glyph={GLYPH[status]}
      pulse={PULSE[status]}
      label={LABEL[status]}
      size="sm"
      data-testid="connector-health-badge"
      data-status={status}
      aria-label={`Health: ${LABEL[status]}`}
      className={className}
    />
  );
}
