/**
 * MCP tool definitions + handlers for the FORA Confluence MCP server
 * — READ-ONLY (FORA-290).
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `spaceId` is intentionally NOT a tool input. The server is pinned
 * to a single space at startup; the model can only pass `page_id` and
 * that is asserted against the pinned space before any call lands.
 *
 * SCOPE: This server exposes ONLY the read tools required by
 * SecurityEngineer's FORA-290 allow-list. Mutation tools
 * (`create_page`, `update_page`, `add_comment`) are not implemented —
 * the typed `Client` has no such methods, and the smoke test asserts no
 * POST/PATCH route is ever reached.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ListPagesShape = {
  limit: z.number().int().min(1).max(250).default(25)
    .describe("Page size, 1-250. Default 25."),
  cursor: z.string().optional()
    .describe("Opaque pagination cursor returned by a previous call."),
  title: z.string().optional()
    .describe("Filter by exact page title (server-side). Optional."),
};

const GetPageShape = {
  page_id: z.string().min(1).describe("Confluence page id. Must belong to the pinned space."),
};

const SearchShape = {
  // Confluence v2 has no dedicated `search` endpoint; the canonical
  // search is CQL on `/wiki/rest/api/content/search`. We expose a
  // minimal typed wrapper that calls the cloud CQL endpoint and returns
  // the slim summary shape.
  cql: z.string().min(1)
    .describe("Confluence Query Language (CQL) string, e.g. `text ~ \"threat model\"`. The server injects the pinned space scope; do not include a `space = …` clause."),
  limit: z.number().int().min(1).max(50).default(20)
    .describe("Page size, 1-50. Default 20."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const ListPagesInput = z.object(ListPagesShape).strict();
const GetPageInput = z.object(GetPageShape).strict();
const SearchInput = z.object(SearchShape).strict();

export const toolDefinitions = [
  {
    name: "list_pages",
    description: "List pages in the Confluence space this server is pinned to. Use this to discover what pages are available before calling get_page.",
    shape: ListPagesShape,
  },
  {
    name: "get_page",
    description: "Get a single Confluence page by id, including its current version number and storage-format body.",
    shape: GetPageShape,
  },
  {
    name: "search",
    description: "Search the pinned Confluence space using CQL (Confluence Query Language). Returns slim page summaries; use get_page to fetch a single result in full.",
    shape: SearchShape,
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
    case "list_pages": {
      const args = ListPagesInput.parse(rawArgs ?? {});
      result = await client.listPages(args);
      break;
    }
    case "get_page": {
      const args = GetPageInput.parse(rawArgs);
      result = await client.getPage(args);
      break;
    }
    case "search": {
      const args = SearchInput.parse(rawArgs);
      result = await client.search(args);
      break;
    }
    default:
      throw new Error(
        `Unknown tool: ${name}. ` +
          `Note: this server is read-only (FORA-290). Mutation tools ` +
          `(create_page, update_page, add_comment) are not available.`,
      );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
