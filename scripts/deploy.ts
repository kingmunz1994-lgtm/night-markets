import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { UnshieldedWallet, createKeystore, InMemoryTransactionHistoryStorage, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
globalThis.WebSocket = WebSocket;
setNetworkId('preprod');
const CONFIG = { indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql', indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws', node: 'https://rpc.preprod.midnight.network', proofServer: 'http://127.0.0.1:6300' };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'night-markets-escrow');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
function deriveKeysFromSeed(seed) { const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex').length === 32 ? Buffer.from(seed, 'hex') : Buffer.from(seed, 'hex')); if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed'); const result = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0); if (result.type !== 'keysDerived') throw new Error('Key derivation failed'); hdWallet.hdWallet.clear(); return result.keys; }
function signTransactionIntents(tx, signFn, proofMarker) { if (!tx.intents || tx.intents.size === 0) return; for (const segment of tx.intents.keys()) { const intent = tx.intents.get(segment); if (!intent) continue; const cloned = ledger.Intent.deserialize('signature', proofMarker, 'pre-binding', intent.serialize()); const signature = signFn(cloned.signatureData(segment)); if (cloned.fallibleUnshieldedOffer) { const sigs = cloned.fallibleUnshieldedOffer.inputs.map((_,i) => cloned.fallibleUnshieldedOffer.signatures.at(i) ?? signature); cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs); } if (cloned.guaranteedUnshieldedOffer) { const sigs = cloned.guaranteedUnshieldedOffer.inputs.map((_,i) => cloned.guaranteedUnshieldedOffer.signatures.at(i) ?? signature); cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs); } tx.intents.set(segment, cloned); } }
async function createWallet(seed) { const keys = deriveKeysFromSeed(seed); const networkId = getNetworkId(); const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]); const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]); const unshieldedKS = createKeystore(keys[Roles.NightExternal], networkId); const walletConfig = { networkId, indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS }, provingServerUrl: new URL(CONFIG.proofServer), relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')) }; const shieldedWallet = ShieldedWallet(walletConfig).startWithSecretKeys(shieldedKeys); const unshieldedWallet = UnshieldedWallet({ networkId, indexerClientConnection: walletConfig.indexerClientConnection, txHistoryStorage: new InMemoryTransactionHistoryStorage() }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKS)); const dustWallet = DustWallet({ ...walletConfig, costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 } }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust); const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet); await wallet.start(shieldedKeys, dustSecretKey); return { wallet, shieldedKeys, dustSecretKey, unshieldedKS }; }
async function main() { console.log('\n🌙 Night Markets — Deploying to Preprod\n'); if (!fs.existsSync(contractPath)) { console.error('❌ Contract not compiled. Run: npm run compile'); process.exit(1); } const seed = process.env.WALLET_SEED ?? toHex(Buffer.from(generateRandomSeed())); const ctx = await createWallet(seed); console.log('  Waiting for wallet sync...'); const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced))); console.log('  Address:', ctx.unshieldedKS.getBech32Address().toString());
  console.log('  Unshielded coins:', state.unshielded.availableCoins.length);
  console.log('  Registering NIGHT UTXOs for DUST generation...');
  try { await ctx.wallet.registerNightUtxosForDustGeneration(); console.log('  ✓ Registered'); } catch(e) { console.log('  (already registered or no UTXOs yet)'); }
  console.log('  Waiting for DUST...');
  await new Promise(r => setTimeout(r, 60000));
  const freshState = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const dustBalance = freshState.dust.walletBalance(new Date()); if (dustBalance === 0n) throw new Error('DUST balance is zero'); console.log('  ✓ DUST:', dustBalance.toString()); const signFn = (payload) => ctx.unshieldedKS.signData(payload); const walletAndMidnightProvider = { getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(), getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(), async balanceTx(tx, ttl) { const recipe = await ctx.wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys: ctx.shieldedKeys, dustSecretKey: ctx.dustSecretKey }, { ttl: ttl ?? new Date(Date.now() + 30*60*1000) }); signTransactionIntents(recipe.baseTransaction, signFn, 'proof'); if (recipe.balancingTransaction) signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof'); return ctx.wallet.finalizeRecipe(recipe); }, submitTx: (tx) => ctx.wallet.submitTransaction(tx) }; const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath); const providers = { walletProvider: walletAndMidnightProvider, midnightProvider: walletAndMidnightProvider, publicDataProvider: indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS), privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'night-markets-state', walletProvider: walletAndMidnightProvider }), proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider), zkConfigProvider }; const NightMarketsEscrow = await import(contractPath); const compiledContract = CompiledContract.make('night-markets-escrow', NightMarketsEscrow.Contract).pipe(CompiledContract.withVacantWitnesses, CompiledContract.withCompiledFileAssets(zkConfigPath)); console.log('  Deploying contract...'); const deployed = await deployContract(providers, { compiledContract, privateStateId: 'escrowState', initialPrivateState: {} }); const contractAddress = deployed.deployTxData.public.contractAddress; console.log('\n✅ Contract deployed!'); console.log('CONTRACT_ADDRESS=' + contractAddress); }
main().catch((err) => { console.error('\n❌ Deploy failed:', err.message); process.exit(1); });




