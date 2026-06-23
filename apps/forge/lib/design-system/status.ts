/**
 * Agent state -> status tone mapping.
 *
 * This is the bridge between the 6 agent states the user specified
 * and the StatusBadge primitive built in Plan 0.5-02. Components
 * import `agentStateToTone` rather than hardcoding "blue", "purple",
 * etc., so a brand refresh propagates.
 */

import type { AgentState } from './forge-color-tokens'

/** The set of tones the StatusBadge primitive understands. */
export type StatusTone =
  | 'success'
  | 'warn'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'agent'
  | 'execution'
  | 'review'
  | 'cost'

/**
 * Map an AgentState to a StatusBadge tone.
 * Centralized so a brand refresh in `forge-color-tokens.ts` cascades.
 */
export function agentStateToTone(state: AgentState): StatusTone {
  switch (state) {
    case 'idle':      return 'neutral'
    case 'thinking':  return 'agent'
    case 'executing': return 'execution'
    case 'reviewing': return 'review'
    case 'completed': return 'success'
    case 'failed':    return 'danger'
  }
}

/** Display label for an agent state. */
export function agentStateLabel(state: AgentState): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

/** Tailwind utility fragments keyed off tone — consumed by StatusBadge. */
export const toneClasses: Record<StatusTone, { bg: string; fg: string; ring: string }> = {
  success:    { bg: 'bg-success/15',     fg: 'text-success',    ring: 'ring-success/30'    },
  warn:       { bg: 'bg-warning/15',     fg: 'text-warning',    ring: 'ring-warning/30'    },
  danger:     { bg: 'bg-destructive/15', fg: 'text-destructive',ring: 'ring-destructive/30'},
  info:       { bg: 'bg-primary/15',     fg: 'text-primary',    ring: 'ring-primary/30'    },
  neutral:    { bg: 'bg-muted',          fg: 'text-muted-foreground', ring: 'ring-border' },
  agent:      { bg: 'bg-agent/15',       fg: 'text-agent',      ring: 'ring-agent/30'      },
  execution:  { bg: 'bg-execution/15',   fg: 'text-execution',  ring: 'ring-execution/30'  },
  review:     { bg: 'bg-review/15',      fg: 'text-review',     ring: 'ring-review/30'     },
  cost:       { bg: 'bg-warning/10',     fg: 'text-warning',    ring: 'ring-warning/20'    },
}

/**
 * Run lifecycle -> tone mapping (broader than AgentState).
 * Lives here so the SDLC pipeline view in Plan 0.5-06 can adopt the
 * same StatusBadge family as the agent UI.
 */
export const runStateTone: Record<string, StatusTone> = {
  created: 'neutral',
  running: 'execution',
  waiting_approval: 'review',
  paused: 'execution',
  approved: 'success',
  rejected: 'danger',
  aborted: 'danger',
  finished: 'success',
  done: 'success',
}

/**
 * Knowledge graph node -> tone mapping (PILOT-03).
 * Distinct from run/agent states because the KG is an artifact graph.
 */
export const kgStateTone: Record<string, StatusTone> = {
  draft: 'neutral',
  approved: 'success',
  conflicted: 'warn',
  deployed: 'info',
}
