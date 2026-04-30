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
 * SDK stack: midnight-js-contracts@3.0.0 / wallet-sdk-facade@1.0.0 / ledger-v7
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

// Midnight SDK — 3.x stack (matches compact-runtime 0.14.0 compiled output)
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
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
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: globalThis.WebSocket is needed for Apollo WS transport
globalThis.WebSocket = WebSocket;

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

  const baseConfig = {
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: CONFIG.indexer,
      indexerWsUrl:   CONFIG.indexerWS,
    },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL:         new URL(CONFIG.node.replace(/^http/, 'ws')),
  };

  const shieldedWallet = ShieldedWallet(baseConfig).startWithSecretKeys(shieldedSecretKeys);

  const unshieldedWallet = UnshieldedWallet({
    networkId,
    indexerClientConnection: baseConfig.indexerClientConnection,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));

  const dustWallet = DustWallet({
    ...baseConfig,
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

  // ← Official constructor: new WalletFacade(shielded, unshielded, dust)
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

const readyFilter = (s: any) => s.isSynced || (s.dust?.walletBalance?.(new Date()) ?? 0n) > 0n;

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
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }
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

  if ((state.dust?.walletBalance?.(new Date()) ?? 0n) > 0n) {
    console.log(`  ✓ DUST available: ${state.dust.walletBalance(new Date()).toLocaleString()}`);
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
      Rx.filter((s: any) => (s.dust?.walletBalance?.(new Date()) ?? 0n) > 0n),
    ),
  );
  const final = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter(readyFilter)));
  console.log(`  ✓ DUST balance: ${final.dust.walletBalance(new Date()).toLocaleString()}`);
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

  // 1. Build wallet
  console.log('\n  Building wallet...');
  const ctx = await buildWallet(seed);
  console.log(`  Address: ${ctx.unshieldedKeystore.getBech32Address()}`);

  // 2. Wait for sync
  console.log('  Syncing with network (this can take 5–10 min on first run)...');
  let syncTick = 0;
  const syncSub = ctx.wallet.state().pipe(Rx.throttleTime(10_000)).subscribe((s: any) => {
    syncTick++;
    const dust = s.dust?.walletBalance?.(new Date()) ?? '?';
    const synced = s.isSynced ? '✓ synced' : `syncing… (${syncTick * 10}s)`;
    console.log(`  [sync] ${synced} | dust: ${dust}`);
  });
  // Proceed once fully synced OR once dust is available (shielded sync can take very long)
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.filter((s: any) => s.isSynced || (s.dust?.walletBalance?.(new Date()) ?? 0n) > 0n),
    ),
  );
  syncSub.unsubscribe();
  const tNightBal = state.unshielded?.balances?.[unshieldedToken().raw] ?? 0n;
  console.log(`  ✓ Ready   |  tNight: ${tNightBal.toLocaleString()}  |  dust: ${state.dust?.walletBalance?.(new Date())?.toLocaleString() ?? '?'}`);


  // 3. Ensure DUST (fee token) is available
  await registerForDustGeneration(ctx);

  // 4. Wire up providers (exact counter-example pattern)
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
      accountId: String(ctx.unshieldedKeystore.getBech32Address()),
    }),
  };

  // 5. Load compiled contract and wire witnesses
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

  // 6. Deploy
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
