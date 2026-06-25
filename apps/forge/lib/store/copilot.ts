/**
 * Co-pilot client state (Zustand).
 *
 * Drives the right-side Cmd+J Co-pilot panel. Mirrors the shape of
 * `useTerminalStore` (see `lib/store.ts`) so the rest of the app
 * can compose panel + terminal state in one place later if needed.
 *
 * F-800 Plan 2 — frontend shell + scaffold. Plan 3 adds the
 * conversation list + API integration on top of these primitives.
 * Plan 4 adds `firstRunDismissed` + `dismissFirstRun()` so the
 * one-time "Press ⌘J to chat with Co-pilot" tooltip can persist
 * its dismissal across reloads via localStorage.
 */

import { create } from 'zustand';

const FIRST_RUN_STORAGE_KEY = 'forge.copilot.firstRunDismissed';

interface CopilotState {
  open: boolean;
  activeConversationId: string | null;
  draft: string;
  lastError: string | null;
  firstRunDismissed: boolean;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversation: (id: string | null) => void;
  setDraft: (draft: string) => void;
  appendDraft: (chunk: string) => void;
  clearDraft: () => void;
  setError: (msg: string | null) => void;
  dismissFirstRun: () => void;
}

export const useCopilotStore = create<CopilotState>((set) => ({
  open: false,
  activeConversationId: null,
  draft: '',
  lastError: null,
  // Initialize from localStorage when available; SSR-safe default `false`.
  firstRunDismissed:
    typeof window !== 'undefined'
      ? window.localStorage.getItem(FIRST_RUN_STORAGE_KEY) === '1'
      : false,

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setDraft: (draft) => set({ draft }),
  appendDraft: (chunk) =>
    set((state) => ({ draft: state.draft + chunk })),
  clearDraft: () => set({ draft: '' }),
  setError: (msg) => set({ lastError: msg }),
  dismissFirstRun: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, '1');
    }
    set({ firstRunDismissed: true });
  },
}));
