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
 */

process.on('uncaughtException',  (err: unknown) => console.error('Uncaught:', err));
process.on('unhandledRejection', (r: unknown)   => console.error('Rejected:', r));

import * as http   from 'node:http';
import * as path   from 'node:path';
import * as fs     from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer }  from 'buffer';
import { WebSocket } from 'ws';
import * as Rx     from 'rxjs';

import * as ledger    from '@midnight-ntwrk/ledger-v7';
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

// ─── Config ───────────────────────────────────────────────────────────────────

setNetworkId('preprod');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
  ?? '7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711';

const PORT = parseInt(process.env.API_PORT ?? '3001', 10);

const CONFIG = {
  indexer:     process.env.INDEXER_URI      ?? 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS:   process.env.INDEXER_WS_URI   ?? 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node:        process.env.NODE_URI         ?? 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
};

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-markets-escrow');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// ─── Wallet helpers (shared with deploy.ts / transact.ts) ────────────────────

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
  const state  = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
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

    const ctx = await buildWallet(seed);
    console.log(`  Wallet: ${ctx.keystore.getBech32Address()}`);

    console.log('  Syncing with preprod...');
    await Rx.firstValueFrom(
      ctx.wallet.state().pipe(Rx.throttleTime(5_000), Rx.filter((s: any) => s.isSynced)),
    );
    const state  = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
    const night  = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const dust   = state.dust.walletBalance(new Date());
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

  json(res, 404, { error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌙 Night Markets API Server`);
  console.log(`   http://127.0.0.1:${PORT}/api/status`);
  console.log(`   Contract: ${CONTRACT_ADDRESS}`);
  console.log(`   Network:  Midnight preprod\n`);
});

await init();
