'use client';

/**
 * BootstrapReportCard — M9-G4 (Track B / T-B4).
 *
 * Renders the day-one `BootstrapReport` (Pydantic
 * `BootstrapResult` aliased to `BootstrapReport` per
 * `backend/app/schemas/day_one_bootstrap.py`). The card surfaces
 * the four resource buckets — standards, templates, governance
 * policies, steering rules — plus the `run_id` mono-font badge.
 *
 * Empty-state contract (per M9 spec §3 G-4):
 *   - When `report` is null, render "Pending — provisioning still
 *     running" so the user has a stable view during the in-flight
 *     poll cycle.
 *   - When `report.completed_at` is null but the report object is
 *     present (e.g. backend returned a partial snapshot), render
 *     the same Pending state so the user never sees a card with
 *     all zeros.
 *
 * The `BootstrapReportShape` interface is intentionally typed
 * structurally — the backend may add fields (project_id, status,
 * error, ...) and we want to render as much as possible while the
 * shape evolves. Only the four resource keys + run_id + completed_at
 * are required by this card.
 */

import * as React from 'react';
import {
  Boxes,
  FileCode2,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of `BootstrapReport` (`backend/app/schemas/day_one_bootstrap.py`)
 * that this card depends on. The Pydantic shape also carries
 * `project_id`, `status`, `error`, `tenant_id` — those are surfaced
 * by the parent step and not by this card.
 */
export interface BootstrapReportShape {
  standards: ReadonlyArray<{ name: string }>;
  templates: ReadonlyArray<{ type: string; name: string }>;
  governance_policies: ReadonlyArray<{ name: string }>;
  steering_rules: ReadonlyArray<{ name: string }>;
  run_id: string | null;
  completed_at: string | null;
}

export interface BootstrapReportCardProps {
  /** The bootstrap report payload. `null` renders the empty state. */
  report: BootstrapReportShape | null;
  /** Optional className on the root. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PENDING_LABEL = 'Pending — provisioning still running';

/** Each row in the count table — pairs the resource key on the
 * report with a human label and a Lucide icon. The order matches
 * the M9 spec §3 G-4 "4-row count table (standards, templates,
 * governance, steering)" — keep stable. */
const ROWS: ReadonlyArray<{
  key: keyof Pick<
    BootstrapReportShape,
    'standards' | 'templates' | 'governance_policies' | 'steering_rules'
  >;
  label: string;
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
    'aria-hidden'?: boolean;
  }>;
}> = [
  { key: 'standards', label: 'Standards', icon: ScrollText },
  { key: 'templates', label: 'Templates', icon: FileCode2 },
  { key: 'governance_policies', label: 'Governance policies', icon: ShieldCheck },
  { key: 'steering_rules', label: 'Steering rules', icon: Boxes },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BootstrapReportCard({
  report,
  className,
}: BootstrapReportCardProps) {
  // Empty-state branch. Two flavours of "empty" — the report
  // not having arrived yet, and the report having arrived but
  // not yet completed. Both render the same Pending label so the
  // user only sees one stable UI.
  if (report === null || report.completed_at === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="bootstrap-report-pending"
        className={className}
        style={{
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border-subtle)',
          background: 'var(--bg-inset)',
          padding: '12px 14px',
          fontSize: 'var(--text-sm)',
          color: 'var(--fg-tertiary)',
          fontStyle: 'italic',
        }}
      >
        {PENDING_LABEL}
      </div>
    );
  }

  const counts = {
    standards: report.standards.length,
    templates: report.templates.length,
    governance_policies: report.governance_policies.length,
    steering_rules: report.steering_rules.length,
  };

  return (
    <section
      aria-label="Day-one bootstrap report"
      data-testid="bootstrap-report-card"
      className={className}
      style={{
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        padding: '16px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          Day-one bootstrap
        </h3>
        <span
          data-testid="bootstrap-run-id"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--fg-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.04em',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={report.run_id ?? undefined}
        >
          <span aria-hidden="true">id</span>
          <span>{report.run_id ?? '—'}</span>
        </span>
      </header>

      <table
        data-testid="bootstrap-report-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--text-sm)',
        }}
      >
        <caption className="sr-only">
          Day-one bootstrap resource counts
        </caption>
        <tbody>
          {ROWS.map(({ key, label, icon: Icon }) => {
            const value = counts[key];
            return (
              <tr
                key={key}
                data-testid={`bootstrap-row-${key}`}
                style={{
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <th
                  scope="row"
                  style={{
                    padding: '8px 6px',
                    textAlign: 'left',
                    fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--fg-secondary)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Icon
                      className="h-3.5 w-3.5"
                      aria-hidden={true}
                      style={{ color: 'var(--accent-primary)' }}
                    />
                    {label}
                  </span>
                </th>
                <td
                  style={{
                    padding: '8px 6px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--fg-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer
        style={{
          marginTop: 10,
          fontSize: 10,
          color: 'var(--fg-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
        }}
      >
        Completed{' '}
        <time
          dateTime={report.completed_at}
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-tertiary)',
            textTransform: 'none',
            letterSpacing: 'normal',
          }}
        >
          {report.completed_at}
        </time>
      </footer>
    </section>
  );
}

export default BootstrapReportCard;
