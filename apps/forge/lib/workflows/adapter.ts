/**
 * Adapter: map the 9 canvas node kinds (lib/workflow/types.ts) to
 * the 4 backend node kinds (lib/workflows/types.ts).
 *
 * The visual editor was built in Step 22 with 9 rich node types
 * (trigger / command / agent / llmPrompt / apiRequest / approval /
 * condition / wait / end). The FastAPI backend only persists 4
 * canonical kinds (trigger / command / approval / script). This
 * adapter collapses the richer UI shape into the wire format on
 * save and rehydrates it on load so the UX stays intact.
 */

import type { WorkflowNodeData as CanvasNode } from '@/lib/workflow/types';
import type {
  WorkflowNode,
  WorkflowNodeData as WireNode,
  WorkflowPosition,
} from './types';

type CanvasKind = CanvasNode['kind'];

function pickLabel(d: CanvasNode): string {
  // Each variant has a `label` — fall back to other identifying fields
  // so we never lose information when collapsing to a backend kind.
  const anyD = d as unknown as { label?: string };
  if (typeof anyD.label === 'string' && anyD.label.length > 0) return anyD.label;
  switch (d.kind) {
    case 'command':
      return d.commandName;
    case 'agent':
      return d.agentLabel;
    case 'approval':
      return d.label;
    default:
      return d.kind;
  }
}

function toWireData(node: CanvasNode): WireNode {
  switch (node.kind) {
    case 'trigger':
      return { type: 'trigger', label: pickLabel(node) };
    case 'command':
      return {
        type: 'command',
        command_name: node.commandName,
        on_error: 'fail',
      };
    case 'agent':
    case 'llmPrompt':
    case 'apiRequest':
    case 'condition':
    case 'wait':
    case 'end':
      // These visual kinds don't have a 1:1 backend kind. We persist
      // them as scripts so the user does not lose their work —
      // admins can promote them to first-class kinds later.
      return {
        type: 'script',
        language: 'python',
        source: nodeSummary(node),
      };
    case 'approval':
      return {
        type: 'approval',
        label: pickLabel(node),
        approver_role: undefined,
        timeout_hours: node.timeoutHours,
      };
  }
}

function nodeSummary(node: CanvasNode): string {
  const anyD = node as unknown as Record<string, unknown>;
  const lines: string[] = [`# ${node.kind} (${pickLabel(node)})`];
  for (const k of Object.keys(anyD)) {
    if (k === 'kind' || k === 'label') continue;
    const v = anyD[k];
    if (v == null) continue;
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return lines.join('\n');
}

export function canvasToWire(
  canvas: CanvasNode & { position: WorkflowPosition; id: string },
): WorkflowNode {
  return {
    id: canvas.id,
    position: canvas.position,
    data: toWireData(canvas),
  };
}

export function wireToCanvas(
  node: WorkflowNode,
): CanvasNode & { position: WorkflowPosition } {
  const d = node.data;
  const baseLabel = (d as { label?: string }).label ?? node.id;
  switch (d.type) {
    case 'trigger':
      return {
        kind: 'trigger',
        label: baseLabel,
        triggerType: 'manual',
        position: node.position,
      };
    case 'command':
      return {
        kind: 'command',
        label: d.command_name,
        commandName: d.command_name,
        position: node.position,
      };
    case 'approval':
      return {
        kind: 'approval',
        label: d.label,
        approverIds: d.approver_role ? [d.approver_role] : [],
        timeoutHours: d.timeout_hours ?? 24,
        position: node.position,
      };
    case 'script':
      return {
        kind: 'llmPrompt',
        label: 'Script',
        prompt: d.source,
        position: node.position,
      };
  }
}
