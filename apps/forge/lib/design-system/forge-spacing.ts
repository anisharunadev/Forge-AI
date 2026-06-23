/**
 * Forge AI spacing system.
 *
 * An 8-point grid with a 4-point micro-step for fine alignment. The
 * scale is intentionally longer than Tailwind's default (up to 96)
 * because multi-page pilot UIs benefit from clearly named large
 * rhythm tokens (a 96 between major sections, a 64 between
 * sub-sections).
 *
 * Used by `tailwind.config.ts` as the `spacing` extension so any
 * `p-N`, `m-N`, `gap-N`, `space-y-N` class resolves through this scale.
 */

export const spacing = {
  // 4-point micro-step
  '0':   '0',
  px:    '1px',
  '0.5': '0.125rem', // 2px
  '1':   '0.25rem',  // 4px
  '1.5': '0.375rem', // 6px
  '2':   '0.5rem',   // 8px   <-- base
  '2.5': '0.625rem', // 10px
  '3':   '0.75rem',  // 12px
  '3.5': '0.875rem', // 14px
  '4':   '1rem',     // 16px
  '5':   '1.25rem',  // 20px
  '6':   '1.5rem',   // 24px
  '7':   '1.75rem',  // 28px
  '8':   '2rem',     // 32px
  '10':  '2.5rem',   // 40px
  '12':  '3rem',     // 48px
  '14':  '3.5rem',   // 56px
  '16':  '4rem',     // 64px
  '20':  '5rem',     // 80px
  '24':  '6rem',     // 96px
  '32':  '8rem',     // 128px
  '40':  '10rem',    // 160px
  '48':  '12rem',    // 192px
  '56':  '14rem',    // 224px
  '64':  '16rem',    // 256px
} as const

export type SpacingToken = keyof typeof spacing

/**
 * Border-radius scale. Six steps from `sm` (6px) to `2xl` (24px),
 * with `full` for pills and circles.
 */
export const radius = {
  none: '0',
  sm:   '0.375rem',  // 6px
  md:   '0.625rem',  // 10px  <-- base (matches shadcn default)
  lg:   '0.875rem',  // 14px
  xl:   '1.125rem',  // 18px
  '2xl':'1.5rem',    // 24px
  '3xl':'2rem',      // 32px
  full: '9999px',
} as const

export type RadiusToken = keyof typeof radius

/**
 * Elevation / shadow system. Subtle, designed for dark-mode clarity —
 * heavy drop shadows look wrong on near-black surfaces, so we lean on
 * tight inner glows and small outer halos.
 */
export const elevation = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.4)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.5)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)',
  // Semantic glows for the AI-native UI
  'glow-primary':  '0 0 0 1px rgb(99 102 241 / 0.4), 0 0 24px -4px rgb(99 102 241 / 0.4)',
  'glow-agent':    '0 0 0 1px rgb(6 182 212 / 0.4),  0 0 24px -4px rgb(6 182 212 / 0.4)',
  'glow-execution':'0 0 0 1px rgb(139 92 246 / 0.4),  0 0 24px -4px rgb(139 92 246 / 0.4)',
  'glow-review':   '0 0 0 1px rgb(249 115 22 / 0.4),  0 0 24px -4px rgb(249 115 22 / 0.4)',
  'glow-success':  '0 0 0 1px rgb(34 197 94 / 0.4),   0 0 24px -4px rgb(34 197 94 / 0.4)',
  'glow-destructive': '0 0 0 1px rgb(239 68 68 / 0.4), 0 0 24px -4px rgb(239 68 68 / 0.4)',
} as const

export type ElevationToken = keyof typeof elevation

/**
 * Motion tokens. The user specified 150/200/250ms as the core
 * transitions. `prefers-reduced-motion` collapses all of these to 0ms
 * at the CSS layer.
 */
export const motion = {
  duration: {
    instant: '0ms',
    fast:    '150ms', // hover, focus, micro-interactions
    base:    '200ms', // default for state transitions
    slow:    '250ms', // drawer, sheet, modal
    slower:  '300ms', // page-level transitions
  },
  easing: {
    standard:  'cubic-bezier(0.2, 0, 0, 1)',     // Linear-style
    decelerate:'cubic-bezier(0, 0, 0.2, 1)',     // entering
    accelerate:'cubic-bezier(0.4, 0, 1, 1)',     // exiting
    spring:    'cubic-bezier(0.34, 1.56, 0.64, 1)', // playful
  },
} as const

export type DurationToken = keyof typeof motion.duration
export type EasingToken = keyof typeof motion.easing
