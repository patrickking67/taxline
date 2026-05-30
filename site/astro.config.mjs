// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import icon from 'astro-icon';

// GitHub Pages is static hosting. `base` is configurable so the same build
// works for a project page (/taxline) or a custom domain (/).
const SITE = process.env.SITE_URL ?? 'https://patrickking67.github.io';
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [icon(), mdx()],
  server: { port: 4321, host: true },
  build: {
    // Hashed, fingerprinted, cache-friendly asset directory.
    assets: '_assets',
  },
  vite: {
    // Cast: @tailwindcss/vite resolves a different vite Plugin type than Astro's
    // bundled vite (benign cross-version mismatch; the build runs fine).
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
