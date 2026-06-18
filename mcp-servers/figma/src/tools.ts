/**
 * MCP tool definitions + handlers for the FORA Figma MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `fileKey` is intentionally NOT a tool input. The server is pinned
 * to a single Figma file at startup; the model can only pass node ids
 * (which Figma scopes to whatever file you query). The team scope is
 * asserted at startup in `index.ts`.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const NodeIdsShape = {
  node_ids: z
    .array(z.string().min(1).describe("Figma node id, e.g. '1:2'."))
    .min(1)
    .max(50)
    .describe(
      "Figma node ids to operate on. Up to 50 per call (Figma's documented cap).",
    ),
};

const GetFileNodesShape = {
  ...NodeIdsShape,
  depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Optional subtree depth (1-10). Default Figma-side."),
};

const GetNodeShape = {
  node_id: z
    .string()
    .min(1)
    .describe("Single Figma node id, e.g. '1:2'. Must exist in the pinned file."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Optional subtree depth (1-10). Default Figma-side."),
};

const GetImagesShape = {
  ...NodeIdsShape,
  format: z
    .enum(["jpg", "png", "svg", "pdf"])
    .default("png")
    .describe("Image format. Default 'png'."),
  scale: z
    .number()
    .min(0.5)
    .max(4)
    .optional()
    .describe("Render scale (0.5-4). Default 2 server-side."),
};

const GetCommentsShape = {
  as_md: z
    .boolean()
    .default(true)
    .describe("Render comment text as Markdown. Default true."),
  after: z
    .string()
    .optional()
    .describe(
      "Pagination cursor returned by a previous get_comments call as 'next'. Omit for first page.",
    ),
};

const PostCommentShape = {
  message: z
    .string()
    .min(1)
    .describe("Comment text. Markdown is rendered."),
  client_meta: z
    .object({
      x: z.number().describe("X coordinate of the comment pin (in document space)."),
      y: z.number().describe("Y coordinate of the comment pin (in document space)."),
    })
    .optional()
    .describe(
      "Pin position in document coordinates. Required to anchor a comment to a specific point on a node; omit to leave a file-level comment.",
    ),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const GetFileNodesInput = z.object(GetFileNodesShape).strict();
const GetNodeInput = z.object(GetNodeShape).strict();
const GetImagesInput = z.object(GetImagesShape).strict();
const GetCommentsInput = z.object(GetCommentsShape).strict();
const PostCommentInput = z.object(PostCommentShape).strict();

export const toolDefinitions = [
  {
    name: "get_file",
    description:
      "Fetch the full pinned Figma file (document tree, components, styles, version metadata). Use this first to learn the file's structure before drilling into specific nodes.",
    shape: {},
  },
  {
    name: "get_file_nodes",
    description:
      "Fetch specific nodes from the pinned file by id. Up to 50 ids per call. Returns a small wrapper per node with the document, components, and styles in scope.",
    shape: GetFileNodesShape,
  },
  {
    name: "get_node",
    description:
      "Fetch a single node from the pinned file by id. Thin wrapper over get_file_nodes; returns just the one wrapper.",
    shape: GetNodeShape,
  },
  {
    name: "get_images",
    description:
      "Render one or more nodes to image URLs (PNG, JPG, SVG, or PDF). The URLs are short-lived; do not cache them across processes.",
    shape: GetImagesShape,
  },
  {
    name: "get_comments",
    description:
      "List comments on the pinned file. Pagination is via the optional `after` cursor. Figma's REST API does not paginate the comments endpoint by default — the response may include a `next` cursor if the server paginates (see template-note contract drift).",
    shape: GetCommentsShape,
  },
  {
    name: "post_comment",
    description:
      "Post a comment on the pinned file. Pass `client_meta` to pin the comment to a specific document coordinate; omit to leave a file-level comment. This is the only write the server exposes; design-file mutation is intentionally not supported.",
    shape: PostCommentShape,
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
    case "get_file": {
      // No args; accept null/undefined gracefully.
      result = await client.getFile();
      break;
    }
    case "get_file_nodes": {
      const args = GetFileNodesInput.parse(rawArgs ?? {});
      result = await client.getFileNodes(args);
      break;
    }
    case "get_node": {
      const args = GetNodeInput.parse(rawArgs);
      result = await client.getNode(args);
      break;
    }
    case "get_images": {
      const args = GetImagesInput.parse(rawArgs ?? {});
      result = await client.getImages(args);
      break;
    }
    case "get_comments": {
      const args = GetCommentsInput.parse(rawArgs ?? {});
      result = await client.getComments(args);
      break;
    }
    case "post_comment": {
      const args = PostCommentInput.parse(rawArgs);
      result = await client.postComment(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
