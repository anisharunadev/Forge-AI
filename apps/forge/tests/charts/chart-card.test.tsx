import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import {
  LineChartCard,
  BarChartCard,
  AreaChartCard,
  PieChartCard,
} from '@/components/charts'
import type {
  Series,
  BarDatum,
  PieDatum,
} from '@/lib/charts/types'

const SERIES: ReadonlyArray<Series> = [
  {
    name: 'runs',
    data: [
      { x: 'Mon', y: 3 },
      { x: 'Tue', y: 5 },
      { x: 'Wed', y: 2 },
      { x: 'Thu', y: 7 },
      { x: 'Fri', y: 4 },
    ],
  },
  {
    name: 'tokens',
    data: [
      { x: 'Mon', y: 1200 },
      { x: 'Tue', y: 1800 },
      { x: 'Wed', y: 900 },
      { x: 'Thu', y: 2400 },
      { x: 'Fri', y: 1600 },
    ],
  },
]

const BARS: ReadonlyArray<BarDatum> = [
  { label: 'Mon', value: 3 },
  { label: 'Tue', value: 5 },
  { label: 'Wed', value: 2 },
  { label: 'Thu', value: 7 },
  { label: 'Fri', value: 4 },
]

const PIE: ReadonlyArray<PieDatum> = [
  { name: 'Idle', value: 40 },
  { name: 'Executing', value: 30 },
  { name: 'Reviewing', value: 20 },
  { name: 'Failed', value: 10 },
]

describe('ChartCard primitives', () => {
  it('LineChartCard renders a card with the chart test id', () => {
    const { container } = render(
      <LineChartCard title="Runs per day" series={SERIES} />,
    )
    expect(container.querySelector('[data-testid="line-chart-card"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-container"]')).toBeTruthy()
  })

  it('BarChartCard renders a card with the chart test id', () => {
    const { container } = render(
      <BarChartCard title="Runs per day" data={BARS} />,
    )
    expect(container.querySelector('[data-testid="bar-chart-card"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-container"]')).toBeTruthy()
  })

  it('AreaChartCard renders a card with the chart test id', () => {
    const { container } = render(
      <AreaChartCard title="Tokens per day" series={SERIES} />,
    )
    expect(container.querySelector('[data-testid="area-chart-card"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-container"]')).toBeTruthy()
  })

  it('PieChartCard renders a card with the chart test id', () => {
    const { container } = render(
      <PieChartCard title="Agent time" data={PIE} />,
    )
    expect(container.querySelector('[data-testid="pie-chart-card"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-container"]')).toBeTruthy()
  })
})