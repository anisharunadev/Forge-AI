import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '../../components/shell/StatusPill';
import type { StatusTone } from '../../lib/design-system/status';

const ALL_TONES: ReadonlyArray<StatusTone> = [
  'success',
  'warn',
  'danger',
  'info',
  'idle',
  'agent',
  'execution',
  'review',
  'cost',
];

describe('<StatusPill>', () => {
  it.each(ALL_TONES)('renders the %s tone with a glyph + label', (tone) => {
    render(<StatusPill tone={tone} label={`tone-${tone}`} />);
    const pill = screen.getByTestId('status-pill');
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('data-tone')).toBe(tone);
    expect(pill.getAttribute('aria-label')).toBe(`tone-${tone}`);
    expect(pill.textContent).toMatch(/tone-/);
  });

  it('uses the sm size classes when size="sm"', () => {
    render(<StatusPill tone="success" label="OK" size="sm" />);
    const pill = screen.getByTestId('status-pill');
    expect(pill.className).toContain('h-5');
  });

  it('applies the active pulse class for execution', () => {
    render(<StatusPill tone="execution" pulse="active" label="Running" />);
    const pill = screen.getByTestId('status-pill');
    expect(pill.className).toContain('animate-spin-execution');
  });
});
