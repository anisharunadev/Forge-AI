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

import type { ToolCallStatus } from '@/lib/connectors/data';
import { StatusPill } from '@/components/shell';
import type { StateGlyph, StatusTone } from '@/lib/design-system/status';

const TONE: Record<ToolCallStatus, StatusTone> = {
  success:  'success',
  degraded: 'warn',
  error:    'danger',
};

const GLYPH: Record<ToolCallStatus, StateGlyph> = {
  success:  '✓',
  degraded: '◑',
  error:    '✕',
};

const LABEL: Record<ToolCallStatus, string> = {
  success:  'healthy',
  degraded: 'degraded',
  error:    'broken',
};

export interface ConnectorStatusPillProps {
  readonly status: ToolCallStatus;
  readonly className?: string;
}

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
