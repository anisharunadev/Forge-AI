/**
 * Public surface of the identity-broker app.
 *
 * Consumers (and the FORA-124/125/126 downstreams) import from here, not from
 * deep paths.
 */

export {
  buildServer,
  SESSION_COOKIE_NAME,
  ForaAuditSink,
  InMemoryAuditSink,
  JsonlAuditSink,
  InMemoryRevocationStore,
  InMemoryProvisioningStore,
  InMemoryStateStore,
} from './server.js';
export type { BrokerDeps } from './server.js';
export type { AuditSink, RevocationStore, ProvisioningStore, StateStore } from './server.js';
export { loadConfig, _resetConfigForTests } from './config.js';
export type { BrokerConfig } from './config.js';
export { startServer } from './start.js';
// Agent IAM (FORA-125 / 0.7.3) — role registry, tenant policy, ToolCall
// envelope, broker check, and audit-event factory.
export {
  checkToolCall,
  iamAuditEvent,
  loadPolicyStore,
  loadRoleRegistry,
  loadTenantPolicy,
  InMemoryPolicyStore,
  DenyAllDispatcher,
  ScriptedDispatcher,
  ToolCallSchema,
  IAM_ACTIONS,
} from './iam.js';
export type {
  IamAction,
  IamDecision,
  McpDispatchResult,
  McpDispatcher,
  PolicyStore,
  PolicyStoreLayout,
  RoleRegistry,
  TenantPolicy,
  ToolCall,
  ToolPrincipal,
} from './iam.js';
