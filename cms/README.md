# Taxline CMS (EmDash)

Editorial backend for Taxline Insights, built on [EmDash](https://github.com/emdash-cms/emdash) 1.3 (Astro 7). Editors write and publish in the admin. The static marketing site pulls published entries at build time, so the public site stays on GitHub Pages and never depends on the CMS being up.

```
editor -> /_emdash/admin -> SQLite (local) or D1 (Cloudflare)
                               |
                 GET /api/insights.json   (published only)
                               |
        scripts/pull-insights.mjs  ->  site/src/content/insights.json  ->  static build
```

## Run it locally

```bash
cd cms
npm install
npm run seed    # applies seed/seed.json: the `insights` collection, categories, and 4 articles
npm run dev     # http://localhost:4322 · admin at /_emdash/admin
```

Then refresh the site's snapshot from the running CMS:

```bash
EMDASH_URL=http://localhost:4322 npm run pull-insights   # from the repo root
```

## Schema

`seed/seed.json` is the schema of record (EmDash stores content types in the database):

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | required |
| `excerpt` | text | required; used as the meta description |
| `content` | portableText | rendered by `site/src/components/PortableText.astro` |
| `tool` | string | slug of a related calculator, such as `s-corp` |
| `reading_minutes` | integer | |
| `category` | taxonomy | `tax-year-2026`, `planning`, `product` |

Supports drafts, revisions, preview, scheduling, search, and SEO fields. Only `published` entries are exported. After a schema change, `npx emdash types` regenerates `emdash-env.d.ts`.

## The export contract

`GET /api/insights.json` returns `{ source, generatedAt, entries: [{ slug, title, excerpt, category, tool, readingMinutes, publishedAt, content }] }`. The pull script validates the shape before it writes anything and replaces the snapshot atomically. On any failure it exits non-zero and leaves the committed snapshot in place.

## Deploy

Choose one. This repo does not deploy the CMS automatically.

- **Node:** `npm run build && npm start` on any Node 22.16+ host with a persistent volume for `data.db` and `uploads/` (for example a Fly.io machine alongside the agent service). Set `EMDASH_DATABASE_URL` to move the database.
- **Cloudflare:** switch `astro.config.mjs` to `@astrojs/cloudflare` with `d1()` and `r2()` from `@emdash-cms/cloudflare`, and add a `wrangler.jsonc` with `DB` and `MEDIA` bindings (see the EmDash configuration docs).

Once it is live, set the repository variable `EMDASH_URL` so the Pages deploy pulls fresh Insights before each build.
