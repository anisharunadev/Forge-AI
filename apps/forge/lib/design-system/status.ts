/**
 * Agent state -> StatusPill tone mapping.
 *
 * Bridge between the 6 agent states and the StatusPill primitive
 * (built in Plan 0.5-02). Components import `agentStateToTone`
 * rather than hardcoding color names, so a brand refresh in
 * `forge-color-tokens.ts` cascades.
 *
 * Per the curated spec (Phase 0.5 amendment):
 *   - `agent` is the IDENTITY channel (cyan)
 *   - `thinking` is a STATE (blue) — distinct from agent identity
 *   - `idle` maps to the dedicated `idle` tone (subtle gray)
 *   - `completed`/`failed` map to semantic success/danger
 */

import type { AgentState } from './forge-color-tokens'

/** The set of tones StatusPill understands. */
export type StatusTone =
  | 'success'
  | 'warn'
  | 'danger'
  | 'info'
  | 'idle'
  | 'agent'       // identity channel
  | 'execution'   // executing
  | 'review'      // reviewing
  | 'cost'        // cost indicator

/** Pulse class names emitted by StatusPill. */
export type PulseKind = 'none' | 'slow' | 'active' | 'fast-to-static'

/** Glyph that pairs with the tone (per curated spec §6). */
export type StateGlyph = '○' | '◐' | '●' | '◑' | '✓' | '✕'

/** Map an AgentState to a StatusPill tone. */
export function agentStateToTone(state: AgentState): StatusTone {
  switch (state) {
    case 'idle':      return 'idle'
    case 'thinking':  return 'info'        // blue, not agent-cyan
    case 'executing': return 'execution'
    case 'reviewing': return 'review'
    case 'completed': return 'success'
    case 'failed':    return 'danger'
  }
}

/** Glyph for an agent state. */
export function agentStateGlyph(state: AgentState): StateGlyph {
  return agentStates[state].glyph
}

/** Pulse class for an agent state. */
export function agentStatePulse(state: AgentState): PulseKind {
  return agentStates[state].pulse
}

/** Re-export the agent states map for convenience. */
import { agentStates } from './forge-color-tokens'

/** Tailwind utility fragments keyed off tone — consumed by StatusPill. */
export const toneClasses: Record<StatusTone, { bg: string; fg: string; ring: string }> = {
  success:    { bg: 'bg-success/15',     fg: 'text-success',     ring: 'ring-success/30'    },
  warn:       { bg: 'bg-warning/15',     fg: 'text-warning',     ring: 'ring-warning/30'    },
  danger:     { bg: 'bg-destructive/15', fg: 'text-destructive', ring: 'ring-destructive/30'},
  info:       { bg: 'bg-primary/15',     fg: 'text-primary',     ring: 'ring-primary/30'    },
  idle:       { bg: 'bg-hover',          fg: 'text-subtle',      ring: 'ring-border'        },
  agent:      { bg: 'bg-agent/15',       fg: 'text-agent',       ring: 'ring-agent/30'      },
  execution:  { bg: 'bg-execution/15',   fg: 'text-execution',   ring: 'ring-execution/30'  },
  review:     { bg: 'bg-review/15',      fg: 'text-review',      ring: 'ring-review/30'     },
  cost:       { bg: 'bg-warning/10',     fg: 'text-warning',     ring: 'ring-warning/20'    },
}

/** Run lifecycle -> tone mapping. */
export const runStateTone: Record<string, StatusTone> = {
  created: 'idle',
  running: 'execution',
  waiting_approval: 'review',
  paused: 'execution',
  approved: 'success',
  rejected: 'danger',
  aborted: 'danger',
  finished: 'success',
  done: 'success',
}

/** Knowledge graph node -> tone mapping (PILOT-03). */
export const kgStateTone: Record<string, StatusTone> = {
  draft: 'idle',
  approved: 'success',
  conflicted: 'warn',
  deployed: 'info',
}
