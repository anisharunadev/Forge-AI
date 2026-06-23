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

        // AI-native channels (NEW — the heart of Forge's visual identity)
        agent: {
          DEFAULT: 'hsl(var(--agent))',
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
      },
      borderRadius: {
        none: '0',
        sm: '0.375rem',   // 6px
        md: '0.625rem',   // 10px  <-- base (matches shadcn default)
        lg: '0.875rem',   // 14px
        xl: '1.125rem',   // 18px
        '2xl': '1.5rem',  // 24px
        '3xl': '2rem',    // 32px
        full: '9999px',
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
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }], // 11px
        xs:    ['0.75rem',   { lineHeight: '1.1rem' }],                          // 12px
        sm:    ['0.875rem',  { lineHeight: '1.4rem' }],                          // 14px
        base:  ['1rem',      { lineHeight: '1.55rem' }],                          // 16px
        lg:    ['1.125rem',  { lineHeight: '1.6rem'  }],                          // 18px
        xl:    ['1.25rem',   { lineHeight: '1.7rem'  }],                          // 20px
        '2xl': ['1.5rem',    { lineHeight: '1.85rem', letterSpacing: '-0.01em' }],// 24px
        '3xl': ['1.875rem',  { lineHeight: '2.2rem',  letterSpacing: '-0.015em' }],
        '4xl': ['2.25rem',   { lineHeight: '2.5rem',  letterSpacing: '-0.02em'  }],
        '5xl': ['3rem',      { lineHeight: '3.25rem', letterSpacing: '-0.025em' }],
        '6xl': ['3.75rem',   { lineHeight: '4rem',    letterSpacing: '-0.03em'  }],
        '7xl': ['4.5rem',    { lineHeight: '4.75rem', letterSpacing: '-0.035em' }],
      },
      transitionDuration: {
        DEFAULT: '200ms',
        fast: '150ms',
        base: '200ms',
        slow: '250ms',
        slower: '300ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
        accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
