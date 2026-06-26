'use client';

import * as React from 'react';
import {
  Bot,
  CheckCircle2,
  CircleStop,
  Clock,
  Globe,
  Hand,
  PlayCircle,
  Sparkles,
  Terminal,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { BaseNode } from './BaseNode';
import type {
  AgentNodeData,
  APIRequestNodeData,
  ApprovalNodeData,
  CommandNodeData,
  ConditionNodeData,
  EndNodeData,
  LLMPromptNodeData,
  TriggerNodeData,
  WaitNodeData,
  WorkflowNodeData,
} from '@/lib/workflow/types';

/* ---------------------------------------------------------------------------
 * 1. TriggerNode — diamond shape via rotation, emerald accent.
 * --------------------------------------------------------------------------- */

const TRIGGER_ICON: Record<TriggerNodeData['triggerType'], LucideIcon> = {
  manual: PlayCircle,
  webhook: Webhook,
  schedule: Clock,
  event: Sparkles,
};

const TRIGGER_DETAIL: Record<TriggerNodeData['triggerType'], string> = {
  manual: 'Manual',
  webhook: 'Webhook',
  schedule: 'Schedule',
  event: 'Event',
};

export function TriggerNode(props: NodeProps) {
  const data = props.data as unknown as TriggerNodeData & { runState?: unknown };
  const Icon = TRIGGER_ICON[data.triggerType] ?? PlayCircle;
  const detail = data.triggerDetail ?? TRIGGER_DETAIL[data.triggerType];
  return (
    <div className="relative h-[120px] w-[160px]">
      {/* Diamond shape */}
      <div
        className="absolute inset-0 rotate-45 rounded-[var(--radius-md)] border-2 bg-[var(--bg-elevated)]"
        style={{ borderColor: 'var(--accent-emerald)' }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--accent-emerald)]">
          Trigger
        </span>
        <span className="text-sm font-semibold text-[var(--fg-primary)]">{data.label}</span>
        <span className="flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)]">
          <Icon className="h-3 w-3" aria-hidden="true" />
          {detail}
        </span>
        {data.triggerDetail && data.triggerDetail !== detail ? (
          <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
            {data.triggerDetail}
          </span>
        ) : null}
      </div>
      {/* Right handle only */}
      <div
        className="absolute right-[-7px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[var(--bg-base)]"
        style={{ background: 'var(--accent-emerald)' }}
        data-handle="source"
        data-handle-id="out"
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 2. CommandNode — cyan accent.
 * --------------------------------------------------------------------------- */

export function CommandNode(props: NodeProps) {
  const baseData = props.data as unknown as CommandNodeData;
  const slug = baseData.commandName.startsWith('forge-')
    ? baseData.commandName
    : `forge-${baseData.commandName.toLowerCase().replace(/\s+/g, '-')}`;
  const data: CommandNodeData = { ...baseData, summary: `Run ${slug}` };
  // Step-23: estimated duration depends on command category. Heuristic only.
  const estMs = slug.includes('test') ? 4500 : slug.includes('deploy') ? 12000 : 2500;
  const estLabel = estMs < 60000 ? `~${Math.round(estMs / 1000)}s` : `~${Math.round(estMs / 60000)}m`;
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-cyan"
      icon={Terminal}
      kindLabel="Command"
      showInputHandle
      showOutputHandle
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{slug}</span>
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{estLabel}</span>
        </div>
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * 3. AgentNode — violet accent, hexagon-ish via rounded card.
 * --------------------------------------------------------------------------- */

export function AgentNode(props: NodeProps) {
  const baseData = props.data as unknown as AgentNodeData;
  const data: AgentNodeData = {
    ...baseData,
    subtitle: baseData.agentLabel,
    ...(baseData.taskDescription ? { summary: baseData.taskDescription } : {}),
  };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-violet"
      icon={Bot}
      kindLabel="Agent"
    />
  );
}

/* ---------------------------------------------------------------------------
 * 4. LLMPromptNode — violet accent with sparkles.
 * --------------------------------------------------------------------------- */

export function LLMPromptNode(props: NodeProps) {
  const baseData = props.data as unknown as LLMPromptNodeData;
  // Step-23: show first 2 lines of the prompt (was 1 line truncated).
  const lines = baseData.prompt.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join('\n');
  const data: LLMPromptNodeData = {
    ...baseData,
    summary: preview + (lines.length > 2 ? '\n…' : ''),
  };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-violet"
      icon={Sparkles}
      kindLabel="LLM Prompt"
      footer={
        baseData.model ? (
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">
            {baseData.model}
            {baseData.temperature !== undefined ? ` · t=${baseData.temperature}` : ''}
          </span>
        ) : undefined
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * 5. APIRequestNode — amber accent.
 * --------------------------------------------------------------------------- */

const METHOD_CLS: Record<APIRequestNodeData['method'], string> = {
  GET: 'bg-[rgba(16,185,129,0.18)] text-[var(--accent-emerald)]',
  POST: 'bg-[rgba(6,182,212,0.18)] text-[var(--accent-cyan)]',
  PUT: 'bg-[rgba(245,158,11,0.18)] text-[var(--accent-amber)]',
  PATCH: 'bg-[rgba(168,85,247,0.18)] text-[var(--accent-violet)]',
  DELETE: 'bg-[rgba(244,63,94,0.18)] text-[var(--accent-rose)]',
};

export function APIRequestNode(props: NodeProps) {
  const baseData = props.data as unknown as APIRequestNodeData;
  const data: APIRequestNodeData = { ...baseData, subtitle: baseData.url };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-amber"
      icon={Globe}
      kindLabel="HTTP Request"
    >
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]">
        <span
          className={`inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono font-semibold ${METHOD_CLS[baseData.method]}`}
        >
          {baseData.method}
        </span>
        {baseData.headersCount ? <span>Headers: {baseData.headersCount}</span> : null}
        {baseData.hasBody ? <span>Body: JSON</span> : null}
      </div>
    </BaseNode>
  );
}

/* ---------------------------------------------------------------------------
 * 6. ApprovalNode — rose accent, diamond-ish.
 * --------------------------------------------------------------------------- */

export function ApprovalNode(props: NodeProps) {
  const baseData = props.data as unknown as ApprovalNodeData;
  const data: ApprovalNodeData = {
    ...baseData,
    subtitle: `Expires in ${baseData.timeoutHours}h`,
    ...(baseData.criteria ? { summary: baseData.criteria } : {}),
  };
  const visible = baseData.approverIds.slice(0, 4);
  const extra = baseData.approverIds.length - visible.length;
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-rose"
      icon={Hand}
      kindLabel="Approval"
      footer={
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {visible.map((id, i) => (
              <span
                key={`${id}-${i}`}
                title={id}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg-elevated)] bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-secondary)]"
              >
                {id.replace(/^role:/, '').slice(0, 2).toUpperCase()}
              </span>
            ))}
            {extra > 0 ? (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg-elevated)] bg-[var(--bg-inset)] text-[10px] text-[var(--fg-tertiary)]">
                +{extra}
              </span>
            ) : null}
          </div>
          <span className="text-[11px] text-[var(--fg-tertiary)]">
            {baseData.approverIds.length} approver{baseData.approverIds.length === 1 ? '' : 's'}
          </span>
        </div>
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * 7. ConditionNode — muted accent, two outputs (True/False).
 * --------------------------------------------------------------------------- */

export function ConditionNode(props: NodeProps) {
  const baseData = props.data as unknown as ConditionNodeData;
  const data: ConditionNodeData = {
    ...baseData,
    subtitle: 'If',
    summary: baseData.expression,
  };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--fg-muted"
      icon={CheckCircle2}
      kindLabel="Condition"
      showInputHandle
      showOutputHandle={false}
      extraOutputHandles={[
        { id: 'true', label: 'True' },
        { id: 'false', label: 'False' },
      ]}
      footer={
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1 text-[var(--accent-emerald)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
            True
          </span>
          <span className="flex items-center gap-1 text-[var(--accent-rose)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-rose)]" />
            False
          </span>
        </div>
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * 8. WaitNode — muted accent.
 * --------------------------------------------------------------------------- */

export function WaitNode(props: NodeProps) {
  const baseData = props.data as unknown as WaitNodeData;
  const minutes = Math.max(1, Math.round(baseData.durationSeconds / 60));
  const data: WaitNodeData = { ...baseData, summary: `${minutes} min` };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--fg-muted"
      icon={Clock}
      kindLabel="Wait"
    />
  );
}

/* ---------------------------------------------------------------------------
 * 9. EndNode — emerald accent, no output handle.
 * --------------------------------------------------------------------------- */

export function EndNode(props: NodeProps) {
  const baseData = props.data as unknown as EndNodeData;
  const data: EndNodeData = {
    ...baseData,
    subtitle: baseData.outcome === 'always' ? 'Always' : baseData.outcome === 'success' ? 'Success' : 'Failure',
  };
  return (
    <BaseNode
      id={props.id}
      selected={props.selected ?? false}
      data={data}
      accentVar="--accent-emerald"
      icon={CircleStop}
      kindLabel="End"
      showOutputHandle={false}
    />
  );
}

/* ---------------------------------------------------------------------------
 * nodeTypes map consumed by <ReactFlow nodeTypes={...}/>.
 * --------------------------------------------------------------------------- */

export const workflowNodeTypes = {
  trigger: TriggerNode,
  command: CommandNode,
  agent: AgentNode,
  llmPrompt: LLMPromptNode,
  apiRequest: APIRequestNode,
  approval: ApprovalNode,
  condition: ConditionNode,
  wait: WaitNode,
  end: EndNode,
} as const;

/** The raw PaletteItem list — consumed by the left sidebar palette. */
import type { PaletteItem, NodeCategory } from '@/lib/workflow/types';

export const NODE_CATEGORIES: ReadonlyArray<{ id: NodeCategory; label: string; accentVar: string }> = [
  { id: 'triggers', label: 'Triggers', accentVar: '--accent-emerald' },
  { id: 'commands', label: 'Forge Commands', accentVar: '--accent-cyan' },
  { id: 'ai', label: 'AI', accentVar: '--accent-violet' },
  { id: 'logic', label: 'Logic', accentVar: '--fg-muted' },
  { id: 'integrations', label: 'Integrations', accentVar: '--accent-amber' },
  { id: 'human', label: 'Human', accentVar: '--accent-rose' },
  { id: 'flow', label: 'Flow', accentVar: '--accent-emerald' },
];

export const PALETTE_ITEMS: ReadonlyArray<PaletteItem> = [
  { nodeKind: 'trigger', label: 'Manual trigger', description: 'Trigger workflow manually', icon: PlayCircle, category: 'triggers' },
  { nodeKind: 'trigger', label: 'Webhook', description: 'Receive an inbound HTTP request', icon: Webhook, category: 'triggers' },
  { nodeKind: 'trigger', label: 'Schedule (cron)', description: 'Run on a cron expression', icon: Clock, category: 'triggers' },
  { nodeKind: 'trigger', label: 'Event', description: 'React to an event from another workflow', icon: Sparkles, category: 'triggers' },

  { nodeKind: 'command', label: 'forge-dev-new-feature', description: 'Scaffold a new feature', icon: Terminal, category: 'commands' },
  { nodeKind: 'command', label: 'forge-test-unit', description: 'Run unit test suite', icon: Terminal, category: 'commands' },
  { nodeKind: 'command', label: 'forge-ideation-capture', description: 'Capture an idea', icon: Terminal, category: 'commands' },
  { nodeKind: 'command', label: 'forge-deploy-preview', description: 'Deploy to preview env', icon: Terminal, category: 'commands' },
  { nodeKind: 'command', label: 'forge-refactor-apply', description: 'Apply a refactor plan', icon: Terminal, category: 'commands' },
  { nodeKind: 'command', label: 'forge-pr-open', description: 'Open a pull request', icon: Terminal, category: 'commands' },

  { nodeKind: 'llmPrompt', label: 'LLM Prompt', description: 'Invoke an LLM with a prompt', icon: Sparkles, category: 'ai' },
  { nodeKind: 'agent', label: 'Agent', description: 'Delegate to a registered agent', icon: Bot, category: 'ai' },
  { nodeKind: 'llmPrompt', label: 'Embedding', description: 'Generate embeddings', icon: Sparkles, category: 'ai' },
  { nodeKind: 'llmPrompt', label: 'Vision', description: 'Vision model inference', icon: Sparkles, category: 'ai' },

  { nodeKind: 'condition', label: 'Condition', description: 'If / else branch', icon: CheckCircle2, category: 'logic' },
  { nodeKind: 'condition', label: 'Switch', description: 'Switch on a value', icon: CheckCircle2, category: 'logic' },
  { nodeKind: 'condition', label: 'Loop', description: 'Iterate over a collection', icon: CheckCircle2, category: 'logic' },
  { nodeKind: 'condition', label: 'Parallel', description: 'Run branches in parallel', icon: CheckCircle2, category: 'logic' },
  { nodeKind: 'condition', label: 'Merge', description: 'Merge parallel branches', icon: CheckCircle2, category: 'logic' },

  { nodeKind: 'apiRequest', label: 'HTTP Request', description: 'Generic API call', icon: Globe, category: 'integrations' },
  { nodeKind: 'apiRequest', label: 'Slack', description: 'Post to Slack', icon: Globe, category: 'integrations' },
  { nodeKind: 'apiRequest', label: 'Email', description: 'Send an email', icon: Globe, category: 'integrations' },
  { nodeKind: 'apiRequest', label: 'Database query', description: 'Run a SQL query', icon: Globe, category: 'integrations' },

  { nodeKind: 'approval', label: 'Manual approval', description: 'Gate on human approval', icon: Hand, category: 'human' },
  { nodeKind: 'approval', label: 'Manual input', description: 'Collect user input', icon: Hand, category: 'human' },
  { nodeKind: 'approval', label: 'Comment', description: 'Annotate the workflow', icon: Hand, category: 'human' },

  { nodeKind: 'wait', label: 'Wait', description: 'Delay for a duration', icon: Clock, category: 'flow' },
  { nodeKind: 'end', label: 'End', description: 'Workflow terminator', icon: CircleStop, category: 'flow' },
];

/** Type guard — checks the data is one of the 9 WorkflowNodeData variants. */
export function isWorkflowNodeData(data: unknown): data is WorkflowNodeData {
  if (!data || typeof data !== 'object') return false;
  const kind = (data as { kind?: string }).kind;
  return (
    kind === 'trigger' ||
    kind === 'command' ||
    kind === 'agent' ||
    kind === 'llmPrompt' ||
    kind === 'apiRequest' ||
    kind === 'approval' ||
    kind === 'condition' ||
    kind === 'wait' ||
    kind === 'end'
  );
}