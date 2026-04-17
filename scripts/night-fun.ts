/**
 * night-fun.ts — NightFunToken SDK
 *
 * Wraps every NightFunToken.compact circuit into typed TypeScript calls.
 * Works for any business scale — Coca-Cola to handcrafted coasters.
 *
 * Usage (Node / server-side oracle):
 *   import { NightFunSDK } from './night-fun.js'
 *   const sdk = await NightFunSDK.connect(seed)
 *   const contract = await sdk.deploy({ name: 'CoasterToken', symbol: 'CSTR', ... })
 *   await contract.recordMerchSale(saleAmountNight)
 *   const earned = await contract.claimRevenue()
 *
 * Run:
 *   npm run compile:nightfun   (add to package.json scripts)
 *   WALLET_SEED=<hex> npx tsx scripts/night-fun.ts
 */

process.on('uncaughtException', (err: unknown) => {
  console.error('Uncaught:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled:', reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

import * as path   from 'node:path';
import * as fs     from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer }  from 'buffer';
import { WebSocket } from 'ws';
import * as Rx     from 'rxjs';

import * as ledger    from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
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

// @ts-expect-error: required for Apollo WS transport
globalThis.WebSocket = WebSocket;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetworkConfig {
  indexer:     string;
  indexerWS:   string;
  node:        string;
  proofServer: string;
}

/**
 * DeployParams — everything the launch wizard collects.
 *
 * Micro (coaster maker):
 *   { name: 'HandcraftedCoasters', symbol: 'CSTR', supply: 1000n,
 *     holderRevBps: 8000, tiers: [0n,0n,0n,0n], requireLicense: false }
 *
 * Enterprise (Coca-Cola):
 *   { name: 'CocaColaToken', symbol: 'COKE', supply: 1_000_000_000n,
 *     holderRevBps: 6000, tiers: [100n, 1000n, 10_000n, 100_000n],
 *     requireLicense: true }
 */
export interface DeployParams {
  name:           string;   // up to 32 chars
  symbol:         string;   // up to 8 chars
  supply:         bigint;
  holderRevBps:   number;   // 0–9500 (platform always keeps 500)
  tiers:          [bigint, bigint, bigint, bigint]; // [bronze, silver, gold, platinum]
  requireLicense: boolean;
}

export interface MerchSale {
  orderId:          string;   // Printful order ID (for logging)
  amountNight:      bigint;   // total NIGHT received for this sale
}

export type HolderTier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

const TIER_NAMES: HolderTier[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ZK_PATH      = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-fun-token');
const CONTRACT_JS  = path.join(ZK_PATH, 'contract', 'index.js');

// ─── Network config ───────────────────────────────────────────────────────────

const NETWORK = (process.env.MIDNIGHT_NETWORK ?? 'preprod') as any;
setNetworkId(NETWORK);

const DEFAULT_CONFIG: NetworkConfig = {
  indexer:     process.env.INDEXER_URI      ?? 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS:   process.env.INDEXER_WS_URI   ?? 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node:        process.env.NODE_URI         ?? 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
};

// ─── Wallet helpers (mirrors deploy.ts) ──────────────────────────────────────

function deriveKeys(seed: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('HDWallet seed failed');
  const result = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();
  return result.keys;
}

async function buildWallet(seed: string, cfg: NetworkConfig) {
  const keys        = deriveKeys(seed);
  const networkId   = getNetworkId();
  const shieldedSKs = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSK      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore    = createKeystore(keys[Roles.NightExternal], networkId);

  const baseConfig = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: cfg.indexer, indexerWsUrl: cfg.indexerWS },
    provingServerUrl: new URL(cfg.proofServer),
    relayURL:         new URL(cfg.node.replace(/^http/, 'ws')),
  };

  const shielded    = ShieldedWallet(baseConfig).startWithSecretKeys(shieldedSKs);
  const unshielded  = UnshieldedWallet({
    networkId,
    indexerClientConnection: baseConfig.indexerClientConnection,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(keystore));
  const dust = DustWallet({
    ...baseConfig,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  }).startWithSecretKey(dustSK, ledger.LedgerParameters.initialParameters().dust);

  const wallet = new WalletFacade(shielded, unshielded, dust);
  await wallet.start(shieldedSKs, dustSK);
  return { wallet, shieldedSKs, dustSK, keystore };
}

function signIntents(
  tx: { intents?: Map<number, any> },
  signFn: (p: Uint8Array) => ledger.Signature,
  marker: 'proof' | 'pre-proof',
) {
  if (!tx.intents?.size) return;
  for (const seg of tx.intents.keys()) {
    const intent = tx.intents.get(seg);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature', marker, 'pre-binding', intent.serialize(),
    );
    const sig = signFn(cloned.signatureData(seg));
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: any, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? sig,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: any, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? sig,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(seg, cloned);
  }
}

async function makeProviders(ctx: Awaited<ReturnType<typeof buildWallet>>, cfg: NetworkConfig) {
  const state  = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  const signFn = (p: Uint8Array) => ctx.keystore.signData(p);

  const walletAndMidnight = {
    getCoinPublicKey()        { return state.shielded.coinPublicKey.toHexString(); },
    getEncryptionPublicKey()  { return state.shielded.encryptionPublicKey.toHexString(); },
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

  const zkConfigProvider = new NodeZkConfigProvider(ZK_PATH);

  return {
    walletProvider:      walletAndMidnight,
    midnightProvider:    walletAndMidnight,
    publicDataProvider:  indexerPublicDataProvider(cfg.indexer, cfg.indexerWS),
    proofProvider:       httpClientProofProvider(cfg.proofServer, zkConfigProvider),
    zkConfigProvider,
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'night-fun-token-state',
      walletProvider: walletAndMidnight,
    }),
  };
}

// ─── String ↔ Bytes<32> helpers ──────────────────────────────────────────────

function strToBytes32(s: string): Uint8Array {
  const buf = new Uint8Array(32);
  const encoded = new TextEncoder().encode(s.slice(0, 32));
  buf.set(encoded);
  return buf;
}

function strToBytes8(s: string): Uint8Array {
  const buf = new Uint8Array(8);
  const encoded = new TextEncoder().encode(s.slice(0, 8));
  buf.set(encoded);
  return buf;
}

// ─── Compiled contract loader ─────────────────────────────────────────────────

async function loadCompiledContract(secretKey: Uint8Array, tokenBalance: bigint) {
  if (!fs.existsSync(CONTRACT_JS)) {
    throw new Error(
      `NightFunToken not compiled. Run:\n` +
      `  npx compactc contracts/NightFunToken.compact contracts/managed/night-fun-token`,
    );
  }

  const NightFunToken = await import(pathToFileURL(CONTRACT_JS).href);

  return CompiledContract
    .make('night-fun-token', NightFunToken.Contract)
    .pipe(
      CompiledContract.withWitnesses({
        // Private secret key — never leaves the client
        localSecretKey: () => secretKey,
        // Caller's current token balance (private witness for balance proofs)
        holderTokenBalance: () => tokenBalance,
        // Balance at a historical epoch (for revenue claims)
        callerEpochSnapshot: () => tokenBalance,
      }),
      CompiledContract.withCompiledFileAssets(ZK_PATH),
    );
}

// ─── NightFunContract — live handle on a deployed contract ───────────────────

export class NightFunContract {
  constructor(
    private readonly deployed: any,
    private readonly providers: Awaited<ReturnType<typeof makeProviders>>,
    private readonly secretKey: Uint8Array,
    public  readonly address: string,
    public  readonly symbol:  string,
  ) {}

  // ── Token transfers ─────────────────────────────────────────────────────────

  /**
   * Transfer tokens to a recipient's ZK commitment.
   * Neither amount nor sender identity is revealed on-chain.
   */
  async transfer(recipientCommitment: Uint8Array, amount: bigint): Promise<string> {
    console.log(`  → Transfer ${amount} ${this.symbol} to commitment ${Buffer.from(recipientCommitment).toString('hex').slice(0, 16)}…`);
    const result = await this.deployed.callTx.transfer(recipientCommitment, amount);
    return result.public.txId;
  }

  // ── Merch oracle ────────────────────────────────────────────────────────────

  /**
   * Record a confirmed Printful sale on-chain.
   * Called by Night Markets backend webhook handler.
   * Splits revenue immediately into holder pool + creator pending.
   *
   * @param sale  { orderId, amountNight } — orderId for logging only
   */
  async recordMerchSale(sale: MerchSale): Promise<string> {
    console.log(`  → Recording sale ${sale.orderId}: ${sale.amountNight} NIGHT`);
    const result = await this.deployed.callTx.recordMerchSale(sale.amountNight);
    console.log(`  ✓ Sale recorded — tx: ${result.public.txId}`);
    return result.public.txId;
  }

  /**
   * Close the current revenue epoch (weekly cron or manual).
   * After closing, holders can claim the closed epoch's revenue.
   */
  async closeEpoch(): Promise<{ txId: string; closedEpoch: bigint }> {
    const result = await this.deployed.callTx.closeEpoch();
    console.log(`  ✓ Epoch closed — tx: ${result.public.txId}`);
    return { txId: result.public.txId, closedEpoch: result.public.result };
  }

  // ── Holder actions ──────────────────────────────────────────────────────────

  /**
   * Claim revenue for one epoch.
   * Caller proves they held tokens — balance never revealed.
   * Returns NIGHT earned (bigint).
   */
  async claimRevenue(epochsToClaim: number = 1): Promise<{ txId: string; earned: bigint }> {
    const result = await this.deployed.callTx.claimRevenue(epochsToClaim);
    const earned = result.public.result as bigint;
    console.log(`  ✓ Claimed ${earned} NIGHT — tx: ${result.public.txId}`);
    return { txId: result.public.txId, earned };
  }

  /**
   * Get the caller's membership tier without revealing their balance.
   * Returns: 'none' | 'bronze' | 'silver' | 'gold' | 'platinum'
   */
  async getHolderTier(): Promise<HolderTier> {
    const result = await this.deployed.callTx.getHolderTier();
    return TIER_NAMES[Number(result.public.result)] ?? 'none';
  }

  /**
   * ZK proof that caller is a holder. Used for UI badges and gating.
   * No identity or balance revealed.
   */
  async proveHolder(): Promise<boolean> {
    try {
      await this.deployed.callTx.proveHolder();
      return true;
    } catch {
      return false;
    }
  }

  // ── Creator actions ─────────────────────────────────────────────────────────

  /** Creator withdraws accumulated revenue share. */
  async creatorClaim(): Promise<{ txId: string; amount: bigint }> {
    const result = await this.deployed.callTx.creatorClaim();
    return { txId: result.public.txId, amount: result.public.result as bigint };
  }

  // ── Enterprise licence management ───────────────────────────────────────────

  /**
   * Grant a regional licence to a holder commitment.
   * Enterprise only — no-op if requireLicense was false at deploy.
   */
  async grantLicense(holderCommitment: Uint8Array): Promise<string> {
    const result = await this.deployed.callTx.grantLicense(holderCommitment);
    return result.public.txId;
  }

  async revokeLicense(holderCommitment: Uint8Array): Promise<string> {
    const result = await this.deployed.callTx.revokeLicense(holderCommitment);
    return result.public.txId;
  }

  // ── Emergency controls ──────────────────────────────────────────────────────

  async pause():   Promise<string> { return (await this.deployed.callTx.pause()).public.txId;   }
  async unpause(): Promise<string> { return (await this.deployed.callTx.unpause()).public.txId; }

  // ── Public ledger reads (no proof needed) ───────────────────────────────────

  /** Read public stats from the indexer. No wallet required. */
  async publicStats() {
    const state = await this.deployed.ledger;
    return {
      totalSales:        Number(state.total_sales?.value ?? 0n),
      totalRevenue:      state.total_merch_revenue?.member
        ? state.total_merch_revenue.lookup(strToBytes32('rev'))
        : 0n,
      totalHolders:      Number(state.total_holders?.value ?? 0n),
      currentEpoch:      Number(state.current_epoch?.value ?? 0n),
    };
  }
}

// ─── NightFunSDK — top-level entry point ─────────────────────────────────────

export class NightFunSDK {
  private constructor(
    private readonly ctx:       Awaited<ReturnType<typeof buildWallet>>,
    private readonly providers: Awaited<ReturnType<typeof makeProviders>>,
    private readonly secretKey: Uint8Array,
    public  readonly address:   string,
  ) {}

  /**
   * Connect with a wallet seed.
   * Call once, reuse the SDK instance for all operations.
   */
  static async connect(seed: string, cfg: NetworkConfig = DEFAULT_CONFIG): Promise<NightFunSDK> {
    console.log(`\n🌙 NightFunSDK — connecting to ${NETWORK}`);
    const ctx       = await buildWallet(seed, cfg);
    const providers = await makeProviders(ctx, cfg);

    // Wait for wallet sync
    const state = await Rx.firstValueFrom(
      ctx.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s: any) => s.isSynced),
      ),
    );
    const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const walletAddress = ctx.keystore.getBech32Address();
    console.log(`  ✓ Synced  |  ${walletAddress}  |  tNight: ${tNight.toLocaleString()}`);

    // Derive a stable private secret key for ZK commitments
    const keys     = deriveKeys(seed);
    const secretKey = keys[Roles.NightExternal].slice(0, 32);

    return new NightFunSDK(ctx, providers, secretKey, walletAddress);
  }

  /**
   * Deploy a new NightFunToken contract.
   *
   * Micro creator:
   *   sdk.deploy({ name: 'HandcraftedCoasters', symbol: 'CSTR',
   *                supply: 1000n, holderRevBps: 8000,
   *                tiers: [0n,0n,0n,0n], requireLicense: false })
   *
   * Enterprise:
   *   sdk.deploy({ name: 'CocaColaToken', symbol: 'COKE',
   *                supply: 1_000_000_000n, holderRevBps: 6000,
   *                tiers: [100n, 1000n, 10_000n, 100_000n],
   *                requireLicense: true })
   */
  async deploy(params: DeployParams): Promise<NightFunContract> {
    console.log(`\n  Deploying NightFunToken: ${params.name} (${params.symbol})`);
    console.log(`  Supply: ${params.supply.toLocaleString()}  |  Holder rev: ${params.holderRevBps / 100}%`);
    if (params.requireLicense) console.log(`  Enterprise mode: licence gate enabled`);

    const compiled = await loadCompiledContract(this.secretKey, params.supply);

    const deployed = await deployContract(this.providers, {
      compiledContract: compiled,
      privateStateId:   'night-fun-token-state',
      initialPrivateState: {},
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;
    console.log(`  ✓ Deployed: ${contractAddress}`);

    // Call initialize circuit
    console.log(`  Initializing token parameters...`);
    await deployed.callTx.initialize(
      strToBytes32(params.name),
      strToBytes8(params.symbol),
      params.supply,
      params.holderRevBps,
      params.tiers[0],  // bronze
      params.tiers[1],  // silver
      params.tiers[2],  // gold
      params.tiers[3],  // platinum
      params.requireLicense,
    );
    console.log(`  ✓ Token initialized`);

    return new NightFunContract(
      deployed,
      this.providers,
      this.secretKey,
      contractAddress,
      params.symbol,
    );
  }

  /**
   * Attach to an already-deployed contract (e.g. after page reload).
   */
  async attach(contractAddress: string, symbol: string, currentBalance: bigint = 0n): Promise<NightFunContract> {
    console.log(`  Attaching to ${symbol} at ${contractAddress}`);
    const compiled = await loadCompiledContract(this.secretKey, currentBalance);

    const deployed = await findDeployedContract(this.providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId: 'night-fun-token-state',
    });

    return new NightFunContract(deployed, this.providers, this.secretKey, contractAddress, symbol);
  }

  async disconnect(): Promise<void> {
    await this.ctx.wallet.stop();
  }
}

// ─── CLI demo (npm run night-fun) ────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = process.env.WALLET_SEED;
  if (!seed) { console.error('WALLET_SEED not set'); process.exit(1); }

  const sdk = await NightFunSDK.connect(seed);

  // Demo: deploy a coaster token
  const coasterToken = await sdk.deploy({
    name:           'HandcraftedCoasters',
    symbol:         'CSTR',
    supply:         1000n,
    holderRevBps:   8000,    // 80% to holders, 15% to creator, 5% Night Markets
    tiers:          [0n, 0n, 0n, 0n], // no tiers — simple community
    requireLicense: false,
  });

  // Simulate a Printful sale coming in (£28 hoodie → NIGHT equivalent)
  await coasterToken.recordMerchSale({ orderId: 'printful-001', amountNight: 28_000_000n });

  // Close the epoch so holders can claim
  const { closedEpoch } = await coasterToken.closeEpoch();
  console.log(`  Epoch ${closedEpoch} closed — holders can now claim`);

  // Claim revenue (creator is also the initial holder with full supply)
  const { earned } = await coasterToken.claimRevenue();
  console.log(`  Creator earned: ${earned} NIGHT`);

  const stats = await coasterToken.publicStats();
  console.log(`\n  Stats:`, stats);

  await sdk.disconnect();
  console.log('\n✅  NightFunSDK demo complete');
}
