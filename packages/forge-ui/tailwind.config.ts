import type { Config } from "tailwindcss";

/**
 * FORA Forge UI Tailwind config.
 * Tokens live as CSS custom properties in src/styles.css.
 * This config only wires Tailwind to those variables + the typography scale.
 *
 * Reference: FORA-393 Plan 3 (design-system-spec.md §3) + Plan 4 §2.
 */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        brand: {
          primary: "hsl(var(--brand-primary) / <alpha-value>)",
          accent: "hsl(var(--brand-accent) / <alpha-value>)",
          warn: "hsl(var(--brand-warn) / <alpha-value>)",
          danger: "hsl(var(--brand-danger) / <alpha-value>)",
          success: "hsl(var(--brand-success) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "hsl(var(--surface-bg) / <alpha-value>)",
          raised: "hsl(var(--surface-bg-raised) / <alpha-value>)",
          sunken: "hsl(var(--surface-bg-sunken) / <alpha-value>)",
          border: "hsl(var(--surface-border) / <alpha-value>)",
          ring: "hsl(var(--surface-ring) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "hsl(var(--ink-default) / <alpha-value>)",
          muted: "hsl(var(--ink-muted) / <alpha-value>)",
          subtle: "hsl(var(--ink-subtle) / <alpha-value>)",
          inverse: "hsl(var(--ink-inverse) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        // FORA typography scale (Plan 3 §3.2). body is 14/22 for data density.
        "display-1": ["36px", { lineHeight: "44px", letterSpacing: "-0.02em" }],
        "display-2": ["28px", { lineHeight: "36px", letterSpacing: "-0.015em" }],
        "heading-1": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em" }],
        "heading-2": ["20px", { lineHeight: "28px" }],
        "heading-3": ["18px", { lineHeight: "26px" }],
        "body-lg": ["16px", { lineHeight: "24px" }],
        body: ["14px", { lineHeight: "22px" }],
        "body-sm": ["13px", { lineHeight: "20px" }],
        caption: ["12px", { lineHeight: "16px", letterSpacing: "0.01em" }],
        mono: ["13px", { lineHeight: "20px" }],
      },
      // Icon size tokens (Plan 3 §3.3) — applied via tailwind utilities .icon-xs/.icon-sm/…
      spacing: {
        "icon-xs": "12px",
        "icon-sm": "16px",
        "icon-md": "20px",
        "icon-lg": "24px",
        "icon-xl": "32px",
      },
      boxShadow: {
        "elev-1": "var(--shadow-elev-1)",
        "elev-2": "var(--shadow-elev-2)",
      },
      ringColor: {
        focus: "hsl(var(--surface-ring) / 0.6)",
      },
      ringOffsetWidth: {
        focus: "2px",
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "slide-up": "slide-up 160ms ease-out",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;