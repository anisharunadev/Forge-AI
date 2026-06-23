/**
 * Forge AI spacing system.
 *
 * Curated spec (4px base, Phase 0.5 amendment):
 *   2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64
 *
 * 12 named values cover 95% of layouts. Beyond 64, use the
 * `px` arbitrary unit (rare; usually for hero whitespace).
 *
 * Border-radius uses 3 named uses per the curated spec:
 *   - Controls (buttons, inputs, tabs) — 6px
 *   - Cards                          — 8px
 *   - Modals                         — 12px
 *
 * Motion uses 3 named durations per the curated spec:
 *   - micro       150ms ease-out (hover, focus, micro-interactions)
 *   - standard    200ms ease-out (default state transitions)
 *   - state change 250ms ease-out (drawer, sheet, modal)
 *
 * Hard rule: no motion > 400ms.
 */

export const spacing = {
  '2':  '0.5rem',  //  8px
  '4':  '1rem',    // 16px
  '6':  '1.5rem',  // 24px
  '8':  '2rem',    // 32px
  '12': '3rem',    // 48px
  '16': '4rem',    // 64px
  '20': '5rem',    // 80px
  '24': '6rem',    // 96px
  '32': '8rem',    // 128px
  '40': '10rem',   // 160px
  '48': '12rem',   // 192px
  '64': '16rem',   // 256px
} as const

export type SpacingToken = keyof typeof spacing

/**
 * Border-radius — 3 named uses + `full` for pills/avatars.
 * Per curated spec: Controls 6px · Cards 8px · Modals 12px.
 */
export const radius = {
  none: '0',
  sm:   '0.375rem',  //  6px  — controls (buttons, inputs, tabs)
  md:   '0.5rem',    //  8px  — cards
  lg:   '0.75rem',   // 12px  — modals
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
  // AI-native glows (one per agent channel + status channels)
  'glow-primary':    '0 0 0 1px rgb(99 102 241 / 0.4),  0 0 24px -4px rgb(99 102 241 / 0.4)',
  'glow-agent':      '0 0 0 1px rgb(6 182 212 / 0.4),   0 0 24px -4px rgb(6 182 212 / 0.4)',
  'glow-execution':  '0 0 0 1px rgb(139 92 246 / 0.4),  0 0 24px -4px rgb(139 92 246 / 0.4)',
  'glow-review':     '0 0 0 1px rgb(249 115 22 / 0.4),  0 0 24px -4px rgb(249 115 22 / 0.4)',
  'glow-success':    '0 0 0 1px rgb(34 197 94 / 0.4),   0 0 24px -4px rgb(34 197 94 / 0.4)',
  'glow-destructive':'0 0 0 1px rgb(239 68 68 / 0.4),   0 0 24px -4px rgb(239 68 68 / 0.4)',
} as const

export type ElevationToken = keyof typeof elevation

/**
 * Motion tokens. 3 named durations per the curated spec.
 * Hard rule: no motion > 400ms.
 */
export const motion = {
  duration: {
    instant: '0ms',       // Disabled (reduced-motion)
    micro:   '150ms',     // Hover, focus, micro-interactions
    standard:'200ms',     // Default state transitions
    state:   '250ms',     // Drawer, sheet, modal
  },
  easing: {
    out:     'cubic-bezier(0, 0, 0.2, 1)',  // ease-out (Linear-style)
    in:      'cubic-bezier(0.4, 0, 1, 1)',  // ease-in
    inOut:   'cubic-bezier(0.4, 0, 0.2, 1)',// ease-in-out
  },
} as const

export type DurationToken = keyof typeof motion.duration
export type EasingToken = keyof typeof motion.easing
