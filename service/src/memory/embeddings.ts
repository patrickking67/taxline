// Embeddings — the vectorization seam for the memory layer.
//
// One small interface, three providers, picked by EMBEDDINGS_PROVIDER at startup:
//   - 'local'  (DEFAULT, OFFLINE): a deterministic, dependency-free pseudo-embedding.
//     It hashes tokens + 2-grams into a fixed 512-dim bucketed vector and L2-normalizes.
//     Stable across runs and processes (no learned weights, no network). This is the
//     fallback that keeps the whole service runnable offline / in dev. It captures
//     lexical overlap only — NOT real semantics.
//   - 'voyage'  (PRODUCTION): Voyage AI embeddings (model 'voyage-3'), real semantic quality.
//   - 'openai'  (PRODUCTION): OpenAI embeddings (model 'text-embedding-3-small').
//
// Switching is config-only: set EMBEDDINGS_PROVIDER + the matching API key, then rebuild
// the index (POST /memory/index) so stored vectors come from the new provider. The store
// and retrieval code never change — they only see `number[]` vectors and a `dim`.

import { fail, type StructuredError } from '../types.js';

/** The contract every provider implements. `dim` is fixed per provider. */
export interface Embeddings {
  /** Embed a batch of texts into row vectors (one number[] per input, in order). */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the vectors this provider returns. */
  dim: number;
}

/** A provider call failed in a way the caller should surface, not swallow. */
export class EmbeddingsError extends Error {
  readonly structured: StructuredError;
  constructor(structured: StructuredError) {
    super(structured.message);
    this.name = 'EmbeddingsError';
    this.structured = structured;
  }
}

// ── Local provider (offline, deterministic) ────────────────────────────────

/** Fixed local dimensionality. Small enough to be cheap, large enough to spread hashes. */
const LOCAL_DIM = 512;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'by',
  'is',
  'are',
  'be',
  'as',
  'at',
  'it',
  'this',
  'that',
  'with',
  'from',
  'into',
  'per',
  'each',
  'you',
  'your',
  'not',
  'no',
  'do',
  'if',
  'after',
  'before',
  'when',
  'than',
]);

/** Same tokenization shape as kb/retrieve.ts so local vectors track that scoring. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9§-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * FNV-1a (32-bit) — a fast, stable string hash. Deterministic across runs and
 * machines, which is the whole point: the same text must always bucket the same way.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned space via Math.imul + >>> 0.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic pseudo-embedding: bucket each token AND each adjacent 2-gram into a
 * fixed-width array of counts, then L2-normalize. 2-grams add a little local order
 * sensitivity on top of bag-of-words. Cosine similarity over these vectors approximates
 * lexical overlap — good enough for offline dev, not a substitute for real embeddings.
 */
function localEmbedOne(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec; // zero vector (cosine handles it as no-match)

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    vec[fnv1a(tok) % dim]! += 1;
    if (i + 1 < tokens.length) {
      const bigram = `${tok}_${tokens[i + 1]!}`;
      vec[fnv1a(bigram) % dim]! += 1;
    }
  }

  // L2-normalize so cosine == dot product and document length is factored out.
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm > 0) for (let i = 0; i < dim; i++) vec[i]! /= norm;
  return vec;
}

class LocalEmbeddings implements Embeddings {
  readonly dim = LOCAL_DIM;
  // Synchronous under the hood, but Promise-typed to satisfy the interface and so
  // callers treat all providers identically.
  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => localEmbedOne(t, this.dim)));
  }
}

// ── Remote providers (Voyage / OpenAI) ─────────────────────────────────────

/** Shared response shape for both OpenAI- and Voyage-style embeddings endpoints. */
interface EmbeddingsApiResponse {
  data?: { embedding?: number[]; index?: number }[];
}

/**
 * One POST to an OpenAI-compatible embeddings endpoint (Voyage mirrors this shape).
 * Errors are wrapped as structured `transient` failures so the caller can retry or
 * surface them; we never return a silently-wrong vector.
 */
async function postEmbeddings(args: {
  provider: string;
  url: string;
  apiKey: string;
  keyEnvName: string;
  model: string;
  texts: string[];
}): Promise<number[][]> {
  if (!args.apiKey) {
    throw new EmbeddingsError(
      fail(
        'permission',
        `EMBEDDINGS_PROVIDER=${args.provider} requires ${args.keyEnvName} to be set.`,
      ),
    );
  }

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({ model: args.model, input: args.texts }),
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, offline) — transient, retryable.
    throw new EmbeddingsError(
      fail(
        'transient',
        `${args.provider} embeddings request failed (network).`,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new EmbeddingsError(
      fail(
        'transient',
        `${args.provider} embeddings returned HTTP ${res.status}.`,
        detail.slice(0, 500),
      ),
    );
  }

  const body = (await res.json().catch(() => null)) as EmbeddingsApiResponse | null;
  const rows = body?.data;
  if (!Array.isArray(rows) || rows.length !== args.texts.length) {
    throw new EmbeddingsError(
      fail('transient', `${args.provider} embeddings returned an unexpected payload shape.`),
    );
  }

  // Preserve input order via the `index` field when present; APIs may return out of order.
  const out = new Array<number[]>(args.texts.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const vec = row.embedding;
    if (!Array.isArray(vec)) {
      throw new EmbeddingsError(
        fail('transient', `${args.provider} embeddings row ${i} had no vector.`),
      );
    }
    const at = typeof row.index === 'number' ? row.index : i;
    out[at] = vec;
  }
  return out;
}

/** Probe one input to learn the live vector width (model dims can vary). */
async function probeDim(
  getOne: (text: string) => Promise<number[][]>,
  fallback: number,
): Promise<number> {
  try {
    const [vec] = await getOne('dimension probe');
    return Array.isArray(vec) && vec.length > 0 ? vec.length : fallback;
  } catch {
    // If the probe fails we keep the documented default; the first real embed call
    // will surface any genuine error to the caller.
    return fallback;
  }
}

class VoyageEmbeddings implements Embeddings {
  // voyage-3 is 1024-dim; confirmed by a one-time probe on first use.
  dim = 1024;
  private probed = false;
  private readonly apiKey = process.env.VOYAGE_API_KEY ?? '';

  private call(texts: string[]): Promise<number[][]> {
    return postEmbeddings({
      provider: 'voyage',
      url: 'https://api.voyageai.com/v1/embeddings',
      apiKey: this.apiKey,
      keyEnvName: 'VOYAGE_API_KEY',
      model: 'voyage-3',
      texts,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.probed) {
      this.dim = await probeDim((t) => this.call([t]), this.dim);
      this.probed = true;
    }
    return this.call(texts);
  }
}

class OpenAiEmbeddings implements Embeddings {
  // text-embedding-3-small is 1536-dim; confirmed by a one-time probe on first use.
  dim = 1536;
  private probed = false;
  private readonly apiKey = process.env.OPENAI_API_KEY ?? '';

  private call(texts: string[]): Promise<number[][]> {
    return postEmbeddings({
      provider: 'openai',
      url: 'https://api.openai.com/v1/embeddings',
      apiKey: this.apiKey,
      keyEnvName: 'OPENAI_API_KEY',
      model: 'text-embedding-3-small',
      texts,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.probed) {
      this.dim = await probeDim((t) => this.call([t]), this.dim);
      this.probed = true;
    }
    return this.call(texts);
  }
}

/** The configured provider name, lowercased. `local` is the documented default. */
export const EMBEDDINGS_PROVIDER = (process.env.EMBEDDINGS_PROVIDER ?? 'local').toLowerCase();

/**
 * Construct the configured provider. Unknown values fall back to `local` so a typo
 * never takes the service offline — it just loses semantic quality, loudly logged.
 */
export function createEmbeddings(): Embeddings {
  switch (EMBEDDINGS_PROVIDER) {
    case 'voyage':
      return new VoyageEmbeddings();
    case 'openai':
      return new OpenAiEmbeddings();
    case 'local':
      return new LocalEmbeddings();
    default:
      // eslint-disable-next-line no-console
      console.warn(`Unknown EMBEDDINGS_PROVIDER="${EMBEDDINGS_PROVIDER}" — falling back to local.`);
      return new LocalEmbeddings();
  }
}
