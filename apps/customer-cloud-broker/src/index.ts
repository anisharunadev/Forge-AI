/**
 * Public exports. Library consumers (the agent runtime, the identity-
 * broker's dispatcher) import from here.
 */

export * from './types.js';
export * from './deny-list.js';
export * from './audit.js';
export * from './metrics.js';
export * from './trust.js';
export * from './probe-signer.js';
export * from './probe-scheduler.js';
export * from './broker.js';
export * from './server.js';
export * from './config.js';
export * from './adapters/index.js';
export { AwsAdapter } from './adapters/aws.js';
export { AzureAdapter, AdapterNotImplementedError } from './adapters/azure.js';
export { GcpAdapter, type GcpAdapterOptions, type GcpAssumeFn, type GcpAssumeFnInput, type GcpAssumeFnOutput, type GcpCredentialHandle } from './adapters/gcp.js';
export {
  SonarQubeAdapter,
  SONARQUBE_SERVICES,
  type SonarQubeService,
  type SonarQubeAdapterOptions,
  type SonarQubeUserTokenHandle,
  type SonarQubeAssumeFnInput,
  type SonarQubeAssumeFnOutput,
  type SonarQubeDispatchFn,
  type SonarQubeReleaseFn,
} from './adapters/sonarqube.js';
// Per-tenant scope guard adapter (FORA-48 §3.5 / FORA-448). Implements
// the `CredentialResolver` port from `@fora/mcp-router` against the
// `POST /credentials/resolve` route. Fails closed on transport failure.
export {
  HttpCredentialResolver,
  type HttpCredentialResolverOptions,
  type CredentialResolutionDenial,
  type CredentialResolutionOk,
  type CredentialResolutionResult,
  type CredentialResolverLike,
} from './credential_resolver.js';
