/**
 * components/ui/route-loading.tsx
 *
 * Shared skeleton primitive for per-route `loading.tsx` files.
 *
 * PERF (cold-click fix): without a colocated `loading.tsx`, every cold
 * client-side navigation into a sidebar target renders an empty layout
 * shell with no Suspense fallback while the route chunk downloads and
 * the page-level `'use client'` component mounts and fires its data
 * fetches. This component fills that gap so the cold click shows a
 * skeleton immediately (same tick as the click) instead of a blank screen.
 *
 * Variants mirror the typical shape of each route group so the swap
 * from skeleton to real content produces no CLS:
 *   - `grid`    KPI cards / overview pages (dashboard, analytics, agent-center)
 *   - `table`   list views (runs, audit, refactor, validator)
 *   - `graph`   knowledge graph + architecture trace views
 *   - `form`    intake / wizard (project-onboarding)
 *   - `terminal` terminal header + status bar (forge-terminal)
 *   - `default` fallback for everything else
 *
 * Width / padding / grid breakpoints match the shell's PageContainer
 * (`max-w-[1800px]`, `space-y-6`, `px-4 py-6 sm:px-6 sm:py-8`).
 */

import { Skeleton } from "@/components/ui/skeleton"

export type RouteLoadingVariant =
  | "grid"
  | "table"
  | "graph"
  | "form"
  | "terminal"
  | "default"

export interface RouteLoadingProps {
  variant?: RouteLoadingVariant
}

export function RouteLoading({ variant = "default" }: RouteLoadingProps) {
  return (
    <div
      className="mx-auto w-full max-w-[1800px] space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="route-loading"
      data-variant={variant}
      role="status"
      aria-label="Loading content"
      aria-busy="true"
    >
      <HeaderSkeleton />
      {variant === "grid" && <GridSkeleton />}
      {variant === "table" && <TableSkeleton />}
      {variant === "graph" && <GraphSkeleton />}
      {variant === "form" && <FormSkeleton />}
      {variant === "terminal" && <TerminalSkeleton />}
      {variant === "default" && <DefaultSkeleton />}
    </div>
  )
}

function HeaderSkeleton() {
  return (
    <header className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </header>
  )
}

function GridSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="flex justify-between pt-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function TableSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3 border-b border-border pb-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6 ml-auto" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/6 ml-auto" />
          </div>
        ))}
      </div>
    </>
  )
}

function GraphSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-border bg-card" style={{ height: 560 }}>
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-6 w-40" />
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      </div>
    </>
  )
}

function FormSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
    </div>
  )
}

function TerminalSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="rounded-lg border border-border bg-card" style={{ height: 520 }}>
        <div className="flex h-full items-center justify-center">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
    </div>
  )
}

function DefaultSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="flex justify-between pt-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}