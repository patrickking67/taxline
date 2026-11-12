// Capture the README screenshots from the production build.
//
//   BASE_PATH=/taxline npm run build
//   node site/e2e/serve.mjs &            # http://localhost:4173/taxline/
//   node scripts/capture-screenshots.mjs [outDir]     # run from the repo root
//
// Uses the site's own Playwright install; CHROMIUM_PATH reuses a local Chromium.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(new URL('../site/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const origin = process.env.SITE_ORIGIN ?? 'http://localhost:4173/taxline';
const out = resolve(process.argv[2] ?? 'docs/assets');
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'home', path: '/', width: 1280, height: 800 },
  { name: 'console', path: '/app/acme_w2_2024/', width: 1280, height: 800 },
  { name: 'calculator', path: '/tools/income-tax/', width: 1280, height: 800 },
  { name: 'home-mobile', path: '/', width: 390, height: 844 },
  // The Open Graph card, taken from the real hero.
  { name: 'social-preview', path: '/', width: 1200, height: 630, dir: 'site/public' },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(origin + shot.path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shot.dir ? resolve(shot.dir) : out}/${shot.name}.png` });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(
    `${shot.name}.png  ${shot.width}x${shot.height}  overflow ${overflow}px  console errors ${errors.length}`,
  );
  await page.close();
}
await browser.close();
