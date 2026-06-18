import type { RunsView } from '@/lib/api';

/**
 * FORA-379: persona-page notice for an unreachable orchestrator.
 *
 * Replaces the previous silent `OrchestratorError -> []` catch in each
 * persona page, which masked transport / 5xx failures behind a
 * misleading "No runs yet" empty state. The persona pages now branch on
 * `RunsView.state` and render this notice when state === 'unreachable'.
 */
export function OrchestratorUnreachable({ view }: { view: Extract<RunsView, { state: 'unreachable' }> }) {
  return (
    <div
      className="card border-amber-400/60 bg-amber-400/10"
      role="alert"
      data-testid="orchestrator-unreachable"
    >
      <p className="text-sm font-semibold text-amber-200">Orchestrator unreachable</p>
      <p className="mt-2 text-sm text-amber-100/90">
        The Forge console could not reach the orchestrator REST API at{' '}
        <code>FORA_FORGE_API_URL</code> (default <code>http://localhost:4000</code>).
        Start it with <code>./scripts/dev-up.sh</code> or check the orchestrator logs.
      </p>
      <p className="mt-3 font-mono text-xs text-amber-100/80" data-testid="orchestrator-error">
        {view.status > 0 ? `HTTP ${view.status} — ` : ''}{view.error}
      </p>
    </div>
  );
}