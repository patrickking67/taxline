// Every public page: it loads, it is well-formed for search, it throws nothing,
// and it has no serious or critical WCAG 2.1 AA violations.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function sitemapPaths(page: Page): Promise<string[]> {
  const res = await page.request.get('sitemap.xml');
  expect(res.ok()).toBe(true);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  return errors;
}

test('the sitemap lists every page and excludes the demo app', async ({ page }) => {
  const paths = await sitemapPaths(page);
  expect(paths.length).toBeGreaterThanOrEqual(20);
  expect(paths.some((p) => p.includes('/app/'))).toBe(false);
  for (const p of paths) expect(p.startsWith('/taxline/')).toBe(true);
});

test('every sitemap page renders cleanly and passes axe', async ({ page }) => {
  test.slow();
  const paths = await sitemapPaths(page);
  const failures: string[] = [];
  for (const path of paths) {
    const errors = watchErrors(page);
    const res = await page.goto(path, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) failures.push(`${path}: HTTP ${res?.status()}`);
    if (!(await page.title()).trim()) failures.push(`${path}: empty <title>`);
    if ((await page.locator('h1').count()) !== 1) failures.push(`${path}: expected one <h1>`);
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    if (!canonical || new URL(canonical).pathname !== path) failures.push(`${path}: canonical ${canonical}`);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    try {
      JSON.parse(ld ?? '');
    } catch {
      failures.push(`${path}: invalid JSON-LD`);
    }
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      failures.push(`${path}: axe ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`);
    }
    failures.push(...errors.map((e) => `${path}: ${e}`));
    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');
    page.removeAllListeners('response');
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

test('unknown paths get the branded 404 page', async ({ page }) => {
  const res = await page.goto('no-such-page/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('a[href="/taxline/"]').first()).toBeVisible();
});

test('the demo app is noindex and renders a document', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('app/');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  expect(errors).toEqual([]);
});

test('every internal link on every page resolves', async ({ page }) => {
  test.slow();
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const links = new Map<string, string>();
  for (const path of await sitemapPaths(page)) {
    await page.goto(path);
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      const url = new URL(href);
      if (url.origin !== origin) continue;
      url.hash = '';
      if (!links.has(url.href)) links.set(url.href, path);
    }
  }
  const broken: string[] = [];
  for (const [href, from] of links) {
    const res = await page.request.get(href);
    if (res.status() !== 200) broken.push(`${res.status()} ${new URL(href).pathname} (linked from ${from})`);
  }
  expect(links.size).toBeGreaterThan(20);
  expect(broken, broken.join('\n')).toEqual([]);
});
