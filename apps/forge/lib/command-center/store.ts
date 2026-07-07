'use client';

/**
 * Command Center state — Zustand store.
 *
 * Scope (deliberately narrow):
 *   - Active top-level mode (ticket / spec / catalog)
 *   - Selected ticket + selected spec
 *   - Active phase in the GSD pipeline
 *   - Drawer / sheet visibility (my-work, shortcuts, command palette)
 *   - Keyboard shortcut visibility
 *
 * Not here: server data, ticket details fetched from Jira/GitHub,
 * run telemetry. Those flow through TanStack Query + WebSocket (Rule 7).
 */

import { create } from 'zustand';
import type { ForgePhase } from '../forge-core/manifest';
import type {
  Spec,
  Ticket,
} from './sample-data';
// Track K (Day 2) — store no longer reads SAMPLE_* for initial state.
// The deprecated exports stay so any third-party imports keep
// type-checking; selectors below intentionally return `undefined`
// when no live IDs match.

export type CommandCenterMode = 'ticket' | 'spec' | 'catalog';

/* ---------------------------------------------------------------------------
 * Orchestration events — the activity feed payload.
 * Cross-module triggers (Step-34 conductor pattern) append events here so
 * the PhaseExecutionDrawer activity rail and the FloatingPhaseWidget can
 * render a coherent timeline. Mock today; real wiring will publish over
 * Redis Pub/Sub → SSE/WebSocket.
 * ------------------------------------------------------------------------- */
export type OrchestrationEventKind =
  | 'agent-invoked'
  | 'file-changed'
  | 'connector-call'
  | 'reasoning'
  | 'ticket-status'
  | 'pr-opened'
  | 'spec-linked'
  | 'phase-completed';

export interface OrchestrationEvent {
  readonly id: string;
  readonly kind: OrchestrationEventKind;
  readonly ticketId?: string;
  readonly phase: ForgePhase;
  readonly at: string;
  readonly actor: string; // e.g. "code-reviewer agent"
  readonly body: string;
  readonly href?: string;
}

export type PhaseExecutionStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export interface PhaseExecution {
  readonly phase: ForgePhase;
  status: PhaseExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  progress: number; // 0-100
  stepIndex: number;
  stepTotal: number;
  outputLines: ReadonlyArray<string>;
}

export interface CommandCenterState {
  /* Mode + selection */
  mode: CommandCenterMode;
  setMode: (m: CommandCenterMode) => void;

  selectedTicketId: string | null;
  setSelectedTicketId: (id: string | null) => void;

  selectedSpecId: string;
  setSelectedSpecId: (id: string) => void;

  activePhase: ForgePhase;
  setActivePhase: (p: ForgePhase) => void;

  /* Drawers + sheets */
  myWorkOpen: boolean;
  setMyWorkOpen: (open: boolean) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /* Catalog filters (kept here so header search shares state) */
  catalogQuery: string;
  setCatalogQuery: (q: string) => void;

  /* First-run tracking — shows the welcome until first interaction. */
  hasOnboarded: boolean;
  completeOnboarding: () => void;

  /* Ticket input draft (preserved across mode switches). */
  ticketDraft: string;
  setTicketDraft: (s: string) => void;

  /* Orchestration — phase execution + activity feed. */
  executionOpen: boolean;
  setExecutionOpen: (open: boolean) => void;

  execution: PhaseExecution;
  setExecution: (e: Partial<PhaseExecution>) => void;
  resetExecution: () => void;

  events: ReadonlyArray<OrchestrationEvent>;
  pushEvent: (e: Omit<OrchestrationEvent, 'id' | 'at'>) => void;
  clearEvents: () => void;
}

/* Track K (Day 2) — start with no selection. The Ticket / Spec
 * surfaces set the id once a live item is picked; selectors below
 * return `undefined` until the matching live item is loaded. */
export const useCommandCenter = create<CommandCenterState>((set) => ({
  mode: 'ticket',
  setMode: (mode) => set({ mode }),

  selectedTicketId: null,
  setSelectedTicketId: (selectedTicketId) => set({ selectedTicketId }),

  selectedSpecId: '',
  setSelectedSpecId: (selectedSpecId) => set({ selectedSpecId }),

  activePhase: 'execution',
  setActivePhase: (activePhase) => set({ activePhase }),

  myWorkOpen: false,
  setMyWorkOpen: (myWorkOpen) => set({ myWorkOpen }),

  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  catalogQuery: '',
  setCatalogQuery: (catalogQuery) => set({ catalogQuery }),

  hasOnboarded: false,
  completeOnboarding: () => set({ hasOnboarded: true }),

  ticketDraft: '',
  setTicketDraft: (ticketDraft) => set({ ticketDraft }),

  /* Orchestration: phase execution state. The PhaseExecutionDrawer
   * subscribes to `execution` + `events`. */
  executionOpen: false,
  setExecutionOpen: (executionOpen) => set({ executionOpen }),

  execution: {
    phase: 'execution',
    status: 'idle',
    progress: 0,
    stepIndex: 0,
    stepTotal: 4,
    outputLines: [],
  },
  setExecution: (patch) =>
    set((s) => ({ execution: { ...s.execution, ...patch } })),
  resetExecution: () =>
    set({
      execution: {
        phase: 'execution',
        status: 'idle',
        progress: 0,
        stepIndex: 0,
        stepTotal: 4,
        outputLines: [],
      },
      events: [],
    }),

  events: [],
  pushEvent: (e) =>
    set((s) => ({
      events: [
        ...s.events,
        {
          ...e,
          id: `evt-${Date.now()}-${s.events.length}`,
          at: new Date().toISOString(),
        },
      ],
    })),
  clearEvents: () => set({ events: [] }),
}));

/* ---------------------------------------------------------------------------
 * Convenience selectors — components subscribe to the narrowest slice.
 * ------------------------------------------------------------------------- */

export function selectSelectedTicket(state: CommandCenterState): Ticket | undefined {
  if (!state.selectedTicketId) return undefined;
  // ponytail: Day 2 returns undefined until the live ticket data
  // lands — PhaseExecutionDrawer already handles the "no ticket"
  // case via its `ticket?: Ticket` prop.
  return undefined;
}

export function selectSelectedSpec(state: CommandCenterState): Spec | undefined {
  if (!state.selectedSpecId) return undefined;
  // ponytail: same as above for the selected spec.
  return undefined;
}
