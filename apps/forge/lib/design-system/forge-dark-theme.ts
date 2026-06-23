/**
 * Forge AI dark theme (PRIMARY per the user spec).
 *
 * The values are mirrored into `app/globals.css :root` (light) and
 * `.dark` (dark) blocks. This file is the typed reference for
 * non-CSS contexts (Recharts color arrays, React Flow node palettes,
 * test fixtures, etc.).
 *
 * Rule: do not import this file from a Server Component that ships
 * CSS — use the CSS variables instead. This file is for *values*.
 */

import { forgeDark } from './forge-color-tokens'

/**
 * Re-export of `forgeDark` for symmetry with `forge-light-theme.ts`.
 * If the dark theme ever needs to diverge from the color tokens
 * (e.g. for a brand partnership), do it here.
 */
export const forgeDarkTheme = {
  ...forgeDark,
  // Semantic aliases
  canvas:     forgeDark.background,
  divider:    forgeDark.border,
  textBody:   forgeDark.foreground,
  textMuted:  forgeDark.muted,
  interactive:forgeDark.primary,
  positive:   forgeDark.success,
  alert:      forgeDark.warning,
  critical:   forgeDark.destructive,
  // AI-native channels
  channelAgent:    forgeDark.agent,
  channelExecution:forgeDark.execution,
  channelReview:   forgeDark.review,
} as const

export type ForgeDarkTheme = typeof forgeDarkTheme
