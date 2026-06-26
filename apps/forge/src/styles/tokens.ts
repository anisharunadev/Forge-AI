/**
 * Forge AI design tokens — Phase 1 (Design System Foundation).
 *
 * The TypeScript mirror of the CSS custom properties in
 * `apps/forge/app/globals.css` and the Tailwind theme extensions in
 * `apps/forge/tailwind.config.ts`.
 *
 * This file is the canonical, typed reference for non-CSS contexts:
 *
 *   - Recharts color arrays / palettes
 *   - React Flow node palettes
 *   - Framer Motion animation variants
 *   - lucide-react icon strokes
 *   - Test fixtures and snapshot tests
 *   - Storybook / Ladle stories
 *
 * RULE: if a value differs from `globals.css`, this file is WRONG.
 * The CSS layer (and its dark-mode switch via the `.dark` class) is
 * the runtime source of truth; this file mirrors it for type safety.
 *
 * @example
 *   import { surface, accent, radius, motion } from '@/styles/tokens'
 *   const card = `${surface.elevated} ${radius.lg}`
 */

// ============================================================================
// Layered surfaces — depth-aware instead of flat #000 / #FFF
// ============================================================================

export const surface = {
  /** Page canvas — the absolute background of <html>/<body>. */
  base: 'var(--bg-base)',
  /** Section dividers, popovers, sidebars. */
  surface: 'var(--bg-surface)',
  /** Cards, modals, sheets. */
  elevated: 'var(--bg-elevated)',
  /** Wells, code blocks, nested inputs, terminal surfaces. */
  inset: 'var(--bg-inset)',
} as const

export type SurfaceToken = keyof typeof surface

// ============================================================================
// Hairline borders — subtle / default / strong ramp
// ============================================================================

export const border = {
  subtle: 'var(--border-subtle)',
  default: 'var(--border-default)',
  strong: 'var(--border-strong)',
} as const

export type BorderToken = keyof typeof border

// ============================================================================
// Semantic foreground — text on surfaces
// ============================================================================

export const fg = {
  /** Primary body text. */
  primary: 'var(--fg-primary)',
  /** Labels, secondary headings. */
  secondary: 'var(--fg-secondary)',
  /** Captions, helper text. */
  tertiary: 'var(--fg-tertiary)',
  /** Disabled / quiet. */
  muted: 'var(--fg-muted)',
} as const

export type ForegroundToken = keyof typeof fg

// ============================================================================
// Accent channels — beyond just the primary
// ============================================================================

export const accent = {
  primary: 'var(--accent-primary)',
  cyan: 'var(--accent-cyan)',
  emerald: 'var(--accent-emerald)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
} as const

export type AccentToken = keyof typeof accent

/**
 * Convenience export — the user-locked hex values for non-CSS contexts.
 * Use only when CSS variables are not available (e.g. SVG fill attrs,
 * Recharts prop arrays).
 */
export const accentHex = {
  primary: '#6366F1', // indigo
  cyan: '#22D3EE',
  emerald: '#10B981',
  amber: '#F59E0B',
  rose: '#F43F5E',
  violet: '#A855F7',
} as const

export const surfaceHex = {
  base: '#09090B',
  surface: '#131316',
  elevated: '#1A1A1F',
  inset: '#0E0E11',
} as const

export const fgHex = {
  primary: '#FAFAFA',
  secondary: '#A1A1AA',
  tertiary: '#71717A',
  muted: '#52525B',
} as const

// ============================================================================
// Type scale — size / line-height (from spec: xs..3xl)
// ============================================================================

export const text = {
  xs:   { size: 'var(--text-xs)',  leading: 'var(--leading-xs)'  }, // 12 / 16
  sm:   { size: 'var(--text-sm)',  leading: 'var(--leading-sm)'  }, // 13 / 18
  base: { size: 'var(--text-base)',leading: 'var(--leading-base)'}, // 14 / 20
  md:   { size: 'var(--text-md)',  leading: 'var(--leading-md)'  }, // 15 / 22
  lg:   { size: 'var(--text-lg)',  leading: 'var(--leading-lg)'  }, // 17 / 24
  xl:   { size: 'var(--text-xl)',  leading: 'var(--leading-xl)'  }, // 20 / 28
  '2xl':{ size: 'var(--text-2xl)', leading: 'var(--leading-2xl)' }, // 24 / 32
  '3xl':{ size: 'var(--text-3xl)', leading: 'var(--leading-3xl)' }, // 30 / 36
} as const

export type TextToken = keyof typeof text

// ============================================================================
// Font weights — 400 / 500 / 600 / 700
// ============================================================================

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

export type FontWeightToken = keyof typeof fontWeight

// ============================================================================
// Radius — 6 / 8 / 12 / 16
// ============================================================================

export const radius = {
  sm: 'var(--radius-sm)',  //  6px — controls (buttons, inputs, tabs)
  md: 'var(--radius-md)',  //  8px — cards (matches shadcn convention)
  lg: 'var(--radius-lg)',  // 12px — modals, sheets
  xl: 'var(--radius-xl)',  // 16px — large hero panels
} as const

export type RadiusToken = keyof typeof radius

// ============================================================================
// Shadow — sm / md / lg + indigo glow
// ============================================================================

export const shadow = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  'glow-primary': 'var(--shadow-glow-primary)',
} as const

export type ShadowToken = keyof typeof shadow

// ============================================================================
// Motion — 100 / 200 / 400 ms + ease-out cubic-bezier(0.16, 1, 0.3, 1)
// ============================================================================

export const motion = {
  fast: 'var(--motion-fast)',          // 100ms
  standard: 'var(--motion-standard)',  // 200ms
  slow: 'var(--motion-slow)',          // 400ms
  easeOut: 'var(--motion-ease-out)',   // cubic-bezier(0.16, 1, 0.3, 1)
} as const

export type MotionToken = keyof typeof motion

// ============================================================================
// Font families — Inter (UI) + JetBrains Mono (numbers/code)
// ============================================================================

export const fontFamily = {
  sans: 'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'var(--font-mono), ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
} as const

export type FontFamilyToken = keyof typeof fontFamily

// ============================================================================
// Aggregate bundle — re-export the canonical token namespaces
// ============================================================================

export const tokens = {
  surface,
  border,
  fg,
  accent,
  text,
  fontWeight,
  radius,
  shadow,
  motion,
  fontFamily,
} as const

export default tokens