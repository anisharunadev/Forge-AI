/**
 * Unit tests for the Kiro MCP server.
 *
 * Each test exercises one tool handler against a typed mock client. The
 * mock implements the `Client` interface from `src/client.ts` directly,
 * so we don't need a real daemon (or a real transport) to assert tool
 * behaviour.
 *
 * 4 tests, one per tool:
 *   1. get_open_files          — round-trips the open-files list
 *   2. get_current_selection   — round-trips the current selection (or null)
 *   3. get_active_task_queue   — round-trips the task queue
 *   4. get_agent_run_history   — threads the `limit` arg through
 *
 * Run with: npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  handleToolCall,
  toolDefinitions,
  type ToolName,
} from "../src/tools.ts";
import type {
  AgentRun,
  Client,
  KiroTask,
  OpenFile,
  Selection,
} from "../src/client.ts";

class MockClient implements Client {
  public lastGetAgentRunHistoryArgs: { limit?: number } | null = null;

  constructor(
    private readonly openFiles: OpenFile[] = [],
    private readonly selection: Selection | null = null,
    private readonly tasks: KiroTask[] = [],
    private readonly runs: AgentRun[] = [],
  ) {}

  async getOpenFiles(): Promise<OpenFile[]> {
    return this.openFiles;
  }

  async getCurrentSelection(): Promise<Selection | null> {
    return this.selection;
  }

  async getActiveTaskQueue(): Promise<KiroTask[]> {
    return this.tasks;
  }

  async getAgentRunHistory(args: { limit?: number }): Promise<AgentRun[]> {
    this.lastGetAgentRunHistoryArgs = args;
    return this.runs;
  }
}

function parseContent(result: {
  content: Array<{ type: "text"; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}

test("tool catalog is exactly 4 tools and matches the F-510 spec", () => {
  const names = toolDefinitions.map((d) => d.name).sort();
  assert.deepEqual(
    names,
    ["get_active_task_queue", "get_agent_run_history", "get_current_selection", "get_open_files"],
  );
});

test("get_open_files returns the IDE's open-file list as JSON", async () => {
  const openFiles: OpenFile[] = [
    { path: "/repo/src/index.ts", active: true, dirty: false, language: "typescript" },
    { path: "/repo/src/utils.ts", active: false, dirty: true, language: "typescript" },
  ];
  const client = new MockClient(openFiles, null, [], []);
  const result = await handleToolCall(client, "get_open_files" as ToolName, {});
  const parsed = parseContent(result) as OpenFile[];
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].path, "/repo/src/index.ts");
  assert.equal(parsed[0].active, true);
  assert.equal(parsed[1].dirty, true);
});

test("get_current_selection returns the file + line range, or null", async () => {
  const selection: Selection = {
    filePath: "/repo/src/index.ts",
    startLine: 10,
    endLine: 14,
    startColumn: 1,
    endColumn: 80,
    text: "const x = 1;",
  };
  const client = new MockClient([], selection, [], []);
  const result = await handleToolCall(client, "get_current_selection" as ToolName, {});
  const parsed = parseContent(result) as Selection;
  assert.equal(parsed.filePath, "/repo/src/index.ts");
  assert.equal(parsed.startLine, 10);
  assert.equal(parsed.endLine, 14);

  // Null case: nothing selected.
  const empty = new MockClient([], null, [], []);
  const result2 = await handleToolCall(empty, "get_current_selection" as ToolName, {});
  const parsed2 = parseContent(result2);
  assert.equal(parsed2, null);
});

test("get_active_task_queue returns the pending + running task list", async () => {
  const tasks: KiroTask[] = [
    {
      id: "t1",
      title: "Refactor auth module",
      status: "running",
      createdAt: "2026-06-22T10:00:00Z",
      startedAt: "2026-06-22T10:00:05Z",
      agent: "kiro.refactor",
      progress: 42,
    },
    {
      id: "t2",
      title: "Run linter",
      status: "pending",
      createdAt: "2026-06-22T10:01:00Z",
    },
  ];
  const client = new MockClient([], null, tasks, []);
  const result = await handleToolCall(client, "get_active_task_queue" as ToolName, {});
  const parsed = parseContent(result) as KiroTask[];
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "t1");
  assert.equal(parsed[0].status, "running");
  assert.equal(parsed[1].status, "pending");
});

test("get_agent_run_history threads the limit arg through to the client", async () => {
  const runs: AgentRun[] = [
    {
      id: "r1",
      agent: "kiro.refactor",
      title: "Refactor auth",
      status: "succeeded",
      startedAt: "2026-06-22T09:00:00Z",
      finishedAt: "2026-06-22T09:01:30Z",
      tokens: 1234,
    },
  ];
  const client = new MockClient([], null, [], runs);
  const result = await handleToolCall(client, "get_agent_run_history" as ToolName, {
    limit: 5,
  });
  const parsed = parseContent(result) as AgentRun[];
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "r1");
  // Limit must reach the client.
  assert.deepEqual(client.lastGetAgentRunHistoryArgs, { limit: 5 });

  // Default limit (25) when no arg is passed.
  const client2 = new MockClient([], null, [], runs);
  await handleToolCall(client2, "get_agent_run_history" as ToolName, {});
  assert.deepEqual(client2.lastGetAgentRunHistoryArgs, { limit: 25 });
});
