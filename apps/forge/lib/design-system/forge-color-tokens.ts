/**
 * Forge AI color tokens — single source of truth.
 *
 * These hex values are the brand-locked palette the user specified in the
 * Phase 0.5 design vision. They are exported as plain string literals so
 * they can be consumed by:
 *
 *   - `tailwind.config.ts` (re-exposed as `bg-primary`, `text-agent`, etc.)
 *   - `app/globals.css` (re-injected as CSS custom properties)
 *   - Recharts, React Flow, and any other color-aware library
 *   - Storybook-style fixture data
 *
 * The CSS layer in `app/globals.css` is what *renders* at runtime; this
 * file is the *typed reference*. If you change a value here, you must
 * mirror it in `globals.css :root` and `.dark` blocks and in
 * `tailwind.config.ts`.
 *
 * Rule: this file is the ONLY place in `apps/forge` (other than
 * `globals.css` and `tailwind.config.ts`) that may contain hex literals.
 * The ESLint rule `no-restricted-syntax` enforces this.
 */

/** Dark theme palette (PRIMARY per the user spec). */
export const forgeDark = {
  background: '#09090B', // App canvas
  surface: '#111113',    // Section dividers, popover background
  card: '#18181B',       // Card surfaces
  border: '#27272A',     // Hairline borders
  primary: '#6366F1',    // Brand / interactive accent
  success: '#22C55E',    // Completed, healthy
  warning: '#F59E0B',    // Stale approval, attention
  destructive: '#EF4444',// Failed, error
  agent: '#06B6D4',      // Agent status (thinking, idle-active)
  execution: '#8B5CF6',  // Agent executing, live code work
  review: '#F97316',     // Review, validation
  foreground: '#FAFAFA', // Primary text
  muted: '#A1A1AA',      // Secondary text, idle state
} as const

/** Light theme palette (defined for parity; not the default). */
export const forgeLight = {
  background: '#FAFAFA',
  surface: '#F4F4F5',
  card: '#FFFFFF',
  border: '#E4E4E7',
  primary: '#4F46E5',
  success: '#16A34A',
  warning: '#F59E0B',
  destructive: '#DC2626',
  agent: '#0891B2',
  execution: '#7C3AED',
  review: '#EA580C',
  foreground: '#18181B',
  muted: '#71717A',
} as const

/**
 * Agent state -> color mapping. The six canonical agent states the user
 * specified for the AI-native UI. Each tone resolves to a pair of
 * foreground + background values that satisfy WCAG 2.2 AA on the
 * primary canvas.
 */
export const agentStates = {
  idle:      { fg: '#A1A1AA', bg: '#27272A', label: 'Idle'      },
  thinking:  { fg: '#06B6D4', bg: '#0E2A33', label: 'Thinking'  },
  executing: { fg: '#8B5CF6', bg: '#241B3A', label: 'Executing' },
  reviewing: { fg: '#F97316', bg: '#3A1F0E', label: 'Reviewing' },
  completed: { fg: '#22C55E', bg: '#0F2A1A', label: 'Completed' },
  failed:    { fg: '#EF4444', bg: '#3A0F0F', label: 'Failed'    },
} as const

export type AgentState = keyof typeof agentStates

/**
 * Run lifecycle states — the broader orchestration model that the SDLC
 * pipeline view consumes. Maps to the same color family as agent states
 * but with semantics appropriate to a multi-stage run.
 */
export const runStates = {
  created:          { fg: '#A1A1AA', bg: '#27272A' },
  running:          { fg: '#8B5CF6', bg: '#241B3A' },
  waiting_approval: { fg: '#F59E0B', bg: '#3A1F0E' },
  paused:           { fg: '#8B5CF6', bg: '#241B3A' },
  approved:         { fg: '#22C55E', bg: '#0F2A1A' },
  rejected:         { fg: '#EF4444', bg: '#3A0F0F' },
  aborted:          { fg: '#EF4444', bg: '#3A0F0F' },
  finished:         { fg: '#22C55E', bg: '#0F2A1A' },
  done:             { fg: '#22C55E', bg: '#0F2A1A' },
} as const

export type RunState = keyof typeof runStates

/**
 * Knowledge graph node statuses (PILOT-03). Distinct from agent and run
 * states because the KG is an artifact graph, not a process graph.
 */
export const kgNodeStates = {
  draft:      { fg: '#A1A1AA', bg: '#27272A' },
  approved:   { fg: '#22C55E', bg: '#0F2A1A' },
  conflicted: { fg: '#F59E0B', bg: '#3A1F0E' },
  deployed:   { fg: '#6366F1', bg: '#1A1A3A' },
} as const

export type KGNodeState = keyof typeof kgNodeStates
