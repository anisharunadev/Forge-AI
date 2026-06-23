/**
 * SeverityBadge — colored pill for `ValidationFinding.severity`.
 *
 * Delegates to <StatusPill>. Glyph + label + color are always present
 * per the curated spec (Phase 0.5 amendment §6) — color is never the
 * only signal.
 *
 *   - critical → danger  ✕
 *   - high     → warn    ◑  (saturated orange for visibility)
 *   - medium   → review  ◑
 *   - low      → info    ◐
 *
 * The original testid/data-severity/aria-label attributes are preserved.
 */

import type { ValidationSeverity } from '@/lib/api';
import { StatusPill } from '@/components/shell';
import type { StateGlyph, StatusTone } from '@/lib/design-system/status';

export interface SeverityBadgeProps {
  readonly severity: ValidationSeverity;
  readonly className?: string;
}

const TONE: Record<ValidationSeverity, StatusTone> = {
  critical: 'danger',
  high:     'warn',
  medium:   'review',
  low:      'info',
};

const GLYPH: Record<ValidationSeverity, StateGlyph> = {
  critical: '✕',
  high:     '◑',
  medium:   '◑',
  low:      '◐',
};

const LABEL: Record<ValidationSeverity, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <StatusPill
      tone={TONE[severity]}
      glyph={GLYPH[severity]}
      label={LABEL[severity]}
      size="sm"
      data-testid="severity-badge"
      data-severity={severity}
      aria-label={`Severity: ${LABEL[severity]}`}
      className={className}
    />
  );
}
