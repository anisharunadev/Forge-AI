/**
 * MCP tool definitions + handlers for the FORA ClickUp MCP server.
 *
 * Eight tools, all operating against the server-pinned List. Mutations
 * (create_task, update_task, set_task_status, add_comment) are gated by a
 * `confirm: z.literal(true)` field on the input shape so the orchestrator's
 * confirmation gate (per FORA-126 broker policy) must approve the call
 * before the HTTP request leaves the box. Read tools do not require
 * confirmation.
 *
 * The `listId` is intentionally NOT a tool input. The server is pinned to
 * a single List at startup — the model can only pass `taskId` and the
 * underlying List is server-pinned for safety, the same posture the
 * GitHub/Jira MCPs take with their respective org/project pins.
 *
 * All payloads are returned as JSON-stringified content blocks (MCP
 * convention).
 */

import { z } from "zod";
import type { Client } from "./client.js";

// --- Read tools (no confirmation required) ---

const ListTasksShape = {
  page: z.number().int().min(0).default(0)
    .describe("Zero-based page index for pagination. Default 0."),
  pageSize: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
  statuses: z.array(z.string()).optional()
    .describe("Optional list of status names to filter on (e.g. ['to do', 'in progress']). Empty/omitted = all statuses."),
};

const SearchTasksShape = {
  query: z.string().min(1)
    .describe("Free-text query string. Server applies it as a case-insensitive substring match against task name + description."),
  page: z.number().int().min(0).default(0)
    .describe("Zero-based page index for pagination. Default 0."),
  pageSize: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
};

const GetTaskShape = {
  taskId: z.string().min(1)
    .describe("ClickUp task id (numeric string, e.g. '9001'). Must belong to the pinned List."),
};

const ListCommentsShape = {
  taskId: z.string().min(1)
    .describe("ClickUp task id (numeric string). Must belong to the pinned List."),
};

// --- Mutation tools (gated by `confirm: z.literal(true)`) ---

const CreateTaskShape = {
  name: z.string().min(1).describe("Task title."),
  description: z.string().optional()
    .describe("Optional plain-text description. Newlines preserved; markdown is NOT rendered by ClickUp."),
  status: z.string().default("to do")
    .describe("Status name within the pinned List, e.g. 'to do', 'in progress', 'done'. Must exist in the List."),
  priority: z.number().int().min(1).max(4).optional()
    .describe("Optional priority 1=Urgent, 2=High, 3=Normal, 4=Low. Omit for no priority."),
  dueDate: z.number().int().optional()
    .describe("Optional due date as a UTC millisecond epoch."),
  confirm: z.literal(true).describe("Must be `true` to confirm a write. Read tools do not require this."),
};

const UpdateTaskShape = {
  taskId: z.string().min(1)
    .describe("ClickUp task id (numeric string). Must belong to the pinned List."),
  name: z.string().min(1).optional()
    .describe("Optional new title."),
  description: z.string().optional()
    .describe("Optional new description (plain text)."),
  priority: z.number().int().min(1).max(4).optional()
    .describe("Optional new priority 1=Urgent, 2=High, 3=Normal, 4=Low."),
  dueDate: z.number().int().optional()
    .describe("Optional new due date as a UTC millisecond epoch."),
  confirm: z.literal(true).describe("Must be `true` to confirm a write. Read tools do not require this."),
};

const SetTaskStatusShape = {
  taskId: z.string().min(1)
    .describe("ClickUp task id (numeric string). Must belong to the pinned List."),
  status: z.string().min(1)
    .describe("Target status name within the pinned List, e.g. 'in progress', 'done'."),
  confirm: z.literal(true).describe("Must be `true` to confirm a write. Read tools do not require this."),
};

const AddCommentShape = {
  taskId: z.string().min(1)
    .describe("ClickUp task id (numeric string). Must belong to the pinned List."),
  body: z.string().min(1).describe("Comment body as plain text."),
  notifyAll: z.boolean().default(false)
    .describe("If true, notify every assignee on the task (uses the workspace's notification settings)."),
  confirm: z.literal(true).describe("Must be `true` to confirm a write. Read tools do not require this."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through. Mutations enforce the
// `confirm: true` literal so the broker-side gate cannot be skipped.
const ListTasksInput = z.object(ListTasksShape).strict();
const SearchTasksInput = z.object(SearchTasksShape).strict();
const GetTaskInput = z.object(GetTaskShape).strict();
const ListCommentsInput = z.object(ListCommentsShape).strict();
const CreateTaskInput = z.object(CreateTaskShape).strict();
const UpdateTaskInput = z.object(UpdateTaskShape).strict();
const SetTaskStatusInput = z.object(SetTaskStatusShape).strict();
const AddCommentInput = z.object(AddCommentShape).strict();

export const toolDefinitions = [
  {
    name: "list_tasks",
    description: "List tasks in the pinned List. Use to discover what work exists in the synced backlog. Supports pagination + status filtering.",
    shape: ListTasksShape,
    mutation: false,
  },
  {
    name: "search_tasks",
    description: "Case-insensitive substring search over task name + description within the pinned List. Use when you need to find a task by content rather than id.",
    shape: SearchTasksShape,
    mutation: false,
  },
  {
    name: "get_task",
    description: "Get a single task by id including current status, priority, assignee, due date, and description. The task must belong to the pinned List.",
    shape: GetTaskShape,
    mutation: false,
  },
  {
    name: "list_comments",
    description: "List comments on a task in chronological order. The task must belong to the pinned List.",
    shape: ListCommentsShape,
    mutation: false,
  },
  {
    name: "create_task",
    description: "Create a new task in the pinned List. Returns the new task id + url. MUTATION — requires `confirm: true`.",
    shape: CreateTaskShape,
    mutation: true,
  },
  {
    name: "update_task",
    description: "Update fields on an existing task in the pinned List. Only provided fields are touched; omitted fields are unchanged. MUTATION — requires `confirm: true`.",
    shape: UpdateTaskShape,
    mutation: true,
  },
  {
    name: "set_task_status",
    description: "Move a task to a new status by name within the pinned List. Returns the updated status. MUTATION — requires `confirm: true`.",
    shape: SetTaskStatusShape,
    mutation: true,
  },
  {
    name: "add_comment",
    description: "Post a plain-text comment on a task in the pinned List. Returns the new comment id. MUTATION — requires `confirm: true`.",
    shape: AddCommentShape,
    mutation: true,
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
    case "list_tasks": {
      const args = ListTasksInput.parse(rawArgs ?? {});
      result = await client.listTasks(args);
      break;
    }
    case "search_tasks": {
      const args = SearchTasksInput.parse(rawArgs);
      result = await client.searchTasks(args);
      break;
    }
    case "get_task": {
      const args = GetTaskInput.parse(rawArgs);
      result = await client.getTask(args);
      break;
    }
    case "list_comments": {
      const args = ListCommentsInput.parse(rawArgs);
      result = await client.listComments(args);
      break;
    }
    case "create_task": {
      const args = CreateTaskInput.parse(rawArgs);
      result = await client.createTask(args);
      break;
    }
    case "update_task": {
      const args = UpdateTaskInput.parse(rawArgs);
      result = await client.updateTask(args);
      break;
    }
    case "set_task_status": {
      const args = SetTaskStatusInput.parse(rawArgs);
      result = await client.setTaskStatus(args);
      break;
    }
    case "add_comment": {
      const args = AddCommentInput.parse(rawArgs);
      result = await client.addComment(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}