/**
 * MCP tool definitions + handlers for the FORA Zendesk MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * Two tools — `create_ticket` and `update_ticket` — are mutations on the
 * customer's Zendesk data plane. They require an explicit
 * `confirm: true` Zod literal so the model can't quietly mutate state; the
 * agent has to declare intent and the caller has to opt in. `add_comment`
 * and `apply_macro` also mutate but are typically lightweight enough that
 * the platform bar for `confirm: true` (meaningful destructive side-effect)
 * does not trigger — comment bodies are append-only and macros are
 * reviewable in the Zendesk UI. The Ideation agent MUST still surface
 * outbound ticket mutations to the Board for approval before invoking
 * `create_ticket` or `update_ticket`.
 *
 * The `subdomain` is intentionally NOT a tool input. The server is pinned
 * to a single Zendesk subdomain at startup; the model can only pass IDs
 * and primitives, never subdomain names.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ConfirmLiteral = z.literal(true).describe(
  "Explicit confirmation that this mutation should run. Must be exactly `true`; the model cannot pass `false` or omit it.",
);

const TicketPriorityEnum = z.enum(["low", "normal", "high", "urgent"]);
const TicketStatusEnum = z.enum(["new", "open", "pending", "hold", "solved", "closed"]);

const TicketCommentShape = {
  body: z.string().min(1).describe("Comment body in plain text."),
  public: z.boolean().optional().describe("Whether the comment is public (default true)."),
  authorId: z.number().int().positive().optional()
    .describe("Optional author user ID. Defaults to the authenticated agent."),
};

const ListTicketsShape = {
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
  perPage: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
};

const GetTicketShape = {
  ticketId: z.number().int().positive().describe("Zendesk ticket ID."),
};

const SearchTicketsShape = {
  query: z.string().min(1)
    .describe("Zendesk search query. Same syntax as the Zendesk admin search bar."),
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
  perPage: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
};

const CreateTicketShape = {
  subject: z.string().min(1).describe("Ticket subject line."),
  comment: z.object(TicketCommentShape).describe("Initial comment / description."),
  priority: TicketPriorityEnum.optional().describe("Ticket priority."),
  status: TicketStatusEnum.optional().describe("Ticket status. Defaults to `new` on the Zendesk side."),
  tags: z.array(z.string()).optional().describe("Tags to apply."),
  requesterEmail: z.string().email().optional()
    .describe("Requester email. Creates the requester if unknown."),
  requesterName: z.string().optional()
    .describe("Requester name. Creates the requester if unknown."),
  externalId: z.string().optional()
    .describe("Optional external-system identifier for cross-referencing."),
  confirm: ConfirmLiteral,
};

const UpdateTicketShape = {
  ticketId: z.number().int().positive().describe("Zendesk ticket ID."),
  subject: z.string().min(1).optional().describe("New subject."),
  priority: TicketPriorityEnum.optional().describe("New priority."),
  status: TicketStatusEnum.optional().describe("New status."),
  tags: z.array(z.string()).optional()
    .describe("Replace the tag set with the given list."),
  addTags: z.array(z.string()).optional()
    .describe("Append these tags (additive)."),
  removeTags: z.array(z.string()).optional()
    .describe("Remove these tags (subtractive)."),
  comment: z.object(TicketCommentShape).optional()
    .describe("Optional new comment to add in the same update."),
  externalId: z.string().optional().describe("New external ID."),
  confirm: ConfirmLiteral,
};

const AddCommentShape = {
  ticketId: z.number().int().positive().describe("Zendesk ticket ID."),
  comment: z.object(TicketCommentShape).describe("Comment to add."),
  public: z.boolean().optional()
    .describe("Whether the comment is public. Defaults to true."),
};

const ListMacrosShape = {
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
  perPage: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
};

const ApplyMacroShape = {
  ticketId: z.number().int().positive().describe("Zendesk ticket ID to apply the macro to."),
  macroId: z.number().int().positive()
    .describe("Macro ID. Obtain from `list_macros`."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input the MCP SDK passes through.
const ListTicketsInput = z.object(ListTicketsShape).strict();
const GetTicketInput = z.object(GetTicketShape).strict();
const SearchTicketsInput = z.object(SearchTicketsShape).strict();
const CreateTicketInput = z.object(CreateTicketShape).strict();
const UpdateTicketInput = z.object(UpdateTicketShape).strict();
const AddCommentInput = z.object(AddCommentShape).strict();
const ListMacrosInput = z.object(ListMacrosShape).strict();
const ApplyMacroInput = z.object(ApplyMacroShape).strict();

export const toolDefinitions = [
  {
    name: "list_tickets",
    description: "List tickets in the pinned Zendesk subdomain. Use to discover what tickets exist before making other calls.",
    shape: ListTicketsShape,
  },
  {
    name: "get_ticket",
    description: "Get a single ticket by ID, including its comment thread and metadata.",
    shape: GetTicketShape,
  },
  {
    name: "search_tickets",
    description: "Search tickets using Zendesk's full-text query syntax (the same string the Zendesk admin search bar accepts).",
    shape: SearchTicketsShape,
  },
  {
    name: "create_ticket",
    description: "Create a new ticket. REQUIRES `confirm: true` — this is a mutation on the customer's Zendesk data plane; the Ideation agent must never auto-create tickets without board approval.",
    shape: CreateTicketShape,
  },
  {
    name: "update_ticket",
    description: "Update an existing ticket. REQUIRES `confirm: true` — this is a mutation on the customer's Zendesk data plane; the Ideation agent must never auto-update tickets without board approval.",
    shape: UpdateTicketShape,
  },
  {
    name: "add_comment",
    description: "Append a comment to a ticket. Public by default — agents in the Zendesk UI will see the comment immediately.",
    shape: AddCommentShape,
  },
  {
    name: "list_macros",
    description: "List macros defined in the pinned Zendesk subdomain. Use to discover macro IDs before calling `apply_macro`.",
    shape: ListMacrosShape,
  },
  {
    name: "apply_macro",
    description: "Apply a macro to a ticket. Mutates the ticket (priority, status, tags, comment, etc.) according to the macro's actions. Surfaces to humans in the Zendesk UI.",
    shape: ApplyMacroShape,
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
    case "list_tickets": {
      const args = ListTicketsInput.parse(rawArgs ?? {});
      result = await client.listTickets(args);
      break;
    }
    case "get_ticket": {
      const args = GetTicketInput.parse(rawArgs);
      result = await client.getTicket(args);
      break;
    }
    case "search_tickets": {
      const args = SearchTicketsInput.parse(rawArgs);
      result = await client.searchTickets(args);
      break;
    }
    case "create_ticket": {
      const args = CreateTicketInput.parse(rawArgs);
      result = await client.createTicket(args);
      break;
    }
    case "update_ticket": {
      const args = UpdateTicketInput.parse(rawArgs);
      result = await client.updateTicket(args);
      break;
    }
    case "add_comment": {
      const args = AddCommentInput.parse(rawArgs);
      result = await client.addComment(args);
      break;
    }
    case "list_macros": {
      const args = ListMacrosInput.parse(rawArgs ?? {});
      result = await client.listMacros(args);
      break;
    }
    case "apply_macro": {
      const args = ApplyMacroInput.parse(rawArgs);
      result = await client.applyMacro(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
