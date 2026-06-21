import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, DeploymentPlan, DeploymentStep } from "./types";

const APPROVAL_TONE: Record<DeploymentPlan["approvalState"], "neutral" | "primary" | "warn" | "danger" | "success"> = {
  pending: "neutral",
  approved: "success",
  blocked: "danger",
  "rolled-back": "warn",
};

const STRATEGY_TONE: Record<DeploymentPlan["strategy"], "neutral" | "primary" | "accent"> = {
  "blue-green": "primary",
  canary: "accent",
  rolling: "neutral",
  recreate: "neutral",
};

const STEP_TONE: Record<DeploymentStep["status"], "neutral" | "primary" | "success" | "danger"> = {
  pending: "neutral",
  running: "primary",
  succeeded: "success",
  failed: "danger",
};

/**
 * DeploymentPlanRenderer — Plan 4 §3.8. Variants: summary-card | detail-panel | run-log-table.
 * Covers the DeploymentPlan + RunLog + RollbackRecord trio in a single surface.
 */
export function DeploymentPlanRenderer({
  artifact,
  variant = "summary-card",
  className,
}: BaseRendererProps<DeploymentPlan>) {
  if (variant === "run-log-table") {
    const steps = artifact.steps ?? [];
    return (
      <article
        aria-labelledby={`dep-${artifact.id}-title`}
        className={cn(
          "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 id={`dep-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            Run log — {artifact.title}
          </h3>
          <Badge tone={APPROVAL_TONE[artifact.approvalState]}>{artifact.approvalState}</Badge>
        </header>
        <table className="mt-3 w-full text-body-sm" aria-label="Deployment steps">
          <caption className="sr-only">Per-step status for {artifact.title}</caption>
          <thead className="text-left text-caption text-ink-muted">
            <tr>
              <th className="px-2 py-1 font-medium">Step</th>
              <th className="px-2 py-1 font-medium">Status</th>
              <th className="px-2 py-1 font-medium">Started</th>
              <th className="px-2 py-1 font-medium">Finished</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.id} className="border-t border-surface-border">
                <td className="px-2 py-1 text-ink-default">{s.title}</td>
                <td className="px-2 py-1">
                  <Badge tone={STEP_TONE[s.status]}>{s.status}</Badge>
                </td>
                <td className="px-2 py-1 font-mono text-ink-muted">{s.startedAt ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-ink-muted">{s.finishedAt ?? "—"}</td>
              </tr>
            ))}
            {steps.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-ink-subtle">
                  No steps recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </article>
    );
  }

  return (
    <article
      aria-labelledby={`dep-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`dep-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            {artifact.title}
          </h3>
          <p className="mt-1 font-mono text-body-sm text-ink-muted">
            {artifact.targetEnv} · {artifact.version} · {artifact.strategy}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={STRATEGY_TONE[artifact.strategy]}>{artifact.strategy}</Badge>
          <Badge tone={APPROVAL_TONE[artifact.approvalState]} aria-label={`Approval: ${artifact.approvalState}`}>
            {artifact.approvalState}
          </Badge>
        </div>
      </header>

      {artifact.timeWindow && (
        <p className="mt-2 text-body-sm text-ink-muted">
          Window:{" "}
          <span className="font-mono text-ink-default">{artifact.timeWindow.startsAt}</span>
          {" → "}
          <span className="font-mono text-ink-default">{artifact.timeWindow.endsAt}</span>
        </p>
      )}

      {artifact.deployer && (
        <p className="mt-1 text-body-sm text-ink-muted">
          Deployer: <span className="text-ink-default">{artifact.deployer}</span>
        </p>
      )}

      {variant === "detail-panel" && artifact.canaryHealth && artifact.canaryHealth.length > 0 && (
        <section className="mt-3" aria-label="Canary health snapshot">
          <h4 className="text-body-sm font-medium text-ink-muted">Canary health</h4>
          <ul className="mt-1 grid grid-cols-2 gap-2 text-body-sm">
            {artifact.canaryHealth.map((h, i) => {
              const passing = h.value <= h.threshold;
              return (
                <li
                  key={`${h.metric}-${i}`}
                  className="flex items-center justify-between rounded-sm border border-surface-border bg-surface-raised px-2 py-1"
                >
                  <span className="font-mono text-ink-default">{h.metric}</span>
                  <span className={passing ? "text-brand-success" : "text-brand-danger"}>
                    {h.value} / {h.threshold}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {variant === "detail-panel" && artifact.rollbackPlan && (
        <section className="mt-3" aria-label="Rollback plan">
          <h4 className="text-body-sm font-medium text-ink-muted">Rollback plan</h4>
          <p className="mt-1 text-body-sm text-ink-default">{artifact.rollbackPlan}</p>
        </section>
      )}

      {artifact.lastRollback && (
        <section
          className="mt-3 rounded-md border border-brand-warn/30 bg-brand-warn/5 p-2"
          aria-label="Last rollback"
        >
          <h4 className="text-body-sm font-medium text-brand-warn">Last rollback</h4>
          <p className="mt-1 text-body-sm text-ink-default">{artifact.lastRollback.reason}</p>
          <p className="mt-1 text-caption text-ink-muted">
            Triggered by <span className="font-mono">{artifact.lastRollback.triggeredBy}</span>{" "}
            at <span className="font-mono">{artifact.lastRollback.triggeredAt}</span>
          </p>
        </section>
      )}
    </article>
  );
}
