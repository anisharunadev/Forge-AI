/**
 * Barrel export for the workflow canvas node components.
 *
 * The 9 variants + BaseNode are re-exported here so the canvas can
 * `import { workflowNodeTypes, PALETTE_ITEMS } from '@/components/workflow-nodes'`.
 */

export { BaseNode } from './BaseNode';
export type { BaseNodeProps } from './BaseNode';

export {
  TriggerNode,
  CommandNode,
  AgentNode,
  LLMPromptNode,
  APIRequestNode,
  ApprovalNode,
  ConditionNode,
  WaitNode,
  EndNode,
  workflowNodeTypes,
  PALETTE_ITEMS,
  NODE_CATEGORIES,
  isWorkflowNodeData,
} from './variants';