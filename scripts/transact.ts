/**
 * transact.ts — Create a live listing on Night Markets Escrow (Midnight Preprod)
 * Calls createListing on the deployed contract — generates a real ZK proof on-chain.
 * Run: npm run transact
 */

// Catch non-Error WASM panics during module init
process.on('uncaughtException', (err: unknown) => {
  console.error('\n❌ Uncaught exception:');
  if (err instanceof Error) { console.error(err.message); console.error(err.stack); }
  else { try { console.error(JSON.stringify(err, null, 2)); } catch { console.error(String(err)); } }
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('\n❌ Unhandled rejection:');
  if (reason instanceof Error) { console.error(reason.message); console.error(reason.stack); }
  else { try { console.error(JSON.stringify(reason, null, 2)); } catch { console.error(String(reason)); } }
  process.exit(1);
});

import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import * as ledger from '@midnight-ntwrk/ledger-v7';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
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

// @ts-expect-error: globalThis.WebSocket needed for Apollo WS transport
globalThis.WebSocket = WebSocket;

// ─── Config ───────────────────────────────────────────────────────────────────

setNetworkId('preprod');

const CONTRACT_ADDRESS = '7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711';

const CONFIG = {
  indexer:     'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS:   'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node:        'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
};

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-markets-escrow');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Encode a short ASCII string into a fixed 32-byte Uint8Array */
function toBytes32(label: string): Uint8Array {
  const buf = new Uint8Array(32);
  for (let i = 0; i < Math.min(label.length, 32); i++) buf[i] = label.charCodeAt(i);
  return buf;
}

/** Format bigint with commas */
const fmt = (n: bigint) => n.toLocaleString();

// ─── Key derivation ───────────────────────────────────────────────────────────

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
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
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const baseConfig = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
  };

  const shieldedWallet   = ShieldedWallet(baseConfig).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet({
    networkId,
    indexerClientConnection: baseConfig.indexerClientConnection,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
  const dustWallet = DustWallet({
    ...baseConfig,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

// ─── Signing helper ───────────────────────────────────────────────────────────

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
) => {
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

const createProviders = async (ctx: Awaited<ReturnType<typeof buildWallet>>) => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);

  const walletAndMidnightProvider = {
    getCoinPublicKey() { return state.shielded.coinPublicKey.toHexString(); },
    getEncryptionPublicKey() { return state.shielded.encryptionPublicKey.toHexString(); },
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: any) { return ctx.wallet.submitTransaction(tx) as any; },
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  return {
    walletProvider:      walletAndMidnightProvider,
    midnightProvider:    walletAndMidnightProvider,
    publicDataProvider:  indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    proofProvider:       httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    zkConfigProvider,
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'night-markets-transact-state',
      walletProvider: walletAndMidnightProvider,
    }),
  };
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(contractPath)) {
    console.error('❌ Contract not compiled. Run: npm run compile');
    process.exit(1);
  }

  const seed = process.env.WALLET_SEED;
  if (!seed) throw new Error('WALLET_SEED not set in .env');

  console.log('\n🌙 Night Markets — Live Transaction on Midnight Preprod');
  console.log('─'.repeat(62));
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  Network:  Midnight Preprod`);
  console.log(`  Action:   createListing\n`);

  // 1. Wallet
  process.stdout.write('  Building wallet... ');
  const ctx = await buildWallet(seed);
  console.log(`✓\n  Address:  ${ctx.unshieldedKeystore.getBech32Address()}`);

  // 2. Sync
  process.stdout.write('  Syncing with network... ');
  await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.throttleTime(5_000), Rx.filter((s: any) => s.isSynced)),
  );
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  const dust  = state.dust.walletBalance(new Date());
  const { unshieldedToken } = await import('@midnight-ntwrk/ledger-v7');
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`✓\n  tNight:   ${fmt(tNight)}\n  DUST:     ${fmt(dust)}`);

  if (tNight === 0n && dust === 0n) {
    console.error('\n  ❌ Wallet has no tNight. Fund it at: https://faucet.preprod.midnight.network/');
    console.error(`     Address: ${ctx.unshieldedKeystore.getBech32Address()}`);
    process.exit(1);
  }

  // Register NIGHT UTXOs for DUST generation if needed
  if (dust === 0n) {
    console.log('\n  Registering NIGHT for DUST generation...');
    const nightUtxos = state.unshielded.availableCoins.filter(
      (coin: any) => coin.meta?.registeredForDustGeneration !== true,
    );
    if (nightUtxos.length > 0) {
      const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
        nightUtxos,
        ctx.unshieldedKeystore.getPublicKey(),
        (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload),
      );
      const finalized = await ctx.wallet.finalizeRecipe(recipe);
      await ctx.wallet.submitTransaction(finalized);
      console.log('  ✓ Registered — waiting for DUST to accrue (up to 5 min)...');
    } else {
      console.log('  Already registered — waiting for DUST to accrue...');
    }
    await Rx.firstValueFrom(
      ctx.wallet.state().pipe(
        Rx.throttleTime(10_000),
        Rx.filter((s: any) => s.isSynced),
        Rx.filter((s: any) => s.dust.walletBalance(new Date()) > 0n),
      ),
    );
    const s2 = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
    console.log(`  ✓ DUST ready: ${fmt(s2.dust.walletBalance(new Date()))}`);
  }

  // 3. Clear stale private state DB (encrypted with a different wallet key = decrypt failure)
  const dbPath = path.resolve(__dirname, '..', 'midnight-level-db');
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }

  // 4. Providers
  process.stdout.write('  Wiring providers... ');
  const providers = await createProviders(ctx);
  console.log('✓');

  // 4. Load compiled contract
  process.stdout.write('  Loading compiled contract... ');
  const NightMarketsEscrow = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract
    .make('night-markets-escrow', NightMarketsEscrow.Contract)
    .pipe(
      CompiledContract.withWitnesses({
        localSecretKey:    ({ privateState }: any) => [privateState, new Uint8Array(32).fill(1)],
        voterNightBalance: ({ privateState }: any) => [privateState, 0n],
      }),
      CompiledContract.withCompiledFileAssets(zkConfigPath),
    );
  console.log('✓');

  // 5. Join the deployed contract
  process.stdout.write('  Joining deployed contract... ');
  const deployedContract = await findDeployedContract(providers, {
    contractAddress:     CONTRACT_ADDRESS,
    compiledContract,
    privateStateId:      'escrowState',
    initialPrivateState: {},
  });
  console.log('✓');

  // 6. Build listing params
  const listingLabel  = `nm-listing-${Date.now().toString(36)}`;
  const orderId       = toBytes32(listingLabel);
  const amountNight   = 1_000_000n; // 1 NIGHT (6 decimals)

  console.log('\n  Listing details:');
  console.log(`  ├─ Order ID:      "${listingLabel}" (padded to 32 bytes)`);
  console.log(`  └─ Amount NIGHT:  ${fmt(amountNight)}`);

  // 7. Call createListing — generates ZK proof + submits tx
  console.log('\n  🔐 Generating ZK proof and submitting transaction...');
  console.log('     (this takes 30–90 seconds)\n');

  const result = await deployedContract.callTx.createListing(orderId, amountNight);

  const txId    = result.public.txId;
  const block   = result.public.blockHeight;

  console.log('\n' + '─'.repeat(62));
  console.log('✅  LISTING CREATED — LIVE ON MIDNIGHT PREPROD');
  console.log('─'.repeat(62));
  console.log(`  Order ID:  ${listingLabel}`);
  console.log(`  Amount:    ${fmt(amountNight)} NIGHT`);
  console.log(`  Tx:        ${txId}`);
  console.log(`  Block:     ${block}`);
  console.log(`  Contract:  ${CONTRACT_ADDRESS}`);
  console.log('─'.repeat(62));
  console.log('\n  This is a real on-chain transaction.');
  console.log('  Verifiable at: https://explorer.preprod.midnight.network\n');

  await ctx.wallet.stop();
}

main().catch((err: Error) => {
  console.error('\n❌ Transaction failed:', err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
