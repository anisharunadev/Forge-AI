/**
 * ConnectorStatusPill — typed status pill for the Connector Center.
 *
 * Delegates to <StatusPill>. Mapping per the curated spec (§6):
 *   - success  → success   ✓
 *   - degraded → warn      ◑
 *   - error    → danger    ✕
 *
 * Back-compat testid/data-status/aria-label preserved.
 */

import type { ConnectorHealthStatus } from '@/lib/connectors/data';
import { StatusPill } from '@/components/shell';
import type { StateGlyph, StatusTone } from '@/lib/design-system/status';

export interface ConnectorStatusPillProps {
  readonly status: ConnectorHealthStatus;
  readonly className?: string;
}

const TONE: Record<ConnectorHealthStatus, StatusTone> = {
  healthy:     'success',
  syncing:     'warn',
  stale:       'warn',
  failed:      'danger',
  quarantined: 'danger',
  paused:      'idle',
};

const GLYPH: Record<ConnectorHealthStatus, StateGlyph> = {
  healthy:     '✓',
  syncing:     '◐',
  stale:       '◑',
  failed:      '✕',
  quarantined: '✕',
  paused:      '○',
};

const LABEL: Record<ConnectorHealthStatus, string> = {
  healthy:     'healthy',
  syncing:     'syncing',
  stale:       'stale',
  failed:      'failed',
  quarantined: 'quarantined',
  paused:      'paused',
};

export function ConnectorStatusPill({ status, className }: ConnectorStatusPillProps) {
  const label = LABEL[status];
  return (
    <StatusPill
      tone={TONE[status]}
      glyph={GLYPH[status]}
      label={label}
      size="sm"
      data-testid="connector-status-pill"
      data-status={status}
      aria-label={`Status: ${label}`}
      className={className}
    />
  );
}
