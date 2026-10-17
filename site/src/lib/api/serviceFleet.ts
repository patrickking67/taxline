import type { AppDoc, FleetService, FleetHealth, RunInput, RunResult, MemoryHit, ScenarioExtraction } from './types';

// Live fleet adapter — talks to the deployed Node service (service/) over its
// JSON endpoints. Selected at build time when PUBLIC_API_ADAPTER is non-mock and
// PUBLIC_SERVICE_ENDPOINT is set. Same FleetService contract as the mock, so the
// app components don't care which one they got. All calls degrade gracefully: a
// failed read returns an empty/offline result instead of throwing, except run(),
// which surfaces the error so the UI can show it.

export function serviceFleet(endpoint: string): FleetService {
  const base = endpoint.replace(/\/+$/, '');

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    name: 'service',

    async health(): Promise<FleetHealth> {
      try {
        const h = await getJson<{
          ok: boolean;
          liveAgents: boolean;
          models?: { default: string; fast: string };
          agents?: string[];
          memory?: { provider: string; records: number };
          note?: string;
        }>('/health');
        return {
          ok: h.ok,
          liveAgents: h.liveAgents,
          provider: h.memory?.provider ?? 'unknown',
          records: h.memory?.records ?? 0,
          agents: h.agents ?? [],
          models: h.models,
          note: h.note,
        };
      } catch {
        return { ok: false, liveAgents: false, provider: 'unreachable', records: 0, agents: [] };
      }
    },

    async queue(): Promise<AppDoc[]> {
      try {
        const { docs } = await getJson<{ docs: Partial<AppDoc>[] }>('/queue');
        // /queue returns summaries (no fields/evidence); fill the AppDoc shape.
        return docs.map((d) => ({
          id: d.id ?? '',
          name: d.name ?? '',
          client: d.client ?? '',
          type: d.type ?? '',
          lastAgent: d.lastAgent ?? '',
          status: d.status ?? 'new',
          confidence: d.confidence ?? null,
          pages: d.pages ?? 1,
          docTitle: d.docTitle,
          fields: [],
          evidence: [],
        }));
      } catch {
        return [];
      }
    },

    async doc(id: string): Promise<AppDoc | null> {
      try {
        return await getJson<AppDoc>(`/doc/${encodeURIComponent(id)}`);
      } catch {
        return null;
      }
    },

    async run(input: RunInput): Promise<RunResult> {
      const res = await fetch(`${base}/agents/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `run → ${res.status}`);
      }
      const r = (await res.json()) as RunResult;
      return {
        output: r.output,
        citations: r.citations ?? [],
        fields: r.fields,
        needsHumanReview: r.needsHumanReview ?? [],
        trace: r.trace ?? [],
        approved: r.approved === true,
      };
    },

    async memorySearch(query: string, k = 5): Promise<MemoryHit[]> {
      try {
        const { results } = await getJson<{
          results: {
            text: string;
            source: { file?: string; heading?: string | null };
            score: number;
          }[];
        }>(`/memory/search?q=${encodeURIComponent(query)}&k=${k}`);
        return results.map((r) => ({
          text: r.text,
          file: r.source.file ?? '',
          heading: r.source.heading ?? null,
          score: r.score,
        }));
      } catch {
        return [];
      }
    },

    async scenario(text: string): Promise<ScenarioExtraction> {
      const res = await fetch(`${base}/scenario`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ScenarioExtraction> & { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error || `scenario → ${res.status}`);
      return { extractor: body.extractor ?? 'service', fields: body.fields ?? [], unplaced: body.unplaced ?? [] };
    },
  };
}
