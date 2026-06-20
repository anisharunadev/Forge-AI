/**
 * Knowledge Center typed-artifact mirror (FORA-502.2).
 *
 * The canonical types live in `@fora/forge-ui/typed-artifacts` (shipped
 * in FORA-502.1). The forge console mirrors them locally because the
 * `@fora/forge-ui` package is not a forge-app dependency (per the
 * connector-center precedent in FORA-578). The two mirrors MUST stay
 * in lockstep — a drift is a v1.0 GA ship-blocker for the Knowledge
 * Center because the page and the canvas would render the same file
 * with different shapes.
 *
 * If you edit a field here, edit the matching field in
 * `packages/forge-ui/src/typed-artifacts/types.ts` and the matching
 * renderer in `packages/forge-ui/src/typed-artifacts/knowledge-file.tsx`.
 * The Forge Knowledge Center page + the Knowledge Graph canvas both
 * consume the same wire shape.
 */

export type KnowledgeFolder = "memory" | "customer" | "project" | "engagements" | "reference";

export type KnowledgeFileType = "markdown" | "json-schema" | "adr-registry" | "glossary";

export type InjectionRole = "primary" | "secondary" | "glossary";

export interface KnowledgeInjectionRole {
  readonly stage: string;
  readonly role: InjectionRole;
}

export interface KnowledgeFile {
  readonly id: string;
  /** Path relative to the workspace root, e.g. "memory/coding.md". */
  readonly path: string;
  /** Display title — usually the basename of `path`. */
  readonly title: string;
  readonly folder: KnowledgeFolder;
  readonly fileType: KnowledgeFileType;
  /** Byte size of the file on disk. */
  readonly byteSize: number;
  /** sha256[:12] of the file content — the version pin. */
  readonly versionHash: string;
  /** Per-stage injection roles (denormalised from README §2). */
  readonly injectionRoles: ReadonlyArray<KnowledgeInjectionRole>;
  /** Optional body — loaded by the page-level `panel` view. */
  readonly content?: string;
  /** Last-write timestamp (ISO 8601). */
  readonly updatedAt?: string;
}
