// Catch any non-Error thrown during module init (e.g. WASM-bindgen panics)
process.on('uncaughtException', (err: unknown) => {
  console.error('\n❌ Uncaught exception (module init failure):');
  if (err instanceof Error) {
    console.error(err.message);
    console.error(err.stack);
  } else {
    try { console.error(JSON.stringify(err, null, 2)); } catch { console.error(String(err)); }
    console.error('Raw:', err);
  }
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('\n❌ Unhandled rejection:');
  if (reason instanceof Error) {
    console.error(reason.message);
    console.error(reason.stack);
  } else {
    try { console.error(JSON.stringify(reason, null, 2)); } catch { console.error(String(reason)); }
  }
  process.exit(1);
});

/**
 * deploy.ts — Night Markets Escrow Contract Deployment
 * Modelled on the official example-counter api.ts (proven working on Preprod).
 * SDK stack: midnight-js-contracts@4.0.4 / wallet-sdk-facade@1.0.0 / ledger-v8
 *
 * Run:  npm run deploy
 * Env:  WALLET_SEED=<hex seed>  (set in .env)
 */

import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK — v8 ledger (matches midnight-js-contracts@4.0.4)
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
// ledger-v7 is used internally by wallet-sdk-* (dust/shielded/facade v1.0.0).
// We import it only to detect cross-WASM-boundary type mismatches in the bridge patch below.
import * as ledger7 from '@midnight-ntwrk/ledger-v7';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

const noOpTxHistory = {
  create: async () => {},
  upsert: async () => {},
  delete: async () => undefined as any,
  getAll: async function* () {},
  get: async () => undefined as any,
};

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: globalThis.WebSocket is needed for Apollo WS transport
globalThis.WebSocket = WebSocket;

// ─── Ledger v7/v8 WASM bridge ────────────────────────────────────────────────
//
// wallet-sdk-facade@1.0.0 and its sub-wallets use ledger-v7 internally.
// midnight-js-contracts@4.0.4 uses ledger-v8. This creates two issues when
// the wallet SDK processes transactions created by the contracts library:
//
//   1. dust.balanceTransactions([v8_tx], ...) calls v8_tx.feesWithMargin(v7_params)
//      → ledger-v8 _assertClass() throws "expected instance of LedgerParameters"
//
//   2. finalizeRecipe() calls v8_boundTx.merge(v7_finalizedDustTx)
//      → ledger-v8 _assertClass() throws "expected instance of Transaction"
//
// The fix: patch ledger-v8's Transaction prototype methods to accept v7 objects
// by serializing them to bytes and re-deserializing as v8 types.
// This works because ledger-v7 and ledger-v8 share the same wire format.
//
let _bridgeApplied = false;
function applyLedgerBridge(): void {
  if (_bridgeApplied) return;
  _bridgeApplied = true;

  const V7LP   = (ledger7 as any).LedgerParameters;
  const V7Tx   = (ledger7 as any).Transaction;
  const V8LP   = ledger.LedgerParameters;
  const V8Tx   = (ledger.Transaction as any);

  // Patch feesWithMargin: if params is a v7 LedgerParameters, convert to v8 first.
  const origFWM = V8Tx.prototype.feesWithMargin;
  V8Tx.prototype.feesWithMargin = function(params: any, n: any) {
    if (params instanceof V7LP) {
      try {
        return origFWM.call(this, V8LP.deserialize(params.serialize()), n);
      } catch (e: any) {
        console.error('  [bridge] feesWithMargin conversion failed:', e?.message);
        throw e;
      }
    }
    return origFWM.call(this, params, n);
  };

  // Patch merge: if other is a v7 Transaction, convert to v8 via serialize/deserialize.
  // v7 finalized tx state is (signature, proof, binding) after finalizeTransaction().
  const origMerge = V8Tx.prototype.merge;
  V8Tx.prototype.merge = function(other: any) {
    if (other instanceof V7Tx) {
      try {
        const v8Other = V8Tx.deserialize('signature', 'proof', 'binding', other.serialize());
        return origMerge.call(this, v8Other);
      } catch (e: any) {
        console.error('  [bridge] merge conversion failed:', e?.message);
        throw e;
      }
    }
    return origMerge.call(this, other);
  };

  console.log('  ✓ Ledger v7/v8 WASM bridge applied');
}

// ─── Config ──────────────────────────────────────────────────────────────────

const NETWORK = (process.env.MIDNIGHT_NETWORK ?? 'preprod') as any;
setNetworkId(NETWORK);

const CONFIG = {
  indexer:     process.env.INDEXER_URI      ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS:   process.env.INDEXER_WS_URI   ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node:        process.env.NODE_URI         ?? 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
};

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-markets-escrow');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// ─── Key derivation ───────────────────────────────────────────────────────────

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialise HDWallet from seed');

  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
};

// ─── Wallet builder ───────────────────────────────────────────────────────────

const buildWallet = async (seed: string) => {
  const keys = deriveKeysFromSeed(seed);
  const networkId = getNetworkId();

  const shieldedSecretKeys  = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey       = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore  = createKeystore(keys[Roles.NightExternal], networkId);

  const indexerClientConnection = { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS };
  const costParameters = { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 };

  const wallet = await (WalletFacade as any).init({
    configuration: {
      networkId,
      indexerClientConnection,
      relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
      provingServerUrl: new URL(CONFIG.proofServer),
      costParameters,
      txHistoryStorage: noOpTxHistory,
    },
    shielded: (config: any) => (ShieldedWallet(config) as any).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (config: any) => (UnshieldedWallet({
      networkId: config.networkId,
      indexerClientConnection: config.indexerClientConnection,
      txHistoryStorage: noOpTxHistory,
    }) as any).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config: any) => (DustWallet({
      networkId: config.networkId,
      costParameters: config.costParameters,
      indexerClientConnection: config.indexerClientConnection,
      txHistoryStorage: noOpTxHistory,
    }) as any).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

// ─── Transaction signing ──────────────────────────────────────────────────────

/**
 * Sign all unshielded offers in a transaction's intents with the correct
 * proof marker.  Works around a wallet-SDK bug where signRecipe hardcodes
 * 'pre-proof', which fails for proven (UnboundTransaction) intents.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature', proofMarker, 'pre-binding', intent.serialize(),
    );
    const signature = signFn(cloned.signatureData(segment));
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: any, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: any, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

// ─── Provider factory ─────────────────────────────────────────────────────────

const readyFilter = (s: any) => s.isSynced || (s.dust?.balance?.(new Date()) ?? 0n) > 0n;

const createWalletAndMidnightProvider = async (ctx: Awaited<ReturnType<typeof buildWallet>>) => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(readyFilter)));
  const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);

  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: any) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

// ─── DUST registration helper ─────────────────────────────────────────────────

const registerForDustGeneration = async (ctx: Awaited<ReturnType<typeof buildWallet>>) => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(readyFilter)));

  if ((state.dust?.balance?.(new Date()) ?? 0n) > 0n) {
    console.log(`  ✓ DUST available: ${state.dust.balance(new Date()).toLocaleString()}`);
    return;
  }

  const nightUtxos = (state.unshielded?.availableCoins ?? []).filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );

  if (nightUtxos.length === 0) {
    console.log('  All NIGHT already registered — waiting for DUST to generate...');
  } else {
    console.log(`  Registering ${nightUtxos.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      ctx.unshieldedKeystore.getPublicKey(),
      (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload),
    );
    const finalized = await ctx.wallet.finalizeRecipe(recipe);
    await ctx.wallet.submitTransaction(finalized);
    console.log('  ✓ Registered — waiting for DUST to accrue...');
  }

  // Wait for DUST balance > 0
  await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s: any) => (s.dust?.balance?.(new Date()) ?? 0n) > 0n),
    ),
  );
  const final = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(readyFilter)));
  console.log(`  ✓ DUST balance: ${final.dust.balance(new Date()).toLocaleString()}`);
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(contractPath)) {
    console.error('❌ Contract not compiled. Run: npm run compile');
    process.exit(1);
  }

  const seed = process.env.WALLET_SEED;
  if (!seed) throw new Error('WALLET_SEED not set in .env');

  console.log(`\n🌙 Night Markets — Deploying to ${NETWORK}`);
  console.log(`  Indexer:      ${CONFIG.indexer}`);
  console.log(`  Node:         ${CONFIG.node}`);
  console.log(`  Proof server: ${CONFIG.proofServer}`);

  // 1. Apply the v7/v8 WASM bridge before any wallet operations
  applyLedgerBridge();

  // 2. Build wallet
  console.log('\n  Building wallet...');
  const ctx = await buildWallet(seed);
  console.log(`  Address: ${ctx.unshieldedKeystore.getBech32Address()}`);

  // 3. Wait for sync
  console.log('  Syncing with network (this can take 5–10 min on first run)...');
  let syncTick = 0;
  const syncSub = ctx.wallet.state().pipe(Rx.throttleTime(10_000)).subscribe((s: any) => {
    syncTick++;
    const dust = s.dust?.balance?.(new Date()) ?? '?';
    const synced = s.isSynced ? '✓ synced' : `syncing… (${syncTick * 10}s)`;
    console.log(`  [sync] ${synced} | dust: ${dust}`);
  });
  // Proceed once fully synced OR once dust is available (shielded sync can take very long)
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.filter((s: any) => s.isSynced || (s.dust?.balance?.(new Date()) ?? 0n) > 0n),
    ),
  );
  syncSub.unsubscribe();
  const tNightBal = state.unshielded?.balances?.[unshieldedToken().raw] ?? 0n;
  console.log(`  ✓ Ready   |  tNight: ${tNightBal.toLocaleString()}  |  dust: ${state.dust?.balance?.(new Date())?.toLocaleString() ?? '?'}`);


  // 4. Ensure DUST (fee token) is available
  await registerForDustGeneration(ctx);

  // 5. Wire up providers (exact counter-example pattern)
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const providers = {
    walletProvider:      walletAndMidnightProvider,
    midnightProvider:    walletAndMidnightProvider,
    publicDataProvider:  indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    proofProvider:       httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    zkConfigProvider,
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'night-markets-state',
      walletProvider: walletAndMidnightProvider,
      privateStoragePasswordProvider: () => 'night-markets-deploy-secret-key-2024',
      accountId: 'night-markets-deployer-account',
    }),
  };

  // 6. Load compiled contract and wire witnesses
  console.log('\n  Loading compiled contract...');
  const NightMarketsEscrow = await import(pathToFileURL(contractPath).href);

  const compiledContract = CompiledContract
    .make('night-markets-escrow', NightMarketsEscrow.Contract)
    .pipe(
      // Provide implementations for the two Compact witness declarations:
      //   witness localSecretKey(): Bytes<32>
      //   witness voterNightBalance(): Uint<64>
      CompiledContract.withWitnesses({
        localSecretKey:    () => new Uint8Array(32).fill(1),
        voterNightBalance: () => 0n,
      }),
      CompiledContract.withCompiledFileAssets(zkConfigPath),
    );

  // 7. Deploy
  console.log('  Deploying contract (30–90 s, ZK proof generation)...\n');
  const deployed = await deployContract(providers, {
    compiledContract,
    privateStateId:      'escrowState',
    initialPrivateState: {},
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;

  console.log('\n✅  Contract deployed successfully!');
  console.log('─'.repeat(62));
  console.log(`  CONTRACT_ADDRESS = ${contractAddress}`);
  console.log('─'.repeat(62));
  console.log(`\n  Block: ${deployed.deployTxData.public.blockHeight}`);
  console.log(`  Tx:    ${deployed.deployTxData.public.txId}`);
  console.log(`\n  Wire into app:`);
  console.log(`  var NM_CONTRACT_ADDRESS = '${contractAddress}';\n`);

  await ctx.wallet.stop();
}

main().catch((err: Error) => {
  console.error('\n❌ Deploy failed:', err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
