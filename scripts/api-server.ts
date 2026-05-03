/**
 * api-server.ts — Night Markets local API bridge
 *
 * Connects the browser UI to the real NightMarketsEscrow contract on Midnight preprod.
 * Runs a lightweight HTTP server on localhost:3001.
 *
 * Run:
 *   npm run api-server
 *
 * Then serve the UI:
 *   npm run serve        (opens on localhost:3000)
 *   Open night-markets-v20.1.html
 *
 * Endpoints:
 *   GET  /api/status              — health check, wallet balance
 *   POST /api/escrow/create       — createListing on-chain (seller)
 *   POST /api/escrow/fund         — fundEscrow on-chain (buyer)
 *   POST /api/escrow/release      — releaseEscrow on-chain (buyer confirms)
 *   POST /api/escrow/dispute      — disputeEscrow on-chain (buyer flags issue)
 *   POST /api/escrow/refund       — refundEscrow on-chain (seller cancels)
 *   POST /api/listings/create    — create a listing record
 *   GET  /api/listings           — fetch all listings
 *   POST /api/ratings/submit     — submit a buyer/seller rating
 *   GET  /api/ratings/:sellerId  — get ratings for a seller
 *   POST /api/delivery/ship      — record shipping + tracking
 *   GET  /api/delivery/:orderId  — get shipping info for order
 *   POST /api/nightfun/close-epoch — close a Night Fun epoch
 *   GET  /api/nightfun/state     — get Night Fun token state
 *   POST /api/sponsor            — proxy to dust-sponsor service (port 3002)
 *   POST /api/nightfun/launch-curve — init bonding curve pool for a token
 *   POST /api/nightfun/buy          — buy tokens from bonding curve (constant-product)
 *   POST /api/nightfun/sell         — sell tokens back to curve
 *   GET  /api/nightfun/curve        — curve state (reserves, price, graduation %)
 *   POST /api/nightid/register      — register a .night name (Night-ID service)
 *   GET  /api/nightid/resolve/:name — resolve name → address
 *   GET  /api/nightid/lookup/:addr  — reverse lookup address → name
 *
 * ZK proof generation note:
 *   Server-side: httpClientProofProvider → local proof server (port 6300)
 *   Client-side: @midnight-ntwrk/dapp-connector-proof-provider v4.0.4
 *     → wallet.getProvingProvider() via Lace/Nocturne browser extension
 *
 * Future — Night Fun bonding curve (SpyCrypto/zk-mint pattern):
 *   Constant-product AMM for token launches with privacy toggle.
 *   POST /api/nightfun/launch-curve — initialise bonding curve
 *   POST /api/nightfun/buy          — buy tokens along curve
 *   POST /api/nightfun/sell         — sell tokens along curve
 */

process.on('uncaughtException',  (err: unknown) => console.error('Uncaught:', err));
process.on('unhandledRejection', (r: unknown)   => console.error('Rejected:', r));

import * as http   from 'node:http';
import * as path   from 'node:path';
import * as fs     from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer }  from 'buffer';
import { WebSocket, WebSocketServer } from 'ws';
import * as Rx     from 'rxjs';

import * as ledger    from '@midnight-ntwrk/ledger-v7';
import * as ledger8   from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider }    from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider }  from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider }  from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider }       from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract }           from '@midnight-ntwrk/compact-js';
import { WalletFacade }               from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet }                 from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles }            from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet }             from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

// @ts-expect-error: Apollo WS transport
globalThis.WebSocket = WebSocket;

// ─── Ledger v7/v8 WASM bridge ────────────────────────────────────────────────
// wallet-sdk uses ledger-v7; midnight-js-contracts uses ledger-v8.
// Patch v8 Transaction to accept v7 objects across the WASM boundary.
let _bridgeApplied = false;
function applyLedgerBridge(): void {
  if (_bridgeApplied) return;
  _bridgeApplied = true;
  const V7LP  = (ledger as any).LedgerParameters;
  const V7Tx  = (ledger as any).Transaction;
  const V8LP  = ledger8.LedgerParameters;
  const V8Tx  = (ledger8.Transaction as any);
  const origFWM = V8Tx.prototype.feesWithMargin;
  V8Tx.prototype.feesWithMargin = function(params: any, n: any) {
    if (params instanceof V7LP) return origFWM.call(this, V8LP.deserialize(params.serialize()), n);
    return origFWM.call(this, params, n);
  };
  const origMerge = V8Tx.prototype.merge;
  V8Tx.prototype.merge = function(other: any) {
    if (other instanceof V7Tx) return origMerge.call(this, V8Tx.deserialize('signature', 'proof', 'binding', other.serialize()));
    return origMerge.call(this, other);
  };
  console.log('  ✓ Ledger v7/v8 bridge applied');
}

// ─── Config ───────────────────────────────────────────────────────────────────

setNetworkId('preprod');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
  ?? '7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711';

const PORT = parseInt(process.env.API_PORT ?? '3001', 10);

const CONFIG = {
  indexer:     process.env.INDEXER_URI      ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS:   process.env.INDEXER_WS_URI   ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node:        process.env.NODE_URI         ?? 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
};

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-markets-escrow');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// ─── Wallet helpers ───────────────────────────────────────────────────────────

const dustBal = (s: any): bigint =>
  (s?.dust?.availableCoins ?? []).reduce((sum: bigint, c: any) => sum + (c.value ?? 0n), 0n);

const serverReadyFilter = (s: any): boolean =>
  (s.unshielded?.progress?.isCompleteWithin?.(50n) ?? false) || dustBal(s) > 0n;

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

async function buildWallet(seed: string) {
  const keys        = deriveKeys(seed);
  const networkId   = getNetworkId();
  const shieldedSKs = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSK      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore    = createKeystore(keys[Roles.NightExternal], networkId);
  const base = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
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
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  }).startWithSecretKey(dustSK, ledger.LedgerParameters.initialParameters().dust);
  const wallet = new WalletFacade(shielded, unshielded, dust);
  await wallet.start(shieldedSKs, dustSK);
  return { wallet, shieldedSKs, dustSK, keystore };
}

function signIntents(tx: { intents?: Map<number, any> }, signFn: (p: Uint8Array) => ledger.Signature, marker: 'proof' | 'pre-proof') {
  if (!tx.intents?.size) return;
  for (const seg of tx.intents.keys()) {
    const intent = tx.intents.get(seg);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature', marker, 'pre-binding', intent.serialize(),
    );
    const sig = signFn(cloned.signatureData(seg));
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map((_: any, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? sig);
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map((_: any, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? sig);
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(seg, cloned);
  }
}

async function buildProviders(ctx: Awaited<ReturnType<typeof buildWallet>>) {
  const state  = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(serverReadyFilter)));
  const signFn = (p: Uint8Array) => ctx.keystore.signData(p);
  const wmp = {
    getCoinPublicKey()       { return state.shielded.coinPublicKey.toHexString(); },
    getEncryptionPublicKey() { return state.shielded.encryptionPublicKey.toHexString(); },
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSKs, dustSecretKey: ctx.dustSK },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      signIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) signIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: any) { return ctx.wallet.submitTransaction(tx) as any; },
  };
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  return {
    walletProvider:       wmp,
    midnightProvider:     wmp,
    publicDataProvider:   indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    proofProvider:        httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    zkConfigProvider,
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'night-markets-api-state',
      walletProvider: wmp,
      privateStoragePasswordProvider: () => 'night-markets-api-secret-key-2024',
      accountId: 'night-markets-api-account',
    }),
  };
}

// ─── Helper: string → Bytes<32> ───────────────────────────────────────────────

function toBytes32(s: string): Uint8Array {
  const buf = new Uint8Array(32);
  const enc = new TextEncoder().encode(s.slice(0, 32));
  buf.set(enc);
  return buf;
}

// ─── Global state (initialised once on startup) ───────────────────────────────

let appState: {
  ready:    boolean;
  contract: any;
  address:  string;
  night:    bigint;
  dust:     bigint;
  error?:   string;
} = { ready: false, contract: null, address: '', night: 0n, dust: 0n };

async function init() {
  const seed = process.env.WALLET_SEED;
  if (!seed) {
    appState.error = 'WALLET_SEED not set — contract calls will fail. Set it in .env and restart.';
    console.warn('\n⚠️  ' + appState.error);
    return;
  }
  if (!fs.existsSync(contractPath)) {
    appState.error = 'Contract not compiled. Run: npm run compile';
    console.error('\n❌  ' + appState.error);
    return;
  }

  try {
    console.log('\n🌙 Night Markets API Server — initialising...');
    applyLedgerBridge();

    const ctx = await buildWallet(seed);
    console.log(`  Wallet: ${ctx.keystore.getBech32Address()}`);

    console.log('  Syncing with preprod...');
    const state  = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(serverReadyFilter)));
    const night  = state.unshielded?.balances?.[unshieldedToken().raw] ?? 0n;
    const dust   = dustBal(state);
    console.log(`  tNight: ${night.toLocaleString()} · DUST: ${dust.toLocaleString()}`);

    const providers = await buildProviders(ctx);

    const NightMarketsEscrow = await import(pathToFileURL(contractPath).href);
    const compiled = CompiledContract
      .make('night-markets-escrow', NightMarketsEscrow.Contract)
      .pipe(
        CompiledContract.withWitnesses({
          localSecretKey:    () => new Uint8Array(32).fill(1),
          voterNightBalance: () => 0n,
        }),
        CompiledContract.withCompiledFileAssets(zkConfigPath),
      );

    console.log('  Attaching to deployed contract...');
    const contract = await findDeployedContract(providers, {
      contractAddress:     CONTRACT_ADDRESS,
      compiledContract:    compiled,
      privateStateId:      'escrowState',
      initialPrivateState: {},
    });

    appState = { ready: true, contract, address: ctx.keystore.getBech32Address(), night, dust };
    console.log(`\n✅  Ready — contract: ${CONTRACT_ADDRESS}`);
  } catch (err: any) {
    appState.error = err.message ?? String(err);
    console.error('\n❌  Init failed:', appState.error);
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function cors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ─── Extended in-memory stores ────────────────────────────────────────────────
const _listingStore:  Map<string, any>    = new Map();
const _ratingStore:   Map<string, any[]>  = new Map();
const _deliveryStore: Map<string, any>    = new Map();
const _curveStore:    Map<string, any>    = new Map(); // tokenAddress → curve state
const _nightIdStore:  Map<string, string> = new Map(); // "name.night" → address

// Bonding curve math (bigint, constant-product AMM)
function calcBuy(nightReserve: bigint, tokenReserve: bigint, nightIn: bigint): bigint {
  if (nightIn <= 0n || tokenReserve <= 0n) return 0n;
  return tokenReserve * nightIn / (nightReserve + nightIn);
}
function calcSell(nightReserve: bigint, tokenReserve: bigint, tokensIn: bigint): bigint {
  if (tokensIn <= 0n || nightReserve <= 0n) return 0n;
  return nightReserve * tokensIn / (tokenReserve + tokensIn);
}

function normalizeNightName(raw: string): string {
  return raw.toLowerCase().replace(/\.night$/, '').replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

// ─── Token store (night-fun) ──────────────────────────────────────────────────
const _tokenStore: Map<string, any> = new Map();
[
  { id:'1', name:'NightDoge',    symbol:'NDOGE', emoji:'🌙', desc:'The original Midnight meme. ZK woof.', nr:42_100_000n, tr:957_900_000n, buys:312, sells:87 },
  { id:'2', name:'ShadowPepe',   symbol:'SPEPE', emoji:'🐸', desc:'Shielded frog. No one knows you hold it.', nr:71_300_000n, tr:928_700_000n, buys:891, sells:201 },
  { id:'3', name:'ZKitty',       symbol:'ZKIT',  emoji:'🐱', desc:'Private cat. Buys are invisible on-chain.', nr:18_600_000n, tr:981_400_000n, buys:143, sells:34 },
  { id:'4', name:'MidnightBull', symbol:'MBULL', emoji:'🐂', desc:'Bullish on Midnight. ZK leveraged vibes.', nr:55_400_000n, tr:944_600_000n, buys:567, sells:123 },
  { id:'5', name:'AnonymousApe', symbol:'ANAPE', emoji:'🦍', desc:'NFT-free ape culture. Totally private buys.', nr:9_200_000n, tr:990_800_000n, buys:78, sells:12 },
  { id:'6', name:'DustDevil',    symbol:'DDUST', emoji:'🌪️', desc:'Sweeping the DUST floor. ZK yield farming.', nr:33_800_000n, tr:966_200_000n, buys:289, sells:76 },
  { id:'7', name:'NightShiba',   symbol:'NSHIB', emoji:'🐕', desc:"Shib but you're anonymous. Much privacy.", nr:61_700_000n, tr:938_300_000n, buys:744, sells:189 },
  { id:'8', name:'VoidCat',      symbol:'VOID',  emoji:'🖤', desc:'Aesthetic nihilism tokenized. ZK dark energy.', nr:4_100_000n, tr:995_900_000n, buys:31, sells:8 },
  { id:'9', name:'ProofOfDoge',  symbol:'POD',   emoji:'✅', desc:'ZK-provably doge. Verify the doge without seeing it.', nr:28_400_000n, tr:971_600_000n, buys:221, sells:58 },
].forEach(t => {
  const address = `token_${t.id}`;
  _tokenStore.set(t.id, { id:t.id, name:t.name, symbol:t.symbol, emoji:t.emoji, desc:t.desc, address, createdAt: Date.now() - Math.random()*86_400_000*7 });
  if (!_curveStore.has(address)) {
    _curveStore.set(address, { tokenAddress:address, nightReserve:t.nr, tokenReserve:t.tr, totalBuys:t.buys, totalSells:t.sells, graduated:t.nr>=85_000_000n, privacy:true, createdAt:Date.now() });
  }
});

// ─── Task store (night-work) ──────────────────────────────────────────────────
const _taskStore: Map<string, any> = new Map([
  ['t1', { id:'t1', icon:'📸', title:'Photograph Sydney CBD — 10 specific locations', meta:'Street level · Standard quality · 48h deadline', agent:'Midnight City Agent #4471 — Urban Mapper faction', reward:120, category:'photography', state:'open', poster:'agent_4471', bond:10, createdAt:Date.now()-3_600_000 }],
  ['t2', { id:'t2', icon:'📦', title:'Purchase and ship a physical item to Melbourne', meta:'Item details provided · Reimbursed + fee · 72h deadline', agent:'Midnight City Agent #1829 — Commerce faction', reward:85, category:'logistics', state:'open', poster:'agent_1829', bond:10, createdAt:Date.now()-7_200_000 }],
  ['t3', { id:'t3', icon:'✅', title:'Verify this business is still operating — Brisbane', meta:'Visit location · Confirm open/closed · Photo required', agent:'Midnight City Agent #7703 — Intelligence faction', reward:40, category:'verification', state:'open', poster:'agent_7703', bond:10, createdAt:Date.now()-1_800_000 }],
  ['t4', { id:'t4', icon:'🔧', title:'Assemble and test a Raspberry Pi sensor kit', meta:'Kit shipped to you · Full assembly guide · Return after', agent:'Midnight City Agent #2201 — Hardware faction', reward:200, category:'hardware', state:'open', poster:'agent_2201', bond:10, createdAt:Date.now()-10_800_000 }],
  ['t5', { id:'t5', icon:'🌱', title:'Plant 10 native seedlings at designated GPS coordinates', meta:'Seedlings provided · GPS proof required · 1 week deadline', agent:'Midnight City Agent #9914 — EcoCore faction', reward:55, category:'environment', state:'open', poster:'agent_9914', bond:10, createdAt:Date.now()-900_000 }],
  ['t6', { id:'t6', icon:'🎤', title:'Record 50 spoken sentences in Australian English', meta:'Audio quality guidelines provided · Submit as WAV files', agent:'Midnight City Agent #3356 — Language faction', reward:75, category:'data', state:'open', poster:'agent_3356', bond:10, createdAt:Date.now()-14_400_000 }],
  ['t7', { id:'t7', icon:'🚚', title:'Last-mile delivery: pick up and deliver 3 parcels in Perth', meta:'Route optimised · Insurance included · Same day', agent:'Midnight City Agent #6621 — Logistics faction', reward:95, category:'logistics', state:'open', poster:'agent_6621', bond:10, createdAt:Date.now()-5_400_000 }],
  ['t8', { id:'t8', icon:'🔍', title:'Mystery shop at 4 retail stores and submit report', meta:'Detailed evaluation form · Receipts reimbursed', agent:'Midnight City Agent #8801 — Intelligence faction', reward:110, category:'verification', state:'open', poster:'agent_8801', bond:10, createdAt:Date.now()-21_600_000 }],
]);
const _workerState: Map<string, Map<string, any>> = new Map(); // taskId → workerAddr → {state,proof}

// ─── Vault store (night-save) ─────────────────────────────────────────────────
const _vaultStore: Map<string, any> = new Map(); // address → {collateral,debt,bnpl[]}
function getVault(address: string) {
  if (!_vaultStore.has(address)) _vaultStore.set(address, { collateral:0, debt:0, bnpl:[] });
  return _vaultStore.get(address)!;
}

// ─── Lend store (night-lend) ──────────────────────────────────────────────────
const _lendStore: Map<string, any> = new Map(); // address → {deposits,borrows}
const POOL_PRICES: Record<string,number> = { NIGHT:0.04, sUSD:1.00, tDUST:0.012 };
const POOLS_APY:   Record<string,number> = { NIGHT:18.4, sUSD:8.2,  tDUST:12.1 };
const POOLS_BORROW:Record<string,number> = { NIGHT:22.1, sUSD:11.5, tDUST:16.3 };
const POOLS_TVL:   Record<string,number> = { NIGHT:1_200_000, sUSD:3_800_000, tDUST:620_000 };
function getLendPos(address: string) {
  if (!_lendStore.has(address)) _lendStore.set(address, { deposits:{NIGHT:0,sUSD:0,tDUST:0}, borrows:{sUSD:0,NIGHT:0,tDUST:0} });
  return _lendStore.get(address)!;
}

// ─── Biz store (night-biz) ────────────────────────────────────────────────────
const _bizStore: Map<string, any> = new Map(); // creatorAddress → deployed token

// ─── Poker rooms (night-poker WS) ────────────────────────────────────────────
const _pokerRooms: Map<string, { players: Set<any>, state: any }> = new Map();

const server = http.createServer(async (req, res) => {
  const url    = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // ── GET /api/status ──────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/status') {
    return json(res, 200, {
      ready:           appState.ready,
      contractAddress: CONTRACT_ADDRESS,
      network:         'preprod',
      walletAddress:   appState.address,
      night:           appState.night.toString(),
      dust:            appState.dust.toString(),
      error:           appState.error ?? null,
    });
  }

  // ── POST /api/escrow/* ────────────────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/api/escrow/')) {
    if (!appState.ready || !appState.contract) {
      return json(res, 503, { error: appState.error ?? 'Server not ready — check logs.' });
    }

    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    const action = url.replace('/api/escrow/', '');

    try {
      if (action === 'create') {
        const { orderId, amountNight } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        const amt      = BigInt(amountNight ?? 1_000_000);
        console.log(`\n  [create] orderId="${orderId}" amount=${amt}`);
        const r = await appState.contract.callTx.createListing(oidBytes, amt);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId, amountNight: amt.toString() });
      }

      if (action === 'fund') {
        const { orderId, amountNight } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        const amt      = BigInt(amountNight ?? 1_000_000);
        console.log(`\n  [fund] orderId="${orderId}" amount=${amt}`);
        const r = await appState.contract.callTx.fundEscrow(oidBytes, amt);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId });
      }

      if (action === 'release') {
        const { orderId } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        console.log(`\n  [release] orderId="${orderId}"`);
        const r = await appState.contract.callTx.releaseEscrow(oidBytes);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId });
      }

      if (action === 'dispute') {
        const { orderId } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        const r = await appState.contract.callTx.disputeEscrow(oidBytes);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId });
      }

      if (action === 'refund') {
        const { orderId } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        const r = await appState.contract.callTx.refundEscrow(oidBytes);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId });
      }

      return json(res, 404, { error: `Unknown action: ${action}` });
    } catch (err: any) {
      console.error(`  [${action}] Error:`, err.message ?? err);
      return json(res, 500, { error: err.message ?? String(err) });
    }
  }

  // ── POST /api/listings/create ──────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/listings/create') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { id, title, cat, price, cond, desc, from: shipFrom, emoji, sellerId } = body;
    if (!id || !title || !price) return json(res, 400, { error: 'id, title, price required' });
    const listing = { id, title, cat, price, cond, desc, shipFrom, emoji, sellerId, state: 'OPEN', createdAt: Date.now() };
    _listingStore.set(id, listing);
    return json(res, 200, { ok: true, listing });
  }

  // ── GET /api/listings ──────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/listings') {
    return json(res, 200, { listings: [..._listingStore.values()] });
  }

  // ── POST /api/ratings/submit ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/ratings/submit') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { sellerId, buyerId, stars, comment, orderId } = body;
    if (!sellerId || !stars) return json(res, 400, { error: 'sellerId and stars required' });
    if (!_ratingStore.has(sellerId)) _ratingStore.set(sellerId, []);
    _ratingStore.get(sellerId)!.push({ stars, comment, buyerId, orderId, at: Date.now() });
    const reviews = _ratingStore.get(sellerId)!;
    const avg = reviews.reduce((s: number, r: any)=>s+r.stars, 0)/reviews.length;
    return json(res, 200, { ok: true, avg: Math.round(avg*10)/10, count: reviews.length });
  }

  // ── GET /api/ratings/:sellerId ─────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/ratings/')) {
    const sellerId = url.replace('/api/ratings/', '');
    const reviews = _ratingStore.get(sellerId) || [];
    const avg = reviews.length ? reviews.reduce((s: number, r: any)=>s+r.stars,0)/reviews.length : null;
    return json(res, 200, { sellerId, reviews, avg: avg ? Math.round(avg*10)/10 : null, count: reviews.length });
  }

  // ── POST /api/delivery/ship ────────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/delivery/ship') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { orderId, carrier, trackingRef, eta } = body;
    if (!orderId || !trackingRef) return json(res, 400, { error: 'orderId and trackingRef required' });
    const d = { carrier, trackingRef, eta, shippedAt: Date.now() };
    _deliveryStore.set(orderId, d);
    return json(res, 200, { ok: true, ...d });
  }

  // ── GET /api/delivery/:orderId ─────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/delivery/')) {
    const orderId = url.replace('/api/delivery/', '');
    const d = _deliveryStore.get(orderId);
    return json(res, d ? 200 : 404, d || { error: 'Not found' });
  }

  // ── POST /api/nightfun/close-epoch ────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightfun/close-epoch') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const distributed = Math.floor(Math.random() * 100);
    console.log(`\n  [nightfun/close-epoch] tokenAddress=${body.tokenAddress} distributed=${distributed}`);
    return json(res, 200, { ok: true, distributed, epoch: Date.now() });
  }

  // ── GET /api/nightfun/state ────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightfun/state')) {
    return json(res, 200, { epoch: 0, holders: 1, epochRev: 0, merchSales: 0, claimable: 0 });
  }

  // ── POST /api/nightfun/launch-curve ───────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightfun/launch-curve') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { tokenAddress, initialTokens = 10000, privacyEnabled = false } = body;
    if (!tokenAddress) return json(res, 400, { error: 'tokenAddress required' });
    if (_curveStore.has(tokenAddress)) return json(res, 400, { error: 'curve already initialized for this token' });
    const curve = {
      tokenAddress,
      nightReserve:  1n,
      tokenReserve:  BigInt(initialTokens),
      privacy:       privacyEnabled,
      graduated:     false,
      totalBuys:     0,
      createdAt:     Date.now(),
    };
    _curveStore.set(tokenAddress, curve);
    console.log(`\n  [curve/launch] ${tokenAddress} — ${initialTokens} tokens seeded`);
    return json(res, 200, { ok: true, curve: { ...curve, nightReserve: curve.nightReserve.toString(), tokenReserve: curve.tokenReserve.toString() } });
  }

  // ── POST /api/nightfun/buy ────────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightfun/buy') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { tokenAddress, nightIn, minTokensOut = 0 } = body;
    const curve = _curveStore.get(tokenAddress);
    if (!curve) return json(res, 404, { error: 'curve not found — call launch-curve first' });
    if (curve.graduated) return json(res, 400, { error: 'curve graduated — use zswap' });
    const nIn   = BigInt(Math.round(Number(nightIn) * 1_000_000));
    const tOut  = calcBuy(curve.nightReserve, curve.tokenReserve, nIn);
    if (tOut < BigInt(minTokensOut)) return json(res, 400, { error: `slippage: got ${tOut} tokens, min ${minTokensOut}` });
    curve.nightReserve += nIn;
    curve.tokenReserve -= tOut;
    curve.totalBuys++;
    const graduated = curve.nightReserve >= 85_000_000n;
    if (graduated) { curve.graduated = true; console.log(`  [curve] GRADUATED — 85 tNight reached!`); }
    const price = Number(curve.nightReserve) / Number(curve.tokenReserve) / 1_000_000;
    console.log(`\n  [curve/buy] ${nIn} µNIGHT → ${tOut} tokens | price ${price.toFixed(8)}`);
    return json(res, 200, { ok: true, tokensOut: tOut.toString(), graduated, curve: { ...curve, nightReserve: curve.nightReserve.toString(), tokenReserve: curve.tokenReserve.toString() } });
  }

  // ── POST /api/nightfun/sell ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightfun/sell') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { tokenAddress, tokensIn, minNightOut = 0 } = body;
    const curve = _curveStore.get(tokenAddress);
    if (!curve) return json(res, 404, { error: 'curve not found' });
    if (curve.graduated) return json(res, 400, { error: 'curve graduated — use zswap' });
    const tIn  = BigInt(Math.round(Number(tokensIn)));
    const nOut = calcSell(curve.nightReserve, curve.tokenReserve, tIn);
    if (nOut < BigInt(minNightOut)) return json(res, 400, { error: `slippage: got ${nOut} µNIGHT, min ${minNightOut}` });
    curve.nightReserve -= nOut;
    curve.tokenReserve += tIn;
    const nightOutDisplay = Number(nOut) / 1_000_000;
    console.log(`\n  [curve/sell] ${tIn} tokens → ${nightOutDisplay.toFixed(6)} NIGHT`);
    return json(res, 200, { ok: true, nightOut: nOut.toString(), nightOutDisplay: nightOutDisplay.toFixed(6), curve: { ...curve, nightReserve: curve.nightReserve.toString(), tokenReserve: curve.tokenReserve.toString() } });
  }

  // ── GET /api/nightfun/curve ───────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightfun/curve')) {
    const tokenAddress = new URL('http://x' + url).searchParams.get('addr') ?? '';
    const curve = _curveStore.get(tokenAddress);
    if (!curve) return json(res, 404, { error: 'curve not found' });
    const price = Number(curve.nightReserve) / Number(curve.tokenReserve) / 1_000_000;
    const gradPct = Math.min(100, Number(curve.nightReserve) / 85_000_000 * 100);
    return json(res, 200, { ...curve, nightReserve: curve.nightReserve.toString(), tokenReserve: curve.tokenReserve.toString(), pricePerToken: price.toFixed(8), graduationPct: gradPct.toFixed(2) });
  }

  // ── POST /api/nightid/register ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightid/register') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { name: rawName, address } = body;
    const name = normalizeNightName(rawName ?? '');
    if (!name || name.length < 3) return json(res, 400, { error: 'name must be 3–32 lowercase alphanumeric chars' });
    if (!address) return json(res, 400, { error: 'address required' });
    const full = `${name}.night`;
    if (_nightIdStore.has(full)) {
      const existing = _nightIdStore.get(full);
      if (existing !== address) return json(res, 409, { error: `${full} already registered to a different address` });
    }
    _nightIdStore.set(full, address);
    console.log(`\n  [nightid/register] ${full} → ${address.slice(0, 20)}…`);
    return json(res, 200, { ok: true, name: full, address });
  }

  // ── GET /api/nightid/resolve/:name ────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/resolve/')) {
    const rawName = url.replace('/api/nightid/resolve/', '');
    const name    = normalizeNightName(rawName);
    const full    = `${name}.night`;
    const address = _nightIdStore.get(full);
    if (!address) return json(res, 404, { error: `${full} not registered` });
    return json(res, 200, { name: full, address });
  }

  // ── GET /api/nightid/lookup/:address ─────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightid/lookup/')) {
    const addr = url.replace('/api/nightid/lookup/', '');
    const entry = [..._nightIdStore.entries()].find(([, a]) => a === addr);
    if (!entry) return json(res, 404, { error: 'no .night name registered for this address' });
    return json(res, 200, { name: entry[0], address: addr });
  }

  // ── POST /api/sponsor — proxy to dust-sponsor service (port 3002) ─────────────
  // Browser UI calls this; we forward to the DUST sponsor service.
  // On mainnet: DUST sponsor attaches fee-paying DUST to user's unbalanced tx.
  // On preprod: returns tx unchanged (no DUST needed on testnet).
  // dapp-connector-proof-provider note: for client-side ZK proof generation,
  //   the browser uses @midnight-ntwrk/dapp-connector-proof-provider v4.0.4
  //   via the Lace/Nocturne wallet. The proof is generated in the wallet extension,
  //   not here — this server handles server-side contract calls only.
  //   Client flow: wallet.getProvingProvider() → proofProvider.generateProof(circuit)
  if (method === 'POST' && url === '/api/sponsor') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

    const SPONSOR_PORT = process.env.SPONSOR_PORT ?? '3002';
    const SPONSOR_URL  = `http://127.0.0.1:${SPONSOR_PORT}/api/sponsor`;

    try {
      // Forward to dust-sponsor service
      const resp = await fetch(SPONSOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await resp.json();
      return json(res, resp.status, result);
    } catch (err: any) {
      // Sponsor service offline — return tx unchanged (preprod graceful fallback)
      console.warn('  [sponsor] Dust sponsor service offline:', err.message);
      return json(res, 200, {
        sponsored:  false,
        simulation: true,
        sponsoredTx: body.tx,
        message: 'DUST sponsor service offline — tx returned unchanged. Start dust-sponsor service for mainnet.',
      });
    }
  }

  // ── GET /health ───────────────────────────────────────────────────────────────
  if (url === '/health' || url === '/api/health') {
    return json(res, 200, { ok: true, ready: appState.ready });
  }

  // ── GET /api/tokens ───────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/tokens') {
    const tokens = [..._tokenStore.values()].map(t => {
      const c = _curveStore.get(t.address);
      const nr = c ? Number(c.nightReserve) / 1_000_000 : 0;
      return { ...t, night: nr.toFixed(1), pct: Math.min(100, Math.round(nr / 85 * 100)), buys: c?.totalBuys ?? 0, graduated: c?.graduated ?? false };
    }).sort((a, b) => Number(b.night) - Number(a.night));
    return json(res, 200, { tokens });
  }

  // ── POST /api/tokens/create ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/tokens/create') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { name, symbol, emoji = '🌙', desc = '', creator } = body;
    if (!name || !symbol) return json(res, 400, { error: 'name and symbol required' });
    const id = `tk_${Date.now()}`;
    const address = `token_${id}`;
    const token = { id, name, symbol: symbol.toUpperCase().slice(0, 6), emoji, desc, address, creator, createdAt: Date.now() };
    _tokenStore.set(id, token);
    _curveStore.set(address, { tokenAddress:address, nightReserve:1n, tokenReserve:1_000_000_000n, totalBuys:0, totalSells:0, graduated:false, privacy:true, createdAt:Date.now() });
    console.log(`\n  [token/create] ${name} $${symbol} → ${address}`);
    return json(res, 200, { ok: true, token });
  }

  // ── GET /api/tokens/:id ───────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/tokens/')) {
    const id = decodeURIComponent(url.replace('/api/tokens/', '').split('?')[0]);
    const token = _tokenStore.get(id);
    if (!token) return json(res, 404, { error: 'token not found' });
    const c = _curveStore.get(token.address);
    const nr = c ? Number(c.nightReserve) / 1_000_000 : 0;
    return json(res, 200, { ...token, night: nr.toFixed(1), pct: Math.min(100, Math.round(nr / 85 * 100)), buys: c?.totalBuys ?? 0, curve: c ? { ...c, nightReserve: c.nightReserve.toString(), tokenReserve: c.tokenReserve.toString() } : null });
  }

  // ── GET /api/tasks ────────────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/tasks')) {
    const category = new URL('http://x' + url).searchParams.get('category');
    let tasks = [..._taskStore.values()];
    if (category && category !== 'all') tasks = tasks.filter(t => t.category === category);
    return json(res, 200, { tasks: tasks.sort((a, b) => b.createdAt - a.createdAt) });
  }

  // ── POST /api/nightwork/post ──────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightwork/post') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { title, desc = '', reward, deadline = '48', bond = 10, poster, category = 'general', icon = '📋' } = body;
    if (!title || !reward) return json(res, 400, { error: 'title and reward required' });
    if (Number(reward) < 1) return json(res, 400, { error: 'minimum reward is 1 NIGHT' });
    const id = `t${Date.now()}`;
    const task = { id, icon, title, meta:`${category} · ${deadline}h deadline`, desc, agent:`${(poster ?? 'Anonymous').slice(0,20)}…`, reward:Number(reward), category, state:'open', poster:poster ?? 'anon', bond:Number(bond), createdAt:Date.now() };
    _taskStore.set(id, task);
    console.log(`\n  [nightwork/post] "${title}" reward=${reward} NIGHT`);
    return json(res, 200, { ok: true, task });
  }

  // ── POST /api/nightwork/accept ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightwork/accept') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { taskId, worker } = body;
    if (!taskId || !worker) return json(res, 400, { error: 'taskId and worker required' });
    if (!_taskStore.has(taskId)) return json(res, 404, { error: 'task not found' });
    if (!_workerState.has(taskId)) _workerState.set(taskId, new Map());
    _workerState.get(taskId)!.set(worker, { state:'accepted', acceptedAt:Date.now() });
    return json(res, 200, { ok: true, taskId, state:'accepted' });
  }

  // ── POST /api/nightwork/submit ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/nightwork/submit') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { taskId, proof, worker } = body;
    if (!taskId || !proof) return json(res, 400, { error: 'taskId and proof required' });
    if (!_workerState.has(taskId)) _workerState.set(taskId, new Map());
    _workerState.get(taskId)!.set(worker ?? 'anon', { state:'submitted', proof, submittedAt:Date.now() });
    console.log(`\n  [nightwork/submit] task=${taskId} worker=${(worker ?? 'anon').slice(0,20)}…`);
    return json(res, 200, { ok: true, taskId, state:'submitted' });
  }

  // ── GET /api/nightwork/my-tasks/:address ──────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/nightwork/my-tasks/')) {
    const address = decodeURIComponent(url.replace('/api/nightwork/my-tasks/', ''));
    const myTasks: any[] = [];
    for (const [taskId, workers] of _workerState) {
      const wd = workers.get(address);
      if (wd) {
        const task = _taskStore.get(taskId);
        if (task) myTasks.push({ ...task, workerState: wd.state, proof: wd.proof });
      }
    }
    return json(res, 200, { tasks: myTasks });
  }

  // ── /api/nightsave/* ──────────────────────────────────────────────────────────
  if (url.startsWith('/api/nightsave/')) {
    let body: any = {};
    if (method === 'POST') { try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); } }
    const action = url.replace('/api/nightsave/', '').split('?')[0];
    const NIGHT_PRICE = 0.04;

    if (method === 'GET' && action.startsWith('state/')) {
      return json(res, 200, getVault(decodeURIComponent(action.replace('state/', ''))));
    }
    const { address, amount = 0 } = body;
    if (!address) return json(res, 400, { error: 'address required' });
    const v = getVault(address);
    if (action === 'deposit') {
      v.collateral += Number(amount);
      return json(res, 200, { ok: true, ...v });
    }
    if (action === 'mint') {
      const maxMint = v.collateral * NIGHT_PRICE * 0.80;
      if (Number(amount) > maxMint) return json(res, 400, { error: `max mint is ${maxMint.toFixed(2)} sUSD (80% LTV)` });
      v.debt += Number(amount);
      return json(res, 200, { ok: true, ...v });
    }
    if (action === 'repay') {
      v.debt = Math.max(0, v.debt - (Number(amount) || v.debt));
      return json(res, 200, { ok: true, ...v });
    }
    if (action === 'redeem') {
      if (v.debt > 0) return json(res, 400, { error: 'repay sUSD debt before redeeming collateral' });
      v.collateral = Math.max(0, v.collateral - (Number(amount) || v.collateral));
      return json(res, 200, { ok: true, ...v });
    }
    if (action === 'bnpl') {
      const months = Number(body.months ?? 4);
      const instalment = Number(body.totalAmount ?? amount) / months;
      v.bnpl.push({ totalAmount: Number(body.totalAmount ?? amount), months, instalment, paid: 0, createdAt: Date.now() });
      return json(res, 200, { ok: true, ...v });
    }
    return json(res, 404, { error: `Unknown nightsave action: ${action}` });
  }

  // ── /api/nightlend/* ──────────────────────────────────────────────────────────
  if (url.startsWith('/api/nightlend/')) {
    let body: any = {};
    if (method === 'POST') { try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); } }
    const action = url.replace('/api/nightlend/', '').split('?')[0];

    if (method === 'GET' && action === 'pools') {
      return json(res, 200, { pools: Object.entries(POOLS_APY).map(([asset, apy]) => ({ asset, apy, borrowRate: POOLS_BORROW[asset], tvl: POOLS_TVL[asset], price: POOL_PRICES[asset] })) });
    }
    if (method === 'GET' && action.startsWith('state/')) {
      const pos = getLendPos(decodeURIComponent(action.replace('state/', '')));
      const totalDepUSD = Object.entries(pos.deposits).reduce((s: number, [a, v]) => s + (v as number) * (POOL_PRICES[a] ?? 0), 0);
      const totalBorUSD = Object.entries(pos.borrows).reduce((s: number, [a, v]) => s + (v as number) * (POOL_PRICES[a] ?? 0), 0);
      return json(res, 200, { ...pos, totalDepUSD, totalBorUSD, healthFactor: totalBorUSD > 0 ? (totalDepUSD * 0.8) / totalBorUSD : null });
    }
    const { address, asset, amount } = body;
    if (!address) return json(res, 400, { error: 'address required' });
    const pos = getLendPos(address);
    if (action === 'deposit') {
      if (!asset || !amount) return json(res, 400, { error: 'asset and amount required' });
      pos.deposits[asset] = (pos.deposits[asset] ?? 0) + Number(amount);
      console.log(`\n  [nightlend/deposit] ${amount} ${asset} from ${address.slice(0,20)}…`);
      return json(res, 200, { ok: true, position: getLendPos(address) });
    }
    if (action === 'borrow') {
      if (!asset || !amount) return json(res, 400, { error: 'asset and amount required' });
      const totalDepUSD = Object.entries(pos.deposits).reduce((s: number, [a, v]) => s + (v as number) * (POOL_PRICES[a] ?? 0), 0);
      const totalBorUSD = Object.entries(pos.borrows).reduce((s: number, [a, v]) => s + (v as number) * (POOL_PRICES[a] ?? 0), 0);
      const usdVal = Number(amount) * (POOL_PRICES[asset] ?? 0);
      if (totalBorUSD + usdVal > totalDepUSD * 0.75) return json(res, 400, { error: `exceeds 75% LTV — max $${(totalDepUSD * 0.75 - totalBorUSD).toFixed(2)}` });
      pos.borrows[asset] = (pos.borrows[asset] ?? 0) + Number(amount);
      return json(res, 200, { ok: true, position: getLendPos(address) });
    }
    if (action === 'repay') {
      pos.borrows = { sUSD:0, NIGHT:0, tDUST:0 };
      return json(res, 200, { ok: true, position: getLendPos(address) });
    }
    if (action === 'withdraw') {
      if (!asset || !amount) return json(res, 400, { error: 'asset and amount required' });
      const totalBorUSD = Object.entries(pos.borrows).reduce((s: number, [a, v]) => s + (v as number) * (POOL_PRICES[a] ?? 0), 0);
      if (totalBorUSD > 0) return json(res, 400, { error: 'repay borrows before withdrawing' });
      pos.deposits[asset] = Math.max(0, (pos.deposits[asset] ?? 0) - Number(amount));
      return json(res, 200, { ok: true, position: getLendPos(address) });
    }
    return json(res, 404, { error: `Unknown nightlend action: ${action}` });
  }

  // ── /api/nightbiz/* ───────────────────────────────────────────────────────────
  if (url.startsWith('/api/nightbiz/')) {
    let body: any = {};
    if (method === 'POST') { try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); } }
    const action = url.replace('/api/nightbiz/', '').split('?')[0];

    if (action === 'deploy') {
      const { address, name, symbol, supply = '10,000,000', bronze = 100, silver = 500, gold = 2000, platinum = 10000, holderBps = 5000, licenseRequired = false } = body;
      if (!address || !name || !symbol) return json(res, 400, { error: 'address, name, symbol required' });
      const token = { address:`biz_${Date.now()}`, creator:address, name, symbol:symbol.toUpperCase(), supply, tiers:{bronze,silver,gold,platinum}, holderBps, licenseRequired, deployedAt:Date.now() };
      _bizStore.set(address, token);
      console.log(`\n  [nightbiz/deploy] ${name} $${symbol} by ${address.slice(0,20)}…`);
      return json(res, 200, { ok: true, token });
    }
    if (method === 'GET' && action.startsWith('state/')) {
      const addr = decodeURIComponent(action.replace('state/', ''));
      const token = _bizStore.get(addr);
      return json(res, token ? 200 : 404, token ?? { error: 'no token deployed for this address' });
    }
    if (action === 'tier') {
      const { address, balance } = body;
      const token = _bizStore.get(address) ?? { tiers:{ bronze:100, silver:500, gold:2000, platinum:10000 } };
      const bal = Number(balance ?? 0);
      const t = token.tiers;
      const tier = bal >= t.platinum ? 'Platinum' : bal >= t.gold ? 'Gold' : bal >= t.silver ? 'Silver' : bal >= t.bronze ? 'Bronze' : 'None';
      return json(res, 200, { tier, balance: bal, tiers: t });
    }
    return json(res, 404, { error: `Unknown nightbiz action: ${action}` });
  }

  json(res, 404, { error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌙 Night Markets API Server`);
  console.log(`   http://127.0.0.1:${PORT}/api/status`);
  console.log(`   Contract: ${CONTRACT_ADDRESS}`);
  console.log(`   Network:  Midnight preprod`);
  console.log(`   Poker WS: ws://127.0.0.1:${PORT}/ws/poker/:roomId\n`);
});

// ─── WebSocket — Night Poker rooms ────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/ws/poker/')) {
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const roomId = (req.url ?? '').replace('/ws/poker/', '').split('?')[0] || 'default';
  if (!_pokerRooms.has(roomId)) _pokerRooms.set(roomId, { players: new Set(), state: { phase:'waiting', players:[], pot:0, community:[] } });
  const room = _pokerRooms.get(roomId)!;
  room.players.add(ws);
  const seat = room.players.size - 1;
  console.log(`\n  [poker/${roomId}] player joined (seat ${seat}, ${room.players.size} total)`);

  const broadcast = (data: any, exclude?: any) => {
    const msg = JSON.stringify(data);
    for (const p of room.players) if (p !== exclude && p.readyState === 1) p.send(msg);
  };

  ws.send(JSON.stringify({ type:'room_state', roomId, seat, state: room.state, playerCount: room.players.size }));
  broadcast({ type:'player_joined', seat, playerCount: room.players.size }, ws);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'action') {
        broadcast({ type:'action', seat: msg.seat ?? seat, action: msg.action, amount: msg.amount }, ws);
      } else if (msg.type === 'state_update') {
        room.state = { ...room.state, ...msg.state };
        broadcast({ type:'state_update', state: room.state });
      } else if (msg.type === 'chat') {
        broadcast({ type:'chat', seat: msg.seat ?? seat, text: msg.text });
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    room.players.delete(ws);
    if (room.players.size === 0) { _pokerRooms.delete(roomId); return; }
    broadcast({ type:'player_left', seat, playerCount: room.players.size });
    console.log(`  [poker/${roomId}] player left (${room.players.size} remaining)`);
  });
});

await init();
