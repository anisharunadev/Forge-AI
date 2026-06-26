/**
 * Barrel export for the typed React Flow graph primitives.
 *
 * `forgeNodeTypes` is the typed `nodeTypes` map consumed by every
 * `<ReactFlow nodeTypes={forgeNodeTypes} ...>` in this directory.
 * Adding a new node type means adding one file and one entry here.
 */

import type { NodeTypes } from '@xyflow/react';

import { ArtifactNode } from './ArtifactNode';
import { RepoFileNode } from './RepoFileNode';
import { ServiceNode } from './ServiceNode';
import { AgentStepNode } from './AgentStepNode';
import { ApprovalNode } from './ApprovalNode';

export { ArtifactNode } from './ArtifactNode';
export { RepoFileNode } from './RepoFileNode';
export { ServiceNode } from './ServiceNode';
export { AgentStepNode } from './AgentStepNode';
export { ApprovalNode } from './ApprovalNode';

export type {
  NodeArtifactData,
  NodeRepoFileData,
  NodeServiceData,
  NodeAgentStepData,
  NodeApprovalData,
  GraphNodeData,
} from './types';

export { KnowledgeGraphView } from './KnowledgeGraphView';
export { RepositoryGraphView } from './RepositoryGraphView';
export { WorkflowGraphView } from './WorkflowGraphView';
export { AgentExecutionGraph } from './AgentExecutionGraph';

/**
 * Typed node-types map for React Flow. Each value is the React
 * component used to render nodes whose `type` matches the key.
 */
export const forgeNodeTypes: NodeTypes = {
  artifact: ArtifactNode as NodeTypes[string],
  repoFile: RepoFileNode as NodeTypes[string],
  service: ServiceNode as NodeTypes[string],
  agentStep: AgentStepNode as NodeTypes[string],
  approval: ApprovalNode as NodeTypes[string],
};
