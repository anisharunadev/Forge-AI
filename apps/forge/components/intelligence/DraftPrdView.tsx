/**
 * DraftPrdView — typed-artifact view for a Draft PRD
 * (FORA-501, Plan 1 §3.4, Plan 4 §3.1).
 *
 * Renders ALL 11 canonical PRD sections in fixed order
 * (FORA-501 AC #1). Section order matches REQUIREMENT_BRIEF_SECTIONS
 * exactly so a test can iterate the DOM and assert every section is
 * present.
 *
 * The renderer reads typed `prd.sectionBodies` (no markdown parsing).
 * The markdown stays on the artifact for the lint-pass contract.
 */

import type { DraftPrd } from "../../lib/intelligence/types";
import { REQUIREMENT_BRIEF_SECTIONS } from "../../lib/intelligence/types";

export interface DraftPrdViewProps {
  readonly prd: DraftPrd;
}

export function DraftPrdView({ prd }: DraftPrdViewProps) {
  return (
    <article
      className="card space-y-4"
      data-testid="draft-prd"
      data-prd-id={prd.id}
      data-lint-passed={String(prd.lintPassed) as "true" | "false"}
      data-section-count={REQUIREMENT_BRIEF_SECTIONS.length}
      aria-labelledby={`prd-${prd.id}-h`}
    >
      <header className="space-y-1 border-b border-forge-800 pb-3">
        <p className="font-mono text-xs text-forge-300">{prd.id}</p>
        <h2 className="text-xl font-semibold" id={`prd-${prd.id}-h`}>
          {prd.title}
        </h2>
        <p
          className="inline-flex rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-200"
          data-testid="draft-prd-lint"
        >
          lint-passed · {REQUIREMENT_BRIEF_SECTIONS.length} sections
        </p>
      </header>

      <ol
        aria-label="PRD sections"
        className="space-y-4"
        data-testid="draft-prd-sections"
      >
        {REQUIREMENT_BRIEF_SECTIONS.map((key, i) => (
          <li
            key={key}
            className="rounded-sm border border-forge-700 bg-forge-900/40 p-3"
            data-testid="draft-prd-section"
            data-section-key={key}
            data-section-index={i + 1}
          >
            <header className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">
                {i + 1}. {labelFor(key)}
              </h3>
              <span className="font-mono text-xs text-forge-300">{key}</span>
            </header>
            <p className="mt-2 whitespace-pre-line text-sm text-forge-100">
              {prd.sectionBodies[key]}
            </p>
          </li>
        ))}
      </ol>
    </article>
  );
}

function labelFor(key: (typeof REQUIREMENT_BRIEF_SECTIONS)[number]): string {
  switch (key) {
    case "mission":
      return "Mission";
    case "core_vision":
      return "Core Vision";
    case "product_positioning":
      return "Product Positioning";
    case "strategic_objective":
      return "Strategic Objective";
    case "product_lines":
      return "Product Lines";
    case "architecture_principles":
      return "Architecture Principles";
    case "three_layer_architecture":
      return "Three Layer Architecture";
    case "multi_tenant_model":
      return "Multi-Tenant Model";
    case "gsd_integration_strategy":
      return "GSD Integration Strategy";
    case "agent_runtime_framework":
      return "Agent Runtime Framework & Provider Abstraction";
    case "core_ui_modules":
      return "Core UI Modules & Visualization Requirements";
  }
}