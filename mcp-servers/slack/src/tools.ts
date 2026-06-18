/**
 * MCP tool definitions + handlers for the FORA Slack MCP server
 * — READ-ONLY (FORA-290).
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `teamId` (workspace pin) is intentionally NOT a tool input. The
 * server is pinned to a single workspace at startup; the model can only
 * pass a `channel` id, and that is asserted against the pinned workspace
 * on every call (see `assertChannelTeam` in client.ts).
 *
 * SCOPE: This server exposes ONLY the read tools required by
 * SecurityEngineer's FORA-290 allow-list. Mutation tools
 * (`post_message`, `update_message`, `add_reaction`) are not implemented
 * — the typed `Client` has no such methods, and the smoke test asserts
 * no mutation route is ever reached.
 *
 * DMs are out of scope: the agent surface only addresses channels. DMs
 * are never returned by `list_channels` and never accepted as a
 * `channel` argument.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ListChannelsShape = {
  limit: z.number().int().min(1).max(200).default(100)
    .describe("Page size, 1-200. Default 100."),
  cursor: z.string().optional()
    .describe("Pagination cursor returned by a previous call's `nextCursor`."),
  types: z.string().default("public_channel,private_channel")
    .describe("Channel types to include. Default 'public_channel,private_channel'. DMs are never returned."),
};

const ChannelArg = {
  channel: z.string().min(1)
    .describe("Channel id (e.g. C0123…) in the pinned workspace. Asserted against SLACK_TEAM_ID on every call."),
};

const ListThreadsShape = {
  ...ChannelArg,
  limit: z.number().int().min(1).max(200).default(50)
    .describe("Page size, 1-200. Default 50."),
  oldest: z.string().optional()
    .describe("Only messages newer than this Unix timestamp."),
  latest: z.string().optional()
    .describe("Only messages older than this Unix timestamp."),
};

const GetThreadShape = {
  ...ChannelArg,
  thread_ts: z.string().min(1)
    .describe("Thread parent message ts (the ts of the message that started the thread)."),
  limit: z.number().int().min(1).max(200).default(100)
    .describe("Page size, 1-200. Default 100."),
};

const SearchMessagesShape = {
  query: z.string().min(1)
    .describe("Slack search query (same syntax as the search box). Workspace-scoped by the token — you do not need to pin a workspace."),
  count: z.number().int().min(1).max(100).default(20)
    .describe("Page size, 1-100. Default 20."),
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const ListChannelsInput = z.object(ListChannelsShape).strict();
const ListThreadsInput = z.object(ListThreadsShape).strict();
const GetThreadInput = z.object(GetThreadShape).strict();
const SearchMessagesInput = z.object(SearchMessagesShape).strict();

export const toolDefinitions = [
  {
    name: "list_channels",
    description: "List channels in the workspace this server is pinned to. Use this to discover what channels are available before making other calls. DMs are never returned.",
    shape: ListChannelsShape,
  },
  {
    name: "list_threads",
    description: "List thread parents (messages with replies) in a channel. Returns the parent message plus reply counts; use get_thread to fetch the full thread.",
    shape: ListThreadsShape,
  },
  {
    name: "get_thread",
    description: "Get all messages in a thread (the parent + every reply), in chronological order. The thread_ts is the ts of the parent message.",
    shape: GetThreadShape,
  },
  {
    name: "search_messages",
    description: "Search messages across the pinned workspace. Uses Slack's own search syntax; you can scope further with `in:#channel-name` or `from:@user` qualifiers.",
    shape: SearchMessagesShape,
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
    case "list_channels": {
      const args = ListChannelsInput.parse(rawArgs ?? {});
      result = await client.listChannels(args);
      break;
    }
    case "list_threads": {
      const args = ListThreadsInput.parse(rawArgs);
      result = await client.listThreads(args);
      break;
    }
    case "get_thread": {
      const args = GetThreadInput.parse(rawArgs);
      result = await client.getThread(args);
      break;
    }
    case "search_messages": {
      const args = SearchMessagesInput.parse(rawArgs);
      result = await client.searchMessages(args);
      break;
    }
    default:
      throw new Error(
        `Unknown tool: ${name}. ` +
          `Note: this server is read-only (FORA-290). Mutation tools ` +
          `(post_message, update_message, add_reaction) are not available.`,
      );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
