/**
 * dust-sponsor.ts — Night Markets DUST Fee Sponsorship Service
 *
 * Mainnet users hold NIGHT tokens but need DUST to pay transaction fees.
 * This service acts as the Night Markets sponsor wallet:
 *   1. User builds an unbalanced transaction (no DUST attached)
 *   2. User POSTs the serialised tx to POST /api/sponsor
 *   3. Sponsor calls balanceFinalizedTransaction() — attaches DUST from
 *      the sponsor's wallet to cover fees
 *   4. Returns the sponsored tx; user submits it via their own wallet
 *
 * The sponsor earns NIGHT from platform fees (2.5%) which it converts
 * to DUST via the Capacity Exchange (Sundae Labs, mid-2026). Until then,
 * the sponsor is topped up manually by Night Markets operations.
 *
 * Run:
 *   SPONSOR_SEED=<hex> MIDNIGHT_NETWORK=mainnet npm run dust-sponsor
 *
 * Endpoints:
 *   GET  /health                — liveness check + DUST balance
 *   POST /api/sponsor           — balance a user tx with DUST
 *   GET  /api/sponsor/estimate  — estimate DUST cost for a tx
 */

process.on('uncaughtException',  (err: unknown) => console.error('Uncaught:', err));
process.on('unhandledRejection', (r: unknown)   => console.error('Rejected:', r));

import * as http from 'node:http';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import * as ledger from '@midnight-ntwrk/ledger-v7';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { WalletFacade }   from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet }     from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

// @ts-expect-error: Apollo WS transport
globalThis.WebSocket = WebSocket;

// ─── Config ───────────────────────────────────────────────────────────────────

const NETWORK   = (process.env.MIDNIGHT_NETWORK ?? 'preprod') as 'preprod' | 'mainnet';
const PORT      = parseInt(process.env.SPONSOR_PORT ?? '3002', 10);
const MAX_DUST_PER_TX = BigInt(process.env.MAX_DUST_PER_TX ?? '5000000000000000'); // 5 DUST cap per tx

setNetworkId(NETWORK);

const ENDPOINTS = {
  preprod: {
    indexer:   'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node:      'https://rpc.preprod.midnight.network',
    proof:     'http://127.0.0.1:6300',
  },
  mainnet: {
    indexer:   'https://indexer.mainnet.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.mainnet.midnight.network/api/v3/graphql/ws',
    node:      'https://rpc.mainnet.midnight.network',
    proof:     process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
  },
};

const CONFIG = ENDPOINTS[NETWORK];

// ─── Sponsorship stats (in-memory) ───────────────────────────────────────────

const stats = {
  sponsored:   0,
  totalDust:   0n,
  errors:      0,
  startedAt:   Date.now(),
};

// ─── Wallet setup ─────────────────────────────────────────────────────────────

function deriveKeys(seed: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('Invalid seed');
  const r = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (r.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();
  return r.keys;
}

let sponsorState: {
  wallet:      WalletFacade;
  dustSK:      ledger.DustSecretKey;
  shieldedSKs: ledger.ZswapSecretKeys;
  address:     string;
  dustBalance: bigint;
  ready:       boolean;
  error?:      string;
} = { wallet: null as any, dustSK: null as any, shieldedSKs: null as any, address: '', dustBalance: 0n, ready: false };

async function initSponsor() {
  const seed = process.env.SPONSOR_SEED;
  if (!seed) {
    sponsorState.error = 'SPONSOR_SEED not set in environment';
    console.error(`\n  ⚠ ${sponsorState.error}`);
    console.log('  Running in SIMULATION mode — no real DUST will be attached\n');
    sponsorState.ready = false;
    return;
  }

  try {
    console.log('\n  Initialising sponsor wallet…');
    const keys        = deriveKeys(seed);
    const networkId   = getNetworkId();
    const shieldedSKs = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
    const dustSK      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
    const keystore    = createKeystore(keys[Roles.NightExternal], networkId);

    const base = {
      networkId,
      indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
      provingServerUrl: new URL(CONFIG.proof),
      relayURL:         new URL(CONFIG.node.replace(/^http/, 'ws')),
    };

    const shielded   = ShieldedWallet(base).startWithSecretKeys(shieldedSKs);
    const unshielded = UnshieldedWallet({
      networkId,
      indexerClientConnection: base.indexerClientConnection,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    }).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = DustWallet({
      ...base,
      costParameters: { additionalFeeOverhead: 500_000_000_000_000n, feeBlocksMargin: 10 },
    }).startWithSecretKey(dustSK, ledger.LedgerParameters.initialParameters().dust);

    const wallet = new WalletFacade(shielded, unshielded, dust);
    await wallet.start(shieldedSKs, dustSK);

    const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
    const dustBal = state.dust?.balance ?? 0n;
    const address = PublicKey.fromKeyStore(keystore).toHexString?.() ?? 'unknown';

    sponsorState = { wallet, dustSK, shieldedSKs, address, dustBalance: dustBal, ready: true };
    console.log(`  ✓ Sponsor wallet ready`);
    console.log(`  Address : ${address.slice(0, 20)}…`);
    console.log(`  DUST    : ${dustBal}`);
    console.log(`  Network : ${NETWORK}\n`);
  } catch (err: any) {
    sponsorState.error = err.message ?? String(err);
    console.error('  ✗ Sponsor wallet init failed:', sponsorState.error);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function cors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) reject(new Error('Body too large')); });
    req.on('end',  () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url    = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // GET /health
  if (method === 'GET' && url === '/health') {
    return json(res, 200, {
      ready:       sponsorState.ready,
      network:     NETWORK,
      address:     sponsorState.address,
      dustBalance: sponsorState.dustBalance.toString(),
      stats: {
        txsSponsored: stats.sponsored,
        totalDustSpent: stats.totalDust.toString(),
        errors:       stats.errors,
        uptimeSeconds: Math.floor((Date.now() - stats.startedAt) / 1000),
      },
      maxDustPerTx: MAX_DUST_PER_TX.toString(),
      error:        sponsorState.error ?? null,
    });
  }

  // POST /api/sponsor — balance a user tx with DUST
  if (method === 'POST' && url === '/api/sponsor') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    const { tx: serialisedTx } = body;
    if (!serialisedTx) return json(res, 400, { error: 'tx field required (serialised transaction bytes as hex or base64)' });

    // Simulation mode — no real wallet
    if (!sponsorState.ready) {
      console.log('  [sponsor] SIMULATION — returning tx unchanged');
      return json(res, 200, {
        sponsored:   false,
        simulation:  true,
        sponsoredTx: serialisedTx,
        message:     'Sponsor wallet not initialised — tx returned unchanged. Set SPONSOR_SEED to enable real sponsorship.',
      });
    }

    try {
      // Deserialise user's unbalanced tx
      const txBytes = Buffer.from(serialisedTx, serialisedTx.startsWith('0x') ? 'hex' : 'base64');

      // balanceFinalizedTransaction attaches DUST to cover fees
      // This is the core sponsorship step — sponsor pays the DUST fee on behalf of user
      const sponsored = await (sponsorState.wallet as any).balanceFinalizedTransaction(
        txBytes,
        { dustSecretKey: sponsorState.dustSK },
      );

      // Estimate dust cost for logging / rate-limiting
      const dustUsed: bigint = sponsored.dustCost ?? MAX_DUST_PER_TX;
      if (dustUsed > MAX_DUST_PER_TX) {
        stats.errors++;
        return json(res, 400, { error: `DUST cost ${dustUsed} exceeds per-tx limit ${MAX_DUST_PER_TX}` });
      }

      stats.sponsored++;
      stats.totalDust += dustUsed;
      console.log(`  [sponsor] Tx sponsored — DUST: ${dustUsed} | total: ${stats.sponsored}`);

      return json(res, 200, {
        sponsored:    true,
        sponsoredTx:  Buffer.from(sponsored.serialise?.() ?? sponsored).toString('base64'),
        dustUsed:     dustUsed.toString(),
        totalSponsored: stats.sponsored,
      });
    } catch (err: any) {
      stats.errors++;
      console.error('  [sponsor] Error:', err.message ?? err);
      return json(res, 500, { error: err.message ?? String(err) });
    }
  }

  // GET /api/sponsor/estimate — rough DUST cost estimate
  if (method === 'GET' && url.startsWith('/api/sponsor/estimate')) {
    // Rough estimate: 1 circuit call ≈ 1–3 DUST units
    // Real cost depends on circuit complexity and network congestion
    return json(res, 200, {
      estimatedDustRange: { min: '1000000000000', max: '3000000000000000' },
      unit:    'DUST (1e-12 NIGHT equivalent)',
      note:    'Actual cost determined at balance time. Night Markets covers this fee.',
      network: NETWORK,
    });
  }

  json(res, 404, { error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌑 Night Markets DUST Sponsor Service`);
  console.log(`   http://127.0.0.1:${PORT}/health`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Max DUST per tx: ${MAX_DUST_PER_TX}\n`);
});

await initSponsor();
