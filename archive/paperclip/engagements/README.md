# Customer Engagement Overrides

Per-tenant convention files live at `engagements/<customer-slug>/conventions.md`.
Read by the foundation layer (`@fora/forge-ui`) at server-render time via
`resolveConventionsFromFs(slug)` (Plan 3 §6).

Schema (minimal — full YAML would pull in `yaml`):

| Key | Type | Effect |
|-----|------|--------|
| `name` | string | Display name for the engagement |
| `theme_default` | `light` \| `dark` \| `system` | Persona-default override |
| `brand_primary` | CSS `hsl()` triplet | Replaces `--brand-primary` |
| `brand_accent` | CSS `hsl()` triplet | Replaces `--brand-accent` |
| `wcag_level` | `AA` \| `AAA` | Effective WCAG target |

The convention hierarchy (per `workspace/customer/conventions.md` §1):
1. Customer contract
2. **This file** (engagement override)
3. Customer standards (`workspace/customer/standards.md`)
4. Engineering memory
5. Project tech stack

A new file here does NOT ship a tenant until the Forge AI-374 forge app is
configured to load it. The foundation layer only ships the resolver.
