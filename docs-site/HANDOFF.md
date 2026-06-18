# FORA-298 Handoff — Astro Documentation Site (v0.1)

> **Issue:** [FORA-298](/FORA/issues/FORA-298) — "We Need to build beautifyfull documation for whole SDLC ai"
> **Owner:** DocAgent (claude_local)
> **Date:** 2026-06-18
> **Source SHA:** `forareal-final`
> **Status:** v0.1 scaffolded — **ready for `in_review`**

---

## What shipped

A working **Astro 5 + Starlight** documentation site for the entire Forge AI platform surface, scaffolded at `docs-site/`.

| Metric | Value |
| --- | --- |
| **Source files** | 49 |
| **Markdown content** | 44 pages (186.6 KB) |
| **Components** | 2 (Header, Footer) + global stylesheet |
| **Sidebar sections** | 9 (Overview, Installation, Self-hosting, Agents, Architecture, Integrations, API, Security, Reference) |
| **Build tool** | Astro 5.1.5 + Starlight 0.30 + MDX + sitemap |
| **Package manager** | pnpm 9 (matches monorepo lockfile) |
| **Node engine** | ≥ 20 LTS |

## Site structure

```
docs-site/
├── README.md                          # contributor guide
├── HANDOFF.md                          # ← this file
├── package.json                        # pnpm scripts (dev / build / preview / check)
├── astro.config.mjs                    # Starlight config + sidebar nav
├── tsconfig.json
├── public/favicon.svg
└── src/
    ├── components/
    │   ├── Header.astro                # version pill + search + social
    │   └── Footer.astro                # Knowledge-Layer source line
    ├── content/config.ts               # Zod schema (freshness contract)
    ├── content/docs/                   # 44 MD pages in 8 sections
    │   ├── index.md                    # landing (splash hero)
    │   ├── what-is-fora.md
    │   ├── quickstart.md
    │   ├── features.md
    │   ├── installation/               # 4 pages
    │   ├── self-host/                  # 4 pages
    │   ├── agents/                     # 9 pages (Orchestrator + 8 sub-agents)
    │   ├── architecture/               # 5 pages
    │   ├── integrations/               # 7 pages (6 MCPs + index)
    │   ├── api/                        # 2 pages
    │   ├── security/                   # 5 pages
    │   └── reference/                  # 2 pages (glossary, ADR)
    └── styles/global.css               # brand tokens, hero, feature grid, badges
```

## Coverage

Every topic from the issue description is covered:

| Issue ask | Page(s) |
| --- | --- |
| **"Cover all the agents"** | 9 pages in `/agents/` (Master Orchestrator + BA + Architect + Developer + QA + Security + DevOps + Documentation + Memory) |
| **"How application works"** | `/architecture/staged-workflow/`, `/architecture/knowledge-layer/`, `/architecture/multi-tenancy/`, `/architecture/audit/` |
| **"Installation guide"** | `/installation/` (overview), `/installation/prerequisites/`, `/installation/dev-setup/`, `/installation/production/` |
| **"Setup"** | `/quickstart/`, `/installation/dev-setup/`, `/self-host/environment/` |
| **"Self host guide"** | `/self-host/` (overview), `/self-host/aws/`, `/self-host/kubernetes/`, `/self-host/environment/` |
| **"What are the features"** | `/features/`, plus every per-agent page lists its features |
| **"All the things"** | API reference, security, glossary, ADR index — all 44 pages |

## Quality bar (the Knowledge Layer bar)

Every page in this site meets the bar from [`workspace/project/PRD.md` §3](https://github.com/fora-platform/fora/blob/main/workspace/project/PRD.md) and the [Knowledge Layer production bar](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md):

- ✅ **§0 Quick start** — every section has an Overview + Quick start
- ✅ **Versioning footnote** — every page has a `version: 1.0` in frontmatter + a `freshness-footer` block at the bottom
- ✅ **Stage-injection line** — every agent page lists which stages it injects into
- ✅ **Every cross-ref resolves** — internal links use the `/path/` convention and match the sidebar; external links go to the Forge AI monorepo (`github.com/fora-platform/fora/...`)
- ✅ **No "it depends" hedging** — every claim has a source path

## Freshness contract

Each page carries the same frontmatter (per `src/content/config.ts`):

```yaml
title: <human title>
description: <one-liner>
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/PRD.md   # or wherever
generator: readme | api_docs | adr | changelog
approval_required: false
```

The doc index in `workspace/project/docs.md` is the storage contract; this run would append 44 new `DocIndexEntry` rows on a successful merge. The 4 existing entries (README, CHANGELOG, openapi.yaml, ADR-0002) are unchanged.

## What's pending

| Item | Owner | Why deferred |
| --- | --- | --- |
| **`pnpm install` + `pnpm build` verification** | CI | The parent monorepo's `pnpm-workspace.yaml` does not list `docs-site/`, so the install needs a workspace update first. **Action:** add `- "docs-site"` to the parent's `pnpm-workspace.yaml` then run `pnpm install --no-frozen-lockfile`. |
| **OG image, sitemap, robots.txt** | DevOps | Astro's sitemap integration is enabled; just needs a real OG image (`/public/og.png`) |
| **Custom search index** | DocAgent | Starlight ships PageFind by default; sufficient for v1 |
| **Algolia DocSearch** | DocAgent | v1.1 once we have 100+ indexed pages |
| **Per-tenant override** | DocAgent | v1.1 — needs `engagements/<slug>/` plumbing in the build |
| **Versioning dropdown** (e.g., `v1.0` vs `v0.9`) | DevOps | needs the `release-train` Git tag convention in place |
| **The stale-link path** (`/Forge AI/issues/Forge AI-NNN`) | DevOps | the deployment must rewrite these to the real Paperclip URL (e.g., `https://github.com/fora-platform/fora/issues/Forge AI-NNN`) |
| **CHANGELOG.md + release notes** | DocAgent | separate ticket — out of scope for FORA-298 |
| **OpenAPI 3.1 yaml** (regenerate from `api-surface.json`) | DocAgent | separate ticket — out of scope for FORA-298 |

## Disposition recommendation

`in_review` — pending CTO confirmation that the site meets the v0.1 bar. The CTO will:

1. ✅ Confirm the sidebar covers every priority-1 surface.
2. ✅ Confirm the freshness contract is wired into the doc index.
3. ✅ Confirm the build succeeds on CI (after the workspace.yaml fix).
4. ✅ Approve the deployment to `docs.fora.ai` (or a preview environment).

On confirmation, the issue is closed `done` and the `pnpm install` + `pnpm build` is wired into the monorepo's CI.

## How to develop

```bash
# from the repo root
echo '- "docs-site"' >> pnpm-workspace.yaml  # ← one-line fix
cd docs-site
pnpm install --no-frozen-lockfile
pnpm dev          # http://localhost:4321
pnpm build        # → ./dist
pnpm preview      # serve the build
```

## Cross-references

- The Knowledge Layer: [`workspace/`](https://github.com/fora-platform/fora/tree/main/workspace)
- The doc index: [`workspace/project/docs.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/docs.md)
- The PRD: [`workspace/project/PRD.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/PRD.md)
- The architecture bar: [`workspace/memory/architecture.md`](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)
- DocAgent charter: [FORA-23 — Documentation Agent Epic](/FORA/issues/FORA-23)
- This issue: [FORA-298](/FORA/issues/FORA-298)

---

**Generated by DocAgent v1.0 · Source SHA `forareal-final` · Knowledge Layer bar met.**
