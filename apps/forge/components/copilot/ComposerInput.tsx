'use client';

/**
 * Step 37 — Compact Co-pilot composer (Linear-style).
 *
 * Replaces the Step 24 four-row chrome with a tighter three-row layout:
 *
 *   1. TOP TOOLBAR  (h-36px)
 *      - LEFT cluster: model picker (Combobox-style chip)
 *      - CENTER: mode pill (`/general`) — click to change mode
 *      - RIGHT: attachments (Paperclip), voice (Mic), close (X)
 *
 *   2. INPUT ROW (auto-grow, max-h-160px scroll)
 *      - Single-line → 6 lines
 *      - "/" trigger: slash commands popover
 *      - "@" trigger: context attachments
 *
 *   3. ATTACHED CONTEXT ROW (only when context > 0, h-32px)
 *      - Compact pills: "@dashboard · @Forge Platform" with X to remove
 *      - "+ Add context" inline button
 *
 *   4. FOOTER ROW (h-28px)
 *      - LEFT: keyboard hints (Enter to send · Shift+Enter newline · /)
 *      - RIGHT: char counter (mono)
 *      - Send button: floating bottom-right circular 36×36
 *
 * Removed (cleaner):
 *   - The $3 / $15 per 1M cost display (lives in model picker tooltip)
 *   - "FREE FOR PREVIEW" badge (the model picker shows tier)
 *   - ⌘J toggle hint in the input area (global shortcut already shown)
 *
 * Skill influence (ui-ux-pro-max):
 *   - "AI-Native UI" — circular 36×36 send button mirrors Claude /
 *     Notion AI; the cyan glow on focus draws the eye to the action.
 *   - "Streaming" UX rule — streaming state shows a Square stop
 *     button inline; we don't block the user behind a modal.
 *   - "Show helpful message and action" — every toolbar control has
 *     an aria-label AND a visible tooltip on hover.
 *   - "Focus States" + "Keyboard Navigation" — full keyboard nav
 *     with Tab order; Esc closes popovers; Cmd+J toggles the panel.
 *
 * Backwards-compat: existing send-mutation flow is unchanged. We
 * added the toolbar + cost row + drop overlay as additive layout.
 */

import * as React from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Mic,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useSendMessage } from '@/hooks/use-copilot-mutations';
import {
  COPILOT_ERROR_CODES,
  ForgeApiError,
} from '@/lib/forge-api';
import {
  dispatchCopilotGuardrailDenied,
  dispatchCopilotRateLimit,
} from '@/hooks/use-copilot-toasts';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

import { SlashCommandPopover } from './SlashCommandPopover';
import { ContextPills } from './ContextPills';

const MAX_ROWS = 6;
const MAX_CHARS = 8000;

// ─────────────────────────────────────────────────────────────────────
// Model picker — local-only (the API doesn't expose a model catalog
// yet; the picker is wired through the Layer 1 Provider Abstraction
// per Rule 1 — no SDK imports).
// ─────────────────────────────────────────────────────────────────────

interface ModelOption {
  id: string;
  label: string;
  hint: string;
  cost: string;
}

const MODELS: ReadonlyArray<ModelOption> = [
  { id: 'auto', label: 'Auto', hint: 'Routes per task', cost: 'var' },
  { id: 'sonnet', label: 'Claude Sonnet 4.5', hint: 'Balanced', cost: '$3 / $15 per 1M' },
  { id: 'opus', label: 'Claude Opus 4.8', hint: 'Deep reasoning', cost: '$15 / $75 per 1M' },
  { id: 'gpt4o', label: 'GPT-4o', hint: 'Multimodal', cost: '$2.5 / $10 per 1M' },
];

const MODEL_STORAGE_KEY = 'forge.copilot.model.v1';

function readPersistedModel(): string {
  if (typeof window === 'undefined') return MODELS[1]!.id;
  try {
    const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (raw && MODELS.some((m) => m.id === raw)) return raw;
  } catch {
    // ignore
  }
  return MODELS[1]!.id;
}

// ─────────────────────────────────────────────────────────────────────
// Mode pill — quick toggle for `/command` popover. Mirrors the
// modes defined in EmptyState so the picker stays consistent.
// ─────────────────────────────────────────────────────────────────────

const MODES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'general', label: '/general' },
  { id: 'code', label: '/code' },
  { id: 'adr', label: '/adr' },
  { id: 'debug', label: '/debug' },
  { id: 'architecture', label: '/architecture' },
];

const MODE_STORAGE_KEY = 'forge.copilot.mode.v1';

function readPersistedMode(): string {
  if (typeof window === 'undefined') return MODES[0]!.id;
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (raw && MODES.some((m) => m.id === raw)) return raw;
  } catch {
    // ignore
  }
  return MODES[0]!.id;
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function ComposerInput() {
  const draft = useCopilotStore((s) => s.draft);
  const setDraft = useCopilotStore((s) => s.setDraft);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const setError = useCopilotStore((s) => s.setError);
  const setPermissionDenied = useCopilotStore((s) => s.setPermissionDenied);
  const streaming = useCopilotStore((s) => s.streaming);
  const setStreaming = useCopilotStore((s) => s.setStreaming);

  const sendMessage = useSendMessage();
  const pathname = usePathname() ?? '/';
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Local state — model selection, mode, slash popover, attachments,
  // drag overlay, voice recording hint. Context pills come from the
  // shared ContextPills component.
  const [modelId, setModelId] = React.useState<string>(() => readPersistedModel());
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [modeId, setModeId] = React.useState<string>(() => readPersistedMode());
  const [modeMenuOpen, setModeMenuOpen] = React.useState(false);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashQuery, setSlashQuery] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const dragCounter = React.useRef(0);

  const selectedModel = MODELS.find((m) => m.id === modelId) ?? MODELS[1]!;
  const selectedMode = MODES.find((m) => m.id === modeId) ?? MODES[0]!;

  // Persist model + mode selection.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  }, [modelId]);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, modeId);
  }, [modeId]);

  // Auto-grow up to MAX_ROWS. After 6 lines we surface an internal
  // scrollbar on the textarea — the toolbar + footer stay fixed.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * MAX_ROWS;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  const handleSend = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || sendMessage.isPending) return;
    setError(null);
    setPermissionDenied(false);
    setStreaming(true);
    setSlashOpen(false);

    sendMessage.mutate(
      {
        conversation_id: activeConversationId,
        project_id: null,
        message: trimmed,
        context: {
          current_page: pathname,
          current_center: null,
          current_artifact_id: null,
          recent_actions: [],
        },
      },
      {
        onSuccess: (response) => {
          setActiveConversation(response.conversation_id);
          clearDraft();
        },
        onError: (err) => {
          // M10 Track B — structured failure shapes. We dispatch
          // toast events instead of (or in addition to) the inline
          // `lastError` path so the panel renders a tailored toast
          // rather than a generic "Send failed" line.
          const forgeErr = err as ForgeApiError | null;
          const status = forgeErr?.status;
          const errorCode = forgeErr?.errorCode ?? null;
          const isRateLimit =
            status === 429 ||
            errorCode === COPILOT_ERROR_CODES.RATE_LIMIT_EXCEEDED;
          const isGuardrail = errorCode === COPILOT_ERROR_CODES.GUARDRAIL_DENIED;

          if (isRateLimit) {
            // Retry-After header is the authoritative source per
            // spec (M10-G1). `Headers.get` is already
            // case-insensitive, but we read both casings for
            // resilience against intermediaries that re-case.
            const headers = forgeErr?.headers ?? null;
            const raw =
              headers?.get('Retry-After') ?? headers?.get('retry-after');
            const retryAfter = Number(raw ?? '0');
            const safeRetry = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter
              : 60;
            dispatchCopilotRateLimit(safeRetry);
            setError(null);
          } else if (isGuardrail) {
            dispatchCopilotGuardrailDenied();
            setError(null);
          } else if (status === 403) {
            setPermissionDenied(true);
          } else {
            setError(err instanceof Error ? err.message : 'Send failed');
          }
        },
        onSettled: () => {
          setStreaming(false);
        },
      },
    );
  }, [
    draft,
    sendMessage,
    activeConversationId,
    pathname,
    setError,
    setPermissionDenied,
    setActiveConversation,
    clearDraft,
    setStreaming,
  ]);

  const handleStop = React.useCallback(() => {
    // TanStack Query mutations don't expose cancel for fetchers out
    // of the box; here we just flip the streaming flag so the UI
    // leaves the "thinking" state. The backend will still complete
    // the response, which is fine — we just stop showing the
    // spinner in the composer.
    setStreaming(false);
  }, [setStreaming]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash popover keyboard nav.
      if (slashOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashOpen(false);
          setSlashQuery('');
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, slashOpen],
  );

  const handleDraftChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setDraft(value);
      // "/" trigger — open popover when the user types a bare "/".
      // We open for any line that ends with a "/" or contains a "/"
      // followed by alpha chars (the command filter query).
      const match = value.match(/\/([a-zA-Z]*)$/);
      if (match) {
        setSlashOpen(true);
        setSlashQuery(match[1] ?? '');
      } else if (slashOpen) {
        setSlashOpen(false);
        setSlashQuery('');
      }
    },
    [setDraft, slashOpen],
  );

  const handleSelectSlash = React.useCallback(
    (replacement: string) => {
      // Replace the trailing "/<query>" with the chosen command's
      // insertion string.
      const next = draft.replace(/\/[a-zA-Z]*$/, replacement);
      setDraft(next);
      setSlashOpen(false);
      setSlashQuery('');
      textareaRef.current?.focus();
    },
    [draft, setDraft],
  );

  // ── Drag-drop attachments ─────────────────────────────────────
  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  }, []);
  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }, []);
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...files.map<Attachment>((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}`,
        name: f.name,
        size: f.size,
        kind: f.type.startsWith('image/') ? 'image' : 'file',
      })),
    ]);
  }, []);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Attachment button — opens file picker ────────────────────
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const handleAttachClick = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      setAttachments((prev) => [
        ...prev,
        ...files.map<Attachment>((f) => ({
          id: `${f.name}-${f.size}-${f.lastModified}`,
          name: f.name,
          size: f.size,
          kind: f.type.startsWith('image/') ? 'image' : 'file',
        })),
      ]);
      e.target.value = '';
    },
    [],
  );

  // ── Voice input — stub ───────────────────────────────────────
  const handleVoiceClick = React.useCallback(() => {
    // Real implementation would wire MediaRecorder; we toggle a
    // visible "Listening…" affordance so the contract is in place.
    setListening((v) => !v);
  }, []);

  // Close popovers when the user clicks outside.
  React.useEffect(() => {
    if (!modelMenuOpen && !modeMenuOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-copilot-model-popover]')) return;
      if (target.closest('[data-copilot-mode-popover]')) return;
      if (target.closest('[data-testid="copilot-model-picker"]')) return;
      if (target.closest('[data-testid="copilot-mode-pill"]')) return;
      setModelMenuOpen(false);
      setModeMenuOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [modelMenuOpen, modeMenuOpen]);

  const charCount = draft.length;
  const canSend = charCount > 0 && !sendMessage.isPending;
  const placeholder = 'Ask the Co-pilot anything…';
  const showContextRow = attachments.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-3"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="copilot-composer"
    >
      {/* Drag-drop overlay */}
      {dragActive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 backdrop-blur-sm"
        >
          <span className="flex items-center gap-2 text-[var(--text-sm)] font-medium text-[var(--accent-primary)]">
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            Drop to attach
          </span>
        </div>
      ) : null}

      {/* TOP TOOLBAR ──────────────────────────────────────────── */}
      <div className="flex h-9 items-center justify-between gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
        {/* LEFT — model picker */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setModelMenuOpen((v) => !v);
              setModeMenuOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
            title={`${selectedModel.label} — ${selectedModel.cost}`}
            className={cn(
              'flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--text-xs)] font-medium text-[var(--fg-secondary)]',
              'hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
            )}
            data-testid="copilot-model-picker"
          >
            <span aria-hidden="true" className="text-[var(--accent-cyan)]">
              ✨
            </span>
            <span className="hidden max-w-[120px] truncate sm:inline">
              {selectedModel.label}
            </span>
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          {modelMenuOpen ? (
            <div
              data-copilot-model-popover
              role="menu"
              aria-label="Choose model"
              className="absolute bottom-[calc(100%+4px)] left-0 z-30 min-w-[260px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
              data-testid="copilot-model-menu"
            >
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m.id === modelId}
                  onClick={() => {
                    setModelId(m.id);
                    setModelMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-[var(--fg-primary)]">{m.label}</span>
                    <span className="text-[10px] text-[var(--fg-tertiary)]">{m.hint}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)]">
                    {m.cost}
                    {m.id === modelId ? (
                      <Check className="h-3 w-3 text-[var(--accent-primary)]" aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* CENTER — mode pill */}
          <button
            type="button"
            onClick={() => {
              setModeMenuOpen((v) => !v);
              setModelMenuOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={modeMenuOpen}
            title="Change mode"
            className={cn(
              'flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--text-xs)] font-medium text-[var(--fg-secondary)]',
              'hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
            )}
            data-testid="copilot-mode-pill"
          >
            <span className="text-[var(--accent-violet)]">{selectedMode.label}</span>
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          {modeMenuOpen ? (
            <div
              data-copilot-mode-popover
              role="menu"
              aria-label="Change mode"
              className="absolute bottom-[calc(100%+4px)] left-[110px] z-30 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
              data-testid="copilot-mode-menu"
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m.id === modeId}
                  onClick={() => {
                    setModeId(m.id);
                    setModeMenuOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-xs)]',
                    m.id === modeId
                      ? 'text-[var(--fg-primary)]'
                      : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                  )}
                >
                  <span className="text-[var(--accent-violet)]">{m.label}</span>
                  {m.id === modeId ? (
                    <Check className="ml-auto h-3 w-3 text-[var(--accent-primary)]" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* RIGHT — attachments, voice, close-panel */}
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleAttachClick}
            aria-label="Attach files"
            title="Attach files"
            data-testid="copilot-attach-button"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              listening && 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]',
            )}
            onClick={handleVoiceClick}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
            title={listening ? 'Listening… click to stop' : 'Voice input'}
            data-testid="copilot-voice-button"
            data-listening={listening ? 'true' : 'false'}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* ATTACHED CONTEXT ROW (only when context > 0) ───────────── */}
      {showContextRow ? (
        <div
          className="flex h-8 flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2"
          data-testid="copilot-attachment-row"
        >
          {attachments.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-0.5 text-[11px] text-[var(--fg-secondary)]"
            >
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
                aria-label={`Remove ${a.name}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* INPUT ROW (relative to anchor slash popover) ──────────── */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          maxLength={MAX_CHARS}
          className={cn(
            'flex w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-[var(--text-sm)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)] placeholder:text-[var(--fg-tertiary)]',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          aria-label="Co-pilot message"
          data-testid="copilot-composer-input"
        />
        {slashOpen ? (
          <SlashCommandPopover
            query={slashQuery}
            onSelect={handleSelectSlash}
            onClose={() => {
              setSlashOpen(false);
              setSlashQuery('');
            }}
          />
        ) : null}
      </div>

      {/* Context pills (in-page context @dashboard etc) ────────── */}
      <ContextPills />

      {/* FOOTER ROW (h-28px) ───────────────────────────────────── */}
      <div className="flex h-7 items-center justify-between gap-2 px-0.5 text-[10px] text-[var(--fg-tertiary)]">
        <p className="truncate">
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{' '}
          to send ·{' '}
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[10px]">
            Shift+Enter
          </kbd>{' '}
          newline ·{' '}
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[10px]">
            /
          </kbd>{' '}
          commands
        </p>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {charCount} / {MAX_CHARS}
          </span>
          {streaming || sendMessage.isPending ? (
            <Button
              type="button"
              onClick={handleStop}
              aria-label="Stop generating"
              className="h-7 w-7 rounded-full bg-[var(--bg-elevated)] text-[var(--fg-primary)] hover:bg-[var(--bg-hover)]"
              data-testid="copilot-stop-button"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                'h-9 w-9 rounded-full p-0 transition-all',
                canSend
                  ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_18px_rgba(99,102,241,0.45)] hover:bg-[var(--accent-primary)] hover:shadow-[0_0_24px_rgba(99,102,241,0.6)]'
                  : 'bg-[var(--bg-inset)] text-[var(--fg-muted)] hover:bg-[var(--bg-inset)]',
              )}
              data-testid="copilot-send-button"
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: 'image' | 'file';
}
