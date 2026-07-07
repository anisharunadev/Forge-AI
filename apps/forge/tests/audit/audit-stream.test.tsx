import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useAuditStream } from '@/lib/hooks/useAuditStream';

describe('useAuditStream', () => {
  it('starts in a connecting or open state', () => {
    const { result } = renderHook(() => useAuditStream());
    expect(['connecting', 'open']).toContain(result.current.status);
    expect(Array.isArray(result.current.events)).toBe(true);
  });
});
