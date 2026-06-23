/**
 * Forge AI typography system.
 *
 * Curated spec (1.25 modular scale, Phase 0.5 amendment):
 *   12, 13, 14, 16, 20, 24, 32, 48
 *
 * - 12 / 13 / 14 — body (12 = dense tables, 13 = default UI, 14 = reading)
 * - 16 — body-lg
 * - 20 / 24 / 32 / 48 — h4, h3, h2, h1
 *
 * Inter is the primary face; JetBrains Mono is reserved for IDs,
 * hashes, code, and contract fields. Both register via
 * `next/font/google` in `app/layout.tsx` and bind to CSS variables
 * (`--font-sans`, `--font-mono`).
 */

export const typeScale = {
  '12': { size: '0.75rem',   lineHeight: '1rem',    letterSpacing: '0',        weight: 400 },
  '13': { size: '0.8125rem', lineHeight: '1.2rem',  letterSpacing: '0',        weight: 400 },
  '14': { size: '0.875rem',  lineHeight: '1.4rem',  letterSpacing: '0',        weight: 400 },
  '16': { size: '1rem',      lineHeight: '1.5rem',  letterSpacing: '0',        weight: 400 },
  '20': { size: '1.25rem',   lineHeight: '1.75rem', letterSpacing: '-0.01em',  weight: 600 },
  '24': { size: '1.5rem',    lineHeight: '2rem',    letterSpacing: '-0.015em', weight: 600 },
  '32': { size: '2rem',      lineHeight: '2.5rem',  letterSpacing: '-0.02em',  weight: 600 },
  '48': { size: '3rem',      lineHeight: '3.5rem',  letterSpacing: '-0.025em', weight: 600 },
} as const

export type TypeScaleToken = keyof typeof typeScale

/** Eyebrow / label styles — small uppercase letterspaced text. */
export const eyebrowTokens = {
  default: { text: 'text-[11px] uppercase tracking-wider text-subtle' },
  accent:  { text: 'text-[11px] uppercase tracking-wider text-primary' },
  agent:   { text: 'text-[11px] uppercase tracking-wider text-agent' },
} as const

/**
 * Font family stacks. The runtime values come from `next/font/google`
 * via CSS variables; these stacks are the fallback chain for when the
 * font variable is not yet bound (e.g. during SSR pre-hydration).
 */
export const fontStacks = {
  sans: [
    'var(--font-sans)',
    'Inter',
    'Inter Variable',
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'Segoe UI',
    'Roboto',
    'sans-serif',
  ],
  mono: [
    'var(--font-mono)',
    'JetBrains Mono',
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Consolas',
    'monospace',
  ],
} as const
