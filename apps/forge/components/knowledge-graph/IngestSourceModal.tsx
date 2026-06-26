'use client';

import * as React from 'react';
import {
  X,
  GitBranch,
  FileText,
  Sparkles,
  Plug,
  Code2,
  Check,
  Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type IngestSourceKind = 'github' | 'docs' | 'forge' | 'connector' | 'openapi';

export interface IngestSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIngest: (kind: IngestSourceKind, payload: Record<string, string>) => void;
}

interface SourceOption {
  kind: IngestSourceKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}

const SOURCE_OPTIONS: ReadonlyArray<SourceOption> = [
  {
    kind: 'github',
    title: 'GitHub repository',
    description: 'Clone a repo, index the file tree, ADRs, and CODEOWNERS into the graph.',
    icon: <GitBranch className="h-5 w-5" aria-hidden="true" />,
    accent: '#22D3EE',
  },
  {
    kind: 'docs',
    title: 'Existing ADR / docs',
    description: 'Upload markdown, JSON, or YAML — Forge extracts nodes + edges from front-matter.',
    icon: <FileText className="h-5 w-5" aria-hidden="true" />,
    accent: '#A855F7',
  },
  {
    kind: 'forge',
    title: 'Forge artefacts',
    description: 'Auto-detect ADRs, runs, agents, ideas, risks, tasks, tests already in the project.',
    icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
    accent: '#F59E0B',
  },
  {
    kind: 'connector',
    title: 'Connector',
    description: 'Stream from Jira, Notion, Confluence, or Linear via an installed connector.',
    icon: <Plug className="h-5 w-5" aria-hidden="true" />,
    accent: '#10B981',
  },
  {
    kind: 'openapi',
    title: 'OpenAPI / AsyncAPI',
    description: 'Upload a spec — Forge extracts services, components, and dependencies automatically.',
    icon: <Code2 className="h-5 w-5" aria-hidden="true" />,
    accent: '#F43F5E',
  },
];

type Phase = 'pick' | 'progress' | 'success';

/**
 * Zone 6 — modal with 5 source option cards. Each card reveals a basic
 * form. After "Connect & ingest" we show a fake progress phase (since
 * there's no real backend), then a success state with node/edge counts.
 */
export function IngestSourceModal({ open, onOpenChange, onIngest }: IngestSourceModalProps) {
  const [phase, setPhase] = React.useState<Phase>('pick');
  const [selected, setSelected] = React.useState<IngestSourceKind | null>(null);
  const [counts, setCounts] = React.useState({ nodes: 0, edges: 0 });
  const [payload, setPayload] = React.useState<Record<string, string>>({});

  // Reset internal state when the modal closes.
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setPhase('pick');
        setSelected(null);
        setCounts({ nodes: 0, edges: 0 });
        setPayload({});
      }, 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const start = () => {
    if (!selected) return;
    setPhase('progress');
    onIngest(selected, payload);
    // Simulated progress — replace with real subscription when backend lands.
    const fakeNodes = Math.floor(80 + Math.random() * 220);
    const fakeEdges = Math.floor(Math.floor(fakeNodes * 0.35) + Math.random() * 30);
    setTimeout(() => {
      setCounts({ nodes: fakeNodes, edges: fakeEdges });
      setPhase('success');
    }, 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-label="Ingest a knowledge source"
      data-testid="ingest-modal"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-[560px] rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {phase === 'pick' && (
          <>
            <h2 className="text-lg font-bold text-[var(--fg-primary)]">
              Connect a knowledge source
            </h2>
            <p className="mt-1 text-sm text-[var(--fg-secondary)]">
              Pick a source and Forge will ingest nodes + edges into your graph.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SOURCE_OPTIONS.map((opt) => {
                const active = selected === opt.kind;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => setSelected(opt.kind)}
                    aria-pressed={active}
                    data-testid="ingest-source-option"
                    data-source={opt.kind}
                    className={cn(
                      'flex flex-col items-start gap-1.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors',
                      active
                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.06)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)]"
                      style={{ background: `${opt.accent}1a`, color: opt.accent }}
                    >
                      {opt.icon}
                    </span>
                    <span className="text-sm font-semibold text-[var(--fg-primary)]">{opt.title}</span>
                    <span className="text-[11px] leading-snug text-[var(--fg-secondary)]">{opt.description}</span>
                  </button>
                );
              })}
            </div>

            {selected && (
              <SourceForm
                kind={selected}
                values={payload}
                onChange={(k, v) => setPayload((p) => ({ ...p, [k]: v }))}
              />
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={start}
                data-testid="ingest-start"
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Connect & ingest
              </button>
            </div>
          </>
        )}

        {phase === 'progress' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="ingest-progress">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-primary)]" aria-hidden="true" />
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">Ingesting…</h3>
            <p className="text-sm text-[var(--fg-secondary)]">
              Found nodes · Linking in progress — this takes a few seconds.
            </p>
          </div>
        )}

        {phase === 'success' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="ingest-success">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]">
              <Check className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">Knowledge graph updated</h3>
            <p className="text-sm text-[var(--fg-secondary)]">
              <span className="font-mono text-[var(--accent-emerald)]">{counts.nodes}</span> new nodes ·{' '}
              <span className="font-mono text-[var(--accent-cyan)]">{counts.edges}</span> new connections
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              View graph
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceForm({
  kind,
  values,
  onChange,
}: {
  kind: IngestSourceKind;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const labelCls = 'mb-1 block text-[11px] font-medium text-[var(--fg-secondary)]';
  const inputCls =
    'h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40';

  if (kind === 'github') {
    return (
      <div className="mt-4 space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div>
          <label className={labelCls} htmlFor="gh-url">Repository URL</label>
          <input id="gh-url" className={inputCls} placeholder="https://github.com/owner/repo" value={values.url ?? ''} onChange={(e) => onChange('url', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="gh-branch">Branch</label>
            <input id="gh-branch" className={inputCls} placeholder="main" value={values.branch ?? ''} onChange={(e) => onChange('branch', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="gh-path">Path filter</label>
            <input id="gh-path" className={inputCls} placeholder="docs/**" value={values.path ?? ''} onChange={(e) => onChange('path', e.target.value)} />
          </div>
        </div>
      </div>
    );
  }
  if (kind === 'docs') {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--fg-tertiary)]">
        <FileText className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />
        Drop .md, .json, or .yaml files here, or click to browse.
      </div>
    );
  }
  if (kind === 'forge') {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--fg-secondary)]">
        Forge will scan <code className="font-mono text-[var(--accent-primary)]">.forge/</code> and the artifact tables.
        Nothing to configure.
      </div>
    );
  }
  if (kind === 'connector') {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <label className={labelCls} htmlFor="connector-pick">Connector</label>
        <select id="connector-pick" className={inputCls} value={values.connector ?? 'jira'} onChange={(e) => onChange('connector', e.target.value)}>
          <option value="jira">Jira</option>
          <option value="notion">Notion</option>
          <option value="confluence">Confluence</option>
          <option value="linear">Linear</option>
        </select>
      </div>
    );
  }
  // openapi
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--fg-tertiary)]">
      <Code2 className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />
      Drop an OpenAPI 3.x or AsyncAPI 2.x spec here.
    </div>
  );
}