import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, SecurityFinding, SecurityReport } from "./types";

const SEVERITY_TONE: Record<
  SecurityFinding["severity"],
  "neutral" | "danger" | "warn" | "primary"
> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "primary",
  info: "neutral",
};

const SEVERITY_ORDER: ReadonlyArray<SecurityFinding["severity"]> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

function severityHistogram(
  findings: ReadonlyArray<SecurityFinding>,
): Record<SecurityFinding["severity"], number> {
  const counts: Record<SecurityFinding["severity"], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/**
 * SecurityReportRenderer — Plan 4 §3.7. Stage, severity histogram, findings
 * list with exploit + fix, and links to the threat model + secrets inventory.
 */
export function SecurityReportRenderer({
  artifact,
  className,
}: BaseRendererProps<SecurityReport>) {
  const histogram = severityHistogram(artifact.findings);

  return (
    <article
      aria-labelledby={`sec-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3
          id={`sec-${artifact.id}-title`}
          className="text-heading-3 font-semibold text-ink-default"
        >
          Security Report — {artifact.stage}
        </h3>
        <Badge tone="neutral">{artifact.findings.length} findings</Badge>
      </header>

      <dl
        aria-label="Severity histogram"
        className="mt-3 flex flex-wrap gap-3"
      >
        {SEVERITY_ORDER.map((sev) => (
          <div key={sev} className="flex items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[sev]}>{sev}</Badge>
            <span className="font-mono text-body-sm text-ink-default">
              {histogram[sev]}
            </span>
          </div>
        ))}
      </dl>

      {artifact.findings.length > 0 && (
        <ul className="mt-4 space-y-3">
          {artifact.findings.map((f) => (
            <li
              key={f.id}
              className="rounded-md border border-surface-border bg-surface-raised p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-body font-medium text-ink-default">{f.title}</p>
                <Badge tone={SEVERITY_TONE[f.severity]} aria-label={`Severity: ${f.severity}`}>
                  {f.severity}
                </Badge>
              </div>
              {f.exploitPath && (
                <p className="mt-1 text-body-sm text-ink-muted">
                  <span className="font-medium">Exploit:</span> {f.exploitPath}
                </p>
              )}
              {f.fixRecommendation && (
                <p className="mt-1 text-body-sm text-ink-muted">
                  <span className="font-medium">Fix:</span> {f.fixRecommendation}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}