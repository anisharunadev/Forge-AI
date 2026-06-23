/**
 * Forge AI color tokens — single source of truth.
 *
 * Curated spec (Phase 0.5 amendment, 2026-06-23):
 *   - Dark mode is the primary experience; light is the companion.
 *   - `agent` is the IDENTITY channel (cyan); `thinking` is a STATE
 *     (blue) and is distinct from the agent identity.
 *   - `idle` uses the "subtle" gray (#71717A), darker than the
 *     default `muted-foreground` (#A1A1AA), so a fleet of idle
 *     agents reads as quiet, not noisy.
 *   - Agent states carry a glyph and pulse hint so a user can
 *     parse the dashboard without reading color alone.
 *
 * The CSS layer in `app/globals.css` is what *renders* at runtime;
 * this file is the *typed reference*. Mirrored in
 * `tailwind.config.ts` (the Tailwind binding).
 *
 * Rule: this file is the ONLY place in `apps/forge` (other than
 * `globals.css` and `tailwind.config.ts`) that may contain hex literals.
 * The ESLint rule `no-restricted-syntax` enforces this.
 */

/** Dark theme palette (PRIMARY per the curated spec). */
export const forgeDark = {
  background: '#09090B', // App canvas
  surface:    '#111113', // Section dividers, popover background
  card:       '#18181B', // Card surfaces
  hover:      '#1F1F23', // Card-on-canvas hover state (between surface and card)
  border:     '#27272A', // Hairline borders
  primary:    '#6366F1', // Brand / interactive accent (indigo)
  success:    '#22C55E', // Completed, healthy
  warning:    '#F59E0B', // Stale approval, attention
  error:      '#EF4444', // Failed, error
  agent:      '#06B6D4', // Agent IDENTITY (cyan) — for avatar, name, channel
  execution:  '#8B5CF6', // Agent executing, live code work
  review:     '#F97316', // Review, validation
  text:       '#FAFAFA', // Primary text
  muted:      '#A1A1AA', // Secondary text
  subtle:     '#71717A', // Idle / quiet / "off" — darker than muted
} as const

/** Light theme palette (companion; not the default). */
export const forgeLight = {
  background: '#FFFFFF',
  surface:    '#F8F8FA',
  card:       '#FFFFFF',
  hover:      '#F2F2F5',
  border:     '#E4E4E7',
  primary:    '#6366F1', // Keep indigo in light for brand consistency
  success:    '#22C55E',
  warning:    '#F59E0B',
  error:      '#EF4444',
  agent:      '#06B6D4',
  execution:  '#8B5CF6',
  review:     '#F97316',
  text:       '#09090B',
  muted:      '#52525B',
  subtle:     '#A1A1AA',
} as const

/**
 * Agent state -> identity mapping.
 *
 * Each state pairs a *color*, a *glyph*, and a *pulse* hint.
 * Per curated spec §6: glyph + label always present; color is the
 * reinforcement, never the only signal.
 *
 * The pulse values are CSS animation class names consumed by
 * <StatusPill> in Plan 0.5-02.
 */
export const agentStates = {
  idle: {
    color: '#71717A', // gray
    bg:    '#1F1F23', // matches hover
    glyph: '○',
    pulse: 'none',
    label: 'Idle',
  },
  thinking: {
    color: '#3B82F6', // blue (distinct from agent identity cyan)
    bg:    '#0E1A33',
    glyph: '◐',
    pulse: 'slow',
    label: 'Thinking',
  },
  executing: {
    color: '#8B5CF6', // violet
    bg:    '#241B3A',
    glyph: '●',
    pulse: 'active',
    label: 'Executing',
  },
  reviewing: {
    color: '#F97316', // orange
    bg:    '#3A1F0E',
    glyph: '◑',
    pulse: 'slow',
    label: 'Reviewing',
  },
  completed: {
    color: '#22C55E', // green
    bg:    '#0F2A1A',
    glyph: '✓',
    pulse: 'none',
    label: 'Completed',
  },
  failed: {
    color: '#EF4444', // red
    bg:    '#3A0F0F',
    glyph: '✕',
    pulse: 'fast-to-static', // pulse quickly once, then settle
    label: 'Failed',
  },
} as const

export type AgentState = keyof typeof agentStates

/**
 * Run lifecycle states — the broader orchestration model.
 * Maps to the same color family as agent states but with semantics
 * appropriate to a multi-stage run.
 */
export const runStates = {
  created:          { color: '#71717A', bg: '#1F1F23' },
  running:          { color: '#8B5CF6', bg: '#241B3A' },
  waiting_approval: { color: '#F97316', bg: '#3A1F0E' },
  paused:           { color: '#8B5CF6', bg: '#241B3A' },
  approved:         { color: '#22C55E', bg: '#0F2A1A' },
  rejected:         { color: '#EF4444', bg: '#3A0F0F' },
  aborted:          { color: '#EF4444', bg: '#3A0F0F' },
  finished:         { color: '#22C55E', bg: '#0F2A1A' },
  done:             { color: '#22C55E', bg: '#0F2A1A' },
} as const

export type RunState = keyof typeof runStates

/**
 * Knowledge graph node statuses (PILOT-03).
 * Distinct from agent and run states because the KG is an artifact graph.
 */
export const kgNodeStates = {
  draft:      { color: '#71717A', bg: '#1F1F23' },
  approved:   { color: '#22C55E', bg: '#0F2A1A' },
  conflicted: { color: '#F59E0B', bg: '#3A1F0E' },
  deployed:   { color: '#6366F1', bg: '#1A1A3A' },
} as const

export type KGNodeState = keyof typeof kgNodeStates
