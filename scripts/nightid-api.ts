/**
 * nightid-api.ts — Night ecosystem API v2.0.0
 *
 * Three distinct systems, now properly separated:
 *
 *  NIGHT SCORE — ecosystem activity points (record-action calls from Night apps)
 *    POST /api/night-score/record          — apps post points here
 *    GET  /api/night-score/:addr           — Night Score totals + breakdown
 *    GET  /api/night-score/leaderboard     — top addresses by Night Score
 *
 *  BUILD SCORE — multi-chain on-chain reputation (ETH/SOL/ADA/Midnight history)
 *    GET  /api/build-score/:chain/:addr    — credibility score from on-chain data
 *
 *  NIGHT ID — ZK identity layer (.night names + verifiable credentials)
 *    POST /api/nightid/register            — claim a .night name
 *    GET  /api/nightid/resolve/:name       — name → address
 *    GET  /api/nightid/lookup/:addr        — address → .night name
 *    GET  /api/nightid/identity/:addr      — unified: name + scores + credentials
 *    POST /api/nightid/issue-credential    — issue a signed credential for an address
 *    GET  /api/nightid/credentials/:addr   — list credentials held by address
 *    POST /api/nightid/verify-credential   — verify a credential is valid
 *
 *  Legacy paths (kept for backward compat):
 *    GET  /api/nightid/score/:chain/:addr  → same as /api/build-score/:chain/:addr
 *    POST /api/nightid/record-action       → same as /api/night-score/record
 *    GET  /api/nightid/action-score/:addr  → same as /api/night-score/:addr
 *    GET  /api/nightid/leaderboard         → same as /api/night-score/leaderboard
 *
 * Credential types issued automatically on threshold crossing:
 *   verified-human  — Build Score > 100  (basic sybil resistance)
 *   builder         — Build Score > 500  (established on-chain history)
 *   night-citizen   — Night Score > 100  (used Night ecosystem)
 *   night-builder   — Night Score > 500  (power user)
 *   night-founder   — Night Score > 1000 (ecosystem founder)
 *   creditworthy    — Build Score > 300 + Night Score > 50 (for night-lend)
 *
 * Env vars:
 *   ETHERSCAN_API_KEY      — https://etherscan.io/apis
 *   HELIUS_API_KEY         — https://helius.dev
 *   BLOCKFROST_ADA_KEY     — https://blockfrost.io
 *   REDIS_URL              — Railway Redis
 *   REDIS_PRIVATE_URL      — Railway internal Redis URL (preferred)
 *   NIGHTID_ISSUER_SECRET  — HMAC secret for credential signing (set in Railway env)
 */

process.on('uncaughtException',  (err: unknown) => console.error('Uncaught:', err));
process.on('unhandledRejection', (r: unknown)   => console.error('Rejected:', r));

import * as http from 'node:http';

const PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10);

// ─── Redis persistence ────────────────────────────────────────────────────────
// Uses Railway Redis when REDIS_PRIVATE_URL / REDIS_URL is set.
// Falls back to in-memory Maps for local dev (scores reset on restart).
interface ScoreData { total: number; byApp: Record<string, number>; spent?: number; }

const _mem_scores = new Map<string, ScoreData>();
const _mem_names  = new Map<string, string>(); // name.night → address
const _mem_rnames = new Map<string, string>(); // address → name.night

// Minimal Redis client using Node built-in net — zero npm dependencies.
// Supports GET, SET, QUIT over TCP/TLS using raw RESP protocol.
import * as net    from 'node:net';
import * as tls    from 'node:tls';
import * as crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

let _redisSocket: net.Socket | null = null;
let _redisReady  = false;

function parseRedisUrl(raw: string): { host: string; port: number; password: string; tls: boolean } {
  const u = new URL(raw);
  return {
    host:     u.hostname,
    port:     parseInt(u.port || (u.protocol === 'rediss:' ? '6380' : '6379'), 10),
    password: u.password ?? '',
    tls:      u.protocol === 'rediss:',
  };
}

function resp(...args: string[]): Buffer {
  let s = `*${args.length}\r\n`;
  for (const a of args) s += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
  return Buffer.from(s);
}

async function redisCmd(...args: string[]): Promise<string | null> {
  if (!_redisSocket || !_redisReady) return null;
  return new Promise((resolve) => {
    const sock = _redisSocket!;
    const handler = (data: Buffer) => {
      sock.removeListener('data', handler);
      const s = data.toString();
      if (s.startsWith('+') || s.startsWith(':')) return resolve(s.slice(1).trim());
      if (s.startsWith('$-1')) return resolve(null);
      if (s.startsWith('$')) {
        const nl = s.indexOf('\r\n');
        return resolve(nl >= 0 ? s.slice(nl + 2).replace(/\r\n$/, '') : null);
      }
      resolve(null);
    };
    sock.on('data', handler);
    sock.write(resp(...args));
  });
}

async function initRedis(): Promise<void> {
  const raw = process.env.REDIS_PRIVATE_URL ?? process.env.REDIS_URL ?? '';
  if (!raw) return;
  try {
    const cfg = parseRedisUrl(raw);
    const sock: net.Socket = cfg.tls
      ? tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: false })
      : net.connect({ host: cfg.host, port: cfg.port });

    await new Promise<void>((resolve, reject) => {
      sock.setTimeout(5000);
      sock.once('error',   reject);
      sock.once('timeout', () => reject(new Error('timeout')));
      sock.once(cfg.tls ? 'secureConnect' : 'connect', resolve);
    });

    _redisSocket = sock;
    sock.on('error', e => console.error('[redis]', e.message));

    if (cfg.password) {
      await redisCmd('AUTH', cfg.password);
    }
    _redisReady = true;
    console.log('  Redis:    connected ✓');
    await leaderboardLoad();
  } catch (e: any) {
    console.error('[redis] failed, using in-memory fallback:', e.message);
    _redisSocket = null;
    _redisReady  = false;
  }
}

async function scoreGet(addr: string): Promise<ScoreData> {
  const raw = await redisCmd('GET', `ns:score:${addr}`);
  if (raw) return JSON.parse(raw);
  return _mem_scores.get(addr) ?? { total: 0, byApp: {} };
}

async function scoreSet(addr: string, data: ScoreData): Promise<void> {
  const s = JSON.stringify(data);
  if (_redisReady) { await redisCmd('SET', `ns:score:${addr}`, s); }
  else { _mem_scores.set(addr, data); }
  leaderboardUpdate(addr, data.total);
  leaderboardPersist().catch(() => {});
}

// ─── In-memory leaderboard (updated on every scoreSet, persisted to Redis) ───
const _leaderboard = new Map<string, number>(); // addr → total

function leaderboardUpdate(addr: string, total: number): void {
  _leaderboard.set(addr, total);
}

async function leaderboardPersist(): Promise<void> {
  if (!_redisReady) return;
  const top = [..._leaderboard.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100);
  await redisCmd('SET', 'ns:leaderboard', JSON.stringify(top));
}

async function leaderboardLoad(): Promise<void> {
  const raw = await redisCmd('GET', 'ns:leaderboard');
  if (!raw) return;
  try {
    const entries: [string, number][] = JSON.parse(raw);
    entries.forEach(([a, s]) => _leaderboard.set(a, s));
    console.log(`  Leaderboard: ${entries.length} entries loaded`);
  } catch {}
}

async function nameGet(name: string): Promise<string | null> {
  const r = await redisCmd('GET', `ns:name:${name}`);
  return r ?? _mem_names.get(name) ?? null;
}

async function nameSet(fullName: string, addr: string): Promise<void> {
  if (_redisReady) {
    await redisCmd('SET', `ns:name:${fullName}`, addr);
    await redisCmd('SET', `ns:rname:${addr}`, fullName);
    return;
  }
  _mem_names.set(fullName, addr);
  _mem_rnames.set(addr, fullName);
}

async function nameFindByAddr(addr: string): Promise<string | null> {
  const r = await redisCmd('GET', `ns:rname:${addr}`);
  return r ?? _mem_rnames.get(addr) ?? null;
}

// ─── Credential system ───────────────────────────────────────────────────────
// Server-side HMAC-signed credentials. Each credential states:
//   "address X has claim Y of type T, issued at timestamp Z"
// Apps verify the sig without needing to know the raw scores.
// On-chain ZK proof replaces this when NightID.compact is deployed (Phase 4).

const ISSUER_SECRET = process.env.NIGHTID_ISSUER_SECRET ?? 'night-id-dev-secret-change-in-prod';

interface Credential {
  subject:  string;
  type:     string;
  claim:    Record<string, unknown>;
  issuedAt: number;
  sig:      string;
}

const CREDENTIAL_THRESHOLDS: Record<string, (bs: number, ns: number) => boolean> = {
  'verified-human':  (bs)     => bs  > 100,
  'builder':         (bs)     => bs  > 500,
  'night-citizen':   (_,  ns) => ns  > 100,
  'night-builder':   (_,  ns) => ns  > 500,
  'night-founder':   (_,  ns) => ns  > 1000,
  'creditworthy':    (bs, ns) => bs  > 300 && ns > 50,
};

function credSign(subject: string, type: string, claim: Record<string, unknown>, issuedAt: number): string {
  const payload = JSON.stringify({ subject, type, claim, issuedAt });
  return crypto.createHmac('sha256', ISSUER_SECRET).update(payload).digest('hex');
}

function credVerify(c: Credential): boolean {
  const expected = credSign(c.subject, c.type, c.claim, c.issuedAt);
  return c.sig === expected;
}

async function credGet(addr: string, type: string): Promise<Credential | null> {
  const raw = await redisCmd('GET', `ns:cred:${addr}:${type}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function credSet(c: Credential): Promise<void> {
  const s = JSON.stringify(c);
  if (_redisReady) await redisCmd('SET', `ns:cred:${c.subject}:${c.type}`, s);
}

async function credListForAddr(addr: string): Promise<Credential[]> {
  const types = Object.keys(CREDENTIAL_THRESHOLDS);
  const results = await Promise.all(types.map(t => credGet(addr, t)));
  return results.filter((c): c is Credential => c !== null);
}

async function issueThresholdCredentials(addr: string, buildScore: number, nightScore: number): Promise<string[]> {
  const issued: string[] = [];
  for (const [type, check] of Object.entries(CREDENTIAL_THRESHOLDS)) {
    if (!check(buildScore, nightScore)) continue;
    const existing = await credGet(addr, type);
    if (existing) continue; // already issued
    const issuedAt = Date.now();
    const claim: Record<string, unknown> = { buildScore, nightScore };
    const cred: Credential = { subject: addr, type, claim, issuedAt, sig: credSign(addr, type, claim, issuedAt) };
    await credSet(cred);
    issued.push(type);
  }
  return issued;
}

// ─── Poker room management ────────────────────────────────────────────────────
interface PokerTable {
  id: string; name: string; bigBlind: number; smallBlind: number;
  maxBuyIn: number; maxPlayers: number; players: number;
  phase: 'waiting' | 'playing'; createdAt: number;
}
const _tables = new Map<string, PokerTable>();
const _rooms  = new Map<string, Map<number, any>>(); // tableId → seat → ws

const DEFAULT_TABLES: PokerTable[] = [
  { id: 'midnight-lounge',  name: 'Midnight Lounge',  bigBlind: 100,  smallBlind: 50,  maxBuyIn: 10000,  maxPlayers: 6, players: 0, phase: 'waiting', createdAt: 0 },
  { id: 'high-roller-room', name: 'High Roller Room', bigBlind: 1000, smallBlind: 500, maxBuyIn: 100000, maxPlayers: 6, players: 0, phase: 'waiting', createdAt: 0 },
  { id: 'zk-private-table', name: 'ZK Private Table', bigBlind: 500,  smallBlind: 250, maxBuyIn: 50000,  maxPlayers: 6, players: 0, phase: 'waiting', createdAt: 0 },
  { id: 'micro-stakes',     name: 'Micro Stakes',     bigBlind: 10,   smallBlind: 5,   maxBuyIn: 1000,   maxPlayers: 6, players: 0, phase: 'waiting', createdAt: 0 },
];
DEFAULT_TABLES.forEach(t => { t.createdAt = Date.now(); _tables.set(t.id, t); });

function pokerRoomSize(tableId: string): number {
  return _rooms.get(tableId)?.size ?? 0;
}

function broadcastPoker(tableId: string, excludeSeat: number, msg: object): void {
  const room = _rooms.get(tableId);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.forEach((ws, seat) => {
    if (seat !== excludeSeat && ws.readyState === 1) ws.send(data);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseQuery(rawUrl: string): URLSearchParams {
  return new URLSearchParams((rawUrl ?? '').split('?')[1] ?? '');
}

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
      service: 'Night Ecosystem API',
      version: '2.0.0',
      storage: _redisReady ? 'redis' : 'in-memory',
      systems: {
        nightScore:  ['/api/night-score/record', '/api/night-score/:addr', '/api/night-score/leaderboard'],
        buildScore:  ['/api/build-score/:chain/:addr'],
        nightId:     ['/api/nightid/identity/:addr', '/api/nightid/register', '/api/nightid/resolve/:name', '/api/nightid/lookup/:addr', '/api/nightid/credentials/:addr', '/api/nightid/issue-credential', '/api/nightid/verify-credential'],
      },
      scoring: {
        eth:      !!process.env.ETHERSCAN_API_KEY,
        sol:      !!process.env.HELIUS_API_KEY,
        ada:      !!process.env.BLOCKFROST_ADA_KEY,
        midnight: true,
      },
    });
  }

  // ── GET /api/build-score/:chain/:addr ──────────────────────────────────────
  // Multi-chain on-chain reputation: ETH history, DeFi, wallet age, Midnight.
  // Legacy alias: /api/nightid/score/:chain/:addr
  const isBuildScore = url.startsWith('/api/build-score/') || url.startsWith('/api/nightid/score/');
  if (method === 'GET' && isBuildScore) {
    const base   = url.startsWith('/api/build-score/') ? '/api/build-score/' : '/api/nightid/score/';
    const parts  = url.replace(base, '').split('/');
    const chain  = parts[0] as any;
    const address = decodeURIComponent(parts.slice(1).join('/'));
    if (!chain || !address) return json(res, 400, { error: 'chain and address required' });
    const valid = ['eth', 'sol', 'ada', 'midnight', 'all'];
    if (!valid.includes(chain)) return json(res, 400, { error: `chain must be one of: ${valid.join(', ')}` });
    try {
      const { scoreWallet } = await import('./night-id-scorer.js');
      const result = await scoreWallet(chain, address);
      return json(res, 200, result);
    } catch (err: any) {
      console.error('[build-score]', err?.message);
      return json(res, 500, { error: 'scoring failed', detail: err?.message });
    }
  }

  // ── POST /api/night-score/record ────────────────────────────────────────────
  // Night ecosystem activity points. Legacy alias: /api/nightid/record-action
  const isRecordAction = url === '/api/night-score/record' || url === '/api/nightid/record-action';
  if (method === 'POST' && isRecordAction) {
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

    // Auto-issue credentials when Night Score thresholds are crossed
    const newCreds = await issueThresholdCredentials(holderAddress, 0, newTotal);
    if (newCreds.length) console.log(`[night-id] issued credentials for ${String(holderAddress).slice(0, 16)}…: ${newCreds.join(', ')}`);

    console.log(`[night-score] ${appId} +${pts} → ${String(holderAddress).slice(0, 16)}… (total: ${newTotal})`);
    return json(res, 200, { ok: true, address: holderAddress, appId, points: pts, newTotal, newCredentials: newCreds });
  }

  // ── GET /api/night-score/leaderboard ───────────────────────────────────────
  // Legacy alias: /api/nightid/leaderboard
  const isLeaderboard = url === '/api/night-score/leaderboard' || url === '/api/nightid/leaderboard';
  if (method === 'GET' && isLeaderboard) {
    const q     = parseQuery(req.url ?? '');
    const limit = Math.min(Math.max(1, parseInt(q.get('limit') ?? '10', 10)), 100);
    const top   = [..._leaderboard.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([address, score], i) => ({ rank: i + 1, address, score }));
    return json(res, 200, { leaderboard: top, total: _leaderboard.size });
  }

  // ── GET /api/night-score/:addr ──────────────────────────────────────────────
  // Night ecosystem activity score. Legacy alias: /api/nightid/action-score/:addr
  const isNightScore = url.startsWith('/api/night-score/') || url.startsWith('/api/nightid/action-score/');
  if (method === 'GET' && isNightScore) {
    const base    = url.startsWith('/api/night-score/') ? '/api/night-score/' : '/api/nightid/action-score/';
    const address = decodeURIComponent(url.replace(base, ''));
    if (!address || address === 'leaderboard') return json(res, 400, { error: 'address required' });
    const s        = await scoreGet(address);
    const spent    = s.spent ?? 0;
    const available = s.total - spent;
    return json(res, 200, {
      address,
      total:        s.total,
      spent,
      available,
      threshold200: s.total >= 200,
      byApp:        s.byApp,
      appsUsed:     Object.keys(s.byApp).length,
    });
  }

  // ── GET /api/nightid/identity/:addr ─────────────────────────────────────────
  // Unified Night ID: .night name + Night Score + credentials.
  // This is the single endpoint apps should query to know who a user is.
  if (method === 'GET' && url.startsWith('/api/nightid/identity/')) {
    const address = decodeURIComponent(url.replace('/api/nightid/identity/', ''));
    if (!address) return json(res, 400, { error: 'address required' });

    const [nightName, scoreData, credentials] = await Promise.all([
      nameFindByAddr(address),
      scoreGet(address),
      credListForAddr(address),
    ]);

    const spent     = scoreData.spent ?? 0;
    const available = scoreData.total - spent;

    return json(res, 200, {
      address,
      nightName,
      nightScore: {
        total:    scoreData.total,
        available,
        spent,
        byApp:    scoreData.byApp,
        appsUsed: Object.keys(scoreData.byApp).length,
      },
      credentials: credentials.map(c => ({ type: c.type, claim: c.claim, issuedAt: c.issuedAt })),
      credentialTypes: credentials.map(c => c.type),
    });
  }

  // ── POST /api/nightid/issue-credential ─────────────────────────────────────
  // Issue a signed credential for an address. Can be called by apps or admin.
  // For auto-threshold credentials, record-action calls this automatically.
  if (method === 'POST' && url === '/api/nightid/issue-credential') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { address, type, claim = {} } = body ?? {};
    if (!address) return json(res, 400, { error: 'address required' });
    if (!type)    return json(res, 400, { error: 'type required' });

    const issuedAt = Date.now();
    const cred: Credential = {
      subject: address, type, claim,
      issuedAt, sig: credSign(address, type, claim, issuedAt),
    };
    await credSet(cred);
    console.log(`[night-id] issued '${type}' credential for ${String(address).slice(0, 16)}…`);
    return json(res, 200, { ok: true, credential: cred });
  }

  // ── GET /api/nightid/credentials/:addr ─────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/credentials/')) {
    const address = decodeURIComponent(url.replace('/api/nightid/credentials/', ''));
    if (!address) return json(res, 400, { error: 'address required' });
    const credentials = await credListForAddr(address);
    return json(res, 200, {
      address,
      credentials: credentials.map(c => ({ type: c.type, claim: c.claim, issuedAt: c.issuedAt })),
      credentialTypes: credentials.map(c => c.type),
    });
  }

  // ── POST /api/nightid/verify-credential ────────────────────────────────────
  if (method === 'POST' && url === '/api/nightid/verify-credential') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { credential } = body ?? {};
    if (!credential) return json(res, 400, { error: 'credential required' });

    const valid = credVerify(credential as Credential);
    return json(res, 200, {
      valid,
      subject:  credential.subject,
      type:     credential.type,
      claim:    credential.claim,
      issuedAt: credential.issuedAt,
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

  // ── Night Store — Printful integration ──────────────────────────────────────

  const PF_TOKEN  = process.env.PRINTFUL_API_TOKEN ?? '';
  const NIGHT_USD = 0.04; // 1 NIGHT = $0.04

  async function pf(path: string, opts: RequestInit = {}): Promise<any> {
    if (!PF_TOKEN) throw new Error('PRINTFUL_API_TOKEN not set');
    const r = await fetch('https://api.printful.com' + path, {
      ...opts,
      headers: { 'Authorization': `Bearer ${PF_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    const d = await r.json() as any;
    if (!r.ok) throw new Error(d?.error?.message ?? `Printful ${r.status}: ${JSON.stringify(d)}`);
    return d.result ?? d;
  }

  // Night Markets branded catalog — 5 products with Printful catalog IDs
  // Variant IDs fetched live from Printful catalog API and cached.
  const CATALOG_DEF = [
    { id: 'tshirt',  pfId: 71,  name: 'Night Markets Tee',    desc: 'Unisex Bella+Canvas 3001',      priceUSD: 32, emoji: '👕', color: 'Black', sizes: ['S','M','L','XL','2XL'] },
    { id: 'hoodie',  pfId: 380, name: 'Night Markets Hoodie',  desc: 'Unisex Gildan 18500 Hoodie',    priceUSD: 55, emoji: '🧥', color: 'Black', sizes: ['S','M','L','XL','2XL'] },
    { id: 'mug',     pfId: 19,  name: 'Night Markets Mug',     desc: 'White Glossy Ceramic 11oz',     priceUSD: 22, emoji: '☕', color: 'White', sizes: ['11oz'] },
    { id: 'tote',    pfId: 2,   name: 'Night Markets Tote',    desc: 'Natural Canvas Tote Bag',       priceUSD: 26, emoji: '🛍️', color: 'Natural', sizes: ['One Size'] },
    { id: 'cap',     pfId: 74,  name: 'Night Markets Cap',     desc: 'Classic Structured Dad Cap',    priceUSD: 30, emoji: '🧢', color: 'Black', sizes: ['One Size'] },
  ];

  // Design file hosted on GitHub Pages — print-ready Night Markets logo
  const DESIGN_URL = 'https://kingmunz1994-lgtm.github.io/night-store/night-print.svg';

  // Cache of { pfId → { size → variantId } } fetched from Printful catalog
  const _variantCache = new Map<number, Record<string, number>>();

  async function getVariants(pfId: number, wantedSizes: string[], wantedColor: string): Promise<Record<string, number>> {
    if (_variantCache.has(pfId)) return _variantCache.get(pfId)!;
    const data = await pf(`/catalog/products/${pfId}`);
    const variants: any[] = data.variants ?? [];
    const map: Record<string, number> = {};
    for (const v of variants) {
      const colorMatch = !wantedColor || v.color?.toLowerCase().includes(wantedColor.toLowerCase());
      if (colorMatch && wantedSizes.includes(v.size)) {
        map[v.size] = v.id;
      }
    }
    // For single-size products (mug/tote/cap) just take first matching variant
    if (wantedSizes.length === 1 && Object.keys(map).length === 0) {
      const first = variants.find(v => !wantedColor || v.color?.toLowerCase().includes(wantedColor.toLowerCase()));
      if (first) map[wantedSizes[0]] = first.id;
    }
    _variantCache.set(pfId, map);
    return map;
  }

  // GET /api/store/products
  if (method === 'GET' && url === '/api/store/products') {
    try {
      const products = await Promise.all(CATALOG_DEF.map(async p => {
        let variants: Record<string, number> = {};
        try { variants = await getVariants(p.pfId, p.sizes, p.color); } catch { /* use empty */ }
        return {
          id:       p.id,
          name:     p.name,
          desc:     p.desc,
          emoji:    p.emoji,
          priceUSD: p.priceUSD,
          priceNIGHT: Math.ceil(p.priceUSD / NIGHT_USD),
          sizes:    p.sizes,
          variants, // size → variantId
          available: Object.keys(variants).length > 0,
        };
      }));
      return json(res, 200, { products, nightUSD: NIGHT_USD });
    } catch (e: any) {
      return json(res, 500, { error: e.message });
    }
  }

  // POST /api/store/estimate — shipping estimate
  // Body: { countryCode, items: [{ variantId, qty }] }
  if (method === 'POST' && url === '/api/store/estimate') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { countryCode = 'US', stateCode = '', zip = '', items = [] } = body ?? {};
    try {
      const rates = await pf('/shipping/rates', {
        method: 'POST',
        body: JSON.stringify({
          recipient: { country_code: countryCode, state_code: stateCode, zip },
          items: items.map((i: any) => ({ variant_id: i.variantId, quantity: i.qty ?? 1 })),
        }),
      });
      const cheapest = Array.isArray(rates) ? rates.sort((a: any, b: any) => a.rate - b.rate)[0] : rates[0];
      return json(res, 200, { rates, cheapest });
    } catch (e: any) {
      return json(res, 200, { rates: [], cheapest: { name: 'Standard Shipping', rate: '4.99', minDeliveryDays: 5, maxDeliveryDays: 10 } });
    }
  }

  // POST /api/store/checkout
  // Body: { address (wallet), items: [{ productId, size, qty }], shipping: { name, address1, city, stateCode, countryCode, zip } }
  if (method === 'POST' && url === '/api/store/checkout') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const { address: walletAddr, items = [], shipping } = body ?? {};
    if (!walletAddr)           return json(res, 400, { error: 'wallet address required' });
    if (!items.length)         return json(res, 400, { error: 'cart is empty' });
    if (!shipping?.name)       return json(res, 400, { error: 'shipping address required' });
    if (!shipping?.countryCode) return json(res, 400, { error: 'country code required' });

    // Calculate NIGHT cost
    let totalNIGHT = 0;
    const pfItems: any[] = [];
    for (const item of items) {
      const def = CATALOG_DEF.find(p => p.id === item.productId);
      if (!def) return json(res, 400, { error: `unknown product: ${item.productId}` });
      const variants = await getVariants(def.pfId, def.sizes, def.color);
      const variantId = item.size ? variants[item.size] : Object.values(variants)[0];
      if (!variantId) return json(res, 400, { error: `size ${item.size} not available for ${def.name}` });
      totalNIGHT += Math.ceil(def.priceUSD / NIGHT_USD) * (item.qty ?? 1);
      pfItems.push({ variant_id: variantId, quantity: item.qty ?? 1, files: [{ type: 'front', url: DESIGN_URL }] });
    }

    // Check NIGHT balance
    const scoreData = await scoreGet(walletAddr);
    const available = scoreData.total - (scoreData.spent ?? 0);
    if (available < totalNIGHT) {
      return json(res, 402, { error: `Insufficient NIGHT — need ${totalNIGHT}, have ${available}` });
    }

    // Place Printful order
    let pfOrder: any;
    try {
      pfOrder = await pf('/orders', {
        method: 'POST',
        body: JSON.stringify({
          recipient: {
            name:         shipping.name,
            address1:     shipping.address1,
            address2:     shipping.address2 ?? '',
            city:         shipping.city,
            state_code:   shipping.stateCode ?? '',
            country_code: shipping.countryCode,
            zip:          shipping.zip ?? '',
          },
          items: pfItems,
        }),
      });
    } catch (e: any) {
      return json(res, 502, { error: 'Printful order failed: ' + e.message });
    }

    // Deduct NIGHT — update score
    const newSpent = (scoreData.spent ?? 0) + totalNIGHT;
    await scoreSet(walletAddr, { ...scoreData, spent: newSpent });

    // Record as app action (small bonus for purchasing)
    const newByApp = { ...scoreData.byApp, 'night-store': (scoreData.byApp['night-store'] ?? 0) + 5 };
    await scoreSet(walletAddr, { ...scoreData, spent: newSpent, byApp: newByApp, total: scoreData.total + 5 });

    console.log(`[store/checkout] ${String(walletAddr).slice(0,16)}… → ${totalNIGHT} NIGHT → Printful order #${pfOrder.id}`);
    return json(res, 200, {
      ok:           true,
      orderId:      pfOrder.id,
      status:       pfOrder.status,
      nightDeducted: totalNIGHT,
      newBalance:   available - totalNIGHT,
    });
  }

  // GET /api/store/order/:id
  if (method === 'GET' && url.startsWith('/api/store/order/')) {
    const orderId = url.replace('/api/store/order/', '');
    try {
      const order = await pf(`/orders/${orderId}`);
      return json(res, 200, { order });
    } catch (e: any) {
      return json(res, 404, { error: e.message });
    }
  }

  // ── Poker — table registry ──────────────────────────────────────────────────

  // GET /api/poker/tables
  if (method === 'GET' && url === '/api/poker/tables') {
    const tables = [..._tables.values()].map(t => ({
      ...t,
      players: pokerRoomSize(t.id),
      phase:   pokerRoomSize(t.id) > 1 ? 'playing' : 'waiting',
    }));
    return json(res, 200, { tables });
  }

  // POST /api/poker/tables
  if (method === 'POST' && url === '/api/poker/tables') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { name, bigBlind = 100, maxBuyIn = 10000, maxPlayers = 6 } = body ?? {};
    if (!name) return json(res, 400, { error: 'name required' });
    const id = 'tbl-' + Date.now();
    const tbl: PokerTable = {
      id, name: String(name),
      bigBlind: Number(bigBlind),
      smallBlind: Math.floor(Number(bigBlind) / 2),
      maxBuyIn: Number(maxBuyIn),
      maxPlayers: Number(maxPlayers),
      players: 0, phase: 'waiting', createdAt: Date.now(),
    };
    _tables.set(id, tbl);
    console.log(`[poker] table created: ${name} (${id})`);
    return json(res, 200, { ok: true, table: tbl });
  }

  json(res, 404, { error: 'not found' });
});

// ─── WebSocket — Poker rooms ──────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
  const wsUrl = (req.url ?? '').split('?')[0];
  if (wsUrl.startsWith('/ws/poker/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const tableId = wsUrl.replace('/ws/poker/', '');
      let mySeat = -1;

      ws.on('message', (raw: Buffer) => {
        try {
          const msg: any = JSON.parse(raw.toString());

          if (msg.type === 'join') {
            let room = _rooms.get(tableId);
            if (!room) { room = new Map(); _rooms.set(tableId, room); }
            for (let s = 0; s < 6; s++) {
              if (!room.has(s)) { mySeat = s; break; }
            }
            if (mySeat === -1) { ws.close(1008, 'Table full'); return; }
            room.set(mySeat, ws);
            const tbl = _tables.get(tableId);
            if (tbl) { tbl.players = room.size; tbl.phase = room.size > 1 ? 'playing' : 'waiting'; }
            ws.send(JSON.stringify({ type: 'room_state', seat: mySeat, playerCount: room.size, tableId }));
            broadcastPoker(tableId, mySeat, { type: 'player_joined', seat: mySeat, playerCount: room.size });
            console.log(`[poker] ${tableId} seat ${mySeat} joined (${room.size} players)`);
          }

          if (msg.type === 'action' || msg.type === 'chat') {
            broadcastPoker(tableId, mySeat, { ...msg, seat: mySeat });
          }
        } catch {}
      });

      ws.on('close', () => {
        const room = _rooms.get(tableId);
        if (!room) return;
        room.delete(mySeat);
        if (room.size === 0) _rooms.delete(tableId);
        const tbl = _tables.get(tableId);
        if (tbl) { tbl.players = room.size; tbl.phase = room.size > 1 ? 'playing' : 'waiting'; }
        broadcastPoker(tableId, mySeat, { type: 'player_left', seat: mySeat, playerCount: room.size });
        console.log(`[poker] ${tableId} seat ${mySeat} left (${room.size} players)`);
      });
    });
  } else {
    socket.destroy();
  }
});

// Start HTTP server immediately — Redis connects in background
server.listen(PORT, () => {
  console.log(`\n⊘ Night Ecosystem API v2.0.0 — listening on :${PORT}`);
  console.log(`  Night Score:  /api/night-score/record | /api/night-score/:addr`);
  console.log(`  Build Score:  /api/build-score/:chain/:addr`);
  console.log(`  Night ID:     /api/nightid/identity/:addr | /api/nightid/credentials/:addr`);
  console.log(`  Scoring:      ETH=${!!process.env.ETHERSCAN_API_KEY} SOL=${!!process.env.HELIUS_API_KEY} ADA=${!!process.env.BLOCKFROST_ADA_KEY} Midnight=yes`);
  console.log(`  Credentials:  issuer=${ISSUER_SECRET === 'night-id-dev-secret-change-in-prod' ? 'DEV KEY ⚠️' : 'custom ✓'}`);
  console.log(`  Health:       http://localhost:${PORT}/health\n`);
});

initRedis().catch(e => console.error('[redis] init failed:', e?.message));
