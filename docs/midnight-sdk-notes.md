# Midnight SDK Build Notes
> Session: claude/night-fun-feature-5hJ9W — May 2026

## Version Matrix (working combination)

| Package | Version | Notes |
|---------|---------|-------|
| midnight-js-contracts | 4.0.4 | Uses ledger-v8 for tx construction |
| midnight-js-http-client-proof-provider | 4.0.4 | Calls /check and /prove endpoints |
| compact-js | 2.5.0 | Uses compact-runtime 0.15.0 |
| compact-runtime | 0.15.0 | Must match compiler output |
| ledger-v7 | 7.0.2 | Used internally by wallet-sdk-* |
| ledger-v8 | 8.0.3 | Used by midnight-js-contracts |
| wallet-sdk-facade | 1.0.0 | No static init() — use new WalletFacade() |
| wallet-sdk-dust-wallet | 1.0.0 | Uses ledger-v7 |
| wallet-sdk-shielded | 1.0.0 | Uses ledger-v7 |
| wallet-sdk-unshielded-wallet | 1.0.0 | Uses ledger-v7 |
| proof-server Docker image | midnightntwrk/proof-server:7.0.0 | Compatible with compact 0.30.0 |

## Critical Bug: Ledger v7/v8 WASM Boundary

**Problem:** wallet-sdk-* uses ledger-v7 internally. midnight-js-contracts uses ledger-v8.
Two `_assertClass()` failures occur when fee-balancing a v8 transaction:
1. `v8_tx.feesWithMargin(v7_LedgerParameters)` — wrong LedgerParameters class
2. `v8_boundTx.merge(v7_finalizedDustTx)` — wrong Transaction class

**Fix:** Monkey-patch ledger-v8's Transaction.prototype before any wallet ops:
```typescript
import * as ledger7 from '@midnight-ntwrk/ledger-v7';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const V7LP = (ledger7 as any).LedgerParameters;
const V7Tx = (ledger7 as any).Transaction;
const V8LP = ledger.LedgerParameters;
const V8Tx = (ledger.Transaction as any);

const origFWM = V8Tx.prototype.feesWithMargin;
V8Tx.prototype.feesWithMargin = function(params: any, n: any) {
  if (params instanceof V7LP)
    return origFWM.call(this, V8LP.deserialize(params.serialize()), n);
  return origFWM.call(this, params, n);
};

const origMerge = V8Tx.prototype.merge;
V8Tx.prototype.merge = function(other: any) {
  if (other instanceof V7Tx)
    return origMerge.call(this, V8Tx.deserialize('signature', 'proof', 'binding', other.serialize()));
  return origMerge.call(this, other);
};
```

## Wallet Construction Pattern (wallet-sdk-facade@1.0.0)

`WalletFacade` has **no static init()** — construct sub-wallets explicitly:

```typescript
const relayURL = new URL(nodeUri.replace(/^http/, 'ws'));
const provingServerUrl = new URL(proofServerUri);

// ShieldedWallet needs provingServerUrl AND relayURL
const shieldedWallet = (ShieldedWallet({
  networkId, indexerClientConnection, txHistoryStorage,
  provingServerUrl, relayURL,
}) as any).startWithSecretKeys(shieldedSecretKeys);

// UnshieldedWallet needs no URLs
const unshieldedWallet = (UnshieldedWallet({
  networkId, indexerClientConnection, txHistoryStorage,
}) as any).startWithPublicKey(PublicKey.fromKeyStore(keystore));

// DustWallet needs relayURL (no provingServerUrl)
const dustWallet = (DustWallet({
  networkId, costParameters, indexerClientConnection, txHistoryStorage, relayURL,
}) as any).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
await wallet.start(shieldedSecretKeys, dustSecretKey);
```

## Dust Balance — No balance() Method

`DustWalletState` has `availableCoins[]` not a `balance()` method.
Compute balance by summing coin values:
```typescript
const dustBal = (s: any): bigint =>
  (s?.dust?.availableCoins ?? []).reduce((sum: bigint, c: any) => sum + (c.value ?? 0n), 0n);
```

## Wallet State Shape (FacadeState)

```
state.isSynced          — boolean (all three sub-wallets synced)
state.shielded          — ShieldedWalletState
  .coinPublicKey        — ZswapCoinPublicKey (has .toHexString())
  .encryptionPublicKey  — EncryptionPublicKey (has .toHexString())
  .availableCoins       — coin[]
  .progress             — { appliedIndex, highestIndex, ... }
state.unshielded        — UnshieldedWalletState
  .balances             — Record<tokenRaw, bigint>
  .availableCoins       — coin[]
  .address              — address string
state.dust              — DustWalletState
  .availableCoins       — { value: bigint, ... }[]
  .dustAddress          — bech32 dust address
  .progress
```

## Key Derivation (HDWallet)

```typescript
const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
const result = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
const keys = result.keys;
// keys[Roles.Zswap] → shielded secret keys seed
// keys[Roles.NightExternal] → unshielded signing key
// keys[Roles.Dust] → dust secret key seed
```

## Compact Runtime Version Matching

The compiled contract calls `checkRuntimeVersion('X.Y.Z')` on load.
Minor version must match EXACTLY when major is 0 (semver pre-1.0 rule).
- compact 0.30.0 compiler → runtime 0.15.0 → compact-js 2.5.0
- compact-js 2.4.0 uses runtime 0.14.0 → FAILS with 0.15.0 contracts

Always check `contracts/managed/<name>/compiler/contract-info.json` for
`runtime-version` and ensure compact-js version matches.

## Proof Server

- Docker image: `midnightntwrk/proof-server:7.0.0`
- Listens on port 6300
- Endpoints used by midnight-js: `POST /check`, `POST /prove`
- Compatible with compact 0.30.0 compiled circuits
- Start: `docker run -p 6300:6300 midnightntwrk/proof-server:7.0.0 -- midnight-proof-server -v`

## Preprod Config

```
MIDNIGHT_NETWORK=preprod
INDEXER_URI=https://indexer.preprod.midnight.network/api/v4/graphql
INDEXER_WS_URI=wss://indexer.preprod.midnight.network/api/v4/graphql/ws
NODE_URI=https://rpc.preprod.midnight.network
PROOF_SERVER_URI=http://127.0.0.1:6300
```

## .env on Windows PowerShell (avoid UTF-8 BOM)

`Out-File -Encoding utf8` adds a BOM that breaks Node's `--env-file`.
Use instead:
```powershell
[System.IO.File]::WriteAllText("C:\path\.env", "KEY=value`n")
```

## package.json Gotchas

- Do NOT override `compact-js` — it pins the wrong runtime version
- The `smoldot` override (`npm:@aspect-build/empty@0.0.0`) is needed to
  avoid pulling in the WASM smoldot light client
- `ledger-v7` override pins to 7.0.2 to prevent version conflicts
