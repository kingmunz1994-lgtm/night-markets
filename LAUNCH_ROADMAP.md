# Night Ecosystem — Full Launch Roadmap

Last audited: 2026-05-03

This is the master checklist from current state to full public launch.
Work through phases in order. Check items off as they are completed.

---

## Current State (Honest Assessment)

| Repo | Contract | Deployed | Frontend | Live URL | SDK OK |
|---|---|---|---|---|---|
| night-markets | ✅ | ✅ preprod | ✅ | ✅ gh-pages | ✅ |
| night-poker | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-fun | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-lend | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-work | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-save | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-biz | ✅ | ❌ | ✅ | ❌ no gh-pages | ❌ isSynced bug |
| night-id | ❌ no contract | ❌ | ✅ | ❌ no gh-pages | — |
| night-store | ❌ no contract | ❌ | ✅ | ❌ no gh-pages | — |
| night-hub | — | — | ✅ | ❌ no gh-pages | — |
| midnight-ai-kit | — | — | — | — | — |

**Critical gap:** night-hub links to 8 app URLs that all 404. Nothing is publicly reachable
except night-markets. The whole ecosystem is invisible to anyone clicking through.

---

## PHASE 1 — Get Everything Publicly Visible
*Goal: All apps live on GitHub Pages. Night Hub is the working front door.*
*Effort: Low. No contract work needed. Just deploy public/ folders to gh-pages.*

- [ ] **night-hub** — deploy `public/` to gh-pages → becomes the ecosystem homepage
- [ ] **night-poker** — deploy `public/` to gh-pages → `kingmunz1994-lgtm.github.io/night-poker/`
- [ ] **night-fun** — deploy `public/` to gh-pages
- [ ] **night-lend** — deploy `public/` to gh-pages
- [ ] **night-work** — deploy `public/` to gh-pages
- [ ] **night-save** — deploy `public/` to gh-pages
- [ ] **night-biz** — deploy `public/` to gh-pages
- [ ] **night-id** — deploy `public/` to gh-pages
- [ ] **night-store** — deploy `public/` to gh-pages
- [ ] Verify all 8 links in night-hub resolve correctly
- [ ] Verify night-markets `night-poker/index.html` link points to correct night-poker URL

---

## PHASE 2 — Fix SDK Bugs Across All Deploy Scripts
*Goal: Every repo can actually deploy its contract. Currently all 6 will hang forever.*
*The isSynced bug means deploy.ts in every repo waits 2.5h+ and then hangs.*

The same 3 fixes are needed in every repo's `scripts/deploy.ts`:

```typescript
// Fix 1: Replace isSynced wait with this
const dustBal = (s: any): bigint =>
  (s?.dust?.availableCoins ?? []).reduce((sum: bigint, c: any) => sum + (c.value ?? 0n), 0n);
const readyFilter = (s: any) =>
  (s.unshielded?.progress?.isCompleteWithin?.(50n) ?? false) || dustBal(s) > 0n;

// Fix 2: Add ledger v7/v8 bridge (copy from night-markets/scripts/deploy.ts)

// Fix 3: Upgrade compact-js 2.4.0 → 2.5.0 and compact-runtime 0.14.0 → 0.15.0 in package.json
```

- [ ] **night-poker** — apply 3 fixes, upgrade package.json versions
- [ ] **night-fun** — apply 3 fixes, upgrade package.json versions
- [ ] **night-lend** — apply 3 fixes, upgrade package.json versions
- [ ] **night-work** — apply 3 fixes, upgrade package.json versions
- [ ] **night-save** — apply 3 fixes, upgrade package.json versions
- [ ] **night-biz** — apply 3 fixes, upgrade package.json versions

---

## PHASE 3 — Deploy All Contracts to Preprod
*Goal: Every app has a real on-chain contract. Priority = DUST holder utility.*
*Prerequisite: Phase 2 complete. Docker proof server running locally.*

### Priority order (most utility for DUST holders first):

- [ ] **night-poker** — `npm run compile && npm run deploy` in night-poker repo
  - Record contract address in night-poker README + .env
  - Wire WS handler to on-chain `commitHand` / `claimPot` at showdown
- [ ] **night-fun** — deploy NightFunToken, wire bonding curve to real contract
  - Record address, update frontend API calls
  - Test: launch token → buy → sell → graduate curve
- [ ] **night-markets NightFunToken** — deploy the copy in night-markets repo
  - Run `npm run set-address <new-address>` after deploy
- [ ] **night-lend** — deploy NightLend
  - Test: deposit NIGHT → borrow sUSD → repay → withdraw
- [ ] **night-work** — deploy NightWork
  - Test: postTask → acceptTask → submitProof → verifyTask → claimReward
- [ ] **night-save** — deploy NightSave
  - Test: deposit → mint sUSD → BNPL flow → repay → redeem
- [ ] **night-biz** — deploy NightBizToken
  - Test: deploy token → transfer → proveTierStatus
- [ ] Update CLAUDE.md with all deployed contract addresses after each deploy

---

## PHASE 4 — night-id Contract (Missing)
*Goal: ZK identity layer that every other app can plug into.*
*night-id has a frontend but NO contract. Needs to be written.*

- [ ] Write `NightID.compact` — key circuits:
  - `registerName(name: Bytes<32>)` — claim a .night name, ZK auth
  - `resolveName(name: Bytes<32>) → Bytes<32>` — name → address commitment
  - `proveAttribute(attrKey, attrValue)` — ZK: prove claim without revealing it
  - `issueCredential(subject, key, value)` — issuer grants attribute
- [ ] Deploy NightID contract to preprod
- [ ] Wire night-id frontend to contract (currently in-memory only)
- [ ] Connect night-hub Night Score to NightID on-chain data

---

## PHASE 5 — night-store Integration
*Goal: Real merch shop powered by NIGHT tokens via Night Fun merch revenue.*
*night-store has a frontend but no contract. It integrates with NightFunToken.*

- [ ] Wire night-store to NightFunToken `recordMerchSale()` circuit
- [ ] Implement stripe/payment → NIGHT conversion flow (or NIGHT-direct checkout)
- [ ] Connect merch revenue → epoch royalty distribution for token holders
- [ ] Test: purchase → `recordMerchSale` → epoch close → holder claims royalty

---

## PHASE 6 — Cross-App Integration (Night Score + NIGHT Token)
*Goal: The ecosystem feels connected. Night Hub shows live data. Night Score means something.*

- [ ] **Night Score** (night-hub) — pull real on-chain data:
  - Hands played (night-poker contract)
  - Tokens launched (night-fun contract)
  - ZK proofs submitted (any contract call)
  - Tasks completed (night-work)
- [ ] **NIGHT token** — currently simulated in all UIs. Wire to real tNIGHT balance via wallet
- [ ] **night-hub live stats** — TVL (night-lend + night-save), active tables (night-poker),
  tokens launched (night-fun), tasks open (night-work)
- [ ] **night-markets api-server** — ensure all ecosystem API routes proxy to real contract
  state rather than in-memory simulation

---

## PHASE 7 — End-to-End Testing
*Goal: Every app's golden path works with a real Lace wallet on preprod.*

- [ ] night-markets: Lace connect → create listing → fund escrow → release → check NIGHT received
- [ ] night-poker: create room → 2 players join → play hand → ZK showdown → pot claimed
- [ ] night-fun: connect → launch token → buy on curve → sell → check graduation at 85 tNIGHT
- [ ] night-lend: deposit NIGHT → borrow sUSD → confirm health factor → repay
- [ ] night-work: post task → accept → submit proof → verify → claim reward
- [ ] night-save: deposit → mint sUSD → BNPL → repay → redeem
- [ ] night-biz: deploy token → transfer to test wallet → prove Bronze tier
- [ ] night-id: register name → resolve → prove attribute

---

## PHASE 8 — Pre-Launch Polish
*Goal: Everything looks and feels production-ready.*

- [ ] All frontends: consistent "Connect Wallet" UX — same flow, same error messages
- [ ] All frontends: tDUST balance shown (requires parseDustAmt fix from night-markets)
- [ ] All frontends: wallet poll backoff (no APIError spam — fix from night-markets)
- [ ] night-hub: add night-store to app grid
- [ ] All README files: update with deployed contract addresses
- [ ] midnight-ai-kit: add patterns extracted from deployed contracts (real addresses, real examples)
- [ ] Verify all GitHub Pages URLs work from a clean browser (no localhost, no cached state)

---

## PHASE 9 — Mainnet / Full Launch
*Blocked on: Midnight mainnet stability + Mōhalu DUST sponsorship (mid-2026)*

- [ ] DUST sponsorship live (`dust-sponsor.ts` with funded wallet) — users don't need tDUST
- [ ] Upgrade all contracts to compact-js 2.6.0 / runtime 0.16.0 when available
- [ ] Deploy all contracts to Midnight mainnet
- [ ] Update all `.env` files and frontends to mainnet endpoints
- [ ] Announce: night-hub as the homepage, all 8 apps linked and live

---

## Quick Reference — Deploy Command Pattern

Same pattern for every repo:
```bash
# 1. In one terminal:
docker run -p 6300:6300 midnightntwrk/proof-server:7.0.0 -- midnight-proof-server -v

# 2. In repo directory:
npm install
npm run compile
WALLET_SEED=<hex> npm run deploy
# → outputs: CONTRACT_ADDRESS=<address>

# 3. Update README + .env with address
```

## Quick Reference — gh-pages Deploy Pattern

Same pattern for every repo (deploy public/ to gh-pages):
```bash
git subtree push --prefix public origin gh-pages
# OR if that fails:
git checkout -b gh-pages-tmp
git add public/ -f
git commit -m "deploy to gh-pages"
git push origin HEAD:gh-pages
git checkout main
git branch -D gh-pages-tmp
```
