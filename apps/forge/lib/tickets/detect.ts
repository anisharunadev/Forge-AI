/**
 * Ticket URL detection (Step 44, Fix 6).
 *
 * Regex-based recognizer for Jira / GitHub / Linear keys + URLs pasted
 * into the terminal input. Returns a normalized `{ source, key, url }`
 * shape so the UI can render a uniform preview card regardless of the
 * originating tracker.
 *
 * Pure function — no network calls, no provider SDKs. Real ticket
 * metadata is fetched separately via the connector center.
 */

export type TicketSource = 'jira' | 'github' | 'linear';

export interface DetectedTicket {
  readonly source: TicketSource;
  readonly key: string;
  readonly url: string;
  /** Raw matched substring (preserves the original URL if pasted). */
  readonly raw: string;
}

/** Match the **last** ticket reference in `input`. Multiple matches →
 *  caller should re-call after each paste. */
export function detectTicket(input: string): DetectedTicket | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Jira — full URL or bare key (PROJ-123). Jira project keys are
  // uppercase letters followed by a dash and a number.
  const jiraUrl = trimmed.match(
    /(https?:\/\/[^\s]+\.atlassian\.net\/browse\/[A-Z][A-Z0-9_]+-\d+)/i,
  );
  if (jiraUrl && jiraUrl[1]) {
    const key = jiraUrl[1].split('/').pop()!.toUpperCase();
    return { source: 'jira', key, url: jiraUrl[1], raw: jiraUrl[0] ?? jiraUrl[1] };
  }
  const jiraKey = trimmed.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
  if (jiraKey && jiraKey[1]) {
    return {
      source: 'jira',
      key: jiraKey[1].toUpperCase(),
      url: `https://example.atlassian.net/browse/${jiraKey[1].toUpperCase()}`,
      raw: jiraKey[0] ?? jiraKey[1],
    };
  }

  // GitHub — `github.com/org/repo#123` or `org/repo#123`.
  const ghUrl = trimmed.match(/(https?:\/\/github\.com\/[^\s]+\#\d+)/i);
  if (ghUrl && ghUrl[1]) {
    const m = ghUrl[1].match(/\#(\d+)/);
    const num = m && m[1] ? m[1] : '?';
    return { source: 'github', key: `#${num}`, url: ghUrl[1], raw: ghUrl[0] ?? ghUrl[1] };
  }
  const ghKey = trimmed.match(/\b([\w.-]+\/[\w.-]+)#(\d+)\b/);
  if (ghKey && ghKey[1] && ghKey[2]) {
    return {
      source: 'github',
      key: `${ghKey[1]}#${ghKey[2]}`,
      url: `https://github.com/${ghKey[1]}/issues/${ghKey[2]}`,
      raw: ghKey[0] ?? `${ghKey[1]}#${ghKey[2]}`,
    };
  }

  // Linear — `linear.app/.../issue/ENG-789`.
  const linUrl = trimmed.match(
    /(https?:\/\/linear\.app\/[^\s]+\/issue\/[A-Z][A-Z0-9]+-\d+)/i,
  );
  if (linUrl && linUrl[1]) {
    const key = linUrl[1].split('/').pop()!.toUpperCase();
    return { source: 'linear', key, url: linUrl[1], raw: linUrl[0] ?? linUrl[1] };
  }

  return null;
}

/** Suggested commands when a ticket is detected. */
export const TICKET_COMMANDS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly description: string;
}> = [
  { id: 'prd', label: '/forge-prd', description: 'generate PRD from ticket' },
  { id: 'impl', label: '/forge-impl', description: 'start implementation' },
  { id: 'ticket', label: '/forge-ticket', description: 'create story from ticket' },
];
