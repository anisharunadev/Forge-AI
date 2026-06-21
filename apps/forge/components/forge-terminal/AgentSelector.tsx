'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTerminalStore, type AgentId } from '@/lib/store';

const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'custom', label: 'Custom agent' },
];

export function AgentSelector() {
  const agent = useTerminalStore((s) => s.agent);
  const setAgent = useTerminalStore((s) => s.setAgent);

  return (
    <Select value={agent} onValueChange={(v) => setAgent(v as AgentId)}>
      <SelectTrigger className="h-8 w-44" aria-label="Agent">
        <SelectValue placeholder="Agent" />
      </SelectTrigger>
      <SelectContent>
        {AGENTS.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
