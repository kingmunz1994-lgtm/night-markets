# Night Markets — Claude Session Guide

Zero-knowledge privacy marketplace on Midnight Network. Read this at the start of every session.

---

## Repo at a Glance

```
contracts/
  NightMarketsEscrow.compact   ← main escrow + governance contract
  NightFunToken.compact        ← token launchpad contract
  managed/
    night-markets-escrow/      ← compiled artifacts (committed, gitignored normally)
    night-fun-token/           ← compiled artifacts

scripts/
  deploy.ts          ← deploy NightMarketsEscrow to preprod
  api-server.ts      ← HTTP API bridge (port 3001) — connects UI to contract
  transact.ts        ← call individual contract circuits
  full-flow.ts       ← end-to-end test (create → fund → release)
  night-fun.ts       ← NightFunToken operations
  dust-sponsor.ts    ← DUST fee sponsorship service (port 3002)
  set-contract-address.ts ← update contract address across all files in one shot
  probe.ts           ← inspect contract state

index.html           ← main marketplace UI (single-file, no build step)
landing.html         ← landing page
night-identity.html  ← Night-ID (.night name service) UI
docs/midnight-sdk-notes.md ← SDK gotchas reference (read before touching SDK code)
```

---

## Deployed Contracts (Preprod)

| Contract | Address | Block |
|---|---|---|
| NightMarketsEscrow | `7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711` | 127,350 |
| NightFunToken | not deployed | — |

After a preprod network reset, run:
```
npm run deploy
npm run set-address <new-address>
```

---

## What's Done ✅

### Contracts
- [x] `NightMarketsEscrow.compact` — escrow lifecycle + ZK auth + governance voting
- [x] `NightFunToken.compact` — token launch, transfers, epochs, merch revenue, royalties
- [x] Both compiled with compact 0.30.0 / runtime 0.15.0
- [x] NightMarketsEscrow live on preprod at address above

### SDK / Deploy infrastructure
- [x] `deploy.ts` — fully working (all known bugs fixed, see SDK Fixes below)
- [x] `api-server.ts` — fixed and ready to run
- [x] `set-contract-address.ts` — patches .env + all hardcoded addresses in one command
- [x] Wallet state persistence (`.wallet-state/`) — avoids 2.5h rescan on every run
- [x] `docs/midnight-sdk-notes.md` — SDK version matrix, all gotchas documented

### Frontend
- [x] `index.html` — full marketplace UI wired to contract address
- [x] Lace + Nocturne wallet connect support
- [x] DUST sponsorship skeleton (`/api/sponsor` proxied through api-server)

---

## What's Pending 🔲

### Immediate
- [ ] Run `npm run api-server` and test full UI flow end-to-end in browser
- [ ] Test wallet connect (Lace) → createListing → fundEscrow → releaseEscrow
- [ ] Fix any issues surfaced by the above test

### NightFunToken
- [ ] Deploy NightFunToken contract to preprod
- [ ] Wire `night-fun.ts` script to deployed address
- [ ] Test token launch + transfer flow

### Scripts not yet audited for SDK bugs
- [ ] `full-flow.ts` — likely has same `s.isSynced` and `dustBal` bugs as deploy.ts had
- [ ] `transact.ts` — same
- [ ] `night-fun.ts` — same
- [ ] `dust-sponsor.ts` — same + uses `s.isSynced` wait that will hang forever

### Ecosystem repos (separate repos, not in this directory)
Per DEPLOY.md these are planned but don't exist yet:
- [ ] night-work (task marketplace)
- [ ] night-lend (lending protocol)
- [ ] night-save (vault + sUSD)
- [ ] night-biz (loyalty tokens)
- [ ] night-poker (ZK poker room)

### Infrastructure
- [ ] DUST sponsorship backend — `/api/sponsor` endpoint needs `dust-sponsor.ts` running
  with a funded sponsor wallet. Blocked until Mōhalu (mid-2026) for mainnet auto-refill.
- [ ] Compact 0.31.0 / runtime 0.16.0 upgrade — wait for compact-js 2.6.0 on npm,
  then: upgrade package.json, recompile contracts, redeploy.

---

## SDK Fixes Applied (Critical — Don't Revert)

All of these were hard-won. See `docs/midnight-sdk-notes.md` for full explanation.

### 1. Ledger v7/v8 WASM bridge (deploy.ts, api-server.ts)
wallet-sdk-* v1.0.0 uses ledger-v7 internally. midnight-js-contracts@4.0.4 uses ledger-v8.
The bridge patches ledger-v8 Transaction prototype to accept v7 objects via serialize/deserialize.
Any new script that calls `wallet.balanceUnboundTransaction()` needs this bridge.

### 2. Secret keys must be ledger-v7
`ZswapSecretKeys.fromSeed()` and `DustSecretKey.fromSeed()` must use `ledger7` (v7), not `ledger` (v8).
The wallet SDK's `_assertClass` checks fail if you pass v8 types.

### 3. DustParameters must be ledger-v7
`LedgerParameters.initialParameters().dust` must come from ledger-v7.

### 4. Never wait on `s.isSynced`
`WalletFacade.isSynced` requires ALL THREE wallets (shielded, unshielded, dust) to be
at `isStrictlyComplete()`. Shielded + dust wallet scan all 313k+ preprod blocks from genesis
on first run (~2.5h each). Only wait on unshielded:
```typescript
const readyFilter = (s: any) =>
  (s.unshielded?.progress?.isCompleteWithin?.(50n) ?? false) || dustBal(s) > 0n;
```

### 5. DustWalletState has no balance() method
Use:
```typescript
const dustBal = (s: any): bigint =>
  (s?.dust?.availableCoins ?? []).reduce((sum, c) => sum + (c.value ?? 0n), 0n);
```

### 6. WalletFacade constructor (not static init)
`new WalletFacade(shielded, unshielded, dust)` — there is no `WalletFacade.init()`.

### 7. compact-js version → compact-runtime version
| compact-js | compact-runtime | compact compiler |
|---|---|---|
| 2.4.0 | 0.14.0 | 0.29.x |
| 2.5.0 | 0.15.0 | 0.30.0 |
| 2.6.0 (pending) | 0.16.0 | 0.31.0 |

The compiled contract checks runtime version at load. Minor mismatch throws immediately.

---

## Environment (.env)

```
WALLET_SEED=10ad5724e540f692f5a8bba4984cdc1e447fc32e4dbc302cd78c2382dd4e4094
MIDNIGHT_NETWORK=preprod
INDEXER_URI=https://indexer.preprod.midnight.network/api/v4/graphql
INDEXER_WS_URI=wss://indexer.preprod.midnight.network/api/v4/graphql/ws
NODE_URI=https://rpc.preprod.midnight.network
PROOF_SERVER_URI=http://127.0.0.1:6300
```

## Running Locally (Windows)

```powershell
# Terminal 1 — proof server (Docker required)
npm run proof-server

# Terminal 2 — API server
npm run api-server

# Terminal 3 — static file server
npm run serve
# open http://localhost:3000
```

## Wallet State Cache

`.wallet-state/dust.json` and `.wallet-state/unshielded.json` are saved after each sync.
Delete them to force a full rescan (needed after network reset or seed change).

## Git Branch

Active branch: `claude/night-fun-feature-5hJ9W`
Push target: `kingmunz1994-lgtm/night-markets`
