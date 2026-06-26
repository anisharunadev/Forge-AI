'use client'

/**
 * ChartSkeleton — chart-specific shimmer placeholders.
 *
 * Per Step 6 polish rules, no spinners in the analytics center —
 * only shimmer skeletons. We provide four shapes that map to the
 * chart kinds we ship (line, bars, gauge, area). All respect the
 * global `prefers-reduced-motion` block (`.shimmer` animation is
 * cancelled in `globals.css`).
 *
 * Skill influence:
 *   - `web` (nextjs) "Avoid layout shifts" → all skeletons reserve
 *     the same height as the chart they replace (240px default).
 *   - `ux` (Performance: Render Blocking) → no JS animation; the
 *     shimmer is a CSS gradient sweep that paints during the same
 *     frame the container mounts.
 */

import * as React from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

const SKELETON_BG = 'var(--bg-inset)'

function ShimmerBar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('shimmer', className)} style={style} aria-hidden="true" />
}

export interface ChartSkeletonProps {
  title?: string
  description?: string
  /** "line" | "bars" | "gauge" | "area" | "list" */
  shape?: 'line' | 'bars' | 'gauge' | 'area' | 'list'
  height?: number
  className?: string
}

export function ChartSkeleton({
  title,
  description,
  shape = 'line',
  height = 240,
  className,
}: ChartSkeletonProps) {
  return (
    <Card
      data-testid="chart-skeleton"
      data-shape={shape}
      className={cn('animate-[fade-in_var(--motion-standard)_ease-out]', className)}
    >
      {(title || description) && (
        <CardHeader className="pb-2">
          {title ? <CardTitle className="text-14 font-semibold">{title}</CardTitle> : null}
          {description ? (
            <CardDescription className="text-12">{description}</CardDescription>
          ) : null}
        </CardHeader>
      )}
      <CardContent>
        <div className="w-full" style={{ height }}>
          {shape === 'line' || shape === 'area' ? (
            <LineBarsSkeleton shape={shape} />
          ) : shape === 'bars' ? (
            <BarsSkeleton />
          ) : shape === 'gauge' ? (
            <GaugeSkeleton />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function LineBarsSkeleton({ shape }: { shape: 'line' | 'area' }) {
  return (
    <div className="flex h-full flex-col gap-2" aria-hidden="true">
      <div className="flex h-[80%] items-end gap-2">
        {Array.from({ length: 12 }).map((_, i) => {
          const h = 30 + ((i * 7 + 11) % 50)
          return (
            <ShimmerBar
              key={i}
              className="flex-1 rounded-[var(--radius-sm)]"
              style={{ height: `${h}%`, background: SKELETON_BG }}
            />
          )
        })}
      </div>
      <div className="flex items-center justify-between">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerBar
            key={i}
            className="h-2 w-6 rounded-[var(--radius-sm)]"
            style={{ background: SKELETON_BG }}
          />
        ))}
      </div>
      {shape === 'area' ? (
        <ShimmerBar
          className="h-2 w-1/3 rounded-[var(--radius-sm)]"
          style={{ background: SKELETON_BG }}
        />
      ) : null}
    </div>
  )
}

function BarsSkeleton() {
  return (
    <div className="flex h-full items-end justify-between gap-3" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => {
        const h = 40 + ((i * 13 + 5) % 55)
        return (
          <ShimmerBar
            key={i}
            className="flex-1 rounded-t-[var(--radius-sm)]"
            style={{ height: `${h}%`, background: SKELETON_BG }}
          />
        )
      })}
    </div>
  )
}

function GaugeSkeleton() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3" aria-hidden="true">
      <ShimmerBar
        className="h-32 w-56 rounded-[var(--radius-pill)]"
        style={{ background: SKELETON_BG, borderRadius: 9999 }}
      />
      <ShimmerBar
        className="h-4 w-24 rounded-[var(--radius-sm)]"
        style={{ background: SKELETON_BG }}
      />
      <ShimmerBar
        className="h-3 w-16 rounded-[var(--radius-sm)]"
        style={{ background: SKELETON_BG }}
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <ShimmerBar
            className="h-3 w-24 rounded-[var(--radius-sm)]"
            style={{ background: SKELETON_BG }}
          />
          <ShimmerBar
            className="h-2 flex-1 rounded-[var(--radius-sm)]"
            style={{ background: SKELETON_BG }}
          />
          <ShimmerBar
            className="h-3 w-10 rounded-[var(--radius-sm)]"
            style={{ background: SKELETON_BG }}
          />
        </div>
      ))}
    </div>
  )
}

export interface KpiCardSkeletonProps {
  className?: string
}

export function KpiCardSkeleton({ className }: KpiCardSkeletonProps) {
  return (
    <Card
      data-testid="kpi-card-skeleton"
      className={cn('flex flex-col gap-2 p-4', className)}
    >
      <div className="flex items-center justify-between">
        <ShimmerBar
          className="h-2.5 w-20 rounded-[var(--radius-sm)]"
          style={{ background: SKELETON_BG }}
        />
        <ShimmerBar
          className="h-4 w-4 rounded-[var(--radius-sm)]"
          style={{ background: SKELETON_BG }}
        />
      </div>
      <ShimmerBar
        className="h-7 w-24 rounded-[var(--radius-sm)]"
        style={{ background: SKELETON_BG }}
      />
      <ShimmerBar
        className="h-10 w-full rounded-[var(--radius-sm)]"
        style={{ background: SKELETON_BG }}
      />
    </Card>
  )
}
