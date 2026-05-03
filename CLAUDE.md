# Night Markets — Claude Session Guide

Zero-knowledge privacy marketplace on Midnight Network. Read this at the start of every session.

---

## CRITICAL: Read This Before Writing Any Code

This is ONE repo in a **10-repo ecosystem**. Before building anything, check whether it
already exists in a standalone repo (list below). The ecosystem repos are **real and live** —
do not rebuild them inside night-markets. If a task belongs to another repo, say so.

The `midnight-ai-kit` repo (`kingmunz1994-lgtm/midnight-ai-kit`) was built specifically
to give AI assistants context about this ecosystem. Its `CLAUDE.md` is the Midnight/Compact
language reference. Its `prompts/` folder has ready-made patterns. Use it.

---

## The Full Night Ecosystem

All repos are under `github.com/kingmunz1994-lgtm/`. All have their own contracts,
frontends, and deploy scripts. Do NOT duplicate any of these inside night-markets.

| Repo | What it is | Live URL | SDK version |
|---|---|---|---|
| **night-markets** | Escrow marketplace + API server ← YOU ARE HERE | `kingmunz1994-lgtm.github.io/night-markets/` | compact-js 2.5.0 / runtime 0.15.0 |
| **night-hub** | Central landing page for all Night apps | `kingmunz1994-lgtm.github.io/night-hub/` | — |
| **night-poker** | ZK Texas Hold'em — own `poker.compact`, own frontend, own deploy | `kingmunz1994-lgtm.github.io/night-poker/` | compact-js 2.4.0 / runtime 0.14.0 ⚠️ |
| **night-fun** | ZK token launchpad (pump.fun but private) | `kingmunz1994-lgtm.github.io/night-fun/` | compact-js 2.4.0 |
| **night-lend** | ZK lending protocol — private collateral, 75% LTV | standalone | compact-js 2.4.0 |
| **night-work** | ZK task marketplace — AI agents post bounties, humans earn NIGHT | standalone | compact-js 2.4.0 |
| **night-save** | ZK vault — deposit NIGHT, mint sUSD, BNPL | standalone | compact-js 2.4.0 |
| **night-biz** | ZK loyalty tokens — private tier verification | standalone | compact-js 2.4.0 |
| **night-id** | ZK identity — prove attributes, share nothing | standalone | compact-js 2.4.0 |
| **night-store** | Merch shop powered by NIGHT tokens | standalone | — |
| **midnight-ai-kit** | AI developer toolkit — prompts, patterns, examples for Midnight | standalone | pragma >= 0.22.0 |

⚠️ **night-poker** and all other standalone repos except night-markets are on compact-js 2.4.0
(runtime 0.14.0). They need upgrading to 2.5.0 / 0.15.0 + the SDK fixes documented below.

---

## night-markets Repo at a Glance

```
contracts/
  NightMarketsEscrow.compact   ← main escrow + governance contract
  NightFunToken.compact        ← token launchpad reference (deployed in night-fun repo)
  NightPoker.compact           ← poker contract copy (canonical version is in night-poker repo)
  managed/
    night-markets-escrow/      ← compiled artifacts
    night-fun-token/           ← compiled artifacts

scripts/
  deploy.ts          ← deploy NightMarketsEscrow to preprod
  api-server.ts      ← HTTP API bridge (port 3001) — escrow + poker WS + all ecosystem APIs
  transact.ts        ← call individual contract circuits
  full-flow.ts       ← end-to-end test (create → fund → release)
  night-fun.ts       ← NightFunToken operations
  dust-sponsor.ts    ← DUST fee sponsorship service (port 3002)
  set-contract-address.ts ← update contract address across all files in one shot
  probe.ts           ← inspect contract state

index.html           ← main marketplace UI
landing.html         ← landing page
night-identity.html  ← Night-ID (.night name service) UI
night-poker/
  index.html         ← poker table UI (also lives in night-poker repo)
go.html              ← cache-busting redirect
docs/midnight-sdk-notes.md ← SDK gotchas reference (read before touching SDK code)
```

---

## Deployed Contracts (Preprod)

| Contract | Address | Block |
|---|---|---|
| NightMarketsEscrow | `7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711` | 127,350 |
| NightFunToken | not deployed | — |
| NightPoker | not deployed (canonical: night-poker repo) | — |

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
- [x] `NightPoker.compact` — ZK poker (copy; canonical in night-poker repo)
- [x] NightMarketsEscrow live on preprod

### SDK / Deploy infrastructure
- [x] `deploy.ts` — fully working (all known bugs fixed, see SDK Fixes below)
- [x] `api-server.ts` — HTTP + WebSocket server, poker room management, all ecosystem API routes
- [x] `set-contract-address.ts` — patches .env + all hardcoded addresses in one command
- [x] Wallet state persistence (`.wallet-state/`) — avoids 2.5h rescan on every run
- [x] `docs/midnight-sdk-notes.md` — SDK version matrix, all gotchas documented

### Frontend
- [x] `index.html` — full marketplace UI wired to contract address
- [x] `night-poker/index.html` — poker lobby + table UI with real WS room management
- [x] Lace + Nocturne wallet connect support
- [x] DUST sponsorship skeleton (`/api/sponsor` proxied through api-server)
- [x] `parseDustAmt()` — robust Lace DApp connector balance parser (handles object/bigint/string)
- [x] Wallet poll backoff — stops spamming APIError when Lace is locked

---

## What's Pending 🔲

### night-markets (this repo)
- [ ] Run `npm run api-server` and test full UI flow end-to-end in browser
- [ ] Test wallet connect (Lace) → createListing → fundEscrow → releaseEscrow
- [ ] Scripts not yet audited for SDK bugs: `full-flow.ts`, `transact.ts`, `night-fun.ts`, `dust-sponsor.ts`
  (likely have same `s.isSynced` and `dustBal` bugs as deploy.ts had — see SDK Fixes below)

### night-poker (standalone repo — work there, not here)
- [ ] Upgrade compact-js 2.4.0 → 2.5.0, compact-runtime 0.14.0 → 0.15.0
- [ ] Apply all SDK fixes from this repo (ledger bridge, dustBal, isSynced, WalletFacade constructor)
- [ ] Deploy `poker.compact` to preprod
- [ ] Wire showdown ZK proof (commitHand → claimPot) into WS handler

### All other standalone repos (night-lend, night-work, night-save, night-biz, night-id, night-fun)
- [ ] Same compact-js 2.4.0 → 2.5.0 upgrade needed in each
- [ ] Same SDK fixes needed in each deploy script

### Infrastructure
- [ ] DUST sponsorship backend — `/api/sponsor` needs `dust-sponsor.ts` running with funded sponsor wallet
- [ ] Compact 0.31.0 / runtime 0.16.0 upgrade — wait for compact-js 2.6.0 on npm

---

## midnight-ai-kit Reference

Repo: `kingmunz1994-lgtm/midnight-ai-kit`
Purpose: Developer toolkit with AI-optimised prompts, patterns, and examples for Midnight.
**This kit was built to give Claude context** — read it before building any new Midnight contract.

Key files:
- `CLAUDE.md` — full Compact language reference + privacy rules
- `prompts/shielded-agent-wallet.md` — shielded token wallet pattern
- `prompts/escrow-for-agents.md` — escrow pattern (references live NightMarketsEscrow)
- `prompts/confidential-task-marketplace.md` — task marketplace (Night Work pattern)
- `prompts/agent-to-agent-payments.md` — private agent payments
- `prompts/private-credentials.md` — ZK credential system
- `patterns/` — reusable Compact modules
- `examples/` — working starters: basic-shielded-agent, confidential-escrow, private-credentials

Note: midnight-ai-kit uses `pragma language_version >= 0.22.0` — this is forward-looking for
a future compiler version. Current deployed contracts use `>= 0.20`.

---

## SDK Fixes Applied (Critical — Don't Revert)

All of these were hard-won. See `docs/midnight-sdk-notes.md` for full explanation.
**These fixes also need to be applied to every standalone repo's deploy script.**

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
