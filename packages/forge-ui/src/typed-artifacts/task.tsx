import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, TaskArtifact } from "./types";

const PRIORITY_TONE: Record<
  TaskArtifact["priority"],
  "neutral" | "primary" | "warn" | "danger"
> = {
  critical: "danger",
  high: "warn",
  medium: "primary",
  low: "neutral",
};

/**
 * TaskRenderer — Plan 4 §3.4. Renders the Paperclip/Jira/GitHub task shape
 * normalized across sources. Status badge + priority + owner + blocked-by.
 */
export function TaskRenderer({
  artifact,
  className,
}: BaseRendererProps<TaskArtifact>) {
  return (
    <article
      aria-labelledby={`task-${artifact.id}-title`}
      className={cn(
        "rounded-md border border-surface-border bg-surface p-3 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-caption text-ink-subtle">
            {artifact.identifier}
          </p>
          <h3
            id={`task-${artifact.id}-title`}
            className="text-body font-semibold text-ink-default"
          >
            {artifact.title}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone="neutral">{artifact.status}</Badge>
          <Badge tone={PRIORITY_TONE[artifact.priority]} aria-label={`Priority: ${artifact.priority}`}>
            {artifact.priority}
          </Badge>
        </div>
      </header>
      {artifact.owner && (
        <p className="mt-2 text-body-sm text-ink-muted">
          Owner: <span className="text-ink-default">{artifact.owner.displayName}</span>
        </p>
      )}
      {artifact.blockedBy && artifact.blockedBy.length > 0 && (
        <p className="mt-1 text-body-sm text-ink-muted">
          Blocked by:{" "}
          <span className="font-mono text-ink-default">
            {artifact.blockedBy.join(", ")}
          </span>
        </p>
      )}
    </article>
  );
}