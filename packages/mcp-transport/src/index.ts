/**
 * @fora/mcp-transport — public API
 *
 * The stdio child-process transport that plugs into `@fora/mcp-router`.
 * Implements FORA-48 §3.4 / FORA-447 / ADR-0011.
 */

export {
  StdioChildProcessTransport,
  type PoolEntry,
} from './stdio_transport.js';

export {
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MIN_MS,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_INVOKE_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POOL_MAX_SIZE,
  DEFAULT_SPAWN_TIMEOUT_MS,
  defaultBinPathForServer,
  TransportError,
  type PoolKey,
  type PoolSnapshot,
  type StdioTransportOptions,
  type StreamChunk,
  type TransportErrorKind,
} from './types.js';

export {
  classifyError,
  computeBackoffMs,
  isMutationTool,
  isRetryable,
  isStreamingTool,
  readIdempotencyKey,
  runWithRetry,
  type RetryPolicyOptions,
} from './retry.js';

export {
  isNotification,
  isResponse,
  readFrames,
  writeFrame,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './frame_io.js';
