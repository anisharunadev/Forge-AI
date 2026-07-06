/**
 * Jira stub — records ticket pushes in memory for SC-8.1 E2E.
 *
 * Replaces a real Jira connector during the launch smoke. Real
 * production tickets land via the connector_ingestion pipeline
 * (apps/forge/lib/hooks/usePushIdeaToJira.ts).
 *
 * Ponytail: a module-scoped Map is enough for the stub. Replace
 * with a backend fetch when the real connector ships.
 */
export interface JiraTicketRecord {
  id: string;
  key: string;
  idea_id: string;
  project_key: string;
  title: string;
  body: string;
  created_at: string;
}

const _tickets: Map<string, JiraTicketRecord> = new Map();
let _counter = 0;

export function recordTicket(input: {
  idea_id: string;
  project_key: string;
  title: string;
  body: string;
}): JiraTicketRecord {
  _counter += 1;
  const id = `STUB-${_counter}`;
  const rec: JiraTicketRecord = {
    id,
    key: `${input.project_key}-${_counter}`,
    idea_id: input.idea_id,
    project_key: input.project_key,
    title: input.title,
    body: input.body,
    created_at: new Date().toISOString(),
  };
  _tickets.set(id, rec);
  return rec;
}

export function listTickets(idea_id?: string): JiraTicketRecord[] {
  const all = Array.from(_tickets.values());
  return idea_id ? all.filter((t) => t.idea_id === idea_id) : all;
}

export function clearTickets(): void {
  _tickets.clear();
  _counter = 0;
}
