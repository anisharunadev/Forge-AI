/**
 * Client state store (Zustand).
 *
 * - `useTerminalStore` drives the Terminal Center.
 * - `useOnboardingStore` drives the Project Onboarding wizard.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AgentId = 'claude-code' | 'codex' | 'gemini-cli' | 'aider' | 'cursor' | 'custom';
export type LayoutMode = 'single' | 'split-horizontal' | 'split-vertical' | 'grid-2x2';

/** Color tag ids — must stay in sync with `SESSION_COLOR_TAGS` in
 * `components/forge-terminal/NewSessionDialog.tsx`. */
export type SessionColorId =
  | 'indigo'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'slate'
  | 'lime';

/** Session lifecycle — drives the tab status dot and the empty/error
 * panes. New sessions start as 'creating' and flip to 'active' once
 * the WebSocket opens. */
export type SessionStatus = 'creating' | 'active' | 'closed' | 'error';

export interface TerminalSession {
  id: string;
  title: string;
  agent: AgentId;
  workspace: string;
  createdAt: string;
  commandCount: number;
  /** Tab visual differentiator. */
  color: SessionColorId;
  /** Lifecycle state. */
  status: SessionStatus;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  command: string;
  timestamp: string;
  /** Process exit code — surfaced as a colored badge in the audit log. */
  exitCode?: number;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  agent: AgentId;
  workspace: string;
  layout: LayoutMode;
  audit: AuditEntry[];
  /** Map of sessionId -> layout slot index (for split/grid layouts). */
  layoutSlots: Record<string, number>;

  createSession: (input?: {
    title?: string;
    agent?: AgentId;
    workspace?: string;
    color?: SessionColorId;
  }) => string;
  /**
   * Add a session whose id was minted by the backend
   * (`POST /api/v1/terminal/sessions`). Used by the new-session dialog
   * after the server has registered the session in its session manager —
   * the returned UUID is what `useTerminal` uses as both the React key
   * and the WebSocket path component.
   */
  addSession: (input: {
    id: string;
    title: string;
    agent: AgentId;
    workspace: string;
    color: SessionColorId;
  }) => string;
  /**
   * Mark a session as closed (its tab fades to muted; the row stays in
   * the list with a Reopen action). Use `removeSession` to hard-delete.
   */
  closeSession: (sessionId: string) => void;
  /** Permanently delete a session from the list. */
  removeSession: (sessionId: string) => void;
  /** Reopen a previously-closed session — flips status back to active. */
  reopenSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  setAgent: (agent: AgentId) => void;
  setWorkspace: (workspace: string) => void;
  setLayout: (layout: LayoutMode) => void;
  /** Reorder tabs (drag-to-reorder from the tab bar). */
  reorderSessions: (orderedIds: string[]) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  appendAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  bumpCommandCount: (sessionId: string) => void;
}

function makeSessionId(): string {
  // Stable, URL-safe, sortable-enough id for in-memory mock state.
  return `ts_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  sessions: [],
  activeSessionId: null,
  agent: 'claude-code',
  workspace: 'default',
  layout: 'single',
  audit: [],
  layoutSlots: {},

  createSession: ({ title, agent, workspace, color } = {}) => {
    const id = makeSessionId();
    const createdAt = new Date().toISOString();
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          title: title ?? `Session ${state.sessions.length + 1}`,
          agent: agent ?? state.agent,
          workspace: workspace ?? state.workspace,
          createdAt,
          commandCount: 0,
          color: color ?? 'indigo',
          // New sessions enter the 'creating' state and flip to 'active'
          // once the WebSocket attaches in `useTerminal`.
          status: 'creating' as const,
        },
      ],
      activeSessionId: id,
    }));
    return id;
  },

  addSession: ({ id, title, agent, workspace, color }) => {
    const createdAt = new Date().toISOString();
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          title,
          agent,
          workspace,
          createdAt,
          commandCount: 0,
          color,
          // Backend-issued sessions enter 'creating' and flip to 'active'
          // when the WS opens in `useTerminal`.
          status: 'creating' as const,
        },
      ],
      activeSessionId: id,
    }));
    return id;
  },

  closeSession: (sessionId) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== sessionId);
      const closed = state.sessions.find((s) => s.id === sessionId);
      const next = closed
        ? state.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: 'closed' as const } : s,
          )
        : state.sessions;
      // If the closed tab was active, fall back to the first non-closed
      // session so the user is never stranded on a closed tab.
      const fallback =
        state.activeSessionId === sessionId
          ? (next.find((s) => s.status !== 'closed')?.id ?? null)
          : state.activeSessionId;
      return {
        sessions: next,
        activeSessionId: fallback,
      };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== sessionId);
      return {
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === sessionId
            ? (remaining.find((s) => s.status !== 'closed')?.id ??
               remaining[0]?.id ??
               null)
            : state.activeSessionId,
      };
    }),

  reopenSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'active' as const } : s,
      ),
      activeSessionId: sessionId,
    })),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  reorderSessions: (orderedIds) =>
    set((state) => {
      const byId = new Map(state.sessions.map((s) => [s.id, s]));
      const next: typeof state.sessions = [];
      for (const id of orderedIds) {
        const s = byId.get(id);
        if (s) next.push(s);
      }
      // Defensive: any session not in the order list is appended.
      for (const s of state.sessions) {
        if (!orderedIds.includes(s.id)) next.push(s);
      }
      return { sessions: next };
    }),

  setSessionStatus: (sessionId, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status } : s,
      ),
    })),

  setAgent: (agent) =>
    set((state) => ({
      agent,
      sessions: state.sessions.map((s) =>
        s.id === state.activeSessionId ? { ...s, agent } : s,
      ),
    })),

  setWorkspace: (workspace) =>
    set((state) => ({
      workspace,
      sessions: state.sessions.map((s) =>
        s.id === state.activeSessionId ? { ...s, workspace } : s,
      ),
    })),

  setLayout: (layout) => set({ layout }),

  appendAudit: (entry) =>
    set((state) => ({
      audit: [
        {
          ...entry,
          id: `a_${Math.random().toString(36).slice(2, 10)}`,
          timestamp: new Date().toISOString(),
        },
        ...state.audit,
      ].slice(0, 200),
    })),

  bumpCommandCount: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, commandCount: s.commandCount + 1 } : s,
      ),
    })),
}));

/**
 * Project Onboarding wizard state (M2 — F-021, modernized F-022).
 *
 * Tracks the current step index and per-step data so the wizard
 * survives navigation, reloads, and deep links. State is also
 * mirrored into the URL `?step=` search param (deep-linkable) and
 * persisted to `localStorage` via `zustand/middleware` so refresh
 * doesn't lose progress — matching the spec's URL + Zustand
 * persistence requirement.
 *
 * Data is typed loosely to allow each step component to define
 * its own shape; consumers narrow at the boundary.
 */
interface OnboardingState {
  currentStep: number;
  stepData: Record<number, unknown>;
  /** Per-step validation flag — true once the user has blurred a field. */
  stepTouched: Record<number, boolean>;
  /**
   * Backend wizard session id (`POST /onboarding/sessions` response).
   * `null` until `useStartWizard()` resolves. Persisted so refresh
   * resumes from the right `current_step` instead of starting over.
   */
  sessionId: string | null;
  setStep: (step: number) => void;
  setStepData: (step: number, data: unknown) => void;
  markTouched: (step: number) => void;
  setSessionId: (id: string | null) => void;
  reset: () => void;
}

const STORAGE_KEY = 'forge:onboarding:v2';

/** Coerce a URL `?step=` value into a valid 1..10 step. */
function parseStepParam(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 1,
      stepData: {},
      stepTouched: {},
      sessionId: null,
      setStep: (step) => set({ currentStep: step }),
      setStepData: (step, data) =>
        set((state) => ({ stepData: { ...state.stepData, [step]: data } })),
      markTouched: (step) =>
        set((state) => ({ stepTouched: { ...state.stepTouched, [step]: true } })),
      setSessionId: (id) => set({ sessionId: id }),
      reset: () =>
        set({
          currentStep: 1,
          stepData: {},
          stepTouched: {},
          sessionId: null,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist the data fields; do not persist actions.
      partialize: (state) => ({
        currentStep: state.currentStep,
        stepData: state.stepData,
        stepTouched: state.stepTouched,
        sessionId: state.sessionId,
      }),
      // Bump the schema version if the shape changes incompatibly.
      version: 3,
      // v2 -> v3 added `sessionId` for the backend wizard session
      // (step-74). Existing users keep their wizard progress; the
      // page creates a fresh backend session on next mount because
      // `sessionId` is null on migration.
      migrate: (persistedState, _version) => {
        const state = (persistedState ?? {}) as Partial<OnboardingState>;
        return {
          currentStep: 1,
          stepData: {},
          stepTouched: {},
          sessionId: null,
          ...state,
        };
      },
    },
  ),
);

/**
 * Sync the URL `?step=` search param with the active wizard step.
 * Run once on mount inside a client effect — never on the server,
 * because `window` and `history` are unavailable during SSR.
 */
export function syncStepFromUrl(): void {
  if (typeof window === 'undefined') return;
  const step = parseStepParam(new URL(window.location.href).searchParams.get('step'));
  if (step !== null) {
    useOnboardingStore.getState().setStep(step);
  }
}

export function pushStepToUrl(step: number): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('step') === String(step)) return;
  url.searchParams.set('step', String(step));
  // `replaceState` avoids polluting the back stack on every step change.
  window.history.replaceState({}, '', url.toString());
}

export { STORAGE_KEY as ONBOARDING_STORAGE_KEY };
