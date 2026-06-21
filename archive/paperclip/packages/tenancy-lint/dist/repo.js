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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.turbo',
    '.vercel',
    'out',
    '.omc',
    '.claude',
    '.paperclip',
]);
const SQL_EXTS = new Set(['.sql']);
const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
/** Filename of the ignore file (no leading dot in the constant for clarity). */
const IGNORE_FILENAME = '.tenancylintignore';
/**
 * Load `.tenancylintignore` from the scan root. Returns an empty list if
 * the file is missing — the linter still runs, it just has nothing to skip.
 */
export function loadIgnorePatterns(root) {
    const path = join(root, IGNORE_FILENAME);
    if (!existsSync(path))
        return [];
    const text = readFileSync(path, 'utf-8');
    return parseIgnoreText(text);
}
/**
 * Parse the body of a `.tenancylintignore` file. Comment lines start with
 * `#`, blank lines are dropped, `\` at end-of-line joins with the next line.
 * Leading and trailing whitespace on each line is ignored.
 */
export function parseIgnoreText(text) {
    const lines = text.replace(/\\\r?\n/g, ' ').split('\n');
    const out = [];
    for (const raw of lines) {
        const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
        if (!line)
            continue;
        if (line.startsWith('#'))
            continue;
        out.push(line);
    }
    return out;
}
/**
 * Compile ignore patterns into a runnable form. Exposed for tests so we
 * can assert that comment lines, blanks, and trailing whitespace are
 * handled without touching the filesystem.
 */
export function compileIgnore(patterns) {
    return { patterns: [...patterns], hasNegations: patterns.some((p) => p.startsWith('!')) };
}
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
export function matchesIgnore(relPath, patterns) {
    if (patterns.length === 0)
        return false;
    const compiled = compileIgnore(patterns);
    const normalized = relPath.split(sep).join('/');
    let ignored = false;
    for (const raw of compiled.patterns) {
        let negated = false;
        let pat = raw;
        if (pat.startsWith('!')) {
            negated = true;
            pat = pat.slice(1);
        }
        const dirOnly = pat.endsWith('/');
        if (dirOnly)
            pat = pat.slice(0, -1);
        if (pat === '')
            continue;
        const anchored = pat.startsWith('/');
        const candidate = anchored ? pat.slice(1) : pat;
        // For dir-only patterns (`packages/foo/`), treat the pattern as a
        // directory prefix: any file at or below that directory matches.
        const reSource = dirOnly ? globToRegExp(candidate + '/**') : globToRegExp(candidate);
        // Match against the full normalized path and any suffix path so that
        // `packages/foo/**` matches `packages/foo/src/x.ts` and `foo/**` does too.
        const matches = reSource.test(normalized) || matchesAnySuffix(normalized, reSource);
        if (!matches)
            continue;
        ignored = !negated;
    }
    return ignored;
}
function globToRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i += 1) {
        const c = glob[i];
        if (c === undefined)
            break;
        if (c === '*') {
            const nx = glob[i + 1];
            if (nx === '*') {
                // `**` — match any number of segments, including zero. When followed
                // by `/`, consume the slash too so `a/**/b` matches `a/b` and `a/x/y/b`.
                out += '.*';
                i += 1;
                if (glob[i + 1] === '/')
                    i += 1;
            }
            else {
                out += '[^/]*';
            }
        }
        else if (c === '?') {
            out += '[^/]';
        }
        else if ('\\^$.|+(){}[\\]'.includes(c)) {
            out += '\\' + c;
        }
        else {
            out += c;
        }
    }
    return new RegExp('^' + out + '$');
}
function matchesAnySuffix(normalized, re) {
    const parts = normalized.split('/');
    for (let i = 1; i < parts.length; i += 1) {
        const suffix = parts.slice(i).join('/');
        if (re.test(suffix))
            return true;
    }
    return false;
}
function hasMatchingAncestorDir(normalized, candidate, anchored) {
    // For dir-only patterns, ensure the file lives inside a directory whose
    // own path matches the pattern as a prefix. We approximate by checking
    // that some parent directory's relpath ends with the candidate (modulo
    // `**` wildcards, which are absorbed into the regex).
    const prefix = candidate.replace(/\/\*\*$/, '').replace(/\*\*$/, '');
    if (!prefix)
        return true;
    const parts = normalized.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
        const ancestor = parts.slice(0, i).join('/');
        if (ancestor === prefix)
            return true;
        if (!anchored && ancestor.endsWith('/' + prefix))
            return true;
        if (!anchored && ancestor === prefix)
            return true;
    }
    return false;
}
/** Walk a directory recursively, returning matching files. */
export function walk(opts = {}) {
    const root = opts.root ?? process.cwd();
    const includeMigrations = opts.includeMigrations ?? true;
    const onDiskPatterns = opts.ignorePatterns !== undefined ? [] : loadIgnorePatterns(root);
    const allPatterns = [...onDiskPatterns, ...(opts.ignorePatterns ?? [])];
    const out = [];
    function recurse(dir) {
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return; // unreadable dir, skip
        }
        for (const entry of entries) {
            const abs = join(dir, entry);
            let st;
            try {
                st = statSync(abs);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                if (SKIP_DIRS.has(entry))
                    continue;
                // Directory-level ignore check: short-circuit before recursing.
                const dirRel = relative(root, abs).split(sep).join('/');
                if (matchesIgnore(dirRel + '/', allPatterns))
                    continue;
                recurse(abs);
                continue;
            }
            if (!st.isFile())
                continue;
            const ext = extname(entry);
            const isSql = SQL_EXTS.has(ext);
            const isTs = TS_EXTS.has(ext);
            if (!isSql && !isTs)
                continue;
            const rel = relative(root, abs).split(sep).join('/');
            if (!includeMigrations && /(?:^|\/)migrations\//.test(rel))
                continue;
            if (matchesIgnore(rel, allPatterns))
                continue;
            out.push({ relPath: rel, absPath: abs, content: readFileSync(abs, 'utf-8') });
        }
    }
    recurse(root);
    // Deterministic order for stable CI output.
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return out;
}
function extname(name) {
    const i = name.lastIndexOf('.');
    return i === -1 ? '' : name.slice(i).toLowerCase();
}
//# sourceMappingURL=repo.js.map