/**
 * MCP tool definitions + handlers for the FORA AWS MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * Scope is intentionally READ-ONLY in this ticket. Mutations
 * (`execute_change_set`, plus any future Cloud Control write tools) are a
 * tracked follow-up: the model has no way to call them today, and a
 * separate ticket will add them behind a `confirm: true` Zod argument per
 * FORA-92's contract note.
 *
 * The `accountId` and `region` are NOT tool inputs. The server is pinned
 * to a single account+region at startup; the model can only pass the
 * resource IDs (stack names, change-set names, type names) that the AWS
 * APIs expect.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const StackNameShape = {
  stackName: z.string().min(1).describe("CloudFormation stack name."),
};

const ListStacksShape = {
  status_filter: z
    .array(
      z.enum([
        "CREATE_IN_PROGRESS",
        "CREATE_FAILED",
        "CREATE_COMPLETE",
        "ROLLBACK_IN_PROGRESS",
        "ROLLBACK_FAILED",
        "ROLLBACK_COMPLETE",
        "DELETE_IN_PROGRESS",
        "DELETE_FAILED",
        "DELETE_COMPLETE",
        "UPDATE_IN_PROGRESS",
        "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
        "UPDATE_COMPLETE",
        "UPDATE_ROLLBACK_IN_PROGRESS",
        "UPDATE_ROLLBACK_FAILED",
        "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
        "UPDATE_ROLLBACK_COMPLETE",
        "REVIEW_IN_PROGRESS",
        "IMPORT_IN_PROGRESS",
        "IMPORT_COMPLETE",
        "IMPORT_ROLLBACK_IN_PROGRESS",
        "IMPORT_ROLLBACK_FAILED",
        "IMPORT_ROLLBACK_COMPLETE",
      ]),
    )
    .optional()
    .describe("Filter to specific stack statuses. Defaults to a healthy set (CREATE_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE, IMPORT_COMPLETE)."),
  next_token: z.string().optional().describe("Pagination token from a previous list_stacks call."),
};

const ListStackResourcesShape = {
  ...StackNameShape,
  next_token: z.string().optional().describe("Pagination token from a previous list_stack_resources call."),
};

const GetResourceShape = {
  type_name: z.string().min(1).describe("CloudFormation resource type (e.g. `AWS::S3::Bucket`, `AWS::EC2::VPC`)."),
  identifier: z.string().min(1).describe("Resource identifier — shape depends on the type (e.g. bucket name, VPC id)."),
};

const ListChangeSetsShape = {
  ...StackNameShape,
  next_token: z.string().optional().describe("Pagination token from a previous list_change_sets call."),
};

const GetChangeSetShape = {
  stackName: z.string().min(1).describe("CloudFormation stack name the change set belongs to."),
  changeSetName: z.string().min(1).describe("Change set name."),
};

const DescribeChangeSetShape = {
  ...GetChangeSetShape,
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input the MCP SDK passes through.
const ListStacksInput = z.object(ListStacksShape).strict();
const GetStackInput = z.object(StackNameShape).strict();
const ListStackResourcesInput = z.object(ListStackResourcesShape).strict();
const GetResourceInput = z.object(GetResourceShape).strict();
const ListChangeSetsInput = z.object(ListChangeSetsShape).strict();
const GetChangeSetInput = z.object(GetChangeSetShape).strict();
const DescribeChangeSetInput = z.object(DescribeChangeSetShape).strict();

export const toolDefinitions = [
  {
    name: "list_stacks",
    description: "List CloudFormation stacks in the pinned account+region. Defaults to a healthy status set; pass `status_filter` to widen or narrow the window.",
    shape: ListStacksShape,
  },
  {
    name: "get_stack",
    description: "Get a single CloudFormation stack by name, including parameters, outputs, and capabilities.",
    shape: StackNameShape,
  },
  {
    name: "list_stack_resources",
    description: "List the resources managed by a CloudFormation stack.",
    shape: ListStackResourcesShape,
  },
  {
    name: "get_resource",
    description: "Get a single resource via the Cloud Control API by its type name and identifier.",
    shape: GetResourceShape,
  },
  {
    name: "list_change_sets",
    description: "List change sets for a CloudFormation stack.",
    shape: ListChangeSetsShape,
  },
  {
    name: "get_change_set",
    description: "Get a single change set by name, including the list of changes it would apply.",
    shape: GetChangeSetShape,
  },
  {
    name: "describe_change_set",
    description: "Describe a change set in detail, including nested-stack linkage and resolved property values.",
    shape: DescribeChangeSetShape,
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
    case "list_stacks": {
      const args = ListStacksInput.parse(rawArgs ?? {});
      result = await client.listStacks({
        statusFilter: args.status_filter as string[] | undefined,
        nextToken: args.next_token,
      });
      break;
    }
    case "get_stack": {
      const args = GetStackInput.parse(rawArgs);
      result = await client.getStack(args);
      break;
    }
    case "list_stack_resources": {
      const args = ListStackResourcesInput.parse(rawArgs);
      result = await client.listStackResources({
        stackName: args.stackName,
        nextToken: args.next_token,
      });
      break;
    }
    case "get_resource": {
      const args = GetResourceInput.parse(rawArgs);
      // Surface the field names the model asked for as the canonical
      // snake_case shape; the SDK-level `GetResource` returns PascalCase.
      result = await client.getResource({
        typeName: args.type_name,
        identifier: args.identifier,
      });
      break;
    }
    case "list_change_sets": {
      const args = ListChangeSetsInput.parse(rawArgs);
      result = await client.listChangeSets({
        stackName: args.stackName,
        nextToken: args.next_token,
      });
      break;
    }
    case "get_change_set": {
      const args = GetChangeSetInput.parse(rawArgs);
      result = await client.getChangeSet(args);
      break;
    }
    case "describe_change_set": {
      const args = DescribeChangeSetInput.parse(rawArgs);
      result = await client.describeChangeSet(args);
      break;
    }
    default:
      throw new Error(
        `Unknown tool: ${name}. ` +
          `Note: execute_change_set is not available in this ticket — ` +
          `mutations are a tracked follow-up to FORA-92.`,
      );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
