'use client';

import * as React from 'react';
import { Search, Send, User, Bot } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { QAExample } from '@/lib/project-intelligence/data';

export interface QASearchBarProps {
  examples: ReadonlyArray<QAExample>;
}

interface Turn {
  id: string;
  question: string;
  answer: string;
  sources: ReadonlyArray<QAExample['sources'][number]>;
  fromExampleId?: string;
}

function makeId(): string {
  return `qa_${Math.random().toString(36).slice(2, 10)}`;
}

export function QASearchBar({ examples }: QASearchBarProps) {
  const [query, setQuery] = React.useState('');
  const [turns, setTurns] = React.useState<ReadonlyArray<Turn>>(() =>
    examples.map((e) => ({
      id: makeId(),
      question: e.question,
      answer: e.answer,
      sources: e.sources,
      fromExampleId: e.id,
    })),
  );

  const handleAsk = (text: string) => {
    const q = text.trim();
    if (q.length === 0) return;
    // Naive: pick the first example whose question contains the query, else generic.
    const match = examples.find((e) =>
      e.question.toLowerCase().includes(q.toLowerCase()),
    );
    const turn: Turn = {
      id: makeId(),
      question: q,
      answer: match
        ? match.answer
        : 'No answer in mock data. Try one of the example questions.',
      sources: match?.sources ?? [],
      fromExampleId: match?.id,
    };
    setTurns((curr) => [...curr, turn]);
    setQuery('');
  };

  return (
    <div className="flex h-full flex-col gap-3" data-testid="qa-search-bar">
      <div
        className="flex-1 space-y-3 overflow-y-auto rounded-md border border-forge-700/40 bg-forge-900/30 p-3"
        data-testid="qa-thread"
      >
        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-2" data-testid="qa-turn">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  'border border-forge-700 bg-forge-800',
                )}
              >
                <User className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <p className="rounded-md bg-forge-800/50 px-3 py-2 text-sm">{t.question}</p>
            </div>
            <div className="flex items-start gap-2 pl-9">
              <div className="flex flex-col gap-1 rounded-md border border-forge-700/40 bg-forge-900/40 p-3 text-sm">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-forge-300">
                  <Bot className="h-3 w-3" aria-hidden="true" />
                  assistant
                </div>
                <p>{t.answer}</p>
                {t.sources.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.sources.map((s, idx) => (
                      <Badge
                        key={`${s.kind}-${s.ref}-${idx}`}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {s.kind}: {s.ref}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk(query);
        }}
      >
        <Search className="h-4 w-4 text-forge-300" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the project anything…"
          data-testid="qa-input"
        />
        <Button type="submit" data-testid="qa-submit">
          <Send className="h-4 w-4" aria-hidden="true" />
          Ask
        </Button>
      </form>
    </div>
  );
}
