/**
 * InjectionMapPanel — "what does each agent see?" (FORA-502.4).
 *
 * Renders the 12 stages from workspace/README.md §2 as a per-stage
 * row with the injected file list. The panel is the Knowledge
 * Center's differentiator per Plan 1 Q4 (recommended in v1.0).
 *
 * The panel is read-only in v1.0 (Plan 1 §5.1). v1.1 will add the
 * "swap file for stage" affordance behind `evaluateBoardAccess`
 * (FORA-507 precedent).
 *
 * Reconciles with:
 *   * workspace/README.md §2 (the source of truth).
 *   * The local `StageInjectionMap` mirror in
 *     `apps/forge/lib/knowledge/types.ts` (which mirrors
 *     `@fora/forge-ui/typed-artifacts` shipped in FORA-502.1).
 *   * `apps/forge/lib/knowledge/injection-model.ts` (the producer).
 */

import Link from "next/link";
import { listKnowledgeFiles } from "@/lib/knowledge/manifest";
import {
  listStageInjectionMaps,
  getStageFiles,
  STAGE_COUNT,
} from "@/lib/knowledge/injection-model";
import type { KnowledgeFile } from "@/lib/knowledge/types";

const ROLE_TONE: Record<KnowledgeFile["injectionRoles"][number]["role"], string> = {
  primary: "bg-indigo-500/15 text-indigo-200 border border-indigo-500/30",
  secondary: "bg-slate-500/15 text-slate-200 border border-slate-500/30",
  glossary: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
};

export function InjectionMapPanel() {
  const maps = listStageInjectionMaps();
  const allFiles = listKnowledgeFiles();
  const fileById = new Map(allFiles.map((f) => [f.id, f] as const));

  return (
    <section
      aria-labelledby="injection-map-h"
      className="space-y-4"
      data-testid="injection-map-panel"
      data-stage-count={STAGE_COUNT}
    >
      <header className="space-y-1">
        <h2 id="injection-map-h" className="text-xl font-semibold text-forge-50">
          What does each agent see?
        </h2>
        <p className="text-sm text-forge-200">
          The {STAGE_COUNT} sub-agent stages per workspace/README.md §2. The
          glossary is always injected; the other files are selected by the
          Master Orchestrator based on the stage and the handoff contract.
          Click a file to open it in the file viewer.
        </p>
      </header>

      <ul className="space-y-3" data-testid="injection-map-stage-list">
        {maps.map((m) => {
          const files = getStageFiles(m.stage);
          return (
            <li
              key={m.id}
              data-testid="injection-map-stage"
              data-stage={m.stage}
              data-file-count={files.length}
              className="card space-y-2"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-forge-50">{m.stage}</h3>
                  {m.ownerRole && (
                    <p className="text-xs text-forge-300">
                      Co-owner: <span className="font-mono">{m.ownerRole}</span>
                    </p>
                  )}
                </div>
                <p
                  className="text-xs text-forge-300"
                  data-testid="injection-map-stage-count"
                  aria-label={`${files.length} files injected`}
                >
                  {files.length} file{files.length === 1 ? "" : "s"}
                </p>
              </header>
              <ul className="space-y-1.5">
                {files.map((f) => {
                  const role = f.injectionRoles.find((r) => r.stage === m.stage)?.role ?? "glossary";
                  return (
                    <li
                      key={`${m.id}-${f.id}`}
                      data-testid="injection-map-file"
                      data-file-id={f.id}
                      data-file-path={f.path}
                      data-role={role}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-forge-700/40 bg-forge-900/30 px-2 py-1.5 text-sm"
                    >
                      <Link
                        href={`/knowledge-center?view=files&file=${encodeURIComponent(f.path)}`}
                        className="font-mono text-xs text-forge-100 hover:text-forge-50"
                      >
                        {f.path}
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ROLE_TONE[role]}`}
                        aria-label={`Role: ${role}`}
                      >
                        {role}
                      </span>
                    </li>
                  );
                })}
                {files.length === 0 && (
                  <li
                    data-testid="injection-map-empty"
                    className="rounded-sm border border-dashed border-forge-700/40 px-2 py-1.5 text-xs italic text-forge-400"
                  >
                    No files injected for this stage. Per README §2, every stage
                    should at minimum receive the glossary.
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
