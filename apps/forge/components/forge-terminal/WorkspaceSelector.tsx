'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTerminalStore } from '@/lib/store';

const WORKSPACES = [
  { id: 'default', label: 'default' },
  { id: 'forge-core', label: 'forge-core' },
  { id: 'forge-ui', label: 'forge-ui' },
  { id: 'sandbox', label: 'sandbox' },
];

export function WorkspaceSelector() {
  const workspace = useTerminalStore((s) => s.workspace);
  const setWorkspace = useTerminalStore((s) => s.setWorkspace);

  return (
    <Select value={workspace} onValueChange={setWorkspace}>
      <SelectTrigger className="h-8 w-44" aria-label="Workspace">
        <SelectValue placeholder="Workspace" />
      </SelectTrigger>
      <SelectContent>
        {WORKSPACES.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
