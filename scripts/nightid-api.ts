/**
 * nightid-api.ts — Night ID public API
 *
 * Lightweight scorer API — no Midnight wallet, no proof server required.
 * Handles multi-chain Night Score, cross-app action scoring, .night names.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/nightid-api.ts
 *
 * Endpoints:
 *   GET  /health
 *   GET  /api/nightid/score/:chain/:addr   — ETH/SOL/ADA/Midnight/All scorer
 *   POST /api/nightid/record-action        — apps post points here
 *   GET  /api/nightid/action-score/:addr   — cross-app score totals
 *   POST /api/nightid/register             — register a .night name
 *   GET  /api/nightid/resolve/:name        — name → address
 *   GET  /api/nightid/lookup/:addr         — address → name
 *
 * Env vars:
 *   ETHERSCAN_API_KEY           — https://etherscan.io/apis
 *   HELIUS_API_KEY              — https://helius.dev
 *   BLOCKFROST_ADA_KEY          — https://blockfrost.io
 *   UPSTASH_REDIS_REST_URL      — https://upstash.com (free tier)
 *   UPSTASH_REDIS_REST_TOKEN    — Upstash REST token
 */

process.on('uncaughtException',  (err: unknown) => console.error('Uncaught:', err));
process.on('unhandledRejection', (r: unknown)   => console.error('Rejected:', r));

import * as http from 'node:http';

const PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10);

// ─── Upstash Redis (persistent storage) ──────────────────────────────────────
// Falls back to in-memory Maps when env vars not set (local dev / CI).
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL   ?? '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const USE_REDIS   = !!(REDIS_URL && REDIS_TOKEN);

async function rd(...args: (string | number)[]): Promise<any> {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const d = await r.json() as any;
  return d.result ?? null;
}

// In-memory fallback
const _mem_scores = new Map<string, ScoreData>();
const _mem_names  = new Map<string, string>(); // name.night → address
const _mem_rnames = new Map<string, string>(); // address → name.night

let rc: any = null; // redis client instance

async function initRedis(): Promise<void> {
  const url = process.env.REDIS_PRIVATE_URL ?? process.env.REDIS_URL ?? '';
  if (!url) return;
  try {
    const { createClient } = await import('redis');
    rc = createClient({ url, socket: { connectTimeout: 5000 } });
    rc.on('error', (e: Error) => console.error('[redis error]', e.message));
    await rc.connect();
    console.log('  Redis:    connected ✓');
  } catch (e: any) {
    console.error('[redis] failed to connect, using in-memory fallback:', e.message);
    rc = null;
  }
}

async function scoreGet(addr: string): Promise<ScoreData> {
  if (USE_REDIS) {
    const raw = await rd('GET', `ns:score:${addr}`);
    return raw ? JSON.parse(raw) : { total: 0, byApp: {} };
  }
  return _mem_scores.get(addr) ?? { total: 0, byApp: {} };
}

async function scoreSet(addr: string, data: ScoreData): Promise<void> {
  if (USE_REDIS) { await rd('SET', `ns:score:${addr}`, JSON.stringify(data)); return; }
  _mem_scores.set(addr, data);
}

async function nameGet(name: string): Promise<string | null> {
  if (USE_REDIS) return await rd('GET', `ns:name:${name}`);
  return _mem_names.get(name) ?? null;
}

async function nameSet(fullName: string, addr: string): Promise<void> {
  if (USE_REDIS) {
    await rd('SET', `ns:name:${fullName}`, addr);
    await rd('SET', `ns:rname:${addr}`, fullName);
    return;
  }
  _mem_names.set(fullName, addr);
  _mem_rnames.set(addr, fullName);
}

async function nameFindByAddr(addr: string): Promise<string | null> {
  if (USE_REDIS) return await rd('GET', `ns:rname:${addr}`);
  return _mem_rnames.get(addr) ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeNightName(raw: string): string {
  return raw.toLowerCase().replace(/\.night$/, '').replace(/[^a-z0-9-_]/g, '').slice(0, 32);
}

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '*').split(',').map(s => s.trim());

function setCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin  = req.headers.origin ?? '';
  const allowed = CORS_ORIGINS.includes('*') ? '*' : (CORS_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Origin', allowed || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1_000_000) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url    = (req.url ?? '/').split('?')[0];

  setCors(req, res);
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Health ──────────────────────────────────────────────────────────────────
  if (url === '/health' || url === '/') {
    return json(res, 200, {
      ok: true,
      service: 'Night ID API',
      version: '1.2.0',
      storage: USE_REDIS ? 'upstash-redis' : 'in-memory',
      endpoints: [
        '/api/nightid/score/:chain/:addr',
        '/api/nightid/record-action',
        '/api/nightid/action-score/:address',
        '/api/nightid/register',
        '/api/nightid/resolve/:name',
        '/api/nightid/lookup/:addr',
      ],
      scoring: {
        eth:      !!process.env.ETHERSCAN_API_KEY,
        sol:      !!process.env.HELIUS_API_KEY,
        ada:      !!process.env.BLOCKFROST_ADA_KEY,
        midnight: true,
      },
    });
  }

  // ── GET /api/nightid/score/:chain/:addr ─────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/score/')) {
    const parts   = url.replace('/api/nightid/score/', '').split('/');
    const chain   = parts[0] as any;
    const address = decodeURIComponent(parts.slice(1).join('/'));
    if (!chain || !address) return json(res, 400, { error: 'chain and address required' });
    const valid = ['eth', 'sol', 'ada', 'midnight', 'all'];
    if (!valid.includes(chain)) return json(res, 400, { error: `chain must be one of: ${valid.join(', ')}` });
    try {
      const { scoreWallet } = await import('./night-id-scorer.js');
      const result = await scoreWallet(chain, address);
      return json(res, 200, result);
    } catch (err: any) {
      console.error('[nightid/score]', err?.message);
      return json(res, 500, { error: 'scoring failed', detail: err?.message });
    }
  }

  // ── POST /api/nightid/record-action ─────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightid/record-action') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { holderAddress, appId, points } = body ?? {};
    if (!holderAddress) return json(res, 400, { error: 'holderAddress required' });
    if (!appId)         return json(res, 400, { error: 'appId required' });

    const pts = Number(points ?? 0);
    if (pts < 1 || pts > 50) return json(res, 400, { error: 'points must be 1–50' });

    const VALID_APPS: Record<string, number> = {
      'night-markets': 50, 'night-work': 40, 'night-lend': 30,
      'night-fun': 25, 'night-poker': 15, 'night-save': 10, 'night-biz': 10,
    };
    if (!VALID_APPS[appId]) return json(res, 400, { error: `unknown appId: ${appId}` });

    const existing = await scoreGet(holderAddress);
    const newTotal  = existing.total + pts;
    const newByApp  = { ...existing.byApp, [appId]: (existing.byApp[appId] ?? 0) + pts };
    await scoreSet(holderAddress, { total: newTotal, byApp: newByApp });

    console.log(`[record-action] ${appId} +${pts} → ${String(holderAddress).slice(0, 16)}… (total: ${newTotal})`);
    return json(res, 200, { ok: true, address: holderAddress, appId, points: pts, newTotal });
  }

  // ── GET /api/nightid/action-score/:address ──────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/action-score/')) {
    const address = decodeURIComponent(url.replace('/api/nightid/action-score/', ''));
    if (!address) return json(res, 400, { error: 'address required' });
    const s = await scoreGet(address);
    return json(res, 200, {
      address,
      total:        s.total,
      threshold200: s.total >= 200,
      byApp:        s.byApp,
      appsUsed:     Object.keys(s.byApp).length,
    });
  }

  // ── POST /api/nightid/register ──────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightid/register') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { name: rawName, address } = body ?? {};
    const name = normalizeNightName(rawName ?? '');
    if (!name || name.length < 3) return json(res, 400, { error: 'name must be 3–32 chars (a-z 0-9 - _)' });
    if (!address) return json(res, 400, { error: 'address required' });

    const full     = `${name}.night`;
    const existing = await nameGet(full);
    if (existing && existing !== address) {
      return json(res, 409, { error: `${full} already registered to a different address` });
    }
    await nameSet(full, address);
    console.log(`[nightid/register] ${full} → ${String(address).slice(0, 20)}…`);
    return json(res, 200, { ok: true, name: full, address });
  }

  // ── GET /api/nightid/resolve/:name ──────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/resolve/')) {
    const rawName = decodeURIComponent(url.replace('/api/nightid/resolve/', ''));
    const name    = normalizeNightName(rawName);
    const full    = `${name}.night`;
    const address = await nameGet(full);
    if (!address) return json(res, 404, { error: `${full} not registered` });
    return json(res, 200, { name: full, address });
  }

  // ── GET /api/nightid/lookup/:addr ────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/lookup/')) {
    const addr = decodeURIComponent(url.replace('/api/nightid/lookup/', ''));
    const name = await nameFindByAddr(addr);
    if (!name) return json(res, 404, { error: 'no .night name for this address' });
    return json(res, 200, { name, address: addr });
  }

  json(res, 404, { error: 'not found' });
});

// Start HTTP server immediately — Redis connects in background
server.listen(PORT, () => {
  console.log(`\n⊘ Night ID API v1.3.0 — listening on :${PORT}`);
  console.log(`  Scoring:  ETH=${!!process.env.ETHERSCAN_API_KEY} SOL=${!!process.env.HELIUS_API_KEY} ADA=${!!process.env.BLOCKFROST_ADA_KEY} Midnight=yes`);
  console.log(`  Health:   http://localhost:${PORT}/health\n`);
});

initRedis().catch(e => console.error('[redis] init failed:', e?.message));
