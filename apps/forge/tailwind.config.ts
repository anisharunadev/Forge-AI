import type { Config } from 'tailwindcss';

/**
 * Forge design tokens — refreshed palette (Phase B revamp, 2026-06-21).
 *
 * The previous "forge-50..900" greyscale was too washed-out for a
 * modern agent-console feel. This pass keeps the same dark-mode
 * default but re-introduces a saturated indigo / violet / amber
 * ramp so charts, badges, and accents read with intent.
 *
 * The shadcn/ui CSS variables in globals.css (--background,
 * --primary, --ring, etc.) are kept as the single source of truth;
 * Tailwind utilities reference them via `hsl(var(--*))`.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
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
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
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

        // === Refreshed brand palette ===
        // Saturated indigo / violet / amber on near-black slate.
        // Use these for persona badges, accent buttons, stage chips,
        // chart series, and CTA glows.
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

        // Neutral forge slate — replaces the old washed-out forge-50..900.
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
          900: '#0b1020', // near-black page background
          950: '#070b16', // deepest bg
        },

        stage: {
          pending: '#94a3b8',
          running: '#6366f1',
          waiting_approval: '#f59e0b',
          approved: '#10b981',
          rejected: '#f43f5e',
          returned: '#8b5cf6',
          skipped: '#94a3b8',
        },
        run: {
          created: '#94a3b8',
          running: '#6366f1',
          waiting_approval: '#f59e0b',
          paused: '#8b5cf6',
          aborted: '#f43f5e',
          finished: '#10b981',
          done: '#10b981',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Glow utilities for CTAs / active stage chips.
        'glow-brand': '0 0 0 1px rgb(99 102 241 / 0.5), 0 8px 30px -8px rgb(99 102 241 / 0.45)',
        'glow-amber': '0 0 0 1px rgb(245 158 11 / 0.5), 0 8px 30px -8px rgb(245 158 11 / 0.45)',
        'glow-emerald': '0 0 0 1px rgb(16 185 129 / 0.5), 0 8px 30px -8px rgb(16 185 129 / 0.45)',
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
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"JetBrains Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;