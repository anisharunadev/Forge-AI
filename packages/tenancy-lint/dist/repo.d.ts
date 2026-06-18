/**
 * @fora/tenancy-lint — repo scanner
 *
 * Walks a directory tree and returns a flat list of file paths matching the
 * lint's input globs. Hidden directories (`node_modules`, `.git`, `dist`,
 * `coverage`, etc.) are skipped. Symlinks are not followed.
 *
 * The scanner is intentionally a tiny in-tree walk rather than a glob
 * library dependency — globs are easy to get wrong, and the only paths we
 * ever want to scan are the ones in the repo working copy.
 *
 * An optional `.tenancylintignore` (gitignore-style) at the scan root is
 * honored by default. The linter itself and any package that mentions
 * `BYPASSRLS` / `CREATE TABLE` as part of its own audit code (e.g. the
 * migration runner) list themselves here so the lint does not self-trigger.
 */
export interface ScannedFile {
    /** Path relative to the scan root, with forward slashes. */
    readonly relPath: string;
    /** Absolute path on disk. */
    readonly absPath: string;
    /** File content. */
    readonly content: string;
}
export interface ScanOptions {
    /** Root directory to walk. Defaults to CWD. */
    readonly root?: string;
    /** If true, also include SQL files under any `migrations/` (default true). */
    readonly includeMigrations?: boolean;
    /**
     * Extra ignore patterns to apply in addition to the on-disk
     * `.tenancylintignore`. Patterns are gitignore-style (see `matchesIgnore`).
     * Pass an empty array to skip the on-disk file as well.
     */
    readonly ignorePatterns?: readonly string[];
}
export interface CompiledIgnore {
    /** Original patterns, in declaration order. */
    readonly patterns: readonly string[];
    /** Whether any pattern is a negation (`!foo`). */
    readonly hasNegations: boolean;
}
/**
 * Load `.tenancylintignore` from the scan root. Returns an empty list if
 * the file is missing — the linter still runs, it just has nothing to skip.
 */
export declare function loadIgnorePatterns(root: string): string[];
/**
 * Parse the body of a `.tenancylintignore` file. Comment lines start with
 * `#`, blank lines are dropped, `\` at end-of-line joins with the next line.
 * Leading and trailing whitespace on each line is ignored.
 */
export declare function parseIgnoreText(text: string): string[];
/**
 * Compile ignore patterns into a runnable form. Exposed for tests so we
 * can assert that comment lines, blanks, and trailing whitespace are
 * handled without touching the filesystem.
 */
export declare function compileIgnore(patterns: readonly string[]): CompiledIgnore;
/**
 * Match a repo-relative path against a list of gitignore-style patterns.
 *
 * Semantics (intentionally a strict subset of gitignore — enough for our
 * scope/exclude use case, no need for the full grammar):
 *
 * - `# comment` and blank lines are dropped by `parseIgnoreText`.
 * - A pattern without a leading slash is matched against any suffix of the
 *   path (`foo/` matches `packages/foo/x.ts` and `x.ts` if `x` is a dir).
 * - A pattern with a leading slash is anchored to the root.
 * - `*` matches anything except `/`.
 * - `**` matches any number of segments, including zero.
 * - `?` matches a single character (excluding `/`).
 * - Trailing `/` means "directory only" — we still apply it to files
 *   inside the directory, which is what callers actually want.
 * - `!pattern` negates a previous match.
 *
 * Returns true if the path should be skipped.
 */
export declare function matchesIgnore(relPath: string, patterns: readonly string[]): boolean;
/** Walk a directory recursively, returning matching files. */
export declare function walk(opts?: ScanOptions): ScannedFile[];
