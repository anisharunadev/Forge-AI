/**
 * FORA-579 — typed mock audit-entry shape for the Connector Center
 * detail panel.
 *
 * Mirrors `@fora/forge-ui/typed-artifacts/types.ts#AuditEntry` (shipped
 * in FORA-505) so the typed shape stays consistent across centers.
 * Kept in a separate file so the forge app can render audit entries
 * without a workspace dep on `@fora/forge-ui`.
 */

export type AuditActorKind = "user" | "agent" | "system" | "scheduler";

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: {
    readonly kind: AuditActorKind;
    readonly id: string;
    readonly displayName?: string;
  };
  readonly tenantId: string;
  readonly tool: string;
  readonly queryHash?: string;
  readonly responseHash?: string;
  readonly latencyMs?: number;
  readonly tokens?: {
    readonly prompt: number;
    readonly completion: number;
  };
  readonly costUsd?: number;
  readonly artifactRef?: {
    readonly kind: "task" | "adr" | "patch" | "deployment" | "approval" | "security-finding";
    readonly id: string;
  };
}