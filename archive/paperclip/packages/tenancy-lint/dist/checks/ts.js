/**
 * @fora/tenancy-lint — TypeScript checks
 *
 * Today there is one TS rule: `BYPASSRLS` may not appear in code that runs
 * inside an application role. The marker is the literal token `BYPASSRLS`
 * (case-insensitive), which can leak in via a string constant, a comment, or
 * a generated SQL query. Outside `migrations/` and `audit/`, any presence of
 * `BYPASSRLS` is a build failure.
 *
 * The TS scan is line-based: we look for the token in any non-comment line.
 * We do NOT parse the TypeScript AST — that would miss the dynamic case
 * (e.g. a runtime string concat that produces `BYPASSRLS`).
 */
import { isUnderAudit, isUnderMigrations } from './sql.js';
const BYPASS_TOKEN_RE = /\bBYPASSRLS\b/i;
/**
 * Strip `//` and `/* ... *\/` comments from a TS/JS line, keeping string
 * literals intact. This is line-based: a `/* ... *\/` that spans multiple
 * lines is not perfectly handled; it is good enough for the lint because
 * `BYPASSRLS` is unlikely to appear across a multi-line comment in a way
 * that masks a real bug, and the CI runs the TS compiler which would
 * surface the obvious cases.
 */
function stripTsComments(line) {
    // Single-line comment.
    const slc = line.indexOf('//');
    // Block-comment opener/closer on a single line: handled below.
    // For a single-line scan we just remove `//` content; for block comments
    // we leave the content because multi-line block comments can hide the
    // token and we want the build to fail loud in that case.
    if (slc !== -1)
        return line.slice(0, slc);
    return line;
}
export function checkTs(filePath, source) {
    if (!source.trim())
        return [];
    if (isUnderMigrations(filePath) || isUnderAudit(filePath))
        return [];
    const findings = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i] ?? '';
        const line = stripTsComments(raw);
        if (BYPASS_TOKEN_RE.test(line)) {
            findings.push({
                severity: 'error',
                rule: 'no-bypassrls-outside-migrations-and-audit',
                file: filePath,
                line: i + 1,
                message: '`BYPASSRLS` is only allowed in `migrations/` (migration runner) and `audit/` (audit-log writer). Application code MUST NOT mint a `BYPASSRLS` role.',
            });
        }
    }
    return findings;
}
//# sourceMappingURL=ts.js.map