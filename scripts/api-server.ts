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
 *   POST /api/nightid/register                — register a .night name (Night-ID service)
 *   GET  /api/nightid/resolve/:name          — resolve name → address
 *   GET  /api/nightid/lookup/:addr           — reverse lookup address → name
 *   GET  /api/nightid/score/:chain/:addr     — multi-chain Night Score (eth|sol|ada|midnight|all)
 *   POST /api/nightid/record-action          — award Night Score points (called by Night apps)
 *   GET  /api/nightid/action-score/:address  — cumulative cross-app Night Score + threshold check
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
import * as crypto from 'node:crypto';
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
  walletCtx: Awaited<ReturnType<typeof buildWallet>> | null;
  address:  string;
  night:    bigint;
  dust:     bigint;
  error?:   string;
} = { ready: false, contract: null, walletCtx: null, address: '', night: 0n, dust: 0n };

// Send real NIGHT from the server custodial wallet to a recipient.
// This is how the escrow pays out: server holds NIGHT on behalf of users,
// state changes are ZK-authorised on-chain, payouts go here.
// Architecture note: this makes the escrow "server-assisted custodial" for Stage 1.
// Stage 6 will migrate to DApp-connector-signed atomic txs (trustless).
async function sendNight(recipientAddr: string, amountNight: bigint): Promise<string> {
  const ctx = appState.walletCtx;
  if (!ctx) throw new Error('Wallet not initialised');
  const nightColor = unshieldedToken().raw;
  const ttl = new Date(Date.now() + 30 * 60 * 1000);
  // wallet.transfer sends unshielded (public) NIGHT tokens to a recipient address.
  // The wallet-sdk-facade routes this through the unshielded sub-wallet's makeTransfer.
  const result = await (ctx.wallet as any).transfer(
    [{ value: amountNight, type: nightColor, owner: recipientAddr }],
    ttl,
  );
  const txId: string = result?.txId ?? result?.public?.txId ?? String(result);
  console.log(`  ✓ Sent ${amountNight} NIGHT → ${recipientAddr.slice(0, 20)}… txId=${txId}`);
  return txId;
}

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

    appState = { ready: true, contract, walletCtx: ctx, address: ctx.keystore.getBech32Address(), night, dust };
    console.log(`  Server NIGHT address (buyers send here): ${ctx.keystore.getBech32Address()}`);
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
const _shippingStore: Map<string, any>    = new Map(); // orderId → buyer shipping address
const _pfOrderStore:  Map<string, any>    = new Map(); // orderId → Printful order result
const _waitlistStore: Map<string, any>    = new Map(); // email:listingId → entry
const _mockupStatus:  Map<string, string> = new Map(); // listingId → 'pending'|'ok'|'error'
const _curveStore:    Map<string, any>    = new Map(); // tokenAddress → curve state

// ─── Printful integration ─────────────────────────────────────────────────────
const PF_TOKEN = process.env.PRINTFUL_API_TOKEN ?? '';

// Base product catalog — sellers drop their design onto these blanks
const PF_CATALOG = [
  { id: 'tshirt',  pfId: 71,  name: 'Unisex T-Shirt',     brand: 'Bella+Canvas 3001', baseCostUSD: 12, emoji: '👕', colors: ['Black','White','Navy','Red','Forest Green'], sizes: ['XS','S','M','L','XL','2XL'] },
  { id: 'hoodie',  pfId: 380, name: 'Unisex Hoodie',       brand: 'Gildan 18500',      baseCostUSD: 18, emoji: '🧥', colors: ['Black','White','Navy','Dark Heather'],       sizes: ['XS','S','M','L','XL','2XL'] },
  { id: 'mug',     pfId: 19,  name: 'White Glossy Mug',    brand: '11oz Ceramic',      baseCostUSD: 8,  emoji: '☕', colors: ['White'],                                     sizes: ['11oz','15oz'] },
  { id: 'tote',    pfId: 2,   name: 'Canvas Tote Bag',     brand: 'Natural Canvas',    baseCostUSD: 9,  emoji: '🛍️', colors: ['Natural','Black'],                           sizes: ['One Size'] },
  { id: 'cap',     pfId: 74,  name: 'Structured Dad Cap',  brand: 'Classic Cap',       baseCostUSD: 10, emoji: '🧢', colors: ['Black','White','Navy'],                      sizes: ['One Size'] },
  { id: 'poster',  pfId: 1,   name: 'Poster',              brand: 'Matte Print',       baseCostUSD: 7,  emoji: '🖼️', colors: ['White'],                                    sizes: ['12×18"','18×24"','24×36"'] },
];
const NIGHT_USD = 0.04; // 1 NIGHT = $0.04

async function pfCall(path: string, opts: RequestInit = {}): Promise<any> {
  if (!PF_TOKEN) throw new Error('PRINTFUL_API_TOKEN not configured — add it to .env');
  const r = await fetch('https://api.printful.com' + path, {
    ...opts,
    headers: { 'Authorization': `Bearer ${PF_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const d = await r.json() as any;
  if (!r.ok) throw new Error(d?.error?.message ?? `Printful ${r.status}`);
  return d.result ?? d;
}

// Cache of pfId → { color → { size → variantId } }
const _pfVariantCache = new Map<number, Record<string, Record<string, number>>>();

async function pfGetVariantId(pfId: number, color: string, size: string): Promise<number> {
  if (!_pfVariantCache.has(pfId)) {
    const data = await pfCall(`/catalog/products/${pfId}`);
    const variants: any[] = data.variants ?? [];
    const map: Record<string, Record<string, number>> = {};
    for (const v of variants) {
      const c = v.color ?? 'Default';
      if (!map[c]) map[c] = {};
      map[c][v.size ?? 'One Size'] = v.id;
    }
    _pfVariantCache.set(pfId, map);
  }
  const byColor = _pfVariantCache.get(pfId)!;
  // fuzzy color match
  const colorKey = Object.keys(byColor).find(k => k.toLowerCase().includes(color.toLowerCase())) ?? Object.keys(byColor)[0];
  const bySizeMap = byColor[colorKey] ?? {};
  return bySizeMap[size] ?? Object.values(bySizeMap)[0];
}

async function pfPlaceOrder(listing: any, shipping: any, size: string): Promise<any> {
  const cat = PF_CATALOG.find(p => p.id === listing.printfulProductType);
  if (!cat) throw new Error(`Unknown product type: ${listing.printfulProductType}`);
  const variantId = await pfGetVariantId(cat.pfId, listing.printfulColor ?? cat.colors[0], size || cat.sizes[0]);
  if (!variantId) throw new Error('Could not find Printful variant for this size/color');
  return pfCall('/orders', {
    method: 'POST',
    body: JSON.stringify({
      recipient: {
        name:         shipping.name,
        address1:     shipping.address1,
        address2:     shipping.address2 ?? '',
        city:         shipping.city ?? '',
        state_code:   shipping.stateCode ?? '',
        country_code: shipping.countryCode,
        zip:          shipping.zip ?? '',
        email:        shipping.email ?? '',
      },
      items: [{
        variant_id: variantId,
        quantity:   1,
        files: [{ type: 'front', url: listing.designUrl }],
      }],
    }),
  });
}
// ─── Shopify integration ──────────────────────────────────────────────────────
async function shopifyCall(shop: string, token: string, path: string, opts: RequestInit = {}): Promise<any> {
  const base = shop.startsWith('http') ? shop.replace(/\/$/, '') : `https://${shop.replace(/\/$/, '')}`;
  const r = await fetch(`${base}/admin/api/2024-01${path}`, {
    ...opts,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const d = await r.json() as any;
  if (!r.ok) throw new Error(typeof d?.errors === 'string' ? d.errors : JSON.stringify(d?.errors) ?? `Shopify ${r.status}`);
  return d;
}

async function shopifyCreateOrder(listing: any, shipping: any): Promise<any> {
  const { shopifyShop, shopifyToken, shopifyVariantId, title, id } = listing;
  if (!shopifyShop || !shopifyToken) throw new Error('Listing missing Shopify credentials');
  const nameParts = (shipping.name ?? '').split(' ');
  return shopifyCall(shopifyShop, shopifyToken, '/orders.json', {
    method: 'POST',
    body: JSON.stringify({
      order: {
        line_items: [{ variant_id: shopifyVariantId ? Number(shopifyVariantId) : undefined, quantity: 1, title }],
        shipping_address: {
          first_name: nameParts[0] ?? '',
          last_name:  (nameParts.slice(1).join(' ') || nameParts[0]) ?? '',
          address1:   shipping.address1 ?? '',
          address2:   shipping.address2 ?? '',
          city:       shipping.city ?? '',
          province:   shipping.stateCode ?? '',
          country:    shipping.countryCode ?? '',
          zip:        shipping.zip ?? '',
        },
        email:            shipping.email ?? '',
        financial_status: 'paid',
        tags:             'night-markets',
        note:             `Night Markets ZK escrow — Order ID: ${id}`,
      },
    }),
  });
}

// ─── Printful mockup generator ────────────────────────────────────────────────
const _mockupCache = new Map<string, string>(); // `${pfId}:${color}:${designUrl}` → mockupUrl

async function pfCreateMockup(pfId: number, color: string, designUrl: string, size: string): Promise<string> {
  const cacheKey = `${pfId}:${color}:${designUrl}`;
  if (_mockupCache.has(cacheKey)) return _mockupCache.get(cacheKey)!;
  const variantId = await pfGetVariantId(pfId, color, size);
  if (!variantId) throw new Error('Could not resolve variant for mockup');
  const task = await pfCall(`/mockup-generator/create-task/${pfId}`, {
    method: 'POST',
    body: JSON.stringify({
      variant_ids: [variantId],
      format: 'jpg',
      files: [{ placement: 'front', image_url: designUrl }],
    }),
  });
  const taskKey = task.task_key;
  if (!taskKey) throw new Error('Printful mockup task returned no task_key');
  // Poll up to 30 s (6 × 5 s)
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 5_000));
    const result = await pfCall(`/mockup-generator/task?task_key=${taskKey}`);
    if (result.status === 'completed') {
      const url: string = result.mockups?.[0]?.mockup_url ?? result.mockups?.[0]?.url ?? '';
      if (url) { _mockupCache.set(cacheKey, url); return url; }
    }
    if (result.status === 'error') throw new Error(`Printful mockup failed: ${result.error ?? 'unknown'}`);
  }
  throw new Error('Printful mockup timed out — retry in a moment');
}

// ─── Printful mockup warmup ───────────────────────────────────────────────────
async function warmMerchMockups(designUrl?: string): Promise<void> {
  const url = designUrl ?? NM_DESIGN_URL;
  if (!url) {
    console.log('  ℹ️  NM_DESIGN_URL not set — skipping mockup warmup (add to .env to enable)');
    return;
  }
  if (!PF_TOKEN) {
    console.log('  ℹ️  PRINTFUL_API_TOKEN not set — skipping mockup warmup');
    return;
  }
  const officials = [..._listingStore.entries()].filter(([, l]) => l.isNMOfficial);
  if (!officials.length) return;
  console.log(`  🖼️  Auto-generating Printful mockups for ${officials.length} NM merch items…`);
  for (const [id, listing] of officials) {
    if (listing.imageUrl) { _mockupStatus.set(id, 'ok'); continue; }
    _mockupStatus.set(id, 'pending');
    const cat = PF_CATALOG.find(p => p.id === listing.printfulProductType);
    if (!cat) { _mockupStatus.set(id, 'error'); continue; }
    const size = cat.sizes[Math.floor(cat.sizes.length / 2)] ?? cat.sizes[0];
    // Stagger requests 4 s apart to respect Printful rate limits
    await new Promise(r => setTimeout(r, 4_000));
    pfCreateMockup(cat.pfId, cat.colors[0], url, size)
      .then(mockupUrl => {
        const l = _listingStore.get(id);
        if (l) { l.imageUrl = mockupUrl; l.mockupUrl = mockupUrl; _listingStore.set(id, l); }
        _mockupStatus.set(id, 'ok');
        console.log(`  ✓ Mockup ready: ${listing.title}`);
      })
      .catch(e => {
        _mockupStatus.set(id, 'error');
        console.warn(`  ⚠️  Mockup failed: ${listing.title}: ${e.message}`);
      });
  }
}

const _nightIdStore:  Map<string, string> = new Map(); // "name.night" → address
const _nightScoreStore: Map<string, number> = new Map(); // address → cumulative action score
const _scoreEventLog:   any[]              = [];         // full event history

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

// ─── Night Markets official merch (pre-seeded Printful listings) ─────────────
const NM_DESIGN_URL = process.env.NM_DESIGN_URL ?? '';
[
  { id:'nm-merch-tee',    type:'tshirt',  name:'Night Markets Tee',     emoji:'👕', price:750,  cat:'clothing'     },
  { id:'nm-merch-hoodie', type:'hoodie',  name:'Night Markets Hoodie',  emoji:'🧥', price:1250, cat:'clothing'     },
  { id:'nm-merch-mug',    type:'mug',     name:'Night Markets Mug',     emoji:'☕', price:375,  cat:'accessories'  },
  { id:'nm-merch-tote',   type:'tote',    name:'Night Markets Tote',    emoji:'🛍️', price:450, cat:'accessories'  },
  { id:'nm-merch-cap',    type:'cap',     name:'Night Markets Cap',     emoji:'🧢', price:500,  cat:'clothing'     },
  { id:'nm-merch-poster', type:'poster',  name:'Night Markets Poster',  emoji:'🖼️', price:375, cat:'home'         },
].forEach(m => {
  if (_listingStore.has(m.id)) return;
  const cat = PF_CATALOG.find(p => p.id === m.type)!;
  _listingStore.set(m.id, {
    id: m.id, title: m.name, cat: m.cat, price: m.price,
    desc: `Official Night Markets branded ${m.name.replace('Night Markets ', '')}. ZK-verified purchase, printed & shipped by Printful.`,
    emoji: m.emoji, sellerId: 'nightmarkets.io',
    type: 'printful', printfulProductType: m.type,
    designUrl: NM_DESIGN_URL || null,
    printfulColor: cat?.colors[0] ?? 'Black',
    sizes: cat?.sizes ?? ['M'],
    state: 'OPEN', isNMOfficial: true, createdAt: Date.now(),
  });
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

// ─── Poker Engine ─────────────────────────────────────────────────────────────
interface PokerSeat {
  ws: any; name: string; seatIdx: number;
  stack: number; bet: number; cards: number[];
  folded: boolean; allIn: boolean;
}
interface GameRoom {
  id: string; name: string; buyin: number; sb: number;
  maxPlayers: number; createdAt: number;
  seats: PokerSeat[]; nextSeat: number;
  deck: number[]; deckPtr: number;
  community: number[];
  pot: number; toCall: number; minRaise: number;
  phase: string;
  dealerSeat: number; actionSeat: number;
  needToAct: Set<number>; // seatIdx values
  handNum: number;
}
const _gameRooms: Map<string, GameRoom> = new Map();

function pShuffle(): number[] {
  const d = Array.from({length:52},(_,i)=>i);
  for(let i=51;i>0;i--){const j=0|Math.random()*(i+1);[d[i],d[j]]=[d[j],d[i]];}
  return d;
}
const P_RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const P_SUITS=['c','d','h','s'];
const cStr=(c:number)=>P_RANKS[c%13]+P_SUITS[0|c/13];

function pEval5(h:number[]):number {
  const R=h.map(c=>c%13).sort((a,b)=>b-a), S=h.map(c=>0|c/13);
  const cnt=new Map<number,number>(); for(const r of R) cnt.set(r,(cnt.get(r)??0)+1);
  const g=[...cnt.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const fl=S.every(s=>s===S[0]);
  let st=false,sh=R[0];
  if(cnt.size===5&&R[0]-R[4]===4) st=true;
  else if(R[0]===12&&R[1]===3&&R[2]===2&&R[3]===1&&R[4]===0){st=true;sh=3;}
  const B=15, sc=(cat:number,...tb:number[])=>tb.reduce((s,v,i)=>s+v*B**(4-i),cat*B**5);
  if(st&&fl) return sc(8,sh);
  if(g[0][1]===4) return sc(7,g[0][0],g[1][0]);
  if(g[0][1]===3&&g[1]&&g[1][1]===2) return sc(6,g[0][0],g[1][0]);
  if(fl) return sc(5,...R);
  if(st) return sc(4,sh);
  if(g[0][1]===3) return sc(3,g[0][0],g[1]?.[0]??0,g[2]?.[0]??0);
  if(g[0][1]===2&&g[1]&&g[1][1]===2) return sc(2,g[0][0],g[1][0],g[2]?.[0]??0);
  if(g[0][1]===2) return sc(1,g[0][0],g[1]?.[0]??0,g[2]?.[0]??0,g[3]?.[0]??0);
  return sc(0,...R);
}
function pBest7(c:number[]):number {
  let b=-1;
  for(let i=0;i<7;i++) for(let j=i+1;j<7;j++) b=Math.max(b,pEval5(c.filter((_,k)=>k!==i&&k!==j)));
  return b;
}
const P_HAND_NAMES=['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
const pHandName=(sc:number)=>P_HAND_NAMES[0|sc/15**5]??'Unknown';

// Next non-folded seat after fromSeat (wraps); fi=-1 safe
function pNextS(room:GameRoom,fromSeat:number):number {
  const n=room.seats.length; if(n===0) return fromSeat;
  const fi=room.seats.findIndex(s=>s.seatIdx===fromSeat);
  const start=fi<0?-1:fi;
  for(let i=1;i<n;i++){
    const s=room.seats[(start+i+n)%n];
    if(!s.folded) return s.seatIdx;
  }
  return fromSeat;
}
function pBy(room:GameRoom,si:number):PokerSeat|undefined { return room.seats.find(s=>s.seatIdx===si); }
function pSend(s:PokerSeat,d:any){ if(s.ws.readyState===1) s.ws.send(JSON.stringify(d)); }
function pBcast(room:GameRoom,d:any,skip?:any){
  const m=JSON.stringify(d);
  for(const s of room.seats) if(s.ws!==skip&&s.ws.readyState===1) s.ws.send(m);
}
function pPub(room:GameRoom){
  return {
    phase:room.phase, pot:room.pot, community:room.community.map(cStr),
    toCall:room.toCall, minRaise:room.minRaise, dealerSeat:room.dealerSeat,
    actionSeat:['waiting','showdown','finished'].includes(room.phase)?-1:room.actionSeat,
    seats:room.seats.map(s=>({
      seatIdx:s.seatIdx, name:s.name, stack:s.stack, bet:s.bet,
      folded:s.folded, allIn:s.allIn,
      hasCards:!s.folded&&!['waiting','finished'].includes(room.phase),
    })),
  };
}

function pStartHand(room:GameRoom){
  const elig=room.seats.filter(s=>s.stack>0&&s.ws.readyState===1);
  if(elig.length<2){ pBcast(room,{type:'error',msg:'Need 2+ players with chips'}); return; }
  room.handNum++; room.deck=pShuffle(); room.deckPtr=0; room.community=[]; room.pot=0;
  for(const s of room.seats){ s.bet=0; s.cards=[]; s.folded=s.stack<=0||s.ws.readyState!==1; s.allIn=false; }
  // Rotate dealer past broke/disconnected
  let tries=0, dn=room.dealerSeat;
  do {
    const ci=room.seats.findIndex(s=>s.seatIdx===dn);
    dn=room.seats[(ci+1)%room.seats.length].seatIdx; tries++;
  } while(pBy(room,dn)?.folded&&tries<room.seats.length);
  room.dealerSeat=dn;
  // Deal 2 cards
  for(const s of room.seats) if(!s.folded) s.cards=[room.deck[room.deckPtr++],room.deck[room.deckPtr++]];
  // Blinds
  const actN=room.seats.filter(s=>!s.folded).length;
  const sb=room.sb, bb=sb*2;
  let sbSeat:number, bbSeat:number, firstSeat:number;
  if(actN===2){ sbSeat=room.dealerSeat; bbSeat=pNextS(room,sbSeat); firstSeat=sbSeat; }
  else { sbSeat=pNextS(room,room.dealerSeat); bbSeat=pNextS(room,sbSeat); firstSeat=pNextS(room,bbSeat); }
  const sbP=pBy(room,sbSeat)!, bbP=pBy(room,bbSeat)!;
  const sbA=Math.min(sb,sbP.stack); sbP.stack-=sbA; sbP.bet=sbA; sbP.allIn=sbP.stack===0; room.pot+=sbA;
  const bbA=Math.min(bb,bbP.stack); bbP.stack-=bbA; bbP.bet=bbA; bbP.allIn=bbP.stack===0; room.pot+=bbA;
  room.toCall=bb; room.minRaise=bb; room.actionSeat=firstSeat; room.phase='preflop';
  room.needToAct=new Set(room.seats.filter(s=>!s.folded&&!s.allIn).map(s=>s.seatIdx));
  for(const s of room.seats) if(!s.folded) pSend(s,{type:'your_cards',cards:s.cards.map(cStr),handNum:room.handNum});
  pBcast(room,{type:'hand_start',state:pPub(room),handNum:room.handNum,sbSeat,bbSeat});
  const actor=pBy(room,room.actionSeat);
  if(actor) pSend(actor,{type:'you_act',toCall:room.toCall-actor.bet,minRaise:room.minRaise,pot:room.pot,actorSeat:room.actionSeat});
  console.log(`  [poker/${room.id}] hand #${room.handNum} (${actN}p) dealer=${room.dealerSeat}`);
}

function pDoAction(room:GameRoom,ws:any,action:string,amount:number){
  const actor=room.seats.find(s=>s.ws===ws);
  if(!actor||actor.seatIdx!==room.actionSeat) return;
  const si=actor.seatIdx, callAmt=room.toCall-actor.bet;
  if(action==='fold'){
    actor.folded=true; room.needToAct.delete(si);
    const rem=room.seats.filter(s=>!s.folded);
    if(rem.length===1){
      rem[0].stack+=room.pot; room.pot=0;
      pBcast(room,{type:'action_result',actorSeat:si,action:'fold',amount:0,pot:0,state:pPub(room)});
      setTimeout(()=>pEndHand(room,rem,'fold'),300); return;
    }
  } else if(action==='check'){
    if(callAmt>0){ pSend(actor,{type:'error',msg:'Cannot check — call '+callAmt+' or fold'}); return; }
    room.needToAct.delete(si);
  } else if(action==='call'){
    const put=Math.min(callAmt,actor.stack); actor.stack-=put; actor.bet+=put; room.pot+=put;
    if(actor.stack===0) actor.allIn=true; room.needToAct.delete(si);
  } else if(action==='raise'){
    const rTo=Math.max(amount,room.toCall+room.minRaise);
    const put=Math.min(rTo-actor.bet,actor.stack); actor.stack-=put; actor.bet+=put; room.pot+=put;
    if(actor.stack===0) actor.allIn=true;
    room.minRaise=actor.bet-room.toCall; room.toCall=actor.bet;
    room.needToAct=new Set(room.seats.filter(s=>!s.folded&&!s.allIn&&s.seatIdx!==si).map(s=>s.seatIdx));
  } else return;
  pBcast(room,{type:'action_result',actorSeat:si,action,amount,pot:room.pot,state:pPub(room)});
  if(room.needToAct.size===0){ setTimeout(()=>pAdvPhase(room),600); return; }
  const cur=room.seats.findIndex(s=>s.seatIdx===si);
  let next=actor;
  for(let i=1;i<room.seats.length;i++){
    const nx=room.seats[(cur+i)%room.seats.length];
    if(room.needToAct.has(nx.seatIdx)){ next=nx; break; }
  }
  room.actionSeat=next.seatIdx;
  pSend(next,{type:'you_act',toCall:room.toCall-next.bet,minRaise:room.minRaise,pot:room.pot,actorSeat:next.seatIdx});
}

function pAdvPhase(room:GameRoom){
  for(const s of room.seats) s.bet=0;
  room.toCall=0; room.minRaise=room.sb*2;
  const active=room.seats.filter(s=>!s.folded);
  if(active.length<=1){ pShowdown(room); return; }
  if(room.phase==='preflop'){
    room.community.push(room.deck[room.deckPtr++],room.deck[room.deckPtr++],room.deck[room.deckPtr++]);
    room.phase='flop';
  } else if(room.phase==='flop'){
    room.community.push(room.deck[room.deckPtr++]); room.phase='turn';
  } else if(room.phase==='turn'){
    room.community.push(room.deck[room.deckPtr++]); room.phase='river';
  } else { pShowdown(room); return; }
  pBcast(room,{type:'phase_change',phase:room.phase,community:room.community.map(cStr),state:pPub(room)});
  const canAct=active.filter(s=>!s.allIn);
  if(canAct.length<2){ setTimeout(()=>pAdvPhase(room),1500); return; }
  const firstSeat=pNextS(room,room.dealerSeat);
  room.actionSeat=firstSeat; room.needToAct=new Set(canAct.map(s=>s.seatIdx));
  const actor=pBy(room,firstSeat);
  if(actor) pSend(actor,{type:'you_act',toCall:0,minRaise:room.minRaise,pot:room.pot,actorSeat:firstSeat});
}

function pShowdown(room:GameRoom){
  room.phase='showdown';
  const active=room.seats.filter(s=>!s.folded);
  if(active.length===1){ active[0].stack+=room.pot; room.pot=0; setTimeout(()=>pEndHand(room,active,'uncontested'),300); return; }
  const scored=active.map(s=>({s,sc:pBest7([...s.cards,...room.community])})).sort((a,b)=>b.sc-a.sc);
  const best=scored[0].sc; const winners=scored.filter(x=>x.sc===best);
  const split=Math.floor(room.pot/winners.length); for(const w of winners) w.s.stack+=split;
  pBcast(room,{
    type:'showdown',
    results:scored.map(x=>({
      seatIdx:x.s.seatIdx, name:x.s.name, cards:x.s.cards.map(cStr),
      handName:pHandName(x.sc), won:winners.some(w=>w.s===x.s),
      amount:winners.some(w=>w.s===x.s)?split:0,
    })),
    pot:room.pot, community:room.community.map(cStr), state:pPub(room),
  });
  room.pot=0; setTimeout(()=>pEndHand(room,winners.map(w=>w.s),'showdown'),3000);
}

function pEndHand(room:GameRoom,winners:PokerSeat[],reason:string){
  room.phase='finished';
  pBcast(room,{type:'hand_over',winners:winners.map(w=>({seatIdx:w.seatIdx,name:w.name,stack:w.stack})),reason,state:pPub(room)});
  console.log(`  [poker/${room.id}] hand #${room.handNum} → ${winners.map(w=>w.name).join(',')} (${reason})`);
}

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

    // Support both URL-based routing (/api/escrow/fund) and body-based (/api/escrow/action + body.action)
    const routeAction = url.replace('/api/escrow/', '');
    const action = routeAction === 'action' ? (body?.action ?? '') : routeAction;

    try {
      // Returns the server's custodial NIGHT address — buyers send NIGHT here before funding.
      if (action === 'wallet-address') {
        return json(res, 200, { address: appState.address, note: 'Send NIGHT here before calling /api/escrow/fund' });
      }

      if (action === 'create') {
        const { orderId, amountNight, sellerNightAddr } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        if (!sellerNightAddr) return json(res, 400, { error: 'sellerNightAddr required — seller NIGHT address for payout' });
        const oidBytes  = toBytes32(String(orderId));
        const amt       = BigInt(amountNight ?? 1_000_000);
        const addrBytes = toBytes32(String(sellerNightAddr));
        console.log(`\n  [create] orderId="${orderId}" amount=${amt} seller=${sellerNightAddr.slice(0,20)}…`);
        const r = await appState.contract.callTx.createListing(oidBytes, amt, addrBytes);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId, amountNight: amt.toString() });
      }

      if (action === 'fund') {
        const { orderId, amountNight, buyerNightAddr } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        if (!buyerNightAddr) return json(res, 400, { error: 'buyerNightAddr required — buyer NIGHT address for refunds' });
        const oidBytes  = toBytes32(String(orderId));
        const amt       = BigInt(amountNight ?? 1_000_000);
        const addrBytes = toBytes32(String(buyerNightAddr));
        console.log(`\n  [fund] orderId="${orderId}" amount=${amt} buyer=${buyerNightAddr.slice(0,20)}…`);
        // NIGHT custody: buyer must have already sent NIGHT to appState.address before calling this.
        // The contract records the ZK authorization; the server holds the funds.
        const r = await appState.contract.callTx.fundEscrow(oidBytes, amt, addrBytes);
        // Track funding time for the 14-day expiry window
        const fundListing = _listingStore.get(String(orderId));
        if (fundListing) {
          fundListing.state = 'FUNDED';
          fundListing.fundedAt = Date.now();
          _listingStore.set(String(orderId), fundListing);
        }
        return json(res, 200, {
          txId: r.public.txId, blockHeight: r.public.blockHeight, orderId,
          note: 'Escrow funded on-chain. NIGHT should have been sent to server wallet before this call.',
        });
      }

      if (action === 'release') {
        const { orderId } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const oidBytes = toBytes32(String(orderId));
        console.log(`\n  [release] orderId="${orderId}"`);

        // Contract returns the seller's NIGHT address from its ledger state
        const r = await appState.contract.callTx.releaseEscrow(oidBytes);
        const sellerNightAddr: string = r.public.result ?? '';
        const listing = _listingStore.get(String(orderId));
        const amt = listing?.price ? BigInt(Math.round(Number(listing.price) * 1_000_000)) : 1_000_000n;

        // Send real NIGHT to seller — fire-and-forget so state change is already committed
        if (sellerNightAddr) {
          sendNight(sellerNightAddr, amt).catch(err =>
            console.error(`  ⚠ sendNight failed for ${orderId}:`, err.message ?? err)
          );
        } else {
          console.warn(`  ⚠ [release] no seller NIGHT address on contract for orderId=${orderId}`);
        }

        // Mark listing as released, handle delivery type
        let deliveryUrl: string | null = null;
        let shippingAddress: any = null;
        if (listing) {
          listing.state = 'RELEASED';
          _listingStore.set(String(orderId), listing);

          if (listing.type === 'digital' && listing.deliveryUrl) {
            // Digital: reveal the download URL to the buyer
            deliveryUrl = listing.deliveryUrl;
            console.log(`  📦 [release] digital delivery unlocked for orderId=${orderId}`);
          } else if (listing.type === 'printful') {
            // Printful: auto-place order via API using buyer's shipping address
            shippingAddress = _shippingStore.get(String(orderId)) ?? null;
            if (shippingAddress && listing.designUrl) {
              try {
                const pfOrder = await pfPlaceOrder(listing, shippingAddress, shippingAddress.size ?? listing.sizes?.[0] ?? 'M');
                _pfOrderStore.set(String(orderId), pfOrder);
                console.log(`  🖨️  [release] Printful order #${pfOrder.id} placed — ${shippingAddress.name}, ${shippingAddress.countryCode}`);
              } catch (pfErr: any) {
                console.error(`  ⚠ [release] Printful order failed for ${orderId}:`, pfErr.message ?? pfErr);
              }
            } else if (!shippingAddress) {
              console.warn(`  ⚠ [release] no shipping address on file for orderId=${orderId}`);
            } else {
              console.warn(`  ⚠ [release] no design URL on listing for orderId=${orderId}`);
            }
          } else if (listing.type === 'shopify') {
            // Shopify: create a paid order in the seller's store using buyer's shipping address
            shippingAddress = _shippingStore.get(String(orderId)) ?? null;
            if (shippingAddress && listing.shopifyShop && listing.shopifyToken) {
              try {
                const shOrder = await shopifyCreateOrder(listing, shippingAddress);
                console.log(`  🛍️  [release] Shopify order #${shOrder?.order?.id} created — ${shippingAddress.name}, ${shippingAddress.countryCode}`);
              } catch (shErr: any) {
                console.error(`  ⚠ [release] Shopify order failed for ${orderId}:`, shErr.message ?? shErr);
              }
            } else if (!shippingAddress) {
              console.warn(`  ⚠ [release] no shipping address on file for orderId=${orderId}`);
            }
          } else if (listing.type === 'physical') {
            shippingAddress = _shippingStore.get(String(orderId)) ?? null;
            if (shippingAddress) {
              console.log(`  📦 [release] shipping address available for manual fulfilment — ${shippingAddress.name}, ${shippingAddress.countryCode}`);
            }
          }
        }

        // Award Night Score to seller
        const seller = listing?.sellerId;
        if (seller) {
          const prev = _nightScoreStore.get(seller) ?? 0;
          _nightScoreStore.set(seller, prev + 50);
          _scoreEventLog.push({ address: seller, appId: 'night-markets', points: 50, eventType: 4, ts: Date.now(), orderId });
          console.log(`  ✓ Night Score +50 → ${seller.slice(0, 16)}… (total: ${prev + 50})`);
        }

        return json(res, 200, {
          txId: r.public.txId, blockHeight: r.public.blockHeight, orderId,
          nightSentTo: sellerNightAddr || null,
          // Delivery payload — only present when relevant
          ...(deliveryUrl    ? { deliveryUrl }                               : {}),
          ...(shippingAddress ? { shippingAddress }                           : {}),
          ...(_pfOrderStore.has(String(orderId)) ? { printfulOrder: { id: _pfOrderStore.get(String(orderId))?.id, status: _pfOrderStore.get(String(orderId))?.status } } : {}),
        });
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
        console.log(`\n  [refund] orderId="${orderId}"`);

        // Contract returns the buyer's NIGHT address from its ledger state
        const r = await appState.contract.callTx.refundEscrow(oidBytes);
        const buyerNightAddr: string = r.public.result ?? '';
        const listing = _listingStore.get(String(orderId));
        const amt = listing?.price ? BigInt(Math.round(Number(listing.price) * 1_000_000)) : 1_000_000n;

        if (buyerNightAddr) {
          sendNight(buyerNightAddr, amt).catch(err =>
            console.error(`  ⚠ sendNight failed for ${orderId}:`, err.message ?? err)
          );
        } else {
          console.warn(`  ⚠ [refund] no buyer NIGHT address on contract for orderId=${orderId}`);
        }

        return json(res, 200, {
          txId: r.public.txId, blockHeight: r.public.blockHeight, orderId,
          nightSentTo: buyerNightAddr || null,
        });
      }

      if (action === 'expire') {
        // Seller claims payment after 14-day deadline — buyer failed to release or dispute
        const { orderId } = body;
        if (!orderId) return json(res, 400, { error: 'orderId required' });
        const expListing = _listingStore.get(String(orderId));
        if (!expListing) return json(res, 404, { error: 'Listing not found' });
        if (expListing.state !== 'FUNDED') return json(res, 400, { error: 'Escrow is not in FUNDED state' });
        const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
        const fundedAt = expListing.fundedAt ?? 0;
        if (Date.now() - fundedAt < FOURTEEN_DAYS) {
          const daysLeft = ((FOURTEEN_DAYS - (Date.now() - fundedAt)) / 86_400_000).toFixed(1);
          return json(res, 400, { error: `Deadline not reached — ${daysLeft} days remaining` });
        }
        const oidBytes = toBytes32(String(orderId));
        console.log(`\n  [expire] orderId="${orderId}" — deadline passed, releasing to seller`);
        const r = await appState.contract.callTx.expireEscrow(oidBytes);
        const sellerNightAddr: string = r.public.result ?? '';
        const amt = expListing?.price ? BigInt(Math.round(Number(expListing.price) * 1_000_000)) : 1_000_000n;
        if (sellerNightAddr) {
          sendNight(sellerNightAddr, amt).catch(err =>
            console.error(`  ⚠ sendNight (expire) failed for ${orderId}:`, err.message ?? err)
          );
        }
        expListing.state = 'RELEASED';
        _listingStore.set(String(orderId), expListing);
        return json(res, 200, { txId: r.public.txId, blockHeight: r.public.blockHeight, orderId, nightSentTo: sellerNightAddr || null });
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
    const { id, title, cat, price, cond, desc, from: shipFrom, emoji, sellerId,
            type, imageUrl, deliveryUrl, printfulProductType, designUrl, printfulColor, sizes, sellerEmail,
            shopifyShop, shopifyToken, shopifyProductId, shopifyVariantId, shopifyVariantTitle } = body;
    if (!id || !title || !price) return json(res, 400, { error: 'id, title, price required' });
    const listing = {
      id, title, cat, price, cond, desc, shipFrom, emoji, sellerId,
      type: type || 'physical',   // 'digital' | 'printful' | 'physical' | 'shopify'
      imageUrl: imageUrl || null,
      deliveryUrl: deliveryUrl || null,       // secret — never returned to buyers
      printfulProductType: printfulProductType || null,
      designUrl: designUrl || null,
      printfulColor: printfulColor || null,
      sizes: sizes || null,
      sellerEmail: sellerEmail || null,
      // Shopify — token is secret (same treatment as deliveryUrl)
      shopifyShop: shopifyShop || null,
      shopifyToken: shopifyToken || null,     // never returned to buyers
      shopifyProductId: shopifyProductId || null,
      shopifyVariantId: shopifyVariantId || null,
      shopifyVariantTitle: shopifyVariantTitle || null,
      state: 'OPEN',
      createdAt: Date.now(),
    };
    _listingStore.set(id, listing);
    const { deliveryUrl: _d, shopifyToken: _t, ...pub } = listing;
    return json(res, 200, { ok: true, listing: pub });
  }

  // ── GET /api/listings ──────────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/api/listings' || url.startsWith('/api/listings?'))) {
    const params = new URL('http://x' + url).searchParams;
    const typeFilter = params.get('type');
    let listings = [..._listingStore.values()].map(({ deliveryUrl: _, shopifyToken: __, ...pub }) => pub);
    if (typeFilter === 'merch')    listings = listings.filter(l => l.isNMOfficial);
    else if (typeFilter)           listings = listings.filter(l => l.type === typeFilter);
    return json(res, 200, { listings });
  }

  // ── GET /api/listings/:id ──────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/listings/') && url.split('/').length === 4) {
    const id = url.split('/')[3];
    const listing = _listingStore.get(id);
    if (!listing) return json(res, 404, { error: 'Listing not found' });
    const { deliveryUrl: _, shopifyToken: __, ...pub } = listing;
    return json(res, 200, { listing: pub });
  }

  // ── POST /api/listings/shipping ───────────────────────────────────────────────
  // Buyer submits shipping address after funding escrow for a physical/Printful listing.
  if (method === 'POST' && url === '/api/listings/shipping') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { orderId, name, address1, address2, city, stateCode, countryCode, zip, email } = body;
    if (!orderId || !name || !address1 || !countryCode) return json(res, 400, { error: 'orderId, name, address1, countryCode required' });
    _shippingStore.set(String(orderId), { name, address1, address2: address2 || '', city: city || '', stateCode: stateCode || '', countryCode, zip: zip || '', email: email || '', at: Date.now() });
    console.log(`  [shipping] orderId=${orderId} → ${name}, ${city}, ${countryCode}`);
    return json(res, 200, { ok: true });
  }

  // ── GET /api/listings/shipping/:orderId ───────────────────────────────────────
  // Seller retrieves buyer shipping address (to place Printful order).
  if (method === 'GET' && url.startsWith('/api/listings/shipping/')) {
    const orderId = url.replace('/api/listings/shipping/', '');
    const shipping = _shippingStore.get(orderId);
    if (!shipping) return json(res, 404, { error: 'No shipping address for this order' });
    return json(res, 200, { shipping });
  }

  // ── GET /api/delivery/download/:orderId ───────────────────────────────────────
  // Returns delivery URL for a released digital order.
  if (method === 'GET' && url.startsWith('/api/delivery/download/')) {
    const orderId = url.replace('/api/delivery/download/', '');
    const listing = _listingStore.get(orderId);
    if (!listing) return json(res, 404, { error: 'Listing not found' });
    if (listing.type !== 'digital') return json(res, 400, { error: 'Not a digital listing' });
    if (listing.state !== 'RELEASED') return json(res, 403, { error: 'Payment not yet released' });
    if (!listing.deliveryUrl) return json(res, 404, { error: 'No delivery URL set for this listing' });
    return json(res, 200, { deliveryUrl: listing.deliveryUrl });
  }

  // ── GET /api/printful/catalog ──────────────────────────────────────────────────
  // Returns base product catalog sellers can drop their design onto.
  if (method === 'GET' && url === '/api/printful/catalog') {
    return json(res, 200, { catalog: PF_CATALOG.map(p => ({
      ...p,
      suggestedPriceNIGHT: Math.ceil((p.baseCostUSD * 2.5) / NIGHT_USD), // 2.5x markup suggestion
      baseCostNIGHT:       Math.ceil(p.baseCostUSD / NIGHT_USD),
    })) });
  }

  // ── GET /api/printful/order/:orderId ──────────────────────────────────────────
  // Returns Printful order status for a released listing.
  if (method === 'GET' && url.startsWith('/api/printful/order/')) {
    const orderId = url.replace('/api/printful/order/', '');
    const pfOrder = _pfOrderStore.get(orderId);
    if (!pfOrder) return json(res, 404, { error: 'No Printful order for this listing' });
    // Optionally refresh status from Printful API
    if (PF_TOKEN && pfOrder.id) {
      try {
        const fresh = await pfCall(`/orders/${pfOrder.id}`);
        _pfOrderStore.set(orderId, fresh);
        return json(res, 200, { order: { id: fresh.id, status: fresh.status, tracking: fresh.shipments?.[0]?.tracking_url ?? null } });
      } catch { /* return cached */ }
    }
    return json(res, 200, { order: { id: pfOrder.id, status: pfOrder.status, tracking: pfOrder.shipments?.[0]?.tracking_url ?? null } });
  }

  // ── POST /api/printful/mockup ──────────────────────────────────────────────────
  // Creates a product mockup via Printful API. Requires PF_TOKEN + public design URL.
  if (method === 'POST' && url === '/api/printful/mockup') {
    if (!PF_TOKEN) return json(res, 400, { error: 'PRINTFUL_API_TOKEN not configured in .env' });
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { productId, color = 'Black', designUrl, size } = body;
    if (!productId || !designUrl) return json(res, 400, { error: 'productId and designUrl required' });
    const cat = PF_CATALOG.find(p => p.id === productId);
    if (!cat) return json(res, 400, { error: `Unknown productId: ${productId}. Valid: ${PF_CATALOG.map(p=>p.id).join(', ')}` });
    try {
      const mockupUrl = await pfCreateMockup(cat.pfId, color, designUrl, size || cat.sizes[0]);
      return json(res, 200, { ok: true, mockupUrl });
    } catch (err: any) {
      return json(res, 500, { error: err.message ?? 'Mockup generation failed' });
    }
  }

  // ── GET /api/shopify/products ──────────────────────────────────────────────────
  // Proxies Shopify Admin API product list for a seller's store.
  if (method === 'GET' && url.startsWith('/api/shopify/products')) {
    const params = new URL('http://x' + url).searchParams;
    const shop  = params.get('shop')  ?? '';
    const token = params.get('token') ?? '';
    if (!shop || !token) return json(res, 400, { error: 'shop and token query params required' });
    try {
      const data = await shopifyCall(shop, token, '/products.json?limit=50&status=active');
      const products = (data.products ?? []).map((p: any) => ({
        id:       String(p.id),
        title:    p.title,
        image:    p.image?.src ?? p.images?.[0]?.src ?? null,
        variants: (p.variants ?? []).map((v: any) => ({
          id:    String(v.id),
          title: v.title,
          price: v.price,
          sku:   v.sku ?? '',
        })),
      }));
      return json(res, 200, { products });
    } catch (err: any) {
      return json(res, 400, { error: err.message ?? 'Could not fetch Shopify products — check shop URL and token' });
    }
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

  // ── GET /api/nightid/score/:chain/:address ────────────────────────────────────
  // Multi-chain Night Score. chain = eth | sol | ada | midnight | all
  // Returns: { totalScore, level, levelEmoji, breakdowns, crossChainBonus, credential }
  if (method === 'GET' && url.startsWith('/api/nightid/score/')) {
    const parts = url.replace('/api/nightid/score/', '').split('/');
    const chain = parts[0] as any;
    const address = decodeURIComponent(parts.slice(1).join('/'));
    if (!chain || !address) return json(res, 400, { error: 'chain and address required' });
    const validChains = ['eth', 'sol', 'ada', 'midnight', 'all'];
    if (!validChains.includes(chain)) return json(res, 400, { error: `chain must be one of: ${validChains.join(', ')}` });
    try {
      const { scoreWallet } = await import('./night-id-scorer.js');
      const result = await scoreWallet(chain, address);
      return json(res, 200, result);
    } catch (err: any) {
      console.error('[nightid/score]', err);
      return json(res, 500, { error: 'scoring failed', detail: err?.message });
    }
  }

  // ── POST /api/nightid/record-action ──────────────────────────────────────────
  // Called by any Night app when a user completes a scored action.
  // v1: records in-memory (no contract call yet).
  // v2: will call NightID.compact recordAction circuit on-chain.
  // Body: { holderAddress, appId, points, eventType }
  // Returns: { ok, address, appId, points, newTotal }
  if (method === 'POST' && url === '/api/nightid/record-action') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { holderAddress, appId, points, eventType } = body;
    if (!holderAddress) return json(res, 400, { error: 'holderAddress required' });
    if (!appId)         return json(res, 400, { error: 'appId required' });
    const pts = Number(points ?? 0);
    if (pts < 1 || pts > 50) return json(res, 400, { error: 'points must be 1–50' });

    const VALID_APPS: Record<string, number> = {
      'night-markets': 50,
      'night-fun':     25,
      'night-poker':   15,
      'night-lend':    30,
      'night-work':    40,
      'night-save':    10,
      'night-biz':     10,
    };
    if (!VALID_APPS[appId]) return json(res, 400, { error: `unknown appId: ${appId}` });

    const prev     = _nightScoreStore.get(holderAddress) ?? 0;
    const newTotal = prev + pts;
    _nightScoreStore.set(holderAddress, newTotal);
    _scoreEventLog.push({ address: holderAddress, appId, points: pts, eventType: eventType ?? 0, ts: Date.now() });
    console.log(`\n  [record-action] ${appId} +${pts} → ${holderAddress.slice(0, 16)}… (total: ${newTotal})`);
    return json(res, 200, { ok: true, address: holderAddress, appId, points: pts, newTotal });
  }

  // ── GET /api/nightid/action-score/:address ────────────────────────────────────
  // Returns the cumulative Night Score for an address across all Night apps.
  // Used by Night Hub, Night Work routing, and AI Builder Program threshold.
  if (method === 'GET' && url.startsWith('/api/nightid/action-score/')) {
    const address = decodeURIComponent(url.replace('/api/nightid/action-score/', ''));
    if (!address) return json(res, 400, { error: 'address required' });
    const total  = _nightScoreStore.get(address) ?? 0;
    const events = _scoreEventLog.filter(e => e.address === address);
    const byApp  = events.reduce((acc: Record<string, number>, e: any) => {
      acc[e.appId] = (acc[e.appId] ?? 0) + e.points;
      return acc;
    }, {});
    const threshold200 = total >= 200;
    return json(res, 200, { address, total, threshold200, byApp, eventCount: events.length });
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

  // ── GET /api/poker/rooms ─────────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/poker/rooms') {
    const rooms = [..._gameRooms.values()].map(r => ({
      id: r.id, name: r.name, buyin: r.buyin, sb: r.sb,
      maxPlayers: r.maxPlayers, createdAt: r.createdAt,
      playerCount: r.seats.filter(s => s.ws.readyState === 1).length,
      phase: r.phase,
    }));
    return json(res, 200, { rooms });
  }

  // ── POST /api/poker/create ────────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/poker/create') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { name = 'Night Table', buyin = 1000, sb = 25, maxPlayers = 6 } = body;
    const id = 'room-' + Math.random().toString(36).slice(2, 8);
    const sbN=Number(sb), buyinN=Number(buyin), maxN=Math.min(9,Math.max(2,Number(maxPlayers)));
    const room: GameRoom = {
      id, name: String(name).slice(0,32), buyin: buyinN, sb: sbN,
      maxPlayers: maxN, createdAt: Date.now(),
      seats: [], nextSeat: 0, deck: [], deckPtr: 0, community: [],
      pot: 0, toCall: 0, minRaise: sbN*2, phase: 'waiting',
      dealerSeat: -1, actionSeat: -1, needToAct: new Set(), handNum: 0,
    };
    _gameRooms.set(id, room);
    console.log(`\n  [poker/create] "${name}" id=${id} buyin=${buyin} sb=${sb}`);
    return json(res, 200, { ok: true, roomId: id, name: room.name, buyin: buyinN, sb: sbN, maxPlayers: maxN });
  }

  // ── POST /api/merch/set-design ────────────────────────────────────────────────
  // Updates designUrl on all NM official merch listings in memory.
  if (method === 'POST' && url === '/api/merch/set-design') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { designUrl } = body;
    if (!designUrl) return json(res, 400, { error: 'designUrl required' });
    let count = 0;
    for (const [id, listing] of _listingStore) {
      if (listing.isNMOfficial) { listing.designUrl = designUrl; _listingStore.set(id, listing); count++; }
    }
    console.log(`  🎨 [merch/set-design] updated ${count} listings → ${designUrl}`);
    return json(res, 200, { ok: true, updated: count, designUrl });
  }

  // ── POST /api/upload ──────────────────────────────────────────────────────────
  // Accepts a raw image body (PNG/JPG). Saves to uploads/ and returns the URL.
  if (method === 'POST' && url === '/api/upload') {
    const uploadsDir = path.resolve(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const contentType = req.headers['content-type'] ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filepath = path.join(uploadsDir, filename);
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>(resolve => req.on('end', resolve));
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) return json(res, 400, { error: 'No image data received' });
    fs.writeFileSync(filepath, buf);
    const fileUrl = `http://localhost:${PORT}/uploads/${filename}`;
    console.log(`  📸 [upload] saved ${filename} (${(buf.length/1024).toFixed(1)} KB)`);
    return json(res, 200, { ok: true, url: fileUrl, filename });
  }

  // ── GET /uploads/:filename ────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/uploads/')) {
    const filename = path.basename(url.replace('/uploads/', ''));
    const filepath = path.resolve(__dirname, '..', 'uploads', filename);
    if (!fs.existsSync(filepath)) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    cors(res);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000' });
    fs.createReadStream(filepath).pipe(res);
    return;
  }

  // ── POST /api/waitlist ────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/waitlist') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { email, listingId, title } = body;
    if (!email || !String(email).includes('@')) return json(res, 400, { error: 'Valid email required' });
    const entry = { email: String(email), listingId: String(listingId ?? ''), title: String(title ?? ''), at: Date.now() };
    if (!(_waitlistStore as any).has) (_waitlistStore as any).size; // ensure exists
    _waitlistStore.set(`${email}:${listingId}`, entry);
    console.log(`  📬 [waitlist] ${email} → ${listingId}`);
    return json(res, 200, { ok: true });
  }

  // ── GET /api/admin/orders ─────────────────────────────────────────────────────
  // Returns all listings with shipping addresses, printful order status, and escrow state.
  // Simple key check — not cryptographically secure, just keeps it off public crawlers.
  if (method === 'GET' && url.startsWith('/api/admin/orders')) {
    const adminKey = new URL('http://x' + url).searchParams.get('key');
    if (adminKey !== (process.env.ADMIN_KEY ?? 'nightmarkets-admin')) {
      return json(res, 401, { error: 'Invalid admin key' });
    }
    const orders = [..._listingStore.values()].map(listing => {
      const shipping = _shippingStore.get(listing.id) ?? null;
      const pfOrder  = _pfOrderStore.get(listing.id) ?? null;
      return {
        id:            listing.id,
        title:         listing.title,
        price:         listing.price,
        state:         listing.state ?? 'OPEN',
        type:          listing.type,
        isNMOfficial:  listing.isNMOfficial ?? false,
        sellerId:      listing.sellerId,
        createdAt:     listing.createdAt,
        fundedAt:      listing.fundedAt ?? null,
        shipping:      shipping,
        printfulOrder: pfOrder ? { id: pfOrder.id, status: pfOrder.status, trackingUrl: pfOrder.shipments?.[0]?.tracking_url ?? null } : null,
      };
    });
    const stats = {
      total:    orders.length,
      open:     orders.filter(o => o.state === 'OPEN').length,
      funded:   orders.filter(o => o.state === 'FUNDED').length,
      released: orders.filter(o => o.state === 'RELEASED').length,
      revenueNIGHT: orders.filter(o => o.state === 'RELEASED').reduce((s, o) => s + Number(o.price), 0),
    };
    const waitlist = [..._waitlistStore.values()];
    return json(res, 200, { orders, stats, waitlist });
  }

  // ── POST /api/admin/fulfill ───────────────────────────────────────────────────
  // Admin manually triggers Printful order placement for a funded listing.
  if (method === 'POST' && url === '/api/admin/fulfill') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { key, orderId, size } = body;
    if (key !== (process.env.ADMIN_KEY ?? 'nightmarkets-admin')) return json(res, 401, { error: 'Invalid admin key' });
    const listing = _listingStore.get(String(orderId));
    if (!listing) return json(res, 404, { error: 'Listing not found' });
    const shipping = _shippingStore.get(String(orderId));
    if (!shipping) return json(res, 400, { error: 'No shipping address for this order yet' });
    try {
      const pfOrder = await pfPlaceOrder(listing, shipping, size ?? shipping.size ?? listing.sizes?.[0] ?? 'M');
      _pfOrderStore.set(String(orderId), pfOrder);
      listing.state = 'FULFILLED';
      _listingStore.set(String(orderId), listing);
      console.log(`  📦 [admin/fulfill] Printful order #${pfOrder.id} placed for ${orderId}`);
      return json(res, 200, { ok: true, printfulOrderId: pfOrder.id, status: pfOrder.status });
    } catch (e: any) {
      return json(res, 500, { error: e.message });
    }
  }

  // ── POST /api/admin/mark-released ────────────────────────────────────────────
  // Admin marks an order as released (for pre-mainnet manual escrow).
  if (method === 'POST' && url === '/api/admin/mark-released') {
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { key, orderId } = body;
    if (key !== (process.env.ADMIN_KEY ?? 'nightmarkets-admin')) return json(res, 401, { error: 'Invalid admin key' });
    const listing = _listingStore.get(String(orderId));
    if (!listing) return json(res, 404, { error: 'Listing not found' });
    listing.state = 'RELEASED';
    listing.releasedAt = Date.now();
    _listingStore.set(String(orderId), listing);
    return json(res, 200, { ok: true, orderId, state: 'RELEASED' });
  }

  // ── POST /api/merch/regenerate-mockups ───────────────────────────────────────
  if (method === 'POST' && url === '/api/merch/regenerate-mockups') {
    let body: any = {};
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const { key, designUrl } = body;
    if (key !== (process.env.ADMIN_KEY ?? 'nightmarkets-admin')) return json(res, 403, { error: 'Invalid admin key' });
    // Clear cached mockups so they get regenerated
    for (const [id, l] of _listingStore) {
      if (l.isNMOfficial) { delete l.imageUrl; delete l.mockupUrl; _listingStore.set(id, l); _mockupStatus.delete(id); }
    }
    // Also clear the pfCreateMockup cache for fresh results
    _mockupCache.clear();
    warmMerchMockups(designUrl ?? undefined).catch(e => console.warn('warmMerchMockups:', e.message));
    return json(res, 200, { ok: true, message: 'Mockup regeneration started — check /api/merch/mockup-status' });
  }

  // ── GET /api/merch/mockup-status ─────────────────────────────────────────────
  if (method === 'GET' && url === '/api/merch/mockup-status') {
    const status: Record<string, any> = {};
    for (const [id, s] of _mockupStatus) {
      const l = _listingStore.get(id);
      status[id] = { state: s, title: l?.title, imageUrl: l?.imageUrl ?? null };
    }
    return json(res, 200, { status, total: _mockupStatus.size });
  }

  json(res, 404, { error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌙 Night Markets API Server`);
  console.log(`   http://0.0.0.0:${PORT}/api/status`);
  console.log(`   Contract: ${CONTRACT_ADDRESS}`);
  console.log(`   Network:  Midnight preprod`);
  console.log(`   Poker WS: ws://0.0.0.0:${PORT}/ws/poker/:roomId\n`);
  // Auto-generate Printful mockups in background after stores are fully seeded
  setTimeout(() => warmMerchMockups().catch(e => console.warn('warmMerchMockups:', e.message)), 2_000);
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
  const roomId = (req.url ?? '').replace('/ws/poker/', '').split('?')[0] || '';
  const room = _gameRooms.get(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' }));
    ws.close(); return;
  }
  if (room.seats.filter(s => s.ws.readyState === 1).length >= room.maxPlayers) {
    ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
    ws.close(); return;
  }

  const seatIdx = room.nextSeat++;
  const seat: PokerSeat = { ws, name: `Player ${seatIdx+1}`, seatIdx, stack: room.buyin, bet: 0, cards: [], folded: false, allIn: false };
  room.seats.push(seat);
  if (room.dealerSeat < 0) room.dealerSeat = seatIdx;
  console.log(`  [poker/${roomId}] ${seat.name} joined (${room.seats.length} total)`);

  ws.send(JSON.stringify({ type: 'room_state', roomId, mySeatIdx: seatIdx, state: pPub(room), buyin: room.buyin, sb: room.sb }));
  pBcast(room, { type: 'player_joined', name: seat.name, seatIdx, state: pPub(room) }, ws);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const me = room.seats.find(s => s.ws === ws);
      if (!me) return;
      if (msg.type === 'set_name') {
        me.name = String(msg.name).slice(0,20).replace(/[<>"]/g,'');
        pBcast(room, { type: 'name_set', seatIdx: me.seatIdx, name: me.name, state: pPub(room) });
      } else if (msg.type === 'start_hand') {
        if (room.phase !== 'waiting' && room.phase !== 'finished') {
          ws.send(JSON.stringify({ type: 'error', msg: 'Hand already in progress' })); return;
        }
        pStartHand(room);
      } else if (msg.type === 'action') {
        if (['fold','check','call','raise'].includes(msg.action))
          pDoAction(room, ws, msg.action, Number(msg.amount ?? 0));
      } else if (msg.type === 'chat') {
        pBcast(room, { type: 'chat', name: me.name, text: String(msg.text).slice(0,200) });
      }
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    const idx = room.seats.findIndex(s => s.ws === ws);
    if (idx < 0) return;
    const gone = room.seats[idx];
    const gsi = gone.seatIdx;
    if (['preflop','flop','turn','river'].includes(room.phase) && !gone.folded) {
      if (room.actionSeat === gsi) {
        pDoAction(room, ws, 'fold', 0);
      } else {
        gone.folded = true;
        room.needToAct.delete(gsi);
        const rem = room.seats.filter(s => !s.folded);
        if (rem.length === 1) { rem[0].stack += room.pot; room.pot = 0; setTimeout(() => pEndHand(room, rem, 'fold'), 300); }
      }
    }
    room.seats.splice(idx, 1);
    room.needToAct.delete(gsi);
    if (room.seats.length === 0) {
      _gameRooms.delete(roomId);
      console.log(`  [poker/${roomId}] room closed (empty)`); return;
    }
    pBcast(room, { type: 'player_left', name: gone.name, seatIdx: gsi, state: pPub(room) });
    console.log(`  [poker/${roomId}] "${gone.name}" left (${room.seats.length} remaining)`);
  });
});

if (process.env.WALLET_SYNC_DISABLED === '1') {
  console.log('  ⚠️  Wallet sync disabled — listings, merch & Printful work; contract calls unavailable');
} else {
  await init();
}
