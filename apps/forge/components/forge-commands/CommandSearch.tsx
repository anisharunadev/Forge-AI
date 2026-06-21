'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

export interface CommandSearchProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function CommandSearch({
  value,
  onChange,
  placeholder = 'Search forge-* commands…',
}: CommandSearchProps) {
  return (
    <div className="relative w-full max-w-xl">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label="Search forge commands"
      />
    </div>
  );
}
