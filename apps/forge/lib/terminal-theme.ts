/**
 * xterm.js theme — `forge-dark`.
 *
 * Single source of truth for terminal color tokens so every pane renders
 * identically and the palette stays in lockstep with the app design tokens.
 *
 * Mirrors the dark-mode swatches in `app/globals.css`:
 *   --bg-base / --bg-inset   → #000000 / #0E0E11
 *   --fg-primary             → #FAFAFA / #E5E7EB
 *   --accent-primary (indigo)→ #6366F1  → cursor, blue, selection halo
 *   --accent-emerald / amber / rose / violet / cyan → ANSI 2..6
 *
 * Selection background uses an alpha-blended indigo so it works on the
 * pure-black canvas without flattening contrast for adjacent glyphs.
 *
 * Skill influence:
 *   - ux-guideline (dark mode OLED) — deep black, vibrant neon accents,
 *     high readability, minimal glow.
 *   - prefers-reduced-motion is honored at the consumer level; this theme
 *     itself is static.
 */
import type { ITheme } from '@xterm/xterm';

export const FORGE_DARK_THEME: ITheme = {
  background: '#000000',
  foreground: '#E5E7EB',
  cursor: '#6366F1',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(99, 102, 241, 0.30)',
  selectionForeground: '#FAFAFA',

  // Standard ANSI palette — calibrated against the dark canvas.
  black:         '#0E0E11',
  red:           '#F43F5E', // --accent-rose
  green:         '#10B981', // --accent-emerald
  yellow:        '#F59E0B', // --accent-amber
  blue:          '#6366F1', // --accent-primary
  magenta:       '#A855F7', // --accent-violet
  cyan:          '#22D3EE', // --accent-cyan
  white:         '#E5E7EB',

  // Bright variants — lifted +10% luminance so bold glyphs read clearly.
  brightBlack:   '#52525B', // --fg-muted
  brightRed:     '#FB7185',
  brightGreen:   '#34D399',
  brightYellow:  '#FBBF24',
  brightBlue:    '#818CF8',
  brightMagenta: '#C084FC',
  brightCyan:    '#67E8F9',
  brightWhite:   '#FAFAFA', // --fg-primary
};

export const FORGE_TERMINAL_FONT =
  'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const FORGE_TERMINAL_FONT_SIZE = 13;
