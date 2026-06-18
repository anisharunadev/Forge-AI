/**
 * Deny-list loader + matcher.
 *
 * The deny-list is a YAML file with one schema (version 1). The broker
 * loads it at boot, caches in memory, and matches every brokered action
 * against it *before* any cloud contact. A match produces
 * `403 deny_listed_action` and a `cloud.brokered` audit event with
 * `response_code = deny_listed`.
 *
 * Matching is anchored: each pattern is wrapped with `^…$` before
 * evaluation. Partial matches do NOT deny — the platform refuses to
 * silently widen coverage via a substring trick.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
const DenyListEntrySchema = z
    .object({
    cloud: z.enum(['aws', 'azure', 'gcp']),
    action: z.string().min(1).max(256),
    reason: z.string().optional(),
})
    .strict();
const DenyListSchema = z
    .object({
    version: z.literal(1),
    actions: z.array(DenyListEntrySchema),
})
    .strict();
function resolvePath(source, baseDir) {
    if (isAbsolute(source))
        return source;
    return resolve(baseDir ?? process.cwd(), source);
}
export function loadDenyList(source, opts = {}) {
    const raw = readFileSync(resolvePath(source, opts.baseDir), 'utf-8');
    const parsed = parseYaml(raw);
    return DenyListSchema.parse(parsed);
}
/**
 * In-memory compiled matcher. Built once from the loaded deny-list and
 * reused on every request. v1 is in-process; future work can move it to
 * the policy store if deny-list hot-reload is needed.
 */
export class DenyListMatcher {
    entries;
    constructor(list) {
        this.entries = list.actions.map((entry) => {
            // Anchor the regex. We trust the YAML (validated by Zod) so we
            // don't worry about ReDoS — entries are short.
            const anchored = entry.action.startsWith('^') ? entry.action : `^${entry.action}$`;
            return {
                cloud: entry.cloud,
                action: entry.action,
                re: new RegExp(anchored),
                reason: entry.reason ?? null,
            };
        });
    }
    /** Returns the matching entry or null. */
    match(cloud, action) {
        for (const entry of this.entries) {
            if (entry.cloud !== cloud)
                continue;
            if (entry.re.test(action)) {
                return { cloud: entry.cloud, action: entry.action, reason: entry.reason };
            }
        }
        return null;
    }
}
/**
 * Convenience: load + compile. Returns the matcher and the raw list
 * (the raw list is what audit events record so a reviewer can confirm
 * *which* version of the deny-list was active).
 */
export function buildDenyListMatcher(source, opts = {}) {
    const baseDir = opts.baseDir ?? dirname(resolvePath(source, opts.baseDir));
    const list = loadDenyList(source, { baseDir });
    return {
        list,
        matcher: new DenyListMatcher(list),
        sourcePath: resolvePath(source, baseDir),
    };
}
