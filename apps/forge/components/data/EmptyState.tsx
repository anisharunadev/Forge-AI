'use client'

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * EmptyState — reusable empty-state primitive.
 *
 * Per the curated spec: every data-bearing surface must have a
 * deliberate empty state. Use this in place of ad-hoc divs with
 * text-forge-300 — keeps the icon + title + description + action
 * structure consistent across the 8 center pages.
 */
export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-surface/40 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && (
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted-foreground"
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-14 font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="max-w-sm text-13 text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}