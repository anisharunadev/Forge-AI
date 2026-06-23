/**
 * Forge AI typography system.
 *
 * Type scale follows a 1.125 minor-third (third-based) ratio for
 * display sizes and a tighter 1.067 ratio for body. Inter is the
 * primary face; JetBrains Mono is reserved for IDs, hashes, code,
 * and contract fields.
 *
 * Font registration happens in `app/layout.tsx` via `next/font/google`
 * which exposes them as CSS variables (`--font-sans`, `--font-mono`).
 * The CSS layer in `globals.css` binds them to the body.
 */

export const typeScale = {
  // Display
  'display-2xl': { size: '4.5rem',  lineHeight: '1.1',  letterSpacing: '-0.04em', weight: 600 },
  'display-xl':  { size: '3.75rem', lineHeight: '1.1',  letterSpacing: '-0.03em', weight: 600 },
  'display-lg':  { size: '3rem',    lineHeight: '1.15', letterSpacing: '-0.025em', weight: 600 },
  // Headings
  h1: { size: '2.25rem', lineHeight: '1.2',  letterSpacing: '-0.02em', weight: 600 },
  h2: { size: '1.875rem',lineHeight: '1.25', letterSpacing: '-0.015em', weight: 600 },
  h3: { size: '1.5rem',  lineHeight: '1.3',  letterSpacing: '-0.01em',  weight: 600 },
  h4: { size: '1.25rem', lineHeight: '1.35', letterSpacing: '-0.005em', weight: 600 },
  h5: { size: '1.125rem',lineHeight: '1.4',  letterSpacing: '0',        weight: 600 },
  h6: { size: '1rem',    lineHeight: '1.5',  letterSpacing: '0',        weight: 600 },
  // Body
  'body-lg': { size: '1.125rem', lineHeight: '1.6',  letterSpacing: '0', weight: 400 },
  body:      { size: '1rem',     lineHeight: '1.55', letterSpacing: '0', weight: 400 },
  'body-sm': { size: '0.875rem', lineHeight: '1.55', letterSpacing: '0', weight: 400 },
  caption:   { size: '0.75rem',  lineHeight: '1.4',  letterSpacing: '0.01em', weight: 500 },
  'eyebrow': { size: '0.6875rem',lineHeight: '1.2',  letterSpacing: '0.08em', weight: 600 },
  // Code
  code:      { size: '0.875rem', lineHeight: '1.5',  letterSpacing: '0', weight: 400 },
} as const

export type TypeScaleToken = keyof typeof typeScale

/**
 * Eyebrow / label styles — small uppercase letterspaced text used for
 * the section label above a h1 in the CenterShell pattern. All
 * uppercase, all tracking-wider, all 11px or smaller.
 */
export const eyebrowTokens = {
  default: {
    text: 'text-eyebrow uppercase tracking-wider text-muted-foreground',
  },
  accent: {
    text: 'text-eyebrow uppercase tracking-wider text-primary',
  },
  agent: {
    text: 'text-eyebrow uppercase tracking-wider text-agent',
  },
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
