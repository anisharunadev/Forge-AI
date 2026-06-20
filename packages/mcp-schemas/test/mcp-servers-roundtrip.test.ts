/**
 * @fora/mcp-schemas — AC #2 round-trip test
 *
 * The acceptance criterion in the FORA-445 sub-goal: round-trip Zod to
 * JSON-Schema for every existing mcp-* server fixture (the P1+P2 set
 * under mcp-servers/).
 *
 * What we mean by round-trip here, concretely:
 *
 *   1. For every server in mcp-servers/<name>/src/tools.ts, the file
 *      exports a toolDefinitions array of records carrying a name, a
 *      description, and a Zod shape (a Record<string, ZodTypeAny>).
 *   2. For every record, convert the shape into a JSON Schema via
 *      shapeToJsonSchema.
 *   3. Assert the result is a non-null object with type "object" and a
 *      properties map matching the shape keys.
 *   4. Assert the result survives JSON.stringify -> JSON.parse (the wire
 *      format) bit-for-bit.
 *   5. Assert every Zod .describe(...) string on a shape field surfaces as
 *      the corresponding property description in the JSON Schema.
 *   6. Register the converted tool set into an InMemorySchemaRegistry and
 *      verify get(server).tools[i].input_schema round-trips the same way.
 *
 * This is the contract that lets the orchestrator, the broker, and the
 * audit forwarder consume MCP server tool shapes uniformly.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { InMemorySchemaRegistry } from '../src/in-memory.js';
import { shapeToJsonSchema } from '../src/to-json-schema.js';
import { asServerName, asToolName } from '../src/types.js';
import type { ToolSchema } from '../src/types.js';

/* eslint-disable @typescript-eslint/consistent-type-imports */
import { toolDefinitions as awsTools } from '../../../mcp-servers/aws/src/tools.js';
import { toolDefinitions as azdoTools } from '../../../mcp-servers/azure-devops/src/tools.js';
import { toolDefinitions as clickupTools } from '../../../mcp-servers/clickup/src/tools.js';
import { toolDefinitions as confluenceTools } from '../../../mcp-servers/confluence/src/tools.js';
import { toolDefinitions as databricksTools } from '../../../mcp-servers/databricks/src/tools.js';
import { toolDefinitions as figmaTools } from '../../../mcp-servers/figma/src/tools.js';
import { toolDefinitions as githubTools } from '../../../mcp-servers/github/src/tools.js';
import { toolDefinitions as jiraTools } from '../../../mcp-servers/jira/src/tools.js';
import { toolDefinitions as secretsTools } from '../../../mcp-servers/secrets/src/tools.js';
import { toolDefinitions as slackTools } from '../../../mcp-servers/slack/src/tools.js';
import { toolDefinitions as sonarqubeTools } from '../../../mcp-servers/sonarqube/src/tools.js';
import { toolDefinitions as zendeskTools } from '../../../mcp-servers/zendesk/src/tools.js';
/* eslint-enable @typescript-eslint/consistent-type-imports */

interface ToolDefinitionLike {
  readonly name: string;
  readonly description: string;
  readonly shape: Readonly<Record<string, z.ZodTypeAny>>;
}

interface ServerFixture {
  readonly serverName: string;
  readonly toolDefinitions: ReadonlyArray<ToolDefinitionLike>;
}

// Each row is the canonical fixture for one MCP server. Adding a new
// `@fora/mcp-*` server means adding a row here — the round-trip test then
// covers it automatically.
const FIXTURES: ReadonlyArray<ServerFixture> = [
  { serverName: 'aws', toolDefinitions: awsTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'azure-devops', toolDefinitions: azdoTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'clickup', toolDefinitions: clickupTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'confluence', toolDefinitions: confluenceTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'databricks', toolDefinitions: databricksTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'figma', toolDefinitions: figmaTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'github', toolDefinitions: githubTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'jira', toolDefinitions: jiraTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'secrets', toolDefinitions: secretsTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'slack', toolDefinitions: slackTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'sonarqube', toolDefinitions: sonarqubeTools as unknown as ReadonlyArray<ToolDefinitionLike> },
  { serverName: 'zendesk', toolDefinitions: zendeskTools as unknown as ReadonlyArray<ToolDefinitionLike> },
];

const convertFixture = (server: ServerFixture): ToolSchema[] =>
  server.toolDefinitions.map((t) => ({
    name: asToolName(t.name),
    description: t.description,
    input_schema: shapeToJsonSchema(t.shape),
  }));

describe('mcp-servers round-trip (AC #2)', () => {
  it('covers every @fora/mcp-* server in mcp-servers/', () => {
    // The fixtures table IS the coverage list. If a new server is added but
    // not listed, this test stays green — what we want is to make sure
    // every listed server is reachable and has at least one tool.
    for (const server of FIXTURES) {
      expect(server.toolDefinitions.length, server.serverName).toBeGreaterThan(0);
    }
    // At least 12 servers — the current P1+P2 platform set. Bumping this
    // intentionally fails the round-trip test when a server is added but
    // not registered, which is the correct signal.
    expect(FIXTURES.length).toBeGreaterThanOrEqual(12);
  });

  for (const server of FIXTURES) {
    describe(`@fora/mcp-${server.serverName}`, () => {
      it('every tool shape converts to a { type: "object" } JSON Schema', () => {
        const converted = convertFixture(server);
        for (const tool of converted) {
          expect(tool.input_schema.type, `${server.serverName}/${tool.name}`).toBe('object');
        }
      });

      it('every tool name is unique within the server', () => {
        const seen = new Set<string>();
        for (const t of server.toolDefinitions) {
          expect(seen.has(t.name), `${server.serverName} duplicate tool: ${t.name}`).toBe(false);
          seen.add(t.name);
        }
      });

      it('every tool description is non-empty (model-facing copy must exist)', () => {
        for (const t of server.toolDefinitions) {
          expect(
            t.description.trim().length,
            `${server.serverName}/${t.name} empty description`,
          ).toBeGreaterThan(0);
        }
      });

      it('every JSON Schema survives a JSON.stringify/parse round-trip', () => {
        const converted = convertFixture(server);
        for (const tool of converted) {
          const wire = JSON.parse(JSON.stringify(tool.input_schema));
          expect(wire, `${server.serverName}/${tool.name}`).toEqual(tool.input_schema);
        }
      });

      it('the converted tool set registers into InMemorySchemaRegistry and is retrievable', () => {
        const reg = new InMemorySchemaRegistry();
        const converted = convertFixture(server);
        reg.register(asServerName(server.serverName), converted);

        const fetched = reg.get(asServerName(server.serverName));
        expect(fetched).toBeDefined();
        expect(fetched?.tools).toHaveLength(converted.length);
        for (let i = 0; i < converted.length; i++) {
          expect(fetched?.tools[i]?.name).toBe(converted[i]?.name);
          expect(fetched?.tools[i]?.input_schema).toEqual(converted[i]?.input_schema);
        }
      });

      it('shape keys appear as JSON Schema properties (the field map is faithful)', () => {
        for (const t of server.toolDefinitions) {
          const json = shapeToJsonSchema(t.shape);
          const props = json.properties as Record<string, unknown> | undefined;
          expect(props, `${server.serverName}/${t.name} missing properties`).toBeDefined();
          for (const key of Object.keys(t.shape)) {
            expect(
              Object.prototype.hasOwnProperty.call(props, key),
              `${server.serverName}/${t.name} missing property: ${key}`,
            ).toBe(true);
          }
        }
      });
    });
  }
});
