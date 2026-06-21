/**
 * @opengsd/gsd-pi (stub)
 *
 * Peripheral-integration stub. Real package will expose adapters for
 * IDE integrations, git hosts, CI runners, and chat surfaces. The stub
 * just re-exports the gsd-core surface so consumers can import a single
 * package until the real implementation lands.
 */

export {
  GSD_INTERNAL_COMMANDS,
  isInternalGsdCommand,
  executeGsdCommand,
} from "../../gsd-core-stub/src/index.js";

export type {
  GsdExecutionContext,
  GsdExecutionResult,
} from "../../gsd-core-stub/src/index.js";