// Published Insights as JSON — the contract the static marketing site pulls at
// build time (scripts/pull-insights.mjs). Drafts never leave the CMS: the query
// asks for published entries only. Shape matches site/src/content/insights.json.
import type { APIRoute } from 'astro';
import { getEmDashCollection, getEntryTerms } from 'emdash';

export const prerender = false;

export const GET: APIRoute = async () => {
  const { entries, error } = await getEmDashCollection('insights', {
    status: 'published',
    orderBy: { published_at: 'desc' },
  });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const out = await Promise.all(
    entries.map(async (e) => {
      // Typed by emdash-env.d.ts, generated from the live schema (npx emdash types).
      const d = e.data;
      const terms = await getEntryTerms('insights', d.id, 'category');
      return {
        slug: e.id,
        title: d.title,
        excerpt: d.excerpt,
        category: terms[0]?.slug ?? null,
        tool: d.tool || null,
        readingMinutes: d.reading_minutes ?? null,
        publishedAt: (d.publishedAt ?? d.updatedAt).toISOString().slice(0, 10),
        content: d.content ?? [],
      };
    }),
  );

  return new Response(JSON.stringify({ source: 'emdash', generatedAt: new Date().toISOString(), entries: out }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
