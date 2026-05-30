// Runtime configuration, loaded from the environment via dotenv.
// The API key is NEVER hardcoded — it is read from process.env at startup.

import 'dotenv/config';

/** Exact model IDs. opus = default/accuracy, haiku = fast/classify. */
export const MODEL_DEFAULT = process.env.MODEL_DEFAULT ?? 'claude-opus-4-8';
export const MODEL_FAST = process.env.MODEL_FAST ?? 'claude-haiku-4-5';

export const PORT = Number(process.env.PORT ?? 8787);

/** Origins allowed to call the API (the static site). Comma-separated. */
export const SITE_ORIGINS = (process.env.SITE_ORIGIN ?? 'http://localhost:4321')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Present only when a real key is configured; agents degrade gracefully without it. */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

export const hasApiKey = ANTHROPIC_API_KEY.length > 0;
