import type { Config } from 'tailwindcss';

/**
 * Forge design tokens — Phase 0.5 (UI Foundation).
 *
 * The previous "Phase B" refresh (2026-06-21) kept the dark-mode
 * default and introduced a saturated indigo/violet/amber ramp. This
 * pass makes the AI-native channels (agent / execution / review /
 * cost) first-class citizens and binds Tailwind utilities to the
 * user-locked hex codes in `lib/design-system/forge-color-tokens.ts`.
 *
 * The shadcn/ui CSS variables in `app/globals.css` (--background,
 * --primary, --ring, etc.) remain the single source of truth at the
 * CSS layer; Tailwind utilities reference them via `hsl(var(--*))`.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // shadcn primitive tokens (backed by CSS variables)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: 'hsl(var(--surface))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // Status (semantic — replaces stage.* and run.*)
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        // AI-native channels (curated spec — Phase 0.5 amendment)
        // `agent` is the IDENTITY channel (cyan). `thinking` is a STATE
        // (blue) and is intentionally a separate token.
        agent: {
          DEFAULT: 'hsl(var(--agent))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        thinking: {
          DEFAULT: 'hsl(var(--thinking))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        execution: {
          DEFAULT: 'hsl(var(--execution))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        review: {
          DEFAULT: 'hsl(var(--review))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        cost: {
          DEFAULT: 'hsl(var(--cost))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        // Subtle / idle — for off-state text and quiet surfaces
        subtle: {
          DEFAULT: 'hsl(var(--subtle))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        // Hover surface — between card and surface, for card-on-canvas hover
        hover: {
          DEFAULT: 'hsl(var(--hover))',
        },

        // === Refreshed brand palette (kept for chart series + gradients) ===
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1', // primary indigo
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#1e1b4b',
        },
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        rose: {
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
        },
        sky: {
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
        },

        // === Deprecated forge slate ramp ===
        // KEPT as a backwards-compat alias so Plan 0.5-02/05 can
        // migrate one file at a time. The .card utility, .btn classes,
        // and inline `text-forge-*` references continue to render.
        // New code MUST use the semantic tokens above.
        forge: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0b1020',
          950: '#070b16',
        },

        // === Status token map (replaces stage.* / run.*) ===
        // Used by StatusBadge via `bg-stage-{name}/15` etc. in
        // Plan 0.5-02. Kept as a bridge from the old tokens.
        stage: {
          pending: 'hsl(var(--muted-foreground))',
          running: 'hsl(var(--execution))',
          waiting_approval: 'hsl(var(--review))',
          approved: 'hsl(var(--success))',
          rejected: 'hsl(var(--destructive))',
          returned: 'hsl(var(--execution))',
          skipped: 'hsl(var(--muted-foreground))',
        },
        run: {
          created: 'hsl(var(--muted-foreground))',
          running: 'hsl(var(--execution))',
          waiting_approval: 'hsl(var(--review))',
          paused: 'hsl(var(--execution))',
          aborted: 'hsl(var(--destructive))',
          finished: 'hsl(var(--success))',
          done: 'hsl(var(--success))',
        },

        // ==========================================================================
        // Phase 1 — DESIGN SYSTEM FOUNDATION
        // The canonical token layer new components consume. Backed by raw hex
        // CSS variables in `app/globals.css` (not HSL, so utility output is
        // identical to the spec). Existing HSL primitives above remain for
        // backwards compatibility.
        // ==========================================================================

        // Layered surfaces — depth-aware instead of flat #000/#FFF.
        // Use: bg-base (canvas), bg-surface (panels), bg-elevated (cards),
        //      bg-inset (wells, code, nested inputs).
        'bg-base':     'var(--bg-base)',
        'bg-surface':  'var(--bg-surface)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-inset':    'var(--bg-inset)',

        // Hairline borders — subtle/default/strong ramp over rgba whites.
        // Use: border-subtle (1px hairlines), border-default, border-strong.
        'border-subtle':  'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong':  'var(--border-strong)',

        // Semantic foreground — text on surfaces.
        // Use: text-fg-primary (body), text-fg-secondary (label),
        //      text-fg-tertiary (caption), text-fg-muted (disabled/quiet).
        'fg-primary':   'var(--fg-primary)',
        'fg-secondary': 'var(--fg-secondary)',
        'fg-tertiary':  'var(--fg-tertiary)',
        'fg-muted':     'var(--fg-muted)',

        // Accent channels — beyond just the primary. Bound to the user-locked
        // hex values from the Phase 1 spec.
        // Use: text-accent-primary, bg-accent-cyan, ring-accent-emerald, etc.
        'accent-primary': 'var(--accent-primary)',
        'accent-cyan':    'var(--accent-cyan)',
        'accent-emerald': 'var(--accent-emerald)',
        'accent-amber':   'var(--accent-amber)',
        'accent-rose':    'var(--accent-rose)',
        'accent-violet':  'var(--accent-violet)',
      },
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',   //  6px — controls (buttons, inputs, tabs)
        md: 'var(--radius-md)',   //  8px — cards (matches shadcn convention)
        lg: 'var(--radius-lg)',   // 12px — modals
        xl: 'var(--radius-xl)',   // 16px — large hero panels
        full: '9999px',           // pills, avatars
      },
      boxShadow: {
        // Subtle elevation (linear-style)
        'elev-xs': '0 1px 2px 0 rgb(0 0 0 / 0.4)',
        'elev-sm': '0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5)',
        'elev-md': '0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5)',
        'elev-lg': '0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.5)',
        'elev-xl': '0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)',
        // AI-native glows
        'glow-primary':  '0 0 0 1px rgb(99 102 241 / 0.4), 0 0 24px -4px rgb(99 102 241 / 0.4)',
        'glow-agent':    '0 0 0 1px rgb(6 182 212 / 0.4),  0 0 24px -4px rgb(6 182 212 / 0.4)',
        'glow-execution':'0 0 0 1px rgb(139 92 246 / 0.4),  0 0 24px -4px rgb(139 92 246 / 0.4)',
        'glow-review':   '0 0 0 1px rgb(249 115 22 / 0.4),  0 0 24px -4px rgb(249 115 22 / 0.4)',
        'glow-success':  '0 0 0 1px rgb(34 197 94 / 0.4),   0 0 24px -4px rgb(34 197 94 / 0.4)',
        'glow-destructive': '0 0 0 1px rgb(239 68 68 / 0.4), 0 0 24px -4px rgb(239 68 68 / 0.4)',

        // Phase 1 — canonical shadow scale bound to CSS variables.
        // Overrides Tailwind's built-in `shadow-sm/md/lg` so utility
        // output reads from the foundation --shadow-* CSS vars.
        // Use: shadow-sm, shadow-md, shadow-lg + shadow-glow-primary.
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        'glow-primary-token': 'var(--shadow-glow-primary)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(99 102 241 / 0.55)' },
          '50%': { boxShadow: '0 0 0 8px rgb(99 102 241 / 0)' },
        },
        // AI-native: a "thinking" pulse for active agents
        'pulse-agent': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        // AI-native: a rotating ring for executing agents
        'spin-execution': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        'pulse-agent': 'pulse-agent 1.6s ease-in-out infinite',
        'spin-execution': 'spin-execution 1.2s linear infinite',
      },
      fontFamily: {
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
      },
      fontSize: {
        // 1.25 modular scale per the curated spec: 12, 13, 14, 16, 20, 24, 32, 48
        '12': ['0.75rem',   { lineHeight: '1rem',   letterSpacing: '0'        }],
        '13': ['0.8125rem', { lineHeight: '1.2rem', letterSpacing: '0'        }],
        '14': ['0.875rem',  { lineHeight: '1.4rem', letterSpacing: '0'        }],
        '16': ['1rem',      { lineHeight: '1.5rem', letterSpacing: '0'        }],
        '20': ['1.25rem',   { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '24': ['1.5rem',    { lineHeight: '2rem',   letterSpacing: '-0.015em' }],
        '32': ['2rem',      { lineHeight: '2.5rem', letterSpacing: '-0.02em'  }],
        '48': ['3rem',      { lineHeight: '3.5rem', letterSpacing: '-0.025em' }],

        // Phase 1 — canonical type scale bound to CSS variables.
        // Overrides Tailwind's shadcn defaults so utility output matches
        // the user-locked spec: text-xs 12/16, text-sm 13/18,
        // text-base 14/20, text-md 15/22, text-lg 17/24,
        // text-xl 20/28, text-2xl 24/32, text-3xl 30/36.
        xs:    ['var(--text-xs)',   { lineHeight: 'var(--leading-xs)'  }],
        sm:    ['var(--text-sm)',   { lineHeight: 'var(--leading-sm)'  }],
        base:  ['var(--text-base)', { lineHeight: 'var(--leading-base)'}],
        md:    ['var(--text-md)',   { lineHeight: 'var(--leading-md)'  }],
        lg:    ['var(--text-lg)',   { lineHeight: 'var(--leading-lg)'  }],
        xl:    ['var(--text-xl)',   { lineHeight: 'var(--leading-xl)'  }],
        '2xl': ['var(--text-2xl)',  { lineHeight: 'var(--leading-2xl)' }],
        '3xl': ['var(--text-3xl)',  { lineHeight: 'var(--leading-3xl)' }],
        '4xl': ['2.25rem',  { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        '5xl': ['3rem',     { lineHeight: '1'      , letterSpacing: '-0.025em' }],
        '6xl': ['3.75rem',  { lineHeight: '1'      , letterSpacing: '-0.025em' }],
        '7xl': ['4.5rem',   { lineHeight: '1'      , letterSpacing: '-0.025em' }],
      },
      transitionDuration: {
        DEFAULT: '200ms',
        instant: '0ms',
        micro:   '150ms',
        state:   '250ms',

        // Phase 1 — canonical motion scale bound to CSS variables.
        // Use: duration-standard (200ms) [also DEFAULT], duration-fast (100ms),
        //      duration-slow (400ms).
        fast:     'var(--motion-fast)',
        standard: 'var(--motion-standard)',
        slow:     'var(--motion-slow)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0, 0, 0.2, 1)',
        out:   'cubic-bezier(0, 0, 0.2, 1)',
        in:    'cubic-bezier(0.4, 0, 1, 1)',
        inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',

        // Phase 1 — canonical easing curve bound to CSS variable.
        // Use: ease-out-soft (cubic-bezier(0.16, 1, 0.3, 1)).
        'out-soft': 'var(--motion-ease-out)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
