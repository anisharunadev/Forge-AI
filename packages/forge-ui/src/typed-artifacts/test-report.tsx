import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, TestReport, TestTier } from "./types";

const TIER_TONE: Record<TestTier, "neutral" | "primary" | "accent" | "success"> = {
  unit: "primary",
  integration: "accent",
  contract: "neutral",
  e2e: "success",
};

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s} s`;
}

/**
 * TestReportRenderer — Plan 4 §3.6. Variants: summary-card | detail-panel | coverage-map.
 * Per-tier counts, failing tests, coverage by module, and the optional flake-ledger pointer.
 */
export function TestReportRenderer({
  artifact,
  variant = "summary-card",
  className,
}: BaseRendererProps<TestReport>) {
  const passRate = pct(artifact.passed, artifact.total);

  if (variant === "coverage-map") {
    const modules = artifact.coverage ?? [];
    return (
      <article
        aria-labelledby={`test-${artifact.id}-title`}
        className={cn(
          "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 id={`test-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            Coverage map — {artifact.tier}
          </h3>
          <Badge tone={TIER_TONE[artifact.tier]} aria-label={`Tier: ${artifact.tier}`}>
            {artifact.tier}
          </Badge>
        </header>
        <ul aria-label="Coverage by module" className="mt-4 space-y-2">
          {modules.map((m) => (
            <li key={m.modulePath} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="h-2 overflow-hidden rounded-sm bg-surface-sunken" role="presentation">
                <div
                  className={cn(
                    "h-full",
                    m.coveragePct >= 80 ? "bg-brand-success" : m.coveragePct >= 50 ? "bg-brand-warn" : "bg-brand-danger",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, m.coveragePct))}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="flex items-center gap-2 text-body-sm">
                <span className="font-mono text-ink-default">{m.modulePath}</span>
                <span className="font-mono text-ink-muted">{m.coveragePct.toFixed(1)}%</span>
              </div>
            </li>
          ))}
          {modules.length === 0 && <li className="text-body-sm text-ink-subtle">No coverage data.</li>}
        </ul>
      </article>
    );
  }

  return (
    <article
      aria-labelledby={`test-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`test-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            Test Report — {artifact.tier}
          </h3>
          <p className="mt-1 font-mono text-body-sm text-ink-muted">
            {artifact.total} tests · {fmtDuration(artifact.durationMs)} · pass rate {passRate}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={TIER_TONE[artifact.tier]}>{artifact.tier}</Badge>
          <Badge tone={artifact.failed > 0 ? "danger" : "success"}>
            {artifact.failed > 0 ? `${artifact.failed} failed` : "green"}
          </Badge>
        </div>
      </header>

      <dl
        aria-label="Test counts"
        className="mt-3 grid grid-cols-4 gap-2 text-center"
      >
        <div className="rounded-sm bg-surface-raised p-2">
          <dt className="text-caption text-ink-muted">Passed</dt>
          <dd className="font-mono text-heading-3 text-brand-success">{artifact.passed}</dd>
        </div>
        <div className="rounded-sm bg-surface-raised p-2">
          <dt className="text-caption text-ink-muted">Failed</dt>
          <dd className="font-mono text-heading-3 text-brand-danger">{artifact.failed}</dd>
        </div>
        <div className="rounded-sm bg-surface-raised p-2">
          <dt className="text-caption text-ink-muted">Skipped</dt>
          <dd className="font-mono text-heading-3 text-ink-muted">{artifact.skipped}</dd>
        </div>
        <div className="rounded-sm bg-surface-raised p-2">
          <dt className="text-caption text-ink-muted">Total</dt>
          <dd className="font-mono text-heading-3 text-ink-default">{artifact.total}</dd>
        </div>
      </dl>

      {variant === "detail-panel" && artifact.failingTests && artifact.failingTests.length > 0 && (
        <section className="mt-4" aria-label="Failing tests">
          <h4 className="text-body-sm font-medium text-ink-muted">
            Failing tests ({artifact.failingTests.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {artifact.failingTests.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-brand-danger/30 bg-brand-danger/5 p-2"
              >
                <p className="font-mono text-body-sm text-ink-default">{t.name}</p>
                {t.failureMessage && (
                  <p className="mt-1 text-caption text-ink-muted">{t.failureMessage}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {artifact.flakeLedgerEntry && (
        <p className="mt-3 text-caption text-ink-muted">
          Flake ledger entry:{" "}
          <span className="font-mono text-ink-default">{artifact.flakeLedgerEntry}</span>
        </p>
      )}
    </article>
  );
}
