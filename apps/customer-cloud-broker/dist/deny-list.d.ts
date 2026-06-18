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
import { z } from 'zod';
import type { Cloud } from './types.js';
declare const DenyListSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    actions: z.ZodArray<z.ZodObject<{
        cloud: z.ZodEnum<["aws", "azure", "gcp"]>;
        action: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        cloud: "aws" | "azure" | "gcp";
        action: string;
        reason?: string | undefined;
    }, {
        cloud: "aws" | "azure" | "gcp";
        action: string;
        reason?: string | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    version: 1;
    actions: {
        cloud: "aws" | "azure" | "gcp";
        action: string;
        reason?: string | undefined;
    }[];
}, {
    version: 1;
    actions: {
        cloud: "aws" | "azure" | "gcp";
        action: string;
        reason?: string | undefined;
    }[];
}>;
export type DenyList = z.infer<typeof DenyListSchema>;
export interface DenyListMatch {
    cloud: Cloud;
    action: string;
    reason: string | null;
}
export interface LoadOptions {
    baseDir?: string;
}
export declare function loadDenyList(source: string, opts?: LoadOptions): DenyList;
/**
 * In-memory compiled matcher. Built once from the loaded deny-list and
 * reused on every request. v1 is in-process; future work can move it to
 * the policy store if deny-list hot-reload is needed.
 */
export declare class DenyListMatcher {
    private readonly entries;
    constructor(list: DenyList);
    /** Returns the matching entry or null. */
    match(cloud: Cloud, action: string): DenyListMatch | null;
}
/**
 * Convenience: load + compile. Returns the matcher and the raw list
 * (the raw list is what audit events record so a reviewer can confirm
 * *which* version of the deny-list was active).
 */
export declare function buildDenyListMatcher(source: string, opts?: LoadOptions): {
    list: DenyList;
    matcher: DenyListMatcher;
    sourcePath: string;
};
export {};
