/**
 * MCP tool definitions + handlers for the Forge AI Adobe XD MCP server.
 *
 * Per F-509, the server exposes four tools:
 *   - get_asset(asset_id)        — fetch design asset by ID
 *   - list_components(file_id)   — list components in XD file
 *   - export_spec(file_id, format) — export design spec (JSON)
 *   - get_design_tokens(file_id) — extract design tokens (colors, type, spacing)
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * Note: file_id is accepted as a tool argument for forward-compat with
 * multi-file workflows, but the underlying client always uses the
 * server-pinned `fileId` from config (see `client.ts`). The project_id
 * scope is asserted at startup in `index.ts`.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const GetAssetShape = {
  asset_id: z
    .string()
    .min(1)
    .describe("Adobe XD asset id to fetch. Must exist in the pinned file."),
};

const FileIdShape = {
  file_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional file id override. In practice the server is pinned to one file at startup; omit unless explicitly told otherwise.",
    ),
};

const ListComponentsShape = {
  ...FileIdShape,
};

const ExportSpecShape = {
  ...FileIdShape,
  format: z
    .enum(["json", "css", "scss"])
    .default("json")
    .describe("Spec export format. Default 'json'."),
};

const GetDesignTokensShape = {
  ...FileIdShape,
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const GetAssetInput = z.object(GetAssetShape).strict();
const ListComponentsInput = z.object(ListComponentsShape).strict();
const ExportSpecInput = z.object(ExportSpecShape).strict();
const GetDesignTokensInput = z.object(GetDesignTokensShape).strict();

export const toolDefinitions = [
  {
    name: "get_asset",
    description:
      "Fetch a single Adobe XD design asset by id (artboard, component, shape, symbol, or group). Returns the asset metadata, type, and thumbnail URL.",
    shape: GetAssetShape,
  },
  {
    name: "list_components",
    description:
      "List components in the pinned Adobe XD file. Returns up to 100 components per call with id, name, description, and backing asset id.",
    shape: ListComponentsShape,
  },
  {
    name: "export_spec",
      description:
      "Export a design spec for the pinned Adobe XD file. Returns a structured payload describing each artboard's geometry, fills, strokes, effects, and text styles. Format defaults to 'json'; 'css' and 'scss' are also supported.",
    shape: ExportSpecShape,
  },
  {
    name: "get_design_tokens",
    description:
      "Extract design tokens (colors, typography, spacing) from the pinned Adobe XD file. Use this to feed design-system values into a code generation or theming workflow.",
    shape: GetDesignTokensShape,
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
    case "get_asset": {
      const args = GetAssetInput.parse(rawArgs);
      result = await client.getAsset(args);
      break;
    }
    case "list_components": {
      const args = ListComponentsInput.parse(rawArgs ?? {});
      result = await client.listComponents(args);
      break;
    }
    case "export_spec": {
      const args = ExportSpecInput.parse(rawArgs ?? {});
      result = await client.exportSpec(args);
      break;
    }
    case "get_design_tokens": {
      const args = GetDesignTokensInput.parse(rawArgs ?? {});
      result = await client.getDesignTokens(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
