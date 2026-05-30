// Taxline HTTP server — node:http, no framework.
//
// Endpoints:
//   GET  /health            liveness + config snapshot (no secrets)
//   GET  /queue             intake queue summary
//   GET  /doc/:id           one document (full fields/evidence)
//   POST /agents/run {task} run a task through the orchestrator (returns gated result)
//   POST /demo              demo-request intake (mirrors the site's DemoRequest)
//
// CORS is restricted to the configured site origin(s).

import http from 'node:http';
import { PORT, SITE_ORIGINS, hasApiKey, MODEL_DEFAULT, MODEL_FAST } from './config.js';
import { queueSummary, docById } from './seed/queue.js';
import { orchestrate, type AgentName } from './orchestrator.js';

/** Resolve the Access-Control-Allow-Origin value for a request. */
function corsOrigin(reqOrigin: string | undefined): string {
  if (reqOrigin && SITE_ORIGINS.includes(reqOrigin)) return reqOrigin;
  // Fall back to the first configured origin so the header is always valid.
  return SITE_ORIGINS[0] ?? '*';
}

function setCors(res: http.ServerResponse, reqOrigin: string | undefined): void {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(reqOrigin));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage, limitBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const VALID_AGENTS: AgentName[] = ['intake', 'extraction', 'research', 'workpaper', 'compliance'];

const server = http.createServer(async (req, res) => {
  const reqOrigin = req.headers.origin;
  setCors(res, reqOrigin);

  // Preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    // --- GET /health -------------------------------------------------------
    if (req.method === 'GET' && path === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: '@taxline/service',
        liveAgents: hasApiKey, // false => offline deterministic mode
        models: { default: MODEL_DEFAULT, fast: MODEL_FAST },
        agents: VALID_AGENTS,
        note: 'A human approves before any output ships. No customer data is used for training.',
      });
    }

    // --- GET /queue --------------------------------------------------------
    if (req.method === 'GET' && path === '/queue') {
      return sendJson(res, 200, { docs: queueSummary() });
    }

    // --- GET /doc/:id ------------------------------------------------------
    if (req.method === 'GET' && path.startsWith('/doc/')) {
      const id = decodeURIComponent(path.slice('/doc/'.length));
      const doc = docById(id);
      if (!doc) return sendJson(res, 404, { ok: false, error: `No document "${id}".` });
      return sendJson(res, 200, doc);
    }

    // --- POST /agents/run --------------------------------------------------
    if (req.method === 'POST' && path === '/agents/run') {
      const body = (await readJsonBody(req)) as {
        task?: string;
        agent?: string;
        docId?: string;
        approved?: boolean;
        maxHops?: number;
      };
      if (!body.task || typeof body.task !== 'string') {
        return sendJson(res, 400, { ok: false, error: '`task` (string) is required.' });
      }
      const agent =
        body.agent && VALID_AGENTS.includes(body.agent as AgentName)
          ? (body.agent as AgentName)
          : undefined;
      const result = await orchestrate({
        task: body.task,
        agent,
        docId: typeof body.docId === 'string' ? body.docId : undefined,
        approved: body.approved === true,
        maxHops: typeof body.maxHops === 'number' ? body.maxHops : undefined,
      });
      return sendJson(res, 200, result);
    }

    // --- POST /demo --------------------------------------------------------
    // Mirrors the site's DemoRequest/DemoResult contract (honeypot + email check).
    if (req.method === 'POST' && path === '/demo') {
      const body = (await readJsonBody(req)) as {
        email?: string;
        company_website?: string; // honeypot — must be empty
      };
      if (body.company_website) return sendJson(res, 200, { ok: false, error: 'rejected' });
      if (!body.email || !/.+@.+\..+/.test(body.email)) {
        return sendJson(res, 400, { ok: false, error: 'A valid work email is required.' });
      }
      // Intake only — a human follows up. We do not auto-act on the request.
      const id = `demo_${Math.random().toString(36).slice(2, 10)}`;
      return sendJson(res, 200, { ok: true, id });
    }

    // --- /demo (GET) and unknown routes -----------------------------------
    return sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unexpected error';
    const status = message === 'payload too large' ? 413 : message === 'invalid JSON' ? 400 : 500;
    return sendJson(res, status, { ok: false, error: message });
  }
});

server.listen(PORT, () => {
  // Startup line — confirms port, mode, and the human-in-the-loop posture.
  const mode = hasApiKey ? 'live agents' : 'OFFLINE (no ANTHROPIC_API_KEY — deterministic tool runs)';
  // eslint-disable-next-line no-console
  console.log(
    `Taxline service on http://localhost:${PORT}  ·  ${mode}  ·  ` +
      `models ${MODEL_DEFAULT}/${MODEL_FAST}  ·  CORS ${SITE_ORIGINS.join(', ')}  ·  ` +
      `human-approval gate active`,
  );
});
