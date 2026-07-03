'use client';

/**
 * New Session dialog — opened from the hero "+ New session" button.
 *
 * Step-71: posts to the backend so the session has a server-issued UUID
 * that `useTerminal` can use as the WebSocket path component. The
 * dialog no longer fabricates local-only sessions — every pane opened
 * from this dialog has a backing `session_manager` entry on the server.
 *
 * Collects: name, agent, workspace, color tag. The color tag is purely a
 * visual differentiator on the session tab so multiple Claude / Codex /
 * Aider sessions remain scannable at a glance.
 *
 * Skill influence:
 *   - ux-guideline (forms / submit feedback) — primary button disabled
 *     until required fields are valid; `Submit` -> `Creating…` -> close.
 *   - ux-guideline (color-only signal) — the color dot is always paired
 *     with the label text so color is never the sole channel.
 */

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { useTerminalStore, type AgentId } from '@/lib/store';

export const SESSION_COLOR_TAGS = [
  { id: 'indigo',  label: 'Indigo',  hex: '#6366F1' },
  { id: 'cyan',    label: 'Cyan',    hex: '#22D3EE' },
  { id: 'emerald', label: 'Emerald', hex: '#10B981' },
  { id: 'amber',   label: 'Amber',   hex: '#F59E0B' },
  { id: 'rose',    label: 'Rose',    hex: '#F43F5E' },
  { id: 'violet',  label: 'Violet',  hex: '#A855F7' },
  { id: 'slate',   label: 'Slate',   hex: '#94A3B1' },
  { id: 'lime',    label: 'Lime',    hex: '#A3E635' },
] as const;

export type SessionColorId = (typeof SESSION_COLOR_TAGS)[number]['id'];

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the backend confirms the session. Receives the
   * server-issued id so the caller can register the session in the
   * store with the same UUID that the WebSocket handler will validate
   * against the session_manager. */
  onCreated: (session: {
    id: string;
    title: string;
    agent: AgentId;
    workspace: string;
    color: SessionColorId;
  }) => void;
}

const AGENT_LABELS: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  custom: 'Custom agent',
  aider: 'Aider',
  cursor: 'Cursor',
};

// Map frontend AgentId → backend AgentType enum value. The store's
// `aider` / `cursor` ids fall back to `custom` since the backend v1
// has no dedicated binary for them yet.
const AGENT_TO_BACKEND: Record<AgentId, 'claude_code' | 'codex' | 'gemini' | 'custom'> = {
  'claude-code': 'claude_code',
  codex: 'codex',
  'gemini-cli': 'gemini',
  custom: 'custom',
  aider: 'custom',
  cursor: 'custom',
};

const WORKSPACES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'default', label: 'default' },
  { id: 'forge-core', label: 'forge-core' },
  { id: 'forge-ui', label: 'forge-ui' },
  { id: 'sandbox', label: 'sandbox' },
];

function defaultName(agent: AgentId): string {
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  const tag = agent.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return `${tag}-${stamp}`;
}

interface BackendSessionResponse {
  id: string;
  agent_type: 'claude_code' | 'codex' | 'gemini' | 'custom';
  websocket_path: string;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  onCreated,
}: NewSessionDialogProps) {
  const currentAgent = useTerminalStore((s) => s.agent);
  const currentWorkspace = useTerminalStore((s) => s.workspace);

  const [name, setName] = React.useState('');
  const [agent, setAgent] = React.useState<AgentId>(currentAgent);
  const [workspace, setWorkspace] = React.useState<string>(currentWorkspace);
  const [color, setColor] = React.useState<SessionColorId>('indigo');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset defaults whenever the dialog re-opens so a stale name never
  // leaks from the previous open.
  React.useEffect(() => {
    if (open) {
      setName(defaultName(currentAgent));
      setAgent(currentAgent);
      setWorkspace(currentWorkspace);
      setColor('indigo');
      setSubmitting(false);
      setError(null);
    }
  }, [open, currentAgent, currentWorkspace]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const create = useMutation<BackendSessionResponse, Error, void>({
    mutationFn: () =>
      api.post<BackendSessionResponse>('/terminal/sessions', {
        agent_type: AGENT_TO_BACKEND[agent],
        workspace_path: workspace,
      }),
  });

  const submit = React.useCallback(() => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    create.mutate(undefined, {
      onSuccess: (session) => {
        onCreated({
          id: session.id,
          title: trimmed,
          agent,
          workspace,
          color,
        });
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err.message || 'Failed to create session');
        setSubmitting(false);
      },
    });
  }, [
    canSubmit,
    trimmed,
    agent,
    workspace,
    color,
    onCreated,
    onOpenChange,
    create,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="new-session-dialog"
        className="sm:max-w-[460px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            New terminal session
          </DialogTitle>
          <DialogDescription>
            Pick an agent, workspace, and tab color. You can change any of these later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="new-session-name">Session name</Label>
            <Input
              id="new-session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-claude-session"
              autoFocus
              data-testid="new-session-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="new-session-agent">Agent</Label>
              <Select
                value={agent}
                onValueChange={(v) => setAgent(v as AgentId)}
              >
                <SelectTrigger id="new-session-agent" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AGENT_LABELS) as AgentId[]).map((id) => (
                    <SelectItem key={id} value={id}>
                      {AGENT_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-session-workspace">Workspace</Label>
              <Select value={workspace} onValueChange={setWorkspace}>
                <SelectTrigger id="new-session-workspace" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSPACES.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Color tag</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color tag">
              {SESSION_COLOR_TAGS.map((c) => {
                const selected = c.id === color;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c.label}
                    onClick={() => setColor(c.id)}
                    className={cn(
                      'group inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs btn-press',
                      selected
                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                        : 'border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
                    )}
                    data-testid={`color-tag-${c.id}`}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: c.hex }}
                    />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-[var(--accent-rose)]"
              data-testid="new-session-error"
            >
              {error}
            </motion.p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="new-session-submit"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create session
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}