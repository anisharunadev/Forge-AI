/**
 * Public surface of @fora/db-migrator.
 *
 * Consumers (the identity-broker connection pool, the agent-runtime, the
 * property-based test) import from here, not from deep paths.
 */

export {
  runMigrations,
  applyModelDdlForTest,
  SCHEMA_MIGRATIONS_TABLE,
  DEFAULT_ALLOW_LIST,
} from './runner.js';
export type { RunResult } from './runner.js';

export {
  emitModelDdl,
  emitAllRlsModels,
  tenantIsolationPolicyExpr,
  isValidIdentifier,
  TENANT_ISOLATION_POLICY,
  APP_TENANT_ID_GUC,
  NIL_UUID,
} from './rls.js';

export {
  auditBypassRls,
  assertAllowListDirs,
  isAllowedRole,
} from './bypass-audit.js';
export type { BypassRlsFinding } from './bypass-audit.js';

export { withTenant, isUuid, TENANT_ID_SENTINEL } from './connection.js';

export { FORA_MODELS, getRlsModels, TENANTS_MODEL_NAME } from './registry.js';
export type { ColumnSpec, TenantScopedModel, BypassRlsAllowList } from './types.js';
