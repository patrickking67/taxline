#!/usr/bin/env node
// Pull published Insights from the EmDash CMS into the static site.
//
//   EMDASH_URL=https://cms.example.com node scripts/pull-insights.mjs
//
// Writes site/src/content/insights.json, which the site reads at build time.
// Without EMDASH_URL this is a no-op and the committed snapshot is used, so the
// GitHub Pages build never depends on the CMS being up. A failed or malformed
// pull exits non-zero and leaves the snapshot untouched — it never writes a
// partial file.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../site/src/content/insights.json', import.meta.url));
const base = process.env.EMDASH_URL?.replace(/\/+$/, '');

if (!base) {
  const snap = JSON.parse(await readFile(target, 'utf8'));
  console.log(`EMDASH_URL not set — using the committed snapshot (${snap.entries.length} entries, source: ${snap.source}).`);
  process.exit(0);
}

const res = await fetch(`${base}/api/insights.json`, { headers: { accept: 'application/json' } }).catch((err) => {
  console.error(`Could not reach ${base}: ${err.message}`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`${base}/api/insights.json → ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const strOrNull = (v) => v === null || typeof v === 'string';
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const optArray = (v, ok) => v === undefined || (Array.isArray(v) && v.every(ok));
// Portable Text as the site renders it: blocks with spans, marks, and link defs.
const validSpan = (c) => isObj(c) && typeof c.text === 'string' && optArray(c.marks, (m) => typeof m === 'string');
const validDef = (d) => isObj(d) && typeof d._key === 'string' && typeof d._type === 'string' && (d.href === undefined || typeof d.href === 'string');
const validBlock = (b) =>
  isObj(b) && typeof b._type === 'string' &&
  (b.style === undefined || typeof b.style === 'string') &&
  (b.listItem === undefined || b.listItem === 'bullet' || b.listItem === 'number') &&
  optArray(b.children, validSpan) && optArray(b.markDefs, validDef);
const valid =
  Array.isArray(body?.entries) &&
  body.entries.every(
    (e) =>
      typeof e.slug === 'string' && /^[a-z0-9-]+$/.test(e.slug) &&
      typeof e.title === 'string' && e.title.trim() !== '' &&
      typeof e.excerpt === 'string' &&
      typeof e.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.publishedAt) &&
      strOrNull(e.category) && strOrNull(e.tool) &&
      (e.readingMinutes === null || Number.isInteger(e.readingMinutes)) &&
      Array.isArray(e.content) && e.content.every(validBlock),
  );
if (!valid) {
  console.error('CMS response does not match the Insights contract; snapshot left unchanged.');
  process.exit(1);
}

const tmp = `${target}.tmp`;
await writeFile(tmp, `${JSON.stringify({ ...body, source: 'emdash' }, null, 2)}\n`);
await rename(tmp, target);
console.log(`Pulled ${body.entries.length} published Insights from ${base}.`);
