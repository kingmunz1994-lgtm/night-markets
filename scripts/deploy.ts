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

const STATE_DIR           = path.resolve(__dirname, '..', '.wallet-state');
const DUST_STATE_FILE      = path.join(STATE_DIR, 'dust.json');
const UNSHIELDED_STATE_FILE = path.join(STATE_DIR, 'unshielded.json');

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

// DustWalletState has no balance() method; compute from availableCoins[].value
const dustBal = (s: any): bigint =>
  (s?.dust?.availableCoins ?? []).reduce((sum: bigint, c: any) => sum + (c.value ?? 0n), 0n);

// Persist wallet state so subsequent runs resume from the last synced block
// instead of rescanning from genesis (313k+ preprod blocks = ~2.5h rescan).
const saveWalletStates = async (wallet: WalletFacade): Promise<void> => {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const [dustState, unshieldedState] = await Promise.all([
      (wallet as any).dust.serializeState(),
      (wallet as any).unshielded.serializeState(),
    ]);
    fs.writeFileSync(DUST_STATE_FILE, dustState);
    fs.writeFileSync(UNSHIELDED_STATE_FILE, unshieldedState);
    console.log('  ✓ Wallet state saved (.wallet-state/)');
  } catch (e: any) {
    console.warn('  ⚠ Could not save wallet state:', e.message);
  }
};

const buildWallet = async (seed: string) => {
  const keys = deriveKeysFromSeed(seed);
  const networkId = getNetworkId();

  const shieldedSecretKeys  = (ledger7 as any).ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey       = (ledger7 as any).DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore  = createKeystore(keys[Roles.NightExternal], networkId);

  const indexerClientConnection = { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS };
  const costParameters = { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 };

  const relayURL = new URL(CONFIG.node.replace(/^http/, 'ws'));
  const provingServerUrl = new URL(CONFIG.proofServer);

  const shieldedWalletConfig = { networkId, indexerClientConnection, txHistoryStorage: noOpTxHistory, provingServerUrl, relayURL };
  const unshieldedWalletConfig = { networkId, indexerClientConnection, txHistoryStorage: noOpTxHistory };
  const dustWalletConfig = { networkId, costParameters, indexerClientConnection, txHistoryStorage: noOpTxHistory, relayURL, provingServerUrl };

  const ShieldedWalletClass   = ShieldedWallet(shieldedWalletConfig) as any;
  const UnshieldedWalletClass = UnshieldedWallet(unshieldedWalletConfig) as any;
  const DustWalletClass       = DustWallet(dustWalletConfig) as any;

  const hasDustState      = fs.existsSync(DUST_STATE_FILE);
  const hasUnshieldedState = fs.existsSync(UNSHIELDED_STATE_FILE);

  if (hasDustState || hasUnshieldedState) {
    console.log('  ✓ Resuming from saved wallet state (.wallet-state/)');
  }

  const shieldedWallet   = ShieldedWalletClass.startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = hasUnshieldedState
    ? UnshieldedWalletClass.restore(fs.readFileSync(UNSHIELDED_STATE_FILE, 'utf8'))
    : UnshieldedWalletClass.startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
  const dustWallet = hasDustState
    ? DustWalletClass.restore(fs.readFileSync(DUST_STATE_FILE, 'utf8'))
    : DustWalletClass.startWithSecretKey(dustSecretKey, (ledger7 as any).LedgerParameters.initialParameters().dust);

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
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

// For deployment we only need the unshielded wallet (NIGHT UTXOs for dust registration).
// Both shielded and dust wallets trial-decrypt every block from genesis on first run —
// 313k+ blocks on preprod takes 60-90 min. Since a fresh wallet has no prior DUST,
// skipping that wait is safe: registerForDustGeneration will register our NIGHT UTXOs.
const deployReadyFilter = (s: any): boolean =>
  (s.unshielded?.progress?.isCompleteWithin?.(50n) ?? false) || dustBal(s) > 0n;

const readyFilter = deployReadyFilter;

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

  if (dustBal(state) > 0n) {
    console.log(`  ✓ DUST available: ${dustBal(state).toLocaleString()}`);
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

  // Wait for DUST balance > 0 (generated per-block for registered NIGHT UTXOs)
  // Timeout after 5 min — dust wallet must scan 313k+ blocks on first run before
  // it can see accumulated DUST. If no DUST appears, print actionable instructions.
  const DUST_TIMEOUT_MS = 5 * 60 * 1000;
  let dustTick = 0;
  const dustFound = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((s: any) => {
        dustTick++;
        const dProg = s.dust?.state?.progress;
        const scanned = dProg?.appliedIndex ?? '?';
        console.log(`  [dust-wait ${dustTick * 10}s] dust-bal:${dustBal(s)} | dust-scan:${scanned}`);
      }),
      Rx.filter((s: any) => dustBal(s) > 0n),
      Rx.timeout(DUST_TIMEOUT_MS),
      Rx.catchError(() => Rx.of(null)),
    ),
  );

  if (!dustFound) {
    // Save whatever progress the dust wallet made before exiting
    await saveWalletStates(ctx.wallet);
    console.error(`
❌  No DUST available after ${DUST_TIMEOUT_MS / 60000} minutes.

    DUST is the fee token on Midnight. Your NIGHT UTXOs are registered for
    DUST generation, but the dust wallet needs to scan all 313k+ preprod
    blocks to find accumulated DUST — which takes ~2.5h on first run.

    Wallet scan progress has been saved to .wallet-state/ — re-running
    npm run deploy will resume from where it left off.

    Options:
      1. Re-run npm run deploy — it will resume the scan from the saved
         position and find your DUST much faster.
      2. Get preprod DUST from the Midnight Discord faucet channel:
         https://discord.gg/midnightnetwork  → #preprod-faucet
         Paste your address: ${ctx.unshieldedKeystore.getBech32Address()}
    `);
    await ctx.wallet.stop();
    process.exit(1);
  }
  await saveWalletStates(ctx.wallet);
  const final = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(readyFilter)));
  console.log(`  ✓ DUST balance: ${dustBal(final).toLocaleString()}`);
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
    const dust   = dustBal(s);
    const uProg  = s.unshielded?.progress;
    const dProg  = s.dust?.state?.progress;
    const uReady = uProg?.isCompleteWithin?.(50n) ? '✓' : `${uProg?.appliedIndex ?? '?'}/${uProg?.highestRelevantWalletIndex ?? '?'}`;
    const dReady = dProg?.isCompleteWithin?.(50n) ? '✓' : `${dProg?.appliedIndex ?? '?'}/${dProg?.highestRelevantWalletIndex ?? '?'}`;
    console.log(`  [sync ${syncTick * 10}s] unshielded:${uReady} dust:${dReady} | dust-bal:${dust}`);
  });
  // Proceed once unshielded+dust are synced OR dust balance is available.
  // Shielded wallet scans all chain history and is not needed for deployment.
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.filter(deployReadyFilter)),
  );
  syncSub.unsubscribe();
  const tNightBal = state.unshielded?.balances?.[unshieldedToken().raw] ?? 0n;
  console.log(`  ✓ Ready   |  tNight: ${tNightBal.toLocaleString()}  |  dust: ${dustBal(state).toLocaleString()}`);


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
