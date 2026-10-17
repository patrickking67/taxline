// Serve the production build the way GitHub Pages does: under BASE_PATH, with
// directory indexes and the site's own 404 page. Lets the e2e suite exercise the
// real deployed shape (/taxline/...) rather than the dev server.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = `/${(process.env.BASE_PATH ?? '/taxline').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
const port = Number(process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

async function resolve(path) {
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return null;
  const s = await stat(file).catch(() => null);
  if (s?.isFile()) return file;
  if (s?.isDirectory()) return (await stat(join(file, 'index.html')).catch(() => null)) ? join(file, 'index.html') : null;
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const inBase = base === '' || path === base || path.startsWith(`${base}/`);
  const file = inBase ? await resolve(path.slice(base.length) || '/') : null;
  if (!file) {
    res.writeHead(404, { 'content-type': types['.html'] });
    res.end(await readFile(join(root, '404.html')).catch(() => 'Not found'));
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`dist served at http://localhost:${port}${base}/`));
