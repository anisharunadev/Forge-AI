/**
 * Server-safe defaults for the Step 20 KPI strip.
 *
 * Lives in its own module (no `'use client'`) so the server-side page
 * can call `defaultKpiTiles(...)` and pass the resulting array as a
 * prop into the client-side `<KpiStrip tiles={…} />` component.
 *
 * All inputs are plain primitives — no React types or hooks — so this
 * file stays serializable across the server/client boundary.
 */

import {
  Code,
  Gauge,
  Layers,
  ListTodo,
} from 'lucide-react';
import type { KpiTile } from './KpiStrip';

export interface DefaultKpiInput {
  totalEpics: number;
  epicDelta: string;
  epicTrend: 'up' | 'down' | 'flat';
  epicSpark: ReadonlyArray<number>;
  openStories: number;
  openStoriesDelta: string;
  openStoriesTrend: 'up' | 'down' | 'flat';
  openStoriesSpark: ReadonlyArray<number>;
  storiesInDev: number;
  storiesInDevAgents: number;
  storiesInDevSpark: ReadonlyArray<number>;
  velocity: string;
  velocityDelta: string;
  velocityTrend: 'up' | 'down' | 'flat';
  velocitySpark: ReadonlyArray<number>;
}

export function defaultKpiTiles(input: DefaultKpiInput): ReadonlyArray<KpiTile> {
  return [
    {
      key: 'epics',
      label: 'Total epics',
      value: String(input.totalEpics),
      delta: input.epicDelta,
      trend: input.epicTrend,
      sparkline: input.epicSpark,
      accent: 'indigo',
      icon: <Layers className="h-4 w-4" strokeWidth={2} />,
    },
    {
      key: 'open-stories',
      label: 'Open stories',
      value: String(input.openStories),
      delta: input.openStoriesDelta,
      trend: input.openStoriesTrend,
      sparkline: input.openStoriesSpark,
      accent: 'cyan',
      icon: <ListTodo className="h-4 w-4" strokeWidth={2} />,
    },
    {
      key: 'stories-in-dev',
      label: 'Stories in dev',
      value: String(input.storiesInDev),
      caption: `across ${input.storiesInDevAgents} agent${
        input.storiesInDevAgents === 1 ? '' : 's'
      }`,
      sparkline: input.storiesInDevSpark,
      accent: 'amber',
      icon: <Code className="h-4 w-4" strokeWidth={2} />,
    },
    {
      key: 'velocity',
      label: 'Avg velocity',
      value: input.velocity,
      delta: input.velocityDelta,
      trend: input.velocityTrend,
      caption: 'pts / sprint',
      sparkline: input.velocitySpark,
      accent: 'emerald',
      icon: <Gauge className="h-4 w-4" strokeWidth={2} />,
    },
  ];
}