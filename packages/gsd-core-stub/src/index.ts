/**
 * @opengsd/gsd-core (stub)
 *
 * Stub implementation that exports the 60+ internal command identifiers
 * consumed by Forge AI's FORGE_COMMAND_MAP (DL-024 white-labeling).
 *
 * IMPORTANT — White-labeling contract (DL-024):
 *   * Users see ONLY forge-* commands.
 *   * The strings exported here are the INTERNAL gsd:* names.
 *   * These names are deliberately opaque (e.g. "gsd:phase:discovery")
 *     so end-users can never see "GSD" anywhere in the UI.
 *
 * Once the real @opengsd/gsd-core package is published, replace this
 * stub by adding the real package to the workspace and updating the
 * FORGE_COMMAND_MAP resolvers to import from there. The interface
 * (exported string list) is what Forge AI depends on — execution
 * semantics are owned by the real package.
 */

export const GSD_INTERNAL_COMMANDS: ReadonlyArray<string> = [
  // 1. Onboarding (4)
  "gsd:onboard:welcome",
  "gsd:onboard:detect-stack",
  "gsd:onboard:bootstrap",
  "gsd:onboard:resume",

  // 2. Project Intelligence (6)
  "gsd:intel:scan-repo",
  "gsd:intel:scan-deps",
  "gsd:intel:scan-services",
  "gsd:intel:scan-secrets",
  "gsd:intel:summarize",
  "gsd:intel:trend",

  // 3. Ideation (5)
  "gsd:ideate:brainstorm",
  "gsd:ideate:refine",
  "gsd:ideate:compare",
  "gsd:ideate:prune",
  "gsd:ideate:crystallize",

  // 4. Architecture (6)
  "gsd:arch:diagram",
  "gsd:arch:component-map",
  "gsd:arch:contract-spec",
  "gsd:arch:data-model",
  "gsd:arch:adr",
  "gsd:arch:drift",

  // 5. Development (7)
  "gsd:dev:scaffold",
  "gsd:dev:implement",
  "gsd:dev:refactor",
  "gsd:dev:format",
  "gsd:dev:lint",
  "gsd:dev:hotfix",
  "gsd:dev:migrate",

  // 6. Testing (5)
  "gsd:test:plan",
  "gsd:test:unit",
  "gsd:test:integration",
  "gsd:test:e2e",
  "gsd:test:coverage",

  // 7. Security (5)
  "gsd:sec:scan",
  "gsd:sec:sbom",
  "gsd:sec:policy-check",
  "gsd:sec:incident",
  "gsd:sec:audit-export",

  // 8. Code Review (4)
  "gsd:review:diff",
  "gsd:review:risk",
  "gsd:review:approve",
  "gsd:review:request-changes",

  // 9. Deployment (5)
  "gsd:deploy:plan",
  "gsd:deploy:stage",
  "gsd:deploy:prod",
  "gsd:deploy:rollback",
  "gsd:deploy:status",

  // 10. Milestones (4)
  "gsd:milestone:cut",
  "gsd:milestone:tag",
  "gsd:milestone:changelog",
  "gsd:milestone:archive",

  // 11. Learning (4)
  "gsd:learn:capture",
  "gsd:learn:summarize",
  "gsd:learn:promote",
  "gsd:learn:search",

  // 12. Workflow (4)
  "gsd:flow:plan",
  "gsd:flow:run",
  "gsd:flow:cancel",
  "gsd:flow:status",

  // 13. Environment (4)
  "gsd:env:list",
  "gsd:env:diff",
  "gsd:env:sync",
  "gsd:env:promote",
];

export function isInternalGsdCommand(name: string): boolean {
  return GSD_INTERNAL_COMMANDS.includes(name);
}

export interface GsdExecutionContext {
  tenantId: string;
  projectId: string;
  userId: string;
  args: Record<string, unknown>;
}

export interface GsdExecutionResult {
  ok: boolean;
  command: string;
  output?: unknown;
  error?: string;
}

/**
 * Stub executor — the real package will do the heavy lifting.
 * Forge AI's GSDWrapper MUST go through this surface, never import
 * a different entry point.
 */
export async function executeGsdCommand(
  ctx: GsdExecutionContext,
  command: string,
): Promise<GsdExecutionResult> {
  if (!isInternalGsdCommand(command)) {
    return {
      ok: false,
      command,
      error: `unknown internal gsd command: ${command}`,
    };
  }
  // Stub: just echo. Real impl will dispatch to the engine.
  return {
    ok: true,
    command,
    output: { stub: true, args: ctx.args, tenant: ctx.tenantId },
  };
}