// Persistent on-disk vector store — the durable half of "persistent memory".
//
// A single JSON file (service/.data/memory.json) holds every record: KB chunks
// indexed at startup PLUS anything remember()'d during operation. Persisting to
// disk is what makes memory survive restarts (persistent) and accumulate over time
// (continuous). Each write is atomic-ish: write a temp file, then rename over the
// target, so a crash mid-write can't corrupt the store.
//
// This is intentionally a flat-file brute-force store: dependency-free, transparent,
// and fine for a KB of this size. Swapping in a real vector DB later means
// reimplementing this class behind the same methods — callers (memory/index.ts) are
// unaffected.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The on-disk store lives under service/.data/ (created on first write). */
export const DATA_DIR = path.resolve(__dirname, '../../.data');
export const STORE_PATH = path.join(DATA_DIR, 'memory.json');

/** Where a record came from, and what kind of memory it is. */
export interface MemorySource {
  /** Source file (relative to the KB) when the record is a KB chunk. */
  file?: string;
  /** Heading/section within the source, when known. */
  heading?: string;
  /** 'kb' = indexed knowledge base; 'finding' = remembered approved finding/interaction. */
  kind: 'kb' | 'finding' | string;
}

/** One vector record: the text, its embedding, provenance, and when it was written. */
export interface MemoryRecord {
  id: string;
  text: string;
  vector: number[];
  source: MemorySource;
  /** Unix epoch milliseconds the record was written/updated. */
  ts: number;
}

/** A search hit: the matched record and its cosine score (1 = identical direction). */
export interface SearchHit {
  record: MemoryRecord;
  score: number;
}

/** On-disk envelope. `version` lets a future format migrate safely. */
interface StoreFile {
  version: 1;
  records: MemoryRecord[];
}

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for a zero vector or a
 * dimension mismatch (treated as "no similarity" rather than throwing) so a stray
 * record from a different provider can't crash a search.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class VectorStore {
  /** In-memory copy of the records; the JSON file is the source of truth on disk. */
  private records: MemoryRecord[] = [];
  private loaded = false;

  /** Number of records currently held (after load()). */
  get size(): number {
    return this.records.length;
  }

  /** True once load() has run and the store holds at least one record. */
  isEmpty(): boolean {
    return this.records.length === 0;
  }

  /** Read the store from disk into memory. A missing file is an empty store, not an error. */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      this.records = Array.isArray(parsed.records) ? parsed.records : [];
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.records = []; // first run — nothing persisted yet.
      } else {
        // Corrupt/unreadable store: start empty rather than crash. The next write
        // rewrites a clean file. (A production build might quarantine the bad file.)
        // eslint-disable-next-line no-console
        console.warn(`memory store unreadable (${code ?? 'parse error'}) — starting empty.`);
        this.records = [];
      }
    }
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('VectorStore.load() must be called before use.');
    }
  }

  /**
   * Insert or replace records by id (idempotent). Re-indexing the KB calls this so a
   * given chunk's id always maps to exactly one record — no duplicates on rebuild.
   */
  async upsert(records: MemoryRecord[]): Promise<void> {
    this.ensureLoaded();
    if (records.length === 0) return;
    const byId = new Map<string, MemoryRecord>();
    for (const r of this.records) byId.set(r.id, r);
    for (const r of records) byId.set(r.id, r);
    this.records = Array.from(byId.values());
    await this.persist();
  }

  /**
   * Append a single record (continuous memory of a new finding/interaction). If the id
   * already exists it is replaced, keeping ids unique.
   */
  async append(record: MemoryRecord): Promise<void> {
    await this.upsert([record]);
  }

  /**
   * Cosine top-k search over all records. Returns hits sorted by descending score.
   * An empty store or k<=0 yields []. Zero-similarity hits are dropped.
   */
  search(queryVec: number[], k: number): SearchHit[] {
    this.ensureLoaded();
    if (k <= 0 || this.records.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const record of this.records) {
      const score = cosineSimilarity(queryVec, record.vector);
      if (score > 0) hits.push({ record, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** Atomic-ish persist: write a temp file in the same dir, then rename over the target. */
  private async persist(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const file: StoreFile = { version: 1, records: this.records };
    const tmp = path.join(DATA_DIR, `.memory.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, `${JSON.stringify(file)}\n`, 'utf8');
    // rename is atomic on the same filesystem — readers see either the old or new file.
    await fs.rename(tmp, STORE_PATH);
  }
}
