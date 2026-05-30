// Memory layer — wires embeddings + the persistent store into three operations:
//
//   indexKnowledgeBase()  — (re)embed every KB markdown chunk and upsert it, idempotently.
//   remember(text,source) — embed one new approved finding/interaction and append it.
//   retrieve(query, k)    — embed the query, cosine-search the store, return chunks.
//
// Together these give the service PERSISTENT (on-disk store survives restarts),
// CONTINUOUS (remember() keeps adding to it as work happens), VECTOR (cosine over
// embeddings) memory. A single shared singleton (`memory`) is exported so every caller
// hits the same loaded store.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddings, EMBEDDINGS_PROVIDER, type Embeddings } from './embeddings.js';
import { VectorStore, type MemoryRecord, type MemorySource } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** knowledge-base is a sibling of service/, two levels up from src/memory/. */
export const KB_ROOT = path.resolve(__dirname, '../../../knowledge-base');

/** A retrieved chunk in the memory layer's own shape (provenance + score). */
export interface RetrievedChunk {
  text: string;
  source: MemorySource;
  score: number;
}

/** Embed in batches so a large KB doesn't become one huge request. */
const EMBED_BATCH = 64;

// ── KB chunking (mirrors src/kb/retrieve.ts: split at each markdown heading) ──

interface KbChunkRaw {
  text: string;
  file: string;
  heading: string | null;
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out; // missing KB dir -> no chunks.
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
function chunkByHeading(content: string, relFile: string): KbChunkRaw[] {
  const lines = content.split(/\r?\n/);
  const chunks: KbChunkRaw[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text.length > 0) chunks.push({ text, file: relFile, heading });
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

// ── Stable ids ──────────────────────────────────────────────────────────────

/** FNV-1a (32-bit), rendered hex — a stable id from arbitrary string parts. */
function hashId(parts: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Idempotent KB id: same file+heading always maps to the same record. */
function kbId(file: string, heading: string | null): string {
  return `kb_${hashId(`${file}::${heading ?? ''}`)}`;
}

// ── The memory singleton ──────────────────────────────────────────────────

class Memory {
  private readonly store = new VectorStore();
  private readonly embeddings: Embeddings = createEmbeddings();
  private loadOnce: Promise<void> | null = null;

  /** Provider name, for /health and logging. */
  get provider(): string {
    return EMBEDDINGS_PROVIDER;
  }

  /** Number of records currently in the store (after init()). */
  get size(): number {
    return this.store.size;
  }

  /** Load the persistent store exactly once; safe to call repeatedly/concurrently. */
  async init(): Promise<void> {
    if (!this.loadOnce) this.loadOnce = this.store.load();
    await this.loadOnce;
  }

  /** True if the store holds no records yet (drives the startup auto-index). */
  async isEmpty(): Promise<boolean> {
    await this.init();
    return this.store.isEmpty();
  }

  private async embedBatched(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      out.push(...(await this.embeddings.embed(batch)));
    }
    return out;
  }

  /**
   * (Re)build the KB portion of the store: chunk every markdown file by heading,
   * embed in batches, and upsert by a stable id (file+heading). Idempotent — running
   * it twice replaces existing KB records in place rather than duplicating them.
   * Returns the number of KB chunks indexed.
   */
  async indexKnowledgeBase(): Promise<number> {
    await this.init();
    const files = await listMarkdown(KB_ROOT);
    const raw: KbChunkRaw[] = [];
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const rel = path.relative(KB_ROOT, file);
      raw.push(...chunkByHeading(content, rel));
    }
    if (raw.length === 0) return 0;

    // Embed the heading + body together so a chunk's vector reflects its section title,
    // matching how the keyword path weights heading terms.
    const texts = raw.map((c) => `${c.heading ?? ''}\n${c.text}`.trim());
    const vectors = await this.embedBatched(texts);

    const now = Date.now();
    const records: MemoryRecord[] = raw.map((c, i) => ({
      id: kbId(c.file, c.heading),
      text: c.text,
      vector: vectors[i]!,
      source: { file: c.file, heading: c.heading ?? undefined, kind: 'kb' },
      ts: now,
    }));
    await this.store.upsert(records);
    return records.length;
  }

  /**
   * Continuous memory: embed one new piece of text and append it. The orchestrator
   * calls this AFTER the human-approval gate passes, so only approved, cited findings
   * are ever remembered — never drafts or low-confidence content. Returns the new id.
   */
  async remember(text: string, source: MemorySource): Promise<string> {
    await this.init();
    const clean = text.trim();
    if (clean === '') throw new Error('remember(): text must be non-empty.');
    const [vector] = await this.embeddings.embed([clean]);
    if (!vector) throw new Error('remember(): embedding failed.');
    // Content-addressed id so remembering the identical finding twice is a no-op upsert.
    const id = `${source.kind || 'finding'}_${hashId(`${source.file ?? ''}::${source.heading ?? ''}::${clean}`)}`;
    const record: MemoryRecord = {
      id,
      text: clean,
      vector,
      source: { ...source, kind: source.kind || 'finding' },
      ts: Date.now(),
    };
    await this.store.append(record);
    return id;
  }

  /**
   * Embed the query and return the cosine top-k records as chunks. Returns [] for an
   * empty store or no positive-similarity match (an EMPTY RESULT, distinct from a
   * thrown error). Callers that want a keyword fallback check isEmpty() first.
   */
  async retrieve(query: string, k = 5): Promise<RetrievedChunk[]> {
    await this.init();
    if (this.store.isEmpty()) return [];
    const [queryVec] = await this.embeddings.embed([query]);
    if (!queryVec) return [];
    return this.store.search(queryVec, k).map((h) => ({
      text: h.record.text,
      source: h.record.source,
      score: h.score,
    }));
  }
}

/** The shared singleton every caller uses. */
export const memory = new Memory();

// Re-export the similarity helper so callers/tests can reach it from one place.
export { cosineSimilarity } from './store.js';
