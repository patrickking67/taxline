// Insights — editorial content authored in the EmDash CMS (cms/) and pulled into
// this static site at build time by scripts/pull-insights.mjs. The committed
// snapshot is the fallback, so a Pages build never needs the CMS to be up.
import snapshot from '../../content/insights.json';

export interface PtSpan {
  _type: 'span';
  _key?: string;
  text: string;
  marks?: string[];
}

export interface PtBlock {
  _type: string;
  _key?: string;
  style?: string;
  listItem?: 'bullet' | 'number';
  level?: number;
  markDefs?: { _key: string; _type: string; href?: string }[];
  children?: PtSpan[];
}

export interface Insight {
  slug: string;
  title: string;
  excerpt: string;
  category: string | null;
  tool: string | null;
  readingMinutes: number | null;
  publishedAt: string;
  content: PtBlock[];
}

export const insightsSource: string = snapshot.source;
export const insights: Insight[] = (snapshot.entries as Insight[]).toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt));

export const categoryLabel: Record<string, string> = {
  'tax-year-2026': 'Tax year 2026',
  planning: 'Planning',
  product: 'Product',
};

/** Plain text of a document, for descriptions and word counts. */
export const plainText = (blocks: PtBlock[]) =>
  blocks.map((b) => (b.children ?? []).map((c) => c.text).join('')).join('\n');
