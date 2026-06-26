module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/apps/forge/lib/types.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Type contracts for the Forge console.
 *
 * These mirror `the FastAPI backend/src/types.ts` but are kept independent
 * so the console can be built, type-checked, and shipped without a
 * cross-package workspace dep. Field names track the orchestrator JSON
 * envelope exactly (snake_case); keep them in sync if the upstream
 * types change.
 */ __turbopack_context__.s([
    "PERSONAS",
    ()=>PERSONAS,
    "STAGES_IN_ORDER",
    ()=>STAGES_IN_ORDER
]);
const STAGES_IN_ORDER = [
    'ideation',
    'architect',
    'dev',
    'qa',
    'security',
    'devops',
    'docs'
];
const PERSONAS = [
    {
        id: 'pm',
        label: 'Product Manager',
        shortLabel: 'PM',
        description: 'PRDs, roadmap, capacity. Read-only over orchestrator + memory layer.',
        href: '/personas/pm'
    },
    {
        id: 'eng-lead',
        label: 'Engineering Lead',
        shortLabel: 'Eng Lead',
        description: 'Runs in flight, blocked work, cost. Read + approve (pause/resume/cancel).',
        href: '/personas/eng-lead'
    },
    {
        id: 'cto',
        label: 'CTO / VP Eng',
        shortLabel: 'CTO',
        description: 'Throughput, MTTR, audit log, cost by team. Read-only.',
        href: '/personas/cto'
    }
];
}),
"[project]/apps/forge/lib/auth.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Single-tenant auth stub.
 *
 * FORA-123 (identity-broker + OIDC) owns production auth; this stub
 * exists so the dashboard renders without a real auth flow during the
 * dev quickstart. The seeded tenant is `acme-corp`; the persona is
 * selected via a `?persona=` query param on the home page and stored
 * in a cookie for the rest of the session.
 *
 * Production migration: replace `getPersonaFromRequest` with a real
 * broker JWT claim read, and `PERSONAS` in `lib/types.ts` becomes a
 * role-mapping table instead of a user-facing switcher.
 */ __turbopack_context__.s([
    "PERSONA_COOKIE_NAME",
    ()=>PERSONA_COOKIE_NAME,
    "SEED_TENANT_ID",
    ()=>SEED_TENANT_ID,
    "SEED_TENANT_NAME",
    ()=>SEED_TENANT_NAME,
    "SEED_TENANT_SLUG",
    ()=>SEED_TENANT_SLUG,
    "defaultPersona",
    ()=>defaultPersona,
    "hasPermission",
    ()=>hasPermission,
    "isPersona",
    ()=>isPersona,
    "permissionsForPersona",
    ()=>permissionsForPersona,
    "personaCookie",
    ()=>personaCookie,
    "readPersonaFromCookieHeader",
    ()=>readPersonaFromCookieHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$forge$2f$lib$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/forge/lib/types.ts [app-rsc] (ecmascript)");
;
const SEED_TENANT_ID = process.env.FORA_SEED_TENANT_ID ?? 'acme-corp';
const SEED_TENANT_NAME = process.env.FORA_SEED_TENANT_NAME ?? 'Acme Corp (Dev Demo)';
const SEED_TENANT_SLUG = 'acme-corp';
const PERSONA_COOKIE_NAME = 'forge.persona';
const COOKIE_NAME = PERSONA_COOKIE_NAME;
function isPersona(value) {
    return typeof value === 'string' && __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$forge$2f$lib$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PERSONAS"].some((p)=>p.id === value);
}
function defaultPersona() {
    return 'eng-lead';
}
function readPersonaFromCookieHeader(cookieHeader) {
    if (!cookieHeader) return defaultPersona();
    const match = cookieHeader.split(';').map((p)=>p.trim()).find((p)=>p.startsWith(`${COOKIE_NAME}=`));
    if (!match) return defaultPersona();
    const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    return isPersona(value) ? value : defaultPersona();
}
function personaCookie(value) {
    // 30-day cookie; the stub does not expire on its own.
    const maxAge = 60 * 60 * 24 * 30;
    return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
const PERSONA_PERMISSIONS = {
    pm: new Set([
        'seeds:view'
    ]),
    'eng-lead': new Set([
        'seeds:view',
        'seeds:manage'
    ]),
    steward: new Set([
        'seeds:view',
        'seeds:manage'
    ]),
    cto: new Set([
        'seeds:view',
        'seeds:manage'
    ])
};
function permissionsForPersona(persona) {
    return PERSONA_PERMISSIONS[persona];
}
async function hasPermission(perm) {
    const { cookies } = await __turbopack_context__.A("[project]/node_modules/.pnpm/next@16.2.9_@playwright+test@1.61.1_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/headers.js [app-rsc] (ecmascript, async loader)");
    const store = await cookies();
    const cookieHeader = store.getAll().map((c)=>`${c.name}=${c.value}`).join('; ');
    const persona = readPersonaFromCookieHeader(cookieHeader);
    return permissionsForPersona(persona).has(perm);
}
}),
"[project]/apps/forge/app/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>HomePage
]);
/**
 * `/` — first-run entry point (Plan G commit 1).
 *
 * Replaces the previous hard redirect to `/dashboard` with a small
 * first-run check:
 *
 *   - If no `forge.persona` cookie is present (a brand-new browser
 *     that has never loaded Forge), redirect to `/welcome`.
 *   - Otherwise, the user is on a known session and we send them
 *     straight to `/dashboard`.
 *
 * The persona cookie is set when the user first picks a persona on
 * `/persona`. The cookie name matches `lib/auth.ts:PERSONA_COOKIE_NAME`
 * (`'forge.persona'`). The redirect logic intentionally does NOT
 * depend on the acme-corp seed being applied — the demo banner
 * (Plan G commit 2/3) handles the in-tenant visibility of seed
 * state. `/welcome` itself is the only place that gates on
 * first-run UX (Load Demo vs Start Empty).
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$dist$2f$api$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.9_@playwright+test@1.61.1_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/dist/api/navigation.react-server.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.9_@playwright+test@1.61.1_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/dist/client/components/navigation.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$forge$2f$lib$2f$auth$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/forge/lib/auth.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.9_@playwright+test@1.61.1_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/headers.js [app-rsc] (ecmascript)");
;
;
;
async function HomePage() {
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cookies"])();
    const persona = cookieStore.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$forge$2f$lib$2f$auth$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PERSONA_COOKIE_NAME"])?.value;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["redirect"])(persona ? '/dashboard' : '/welcome');
}
}),
"[project]/apps/forge/app/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", ((__turbopack_context__) => {

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/forge/app/page.tsx [app-rsc] (ecmascript)"));
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0m_6vbw._.js.map