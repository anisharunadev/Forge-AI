/**
 * Forge AI design tokens — barrel re-export.
 *
 * The design system is split into focused files for clarity:
 *   - `forge-color-tokens.ts`  — raw color palette + state mappings
 *   - `forge-dark-theme.ts`    — dark theme (PRIMARY)
 *   - `forge-light-theme.ts`   — light theme
 *   - `forge-typography.ts`    — type scale, eyebrow tokens, font stacks
 *   - `forge-spacing.ts`       — 8pt grid, radius, elevation, motion
 *   - `status.ts`              — agent state -> StatusBadge tone bridge
 *
 * This barrel is the import path components should use.
 *
 * @example
 *   import { forgeDark, agentStateToTone, typeScale } from '@/lib/design-system/tokens'
 */

export * from './forge-color-tokens'
export * from './forge-dark-theme'
export * from './forge-light-theme'
export * from './forge-typography'
export * from './forge-spacing'
export * from './status'
