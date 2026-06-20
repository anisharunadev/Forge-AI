/**
 * HandoffContractViewer — typed viewer for the Handoff Contract
 * envelope between stages (FORA-501, Plan 4 §3 + memory/architecture.md
 * §7).
 *
 * Renders:
 *   * Version + stage envelope (from → to).
 *   * Each step with the artefact reference + sha256.
 *   * SLA triplet (p50 / p99 / max retries).
 *   * Schema + example refs.
 *
 * The viewer is the typed boundary between the agent runtime's output
 * and the customer's view (Plan 4 §10).
 */

import type { HandoffContract } from "../../lib/intelligence/types";

export interface HandoffContractViewerProps {
  readonly contract: HandoffContract;
}

export function HandoffContractViewer({ contract }: HandoffContractViewerProps) {
  return (
    <article
      className="card space-y-3"
      data-testid="handoff-contract"
      data-contract-id={contract.id}
      data-version={contract.version}
      data-from-stage={contract.fromStage}
      data-to-stage={contract.toStage}
      aria-labelledby={`hc-${contract.id}-h`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-forge-300">
            {contract.id} · v{contract.version}
          </p>
          <h3 className="text-lg font-semibold" id={`hc-${contract.id}-h`}>
            {contract.fromStage} → {contract.toStage}
          </h3>
        </div>
        <span
          className="inline-flex shrink-0 rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-forge-200"
          data-testid="handoff-contract-version"
        >
          v{contract.version}
        </span>
      </header>

      <ol
        className="space-y-2"
        aria-label="Handoff steps"
        data-testid="handoff-contract-steps"
        data-step-count={contract.steps.length}
      >
        {contract.steps.map((step, i) => (
          <li
            key={i}
            className="rounded-sm border border-forge-700 bg-forge-900/40 p-2 text-xs"
            data-testid="handoff-contract-step"
            data-step-index={i}
          >
            <p className="font-mono text-forge-100">
              step {i + 1}: {step.fromStage} → {step.toStage}
            </p>
            <p className="font-mono text-forge-300">
              artefact: {step.artefactRef}
            </p>
            {step.sha256 && (
              <p className="font-mono text-forge-300">sha: {step.sha256}</p>
            )}
          </li>
        ))}
      </ol>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        aria-label="Handoff SLA"
      >
        <dt className="text-forge-300">p50</dt>
        <dd className="font-mono text-forge-100" data-testid="handoff-contract-p50">
          {contract.sla.p50Ms} ms
        </dd>
        <dt className="text-forge-300">p99</dt>
        <dd className="font-mono text-forge-100" data-testid="handoff-contract-p99">
          {contract.sla.p99Ms} ms
        </dd>
        <dt className="text-forge-300">Max retries</dt>
        <dd className="font-mono text-forge-100" data-testid="handoff-contract-retries">
          {contract.sla.maxRetries}
        </dd>
        <dt className="text-forge-300">Input schema</dt>
        <dd className="font-mono text-forge-100">{contract.inputSchemaRef}</dd>
        <dt className="text-forge-300">Output schema</dt>
        <dd className="font-mono text-forge-100">{contract.outputSchemaRef}</dd>
        <dt className="text-forge-300">Example</dt>
        <dd className="font-mono text-forge-100">{contract.exampleRef}</dd>
      </dl>
    </article>
  );
}