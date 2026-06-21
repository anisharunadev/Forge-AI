/**
 * MCP tool definitions + handlers for the Forge AI Kiro MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `workspaceId` is intentionally NOT a tool input. The server is pinned
 * to a single Kiro workspace at startup; the model can only pass tool-specific
 * args (e.g. a history `limit`). The workspace scope is asserted on startup
 * in `index.ts` with a liveness call.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const GetOpenFilesShape = {};

const GetCurrentSelectionShape = {};

const GetActiveTaskQueueShape = {};

const GetAgentRunHistoryShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe("Maximum number of recent runs to return (1-200). Default 25."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const GetOpenFilesInput = z.object(GetOpenFilesShape).strict();
const GetCurrentSelectionInput = z.object(GetCurrentSelectionShape).strict();
const GetActiveTaskQueueInput = z.object(GetActiveTaskQueueShape).strict();
const GetAgentRunHistoryInput = z.object(GetAgentRunHistoryShape).strict();

export const toolDefinitions = [
  {
    name: "get_open_files",
    description:
      "List files currently open in the Kiro IDE editor. Returns the absolute path of each open file, the active tab, dirty state, and language identifier when available. No arguments.",
    shape: GetOpenFilesShape,
  },
  {
    name: "get_current_selection",
    description:
      "Return the file path and line range of the current selection in the Kiro IDE. Returns null when no text is selected. No arguments.",
    shape: GetCurrentSelectionShape,
  },
  {
    name: "get_active_task_queue",
    description:
      "List the pending and running tasks in the Kiro task system. Returns task id, title, status (pending, running, blocked, completed, failed, cancelled), timestamps, and the owning agent when available. No arguments.",
    shape: GetActiveTaskQueueShape,
  },
  {
    name: "get_agent_run_history",
    description:
      "Return the most recent N agent runs (default 25, max 200). Each run includes the agent name, title, status (running, succeeded, failed, cancelled, aborted), start/finish timestamps, and token usage when available.",
    shape: GetAgentRunHistoryShape,
  },
] as const;

export type ToolName = (typeof toolDefinitions)[number]["name"];

export async function handleToolCall(
  client: Client,
  name: ToolName | string,
  rawArgs: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let result: unknown;
  switch (name) {
    case "get_open_files": {
      GetOpenFilesInput.parse(rawArgs ?? {});
      result = await client.getOpenFiles();
      break;
    }
    case "get_current_selection": {
      GetCurrentSelectionInput.parse(rawArgs ?? {});
      result = await client.getCurrentSelection();
      break;
    }
    case "get_active_task_queue": {
      GetActiveTaskQueueInput.parse(rawArgs ?? {});
      result = await client.getActiveTaskQueue();
      break;
    }
    case "get_agent_run_history": {
      const args = GetAgentRunHistoryInput.parse(rawArgs ?? {});
      result = await client.getAgentRunHistory(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
