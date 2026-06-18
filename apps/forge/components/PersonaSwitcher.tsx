'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PERSONAS, type Persona } from '@/lib/types';

export interface PersonaSwitcherProps {
  current: Persona;
}

/**
 * Top-right persona switcher. Clicking an item POSTs the new persona to
 * `/api/persona` (sets the cookie) and then navigates to that
 * persona's dashboard. The dropdown is keyboard-navigable (Esc closes,
 * Enter selects the focused item).
 */
export function PersonaSwitcher({ current }: PersonaSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentMeta = PERSONAS.find((p) => p.id === current) ?? PERSONAS[0]!;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, []);

  async function pick(next: Persona) {
    setOpen(false);
    if (next === current) return;
    await fetch('/api/persona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: next }),
    });
    const target = PERSONAS.find((p) => p.id === next)?.href ?? '/';
    router.push(target);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref} data-testid="persona-switcher">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-current-persona={current}
      >
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-forge-500" />
        {currentMeta.label}
        <span className="ml-2 text-xs opacity-60">▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-64 rounded-md border border-forge-200 bg-white shadow-lg dark:border-forge-700 dark:bg-forge-900"
        >
          <ul className="py-1">
            {PERSONAS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-forge-100 dark:hover:bg-forge-800 ${
                    p.id === current ? 'font-semibold' : ''
                  }`}
                  onClick={() => pick(p.id)}
                  data-persona-option={p.id}
                >
                  <span className="block">{p.label}</span>
                  <span className="block text-xs text-forge-300">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-forge-200 px-4 py-2 text-xs text-forge-300 dark:border-forge-700">
            <Link href="/">Back to home</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}