// robots.txt — generated so the sitemap URL follows SITE_URL/BASE_PATH.
import type { APIRoute } from 'astro';
import { absolute, u } from '../lib/url';

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: ${u('app/')}\n\nSitemap: ${absolute('sitemap.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
