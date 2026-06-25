/**
 * Co-pilot client state (Zustand).
 *
 * Drives the right-side Cmd+J Co-pilot panel. Mirrors the shape of
 * `useTerminalStore` (see `lib/store.ts`) so the rest of the app
 * can compose panel + terminal state in one place later if needed.
 *
 * F-800 Plan 2 — frontend shell + scaffold. Plan 3 will add the
 * conversation list + API integration on top of these primitives.
 */

import { create } from 'zustand';

interface CopilotState {
  open: boolean;
  activeConversationId: string | null;
  draft: string;
  lastError: string | null;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversation: (id: string | null) => void;
  setDraft: (draft: string) => void;
  appendDraft: (chunk: string) => void;
  clearDraft: () => void;
  setError: (msg: string | null) => void;
}

export const useCopilotStore = create<CopilotState>((set) => ({
  open: false,
  activeConversationId: null,
  draft: '',
  lastError: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setDraft: (draft) => set({ draft }),
  appendDraft: (chunk) =>
    set((state) => ({ draft: state.draft + chunk })),
  clearDraft: () => set({ draft: '' }),
  setError: (msg) => set({ lastError: msg }),
}));
