import type { JSX } from "react";
import { cn } from "../tokens/cn";

export interface HeatmapCell {
  readonly row: string;
  readonly column: string;
  readonly value: number;
}

export interface HeatmapProps {
  readonly cells: ReadonlyArray<HeatmapCell>;
  /** Domain range for the color scale (e.g. [0, 100] for percent coverage). */
  readonly domain: readonly [number, number];
  readonly title?: string;
  readonly caption?: string;
  className?: string;
}

function rows(cells: ReadonlyArray<HeatmapCell>): string[] {
  const seen = new Set<string>();
  for (const c of cells) seen.add(c.row);
  return [...seen];
}
function columns(cells: ReadonlyArray<HeatmapCell>): string[] {
  const seen = new Set<string>();
  for (const c of cells) seen.add(c.column);
  return [...seen];
}

/**
 * Heatmap<T> — Plan 4 §5. Renders a coverage-map or eval-matrix grid with a
 * continuous color scale between domain bounds. Accessible table fallback
 * (the same data is shown as a sortable table).
 */
export function Heatmap({ cells, domain, title, caption, className }: HeatmapProps): JSX.Element {
  const rowLabels = rows(cells);
  const colLabels = columns(cells);
  const lookup = new Map<string, number>(cells.map((c) => [`${c.row}::${c.column}`, c.value]));
  const [min, max] = domain;
  const range = Math.max(1e-6, max - min);

  return (
    <figure className={cn("rounded-md border border-surface-border bg-surface p-4", className)}>
      {title && <figcaption className="mb-2 text-body-sm font-medium text-ink-default">{title}</figcaption>}
      <div className="overflow-x-auto" aria-hidden="true">
        <table className="text-caption">
          <thead>
            <tr>
              <th className="p-1" />
              {colLabels.map((c) => (
                <th key={c} className="px-2 py-1 text-ink-muted font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((r) => (
              <tr key={r}>
                <th scope="row" className="px-2 py-1 text-left text-ink-muted font-normal">
                  {r}
                </th>
                {colLabels.map((c) => {
                  const v = lookup.get(`${r}::${c}`) ?? min;
                  const t = (v - min) / range;
                  return (
                    <td
                      key={c}
                      className="h-7 min-w-[40px] rounded-sm"
                      style={{
                        backgroundColor: `hsl(var(--brand-primary) / ${t.toFixed(2)})`,
                      }}
                      title={`${r} × ${c} = ${v}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <p className="sr-only">{caption}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-caption text-ink-muted">Show data table</summary>
        <table className="mt-2 w-full text-body-sm" aria-label="Heatmap data">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">row</th>
              <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">column</th>
              <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">value</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c, i) => (
              <tr key={i} className="border-t border-surface-border">
                <td className="px-2 py-1 text-ink-default">{c.row}</td>
                <td className="px-2 py-1 text-ink-default">{c.column}</td>
                <td className="px-2 py-1 font-mono text-ink-default">{c.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
