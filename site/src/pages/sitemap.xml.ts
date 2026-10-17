// sitemap.xml — every public page, derived from the pages directory so a new
// page is listed without editing this file. The demo app and dynamic routes
// are excluded (they are noindex).
import type { APIRoute } from 'astro';
import { absolute } from '../lib/url';
import { insights } from '../lib/content/insights';

const pages = Object.keys(import.meta.glob('./**/*.astro'))
  .map((f) => f.replace(/^\.\//, '').replace(/\.astro$/, '').replace(/(^|\/)index$/, ''))
  .filter((p) => !p.startsWith('app') && !p.includes('[') && p !== '404')
  // Dynamic routes are excluded above; add the concrete public article pages.
  .concat(insights.map((post) => `insights/${post.slug}`))
  .sort();

const priority = (p: string) => (p === '' ? '1.0' : p.startsWith('tools') || p.startsWith('insights') || p === 'pricing' || p === 'product' ? '0.9' : '0.7');

export const GET: APIRoute = ({ site }) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = pages
    .map((p) => `  <url><loc>${absolute(p ? `${p}/` : '', site)}</loc><lastmod>${lastmod}</lastmod><priority>${priority(p)}</priority></url>`)
    .join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
