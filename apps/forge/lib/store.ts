/**
 * Client state store (Zustand).
 *
 * - `useTerminalStore` drives the Terminal Center.
 * - `useOnboardingStore` drives the Project Onboarding wizard.
 */

import { create } from 'zustand';

export type AgentId = 'claude-code' | 'codex' | 'gemini-cli' | 'custom';
export type LayoutMode = 'single' | 'split-horizontal' | 'split-vertical' | 'grid-2x2';

export interface TerminalSession {
  id: string;
  title: string;
  agent: AgentId;
  workspace: string;
  createdAt: string;
  commandCount: number;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  command: string;
  timestamp: string;
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

  createSession: (input?: { title?: string; agent?: AgentId }) => string;
  closeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  setAgent: (agent: AgentId) => void;
  setWorkspace: (workspace: string) => void;
  setLayout: (layout: LayoutMode) => void;
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

  createSession: ({ title, agent } = {}) => {
    const id = makeSessionId();
    const createdAt = new Date().toISOString();
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          title: title ?? `Session ${state.sessions.length + 1}`,
          agent: agent ?? state.agent,
          workspace: state.workspace,
          createdAt,
          commandCount: 0,
        },
      ],
      activeSessionId: id,
    }));
    return id;
  },

  closeSession: (sessionId) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== sessionId);
      return {
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === sessionId
            ? (remaining[0]?.id ?? null)
            : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

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
 * Project Onboarding wizard state (M2 — F-021).
 *
 * Tracks the current step index and per-step data so the wizard
 * survives navigation away and back. Data is typed loosely to allow
 * each step component to define its own shape.
 */
interface OnboardingState {
  currentStep: number;
  stepData: Record<number, unknown>;
  setStep: (step: number) => void;
  setStepData: (step: number, data: unknown) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  currentStep: 1,
  stepData: {},
  setStep: (step) => set({ currentStep: step }),
  setStepData: (step, data) =>
    set((state) => ({ stepData: { ...state.stepData, [step]: data } })),
  reset: () => set({ currentStep: 1, stepData: {} }),
}));
