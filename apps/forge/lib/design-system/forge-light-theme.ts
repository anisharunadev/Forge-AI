/**
 * Forge AI light theme (defined for parity; dark is the default).
 *
 * Operators can ship this as the default by removing the
 * `className="dark"` from `<html>` in `app/layout.tsx` or by setting
 * `defaultTheme="light"` in the `ThemeProvider` in
 * `components/providers.tsx`.
 *
 * Per Rule 8 (configurable everything), the token set is *defined*
 * here and *wired* through the CSS layer; flipping the default is a
 * one-line change.
 */

import { forgeLight } from './forge-color-tokens'

export const forgeLightTheme = {
  ...forgeLight,
  // Semantic aliases (mirror dark)
  canvas:     forgeLight.background,
  divider:    forgeLight.border,
  textBody:   forgeLight.text,
  textMuted:  forgeLight.muted,
  interactive:forgeLight.primary,
  positive:   forgeLight.success,
  alert:      forgeLight.warning,
  critical:   forgeLight.error,
  channelAgent:    forgeLight.agent,
  channelExecution:forgeLight.execution,
  channelReview:   forgeLight.review,
} as const

export type ForgeLightTheme = typeof forgeLightTheme
