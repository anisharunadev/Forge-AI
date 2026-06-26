/**
 * Export serializers for the Analytics Center.
 *
 * Pure functions that turn a snapshot of typed-artifact data into
 * a `Blob` ready for download. The parent decides the filename and
 * triggers the save — keeping the format logic next to the data
 * definitions instead of inside the click handler.
 *
 * Why this lives in its own file:
 *   - The CSV schema (column order, units, date format) is part of
 *     the analytics data contract; if it changes we update one
 *     place.
 *   - Easier to unit test the flatten pass in isolation.
 */

import type {
  AgentUsageBucket,
  ArtifactAcceptance,
  CostPoint,
  KPISnapshot,
  LatencyBin,
  RunStatusBucket,
} from '@/lib/analytics/data'

export interface AnalyticsExportSnapshot {
  kpis: KPISnapshot
  cost: ReadonlyArray<CostPoint>
  runs: ReadonlyArray<RunStatusBucket>
  acceptance: ArtifactAcceptance
  agents: ReadonlyArray<AgentUsageBucket>
  latency: ReadonlyArray<LatencyBin>
  generatedAt: string // ISO timestamp
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const head = headers.map(csvEscape).join(',')
  const body = rows
    .map((r) => headers.map((h) => csvEscape(r[h])).join(','))
    .join('\n')
  return `${head}\n${body}`
}

/**
 * Flatten the snapshot into one long CSV (sheet-per-section style)
 * so a spreadsheet user can see every metric in a single file.
 * Each section is prefixed with a comment header row.
 */
export function snapshotToCsv(snapshot: AnalyticsExportSnapshot): string {
  const blocks: string[] = []
  blocks.push(`# Forge Analytics export — generated ${snapshot.generatedAt}`)
  blocks.push(
    rowsToCsv([
      {
        section: 'kpis',
        totalCostUsd30d: snapshot.kpis.totalCostUsd30d,
        activeRuns: snapshot.kpis.activeRuns,
        avgAcceptancePct: snapshot.kpis.avgAcceptancePct,
        knowledgeReusePct: snapshot.kpis.knowledgeReusePct,
        totalRuns: snapshot.kpis.totalRuns,
      },
    ]),
  )
  blocks.push(`# section: cost-trend`)
  blocks.push(
    rowsToCsv(
      snapshot.cost.map((c) => ({
        date: c.date,
        costUsd: c.costUsd.toFixed(2),
      })),
    ),
  )
  blocks.push(`# section: runs-by-status`)
  blocks.push(
    rowsToCsv(
      snapshot.runs.map((r) => ({
        status: r.status,
        count: r.count,
      })),
    ),
  )
  blocks.push(`# section: artifact-acceptance`)
  blocks.push(
    rowsToCsv([
      {
        accepted: snapshot.acceptance.accepted,
        rejected: snapshot.acceptance.rejected,
        pending: snapshot.acceptance.pending,
      },
    ]),
  )
  blocks.push(`# section: agent-usage`)
  blocks.push(
    rowsToCsv(
      snapshot.agents.map((a) => ({
        agent: a.agent,
        invocations: a.invocations,
        costUsd: a.costUsd.toFixed(2),
      })),
    ),
  )
  blocks.push(`# section: latency-histogram`)
  blocks.push(
    rowsToCsv(
      snapshot.latency.map((l) => ({
        range: l.range,
        count: l.count,
      })),
    ),
  )
  return blocks.filter(Boolean).join('\n\n')
}

export function snapshotToJson(snapshot: AnalyticsExportSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Firefox has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
