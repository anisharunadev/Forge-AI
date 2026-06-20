/**
 * Connector family catalogs — FORA-484 AC #2.
 *
 * Each family file enumerates its event types and provides thin helpers
 * to build the canonical event_type strings. The wire-format is
 * `connector.<family>.<verb>` — but per Plan 3 we drop the `connector.`
 * prefix on the family side (the family prefix is implicit in the
 * `connector_id` field). The full taxonomy is in `envelope.ts`.
 */

export * from './jira.js';
export * from './confluence.js';
export * from './github.js';
export * from './slack.js';
export * from './teams.js';