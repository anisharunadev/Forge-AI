'use client'

import * as React from 'react'
import { Legend } from 'recharts'
import type { LegendProps } from 'recharts'

/**
 * ChartLegend — themed Recharts legend.
 *
 * Renders each series name with a small color swatch driven by the
 * `chartColors` palette. Wraps Recharts' Legend and overrides only
 * the defaults; consumers can pass any `LegendProps` through.
 *
 * The `as any` cast on the JSX root is required because Recharts
 * `Legend` is a class component whose `ref` type does not reconcile
 * with React 19's stricter ref-element types — the runtime behavior
 * is identical to a forwardRef'd component.
 */
export function ChartLegend(props: LegendProps): React.ReactElement {
  const LegendComponent = Legend as unknown as React.ComponentType<LegendProps>
  return (
    <LegendComponent
      iconType="circle"
      iconSize={8}
      wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
      {...props}
    />
  )
}