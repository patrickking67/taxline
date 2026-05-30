// Knowledge-base retrieval — the living-KB read path.
//
// Deliberately dependency-free: NO external vector DB, NO embeddings. It loads
// every markdown file under ../../knowledge-base, splits each into chunks by
// heading, and scores chunks against a query with simple keyword/overlap scoring.
// This keeps the retrieval transparent and runnable offline; the production plan
// (README) describes swapping this for embeddings without touching callers.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** knowledge-base lives a sibling of service/, two levels up from src/kb/. */
export const KB_ROOT = path.resolve(__dirname, '../../../knowledge-base');

export interface KbChunk {
  text: string;
  source: { file: string; heading: string | null };
  score: number;
}

interface RawChunk {
  text: string;
  file: string;
  heading: string | null;
  /** Pre-tokenized lowercase terms for scoring. */
  terms: Set<string>;
}

let cache: RawChunk[] | null = null;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'is', 'are',
  'be', 'as', 'at', 'it', 'this', 'that', 'with', 'from', 'into', 'per', 'each',
  'you', 'your', 'not', 'no', 'do', 'if', 'after', 'before', 'when', 'than',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    // keep tax form ids like 1099-nec, 1120-s together, plus § references.
    .replace(/[^a-z0-9§\-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out; // missing KB dir -> no chunks; callers treat as empty result.
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdown(full)));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** Split a markdown document into chunks at each heading (#..######). */
function chunkByHeading(content: string, relFile: string): RawChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: RawChunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text.length > 0) {
      const termSource = `${heading ?? ''} ${text}`;
      chunks.push({ text, file: relFile, heading, terms: new Set(tokenize(termSource)) });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!.trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

/** Load + chunk the whole KB once, then cache. Call refreshKb() to invalidate. */
async function loadChunks(): Promise<RawChunk[]> {
  if (cache) return cache;
  const files = await listMarkdown(KB_ROOT);
  const all: RawChunk[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const rel = path.relative(KB_ROOT, file);
    all.push(...chunkByHeading(content, rel));
  }
  cache = all;
  return all;
}

/** Drop the in-memory cache so the next retrieve re-reads from disk. */
export function refreshKb(): void {
  cache = null;
}

/**
 * Retrieve the top-k chunks for a query.
 *
 * Scoring is intentionally simple and explainable: term-overlap (query terms
 * present in the chunk) weighted by how rare the term is across the corpus
 * (a light IDF), with a small bonus when a query term appears in the heading.
 * Returns [] for an empty corpus or no-match — an EMPTY RESULT, distinct from a
 * load failure (which would throw and be caught by the calling tool).
 */
export async function retrieve(query: string, k = 4): Promise<KbChunk[]> {
  const chunks = await loadChunks();
  if (chunks.length === 0) return [];

  const qTerms = Array.from(new Set(tokenize(query)));
  if (qTerms.length === 0) return [];

  // Document frequency per term, for a light IDF weighting.
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let n = 0;
    for (const c of chunks) if (c.terms.has(term)) n++;
    df.set(term, n);
  }
  const N = chunks.length;

  const scored = chunks.map((c) => {
    let score = 0;
    const headingTerms = c.heading ? new Set(tokenize(c.heading)) : new Set<string>();
    for (const term of qTerms) {
      if (!c.terms.has(term)) continue;
      const dfi = df.get(term) ?? N;
      const idf = Math.log(1 + N / (1 + dfi));
      score += idf;
      if (headingTerms.has(term)) score += idf * 0.5; // heading match bonus
    }
    return { text: c.text, source: { file: c.file, heading: c.heading }, score };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
