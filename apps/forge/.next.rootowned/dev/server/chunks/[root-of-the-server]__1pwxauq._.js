module.exports = [
"[externals]/next/dist/build/adapter/setup-node-env.external.js [external] (next/dist/build/adapter/setup-node-env.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/build/adapter/setup-node-env.external.js", () => require("next/dist/build/adapter/setup-node-env.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/tags-manifest.external.js [external] (next/dist/server/lib/incremental-cache/tags-manifest.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/tags-manifest.external.js", () => require("next/dist/server/lib/incremental-cache/tags-manifest.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/memory-cache.external.js [external] (next/dist/server/lib/incremental-cache/memory-cache.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/memory-cache.external.js", () => require("next/dist/server/lib/incremental-cache/memory-cache.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/shared-cache-controls.external.js [external] (next/dist/server/lib/incremental-cache/shared-cache-controls.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js", () => require("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js"));

module.exports = mod;
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/apps/forge/proxy.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FORGE_PERSONA_COOKIE",
    ()=>FORGE_PERSONA_COOKIE,
    "FORGE_PERSONA_DEFAULT",
    ()=>FORGE_PERSONA_DEFAULT,
    "FORGE_PERSONA_HEADER",
    ()=>FORGE_PERSONA_HEADER,
    "config",
    ()=>config,
    "proxy",
    ()=>proxy,
    "readPersonaFromRequest",
    ()=>readPersonaFromRequest
]);
/**
 * Next.js proxy — Forge persona header (Pillar 1 Phase 3).
 *
 * In Next.js 16, the `middleware` file convention is deprecated in
 * favor of `proxy` (same shape, new name, runs on the same Edge
 * runtime). This file is the renamed `middleware.ts`.
 *
 * Reads the `forge.persona` cookie on every request and exposes it to
 * downstream handlers (the FastAPI orchestrator in particular) via
 * the `X-Forge-Persona` request header. If the cookie is absent the
 * proxy falls back to the tenant default persona (`developer`)
 * — the backend `Tenant.default_persona` column also defaults to
 * `'developer'`, so the two sides stay in lockstep.
 *
 * The proxy does NOT block requests. Persona is a context value,
 * not an auth gate: anonymous tenants still see the same shell.
 *
 * Matching scope is intentionally narrow (`/((?!_next|api|.*\\..*).*)`)
 * to skip Next.js internals (`/_next/...`), the proxy route
 * (`/api/...`), and static assets (`/favicon.ico`, etc).
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.2.9_@playwright+test@1.61.1_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/server.js [middleware] (ecmascript)");
;
const FORGE_PERSONA_COOKIE = 'forge.persona';
const FORGE_PERSONA_DEFAULT = 'developer';
const FORGE_PERSONA_HEADER = 'X-Forge-Persona';
const config = {
    matcher: [
        '/((?!_next/|api/|favicon.ico|.*\\..*).*)'
    ]
};
function readPersonaFromRequest(request) {
    const cookie = request.cookies.get(FORGE_PERSONA_COOKIE)?.value;
    if (typeof cookie !== 'string') return FORGE_PERSONA_DEFAULT;
    const trimmed = cookie.trim();
    return trimmed.length > 0 ? trimmed : FORGE_PERSONA_DEFAULT;
}
function proxy(request) {
    const persona = readPersonaFromRequest(request);
    // Clone the incoming request headers so we can forward `X-Forge-Persona`
    // to the orchestrator without mutating the read-only `request.headers`.
    const forwarded = new Headers(request.headers);
    forwarded.set(FORGE_PERSONA_HEADER, persona);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$2$2e$9_$40$playwright$2b$test$40$1$2e$61$2e$1_react$2d$dom$40$19$2e$2$2e$7_react$40$19$2e$2$2e$7_$5f$react$40$19$2e$2$2e$7$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
        request: {
            headers: forwarded
        }
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1pwxauq._.js.map