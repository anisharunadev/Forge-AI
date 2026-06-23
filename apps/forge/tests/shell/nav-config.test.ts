import { describe, expect, it } from 'vitest';

import {
  NAV,
  groupedNav,
  isNavMatch,
  searchNav,
} from '@/components/shell/nav-config';

describe('groupedNav()', () => {
  it('returns 3 groups in the documented order', () => {
    const groups = groupedNav();
    expect(groups.map((g) => g.group)).toEqual([
      'workspace',
      'centers',
      'lifecycle',
    ]);
  });

  it('item counts per group match the NAV array', () => {
    const groups = groupedNav();
    for (const { group, items } of groups) {
      const expected = NAV.filter((n) => n.group === group).length;
      expect(items.length).toBe(expected);
    }
  });
});

describe('isNavMatch()', () => {
  const projects = NAV.find((n) => n.label === 'Projects')!;
  const stories = NAV.find((n) => n.label === 'Stories')!;
  const dashboard = NAV.find((n) => n.label === 'Dashboard')!;

  it('matches an exact pathname', () => {
    expect(isNavMatch('/project-intelligence', projects)).toBe(true);
  });

  it('matches a deep pathname against its parent', () => {
    expect(
      isNavMatch('/project-intelligence/epics/abc-123', projects),
    ).toBe(true);
  });

  it('does not match unrelated paths', () => {
    expect(isNavMatch('/dashboard', projects)).toBe(false);
  });

  it('handles the ?tab= suffix in item.href for deep links', () => {
    // Stories item href is '/project-intelligence?tab=stories'.
    expect(
      isNavMatch('/project-intelligence?tab=stories', stories),
    ).toBe(true);
  });

  it('does not false-positive on different segments', () => {
    expect(isNavMatch('/governance-center', dashboard)).toBe(false);
  });
});

describe('searchNav()', () => {
  it('returns no results for an empty query', () => {
    expect(searchNav('')).toEqual([]);
    expect(searchNav('   ')).toEqual([]);
  });

  it('matches by label (case-insensitive)', () => {
    const results = searchNav('proj');
    expect(results.map((r) => r.label)).toContain('Projects');
  });

  it('matches by keyword', () => {
    const results = searchNav('adr');
    expect(results.map((r) => r.label)).toContain('Architecture');
  });

  it('returns an empty array for nonsense', () => {
    expect(searchNav('zzzqqq')).toEqual([]);
  });
});
