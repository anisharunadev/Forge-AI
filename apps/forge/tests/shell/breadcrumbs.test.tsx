import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Breadcrumbs, pathnameToSegments } from '@/components/shell/Breadcrumbs';

describe('pathnameToSegments', () => {
  it('returns Dashboard for the root pathname', () => {
    expect(pathnameToSegments('/')).toEqual([
      { label: 'Dashboard', href: '/dashboard' },
    ]);
  });

  it('converts a one-deep path into a single crumb', () => {
    expect(pathnameToSegments('/dashboard')).toEqual([
      { label: 'Dashboard', href: '/dashboard' },
    ]);
  });

  it('humanizes dashes and underscores across deep paths', () => {
    expect(pathnameToSegments('/project-intelligence/drafts/abc-123')).toEqual([
      { label: 'Project intelligence', href: '/project-intelligence' },
      { label: 'Drafts', href: '/project-intelligence/drafts' },
      { label: 'Abc 123', href: '/project-intelligence/drafts/abc-123' },
    ]);
  });

  it('marks route-param placeholders as ellipsis', () => {
    const segs = pathnameToSegments('/project-intelligence/epics/[id]');
    expect(segs[2]?.label).toBe('…');
  });
});

describe('<Breadcrumbs />', () => {
  it('renders nothing when segments is empty', () => {
    const { container } = render(<Breadcrumbs segments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single crumb without a chevron', () => {
    render(
      <Breadcrumbs
        segments={[{ label: 'Dashboard', href: '/dashboard' }]}
      />,
    );
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.queryByRole('presentation', { hidden: true })).toBeNull();
  });

  it('marks the last segment as aria-current=page and bolds it', () => {
    render(
      <Breadcrumbs
        segments={[
          { label: 'Project intelligence', href: '/project-intelligence' },
          { label: 'Drafts', href: '/project-intelligence/drafts' },
          { label: 'Abc 123' },
        ]}
      />,
    );
    const current = screen.getByText('Abc 123');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('font-medium');
  });

  it('renders a Home icon link to /dashboard', () => {
    render(<Breadcrumbs segments={[{ label: 'Dashboard' }]} />);
    const home = screen.getByLabelText('Home');
    expect(home.getAttribute('href')).toBe('/dashboard');
  });

  it('truncates deep trails with an ellipsis', () => {
    render(
      <Breadcrumbs
        segments={[
          { label: 'A', href: '/a' },
          { label: 'B', href: '/a/b' },
          { label: 'C', href: '/a/b/c' },
          { label: 'D', href: '/a/b/c/d' },
          { label: 'E', href: '/a/b/c/d/e' },
          { label: 'F', href: '/a/b/c/d/e/f' },
        ]}
      />,
    );
    expect(screen.getByText('…')).toBeTruthy();
  });
});
