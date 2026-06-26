/**
 * Connector domain barrel.
 *
 * Re-exports the connector types, constants, and helpers used across
 * Connector Center tabs, the ideation Sources tab, and related consumers.
 * Keep this surface in sync with what other modules import from
 * `@/lib/connectors`.
 */

export {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CREDENTIAL_TYPE_LABEL,
  RECOMMENDED,
  SCOPE_LABEL,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  STATUS_ORDER,
  SYNC_HISTORY_24H,
  computeRollup,
  listConnected,
  listCredentials,
  listMarketplace,
  resolveIcon,
  sparklineFor,
  topByUsage,
} from './data';

export type {
  Connector,
  ConnectorCapability,
  ConnectorCredential,
  ConnectorHealthStatus,
  ConnectorScope,
  ConnectorSyncEvent,
  ConnectorCategory,
  CredentialType,
  SyncEventStatus,
  SyncEventType,
} from './data';

export { ConnectorProvider, useConnectors, useConnectorsOptional } from './provider';