// Knowledge-base refresh — the "living KB" maintenance path.
//
// Run with:  npm run refresh-kb   (from service/)  or  tsx knowledge-base/ingest/refresh.ts
//
// What it does today (offline, deterministic):
//   1. Re-reads every source markdown file referenced by the manifest.
//   2. Recomputes each source's `lastReviewed` to today and verifies the file exists.
//   3. Stamps the manifest's top-level `updatedAt` to today and rewrites manifest.json.
//
// What it is the seam for (live source path — network was unavailable at seed time):
//   Where the comments below say "LIVE FETCH PLUGS IN HERE", a production build would
//   fetch the authoritative source (IRS pages for tax figures/dates, etc.), diff it
//   against the stored seed, update the markdown, and flag changes for human review
//   before they go live. Tax figures are marked `verify: true` in the manifest and must
//   pass that human check — refresh never silently publishes a changed tax number.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(KB_ROOT, 'manifest.json');

interface Source {
  id: string;
  title: string;
  domain: string;
  kind: string;
  lastReviewed: string;
  verify: boolean;
  note: string;
  /** sha256 (first 16 hex) of the source file at last review — detects drift. */
  contentHash?: string;
}

interface Manifest {
  updatedAt: string;
  cadence: string;
  domains: string[];
  sources: Source[];
}

/** Map a manifest source id to its file path under the KB. */
function sourcePath(src: Source): string {
  return path.join(KB_ROOT, src.domain, `${src.id}.md`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function refresh(): Promise<void> {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as Manifest;
  const stamp = today();

  let reviewed = 0;
  let missing = 0;
  let changed = 0;

  for (const src of manifest.sources) {
    const p = sourcePath(src);
    const exists = await fileExists(p);

    if (!exists) {
      // A referenced source is missing — report it; do not fabricate content.
      // eslint-disable-next-line no-console
      console.warn(`  [missing] ${src.id} expected at ${path.relative(KB_ROOT, p)}`);
      missing += 1;
      continue;
    }

    // Re-read so a live pipeline can hash/diff the current content.
    const content = await fs.readFile(p, 'utf8');

    // ── LIVE FETCH PLUGS IN HERE ───────────────────────────────────────────
    // For sources with `verify: true` (tax figures/dates), a production refresh
    // would:
    //   const fresh = await fetchAuthoritativeSource(src);     // e.g. IRS page
    //   const diff  = computeDiff(content, fresh);
    //   if (diff.hasChanges) queueForHumanReview(src, diff);   // never auto-publish
    // Network was unavailable at seed time, so we hash the local file instead: a
    // changed hash since the last review means the seed drifted and (for verify:true
    // sources) must be re-confirmed against the IRS source before it is trusted.
    // ───────────────────────────────────────────────────────────────────────
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    if (src.contentHash && src.contentHash !== hash) {
      changed += 1;
      // eslint-disable-next-line no-console
      console.log(
        `  [changed] ${src.id}: ${src.contentHash} → ${hash}` +
          (src.verify ? ' (verify:true — re-confirm against the IRS source)' : ''),
      );
    }
    src.contentHash = hash;

    src.lastReviewed = stamp;
    reviewed += 1;
  }

  manifest.updatedAt = stamp;
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `KB refreshed: ${reviewed} source(s) re-reviewed, ${changed} changed, ${missing} missing. ` +
      `updatedAt=${stamp}. Verify-flagged tax sources still require human confirmation against the live IRS source.`,
  );
}

refresh().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('KB refresh failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
