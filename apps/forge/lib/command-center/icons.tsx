'use client';

/**
 * Lucide icon resolver.
 *
 * The forge-core catalog ships `icon: "Layers"` etc. — string names.
 * We resolve them against lucide-react here so callers can do
 * `<Icon name="Layers" />` without a giant switch statement.
 */

import * as Lucide from 'lucide-react';
import * as React from 'react';

const FALLBACK = Lucide.Terminal;

const ICON_MAP = Lucide as unknown as Record<string, Lucide.LucideIcon>;

export function resolveIcon(name: string | undefined): Lucide.LucideIcon {
  if (!name) return FALLBACK;
  return ICON_MAP[name] ?? FALLBACK;
}

export interface IconProps extends Lucide.LucideProps {
  name: string | undefined;
}

export function Icon({ name, ...rest }: IconProps) {
  const Cmp = resolveIcon(name);
  return <Cmp {...rest} />;
}
