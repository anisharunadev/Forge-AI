import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette - matches the docs-site "primary" stop.
        forge: {
          50: '#f5f7fb',
          100: '#e6ebf5',
          200: '#c4cfe5',
          300: '#94a6cd',
          400: '#6379ad',
          500: '#3f558c',
          600: '#2f406b',
          700: '#243152',
          800: '#1a223b',
          900: '#11172a',
        },
        stage: {
          pending: '#94a6cd',
          running: '#2563eb',
          waiting_approval: '#d97706',
          approved: '#059669',
          rejected: '#dc2626',
          returned: '#7c3aed',
          skipped: '#9ca3af',
        },
        run: {
          created: '#94a6cd',
          running: '#2563eb',
          waiting_approval: '#d97706',
          paused: '#6366f1',
          aborted: '#dc2626',
          finished: '#059669',
          done: '#059669',
        },
      },
    },
  },
  plugins: [],
};

export default config;