# Night Ecosystem — Full Launch Roadmap

Last audited: 2026-05-06

This is the master checklist from current state to full public launch.
Work through phases in order. Check items off as they are completed.

---

## Current State (Honest Assessment)

**🚨 MIDNIGHT MAINNET IS LIVE (Kūkolu phase, ~May 2026)**
All deployments should now target **mainnet**, not preprod.

| Repo | Contract | Deployed | Frontend | Live URL | SDK OK |
|---|---|---|---|---|---|
| night-markets | ✅ | ✅ preprod | ✅ | ✅ gh-pages | ✅ |
| night-poker | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-fun | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-lend | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-work | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-save | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-biz | ✅ | ❌ | ✅ | ✅ gh-pages | ✅ fixed |
| night-id | ❌ no contract | ❌ | ✅ | ✅ gh-pages | — |
| night-store | ❌ no contract | ❌ | ✅ | ✅ gh-pages | — |
| night-hub | — | — | ✅ | ✅ gh-pages | — |
| midnight-ai-kit | — | — | — | — | — |

**Phase 1+2 done:** All 10 repos on gh-pages. All 6 deploy scripts fixed. Ready to deploy contracts.

---

## PHASE 1 — Get Everything Publicly Visible ✅ COMPLETE 2026-05-03
*Goal: All apps live on GitHub Pages. Night Hub is the working front door.*

- [x] **night-hub** → https://kingmunz1994-lgtm.github.io/night-hub/
- [x] **night-poker** → https://kingmunz1994-lgtm.github.io/night-poker/
- [x] **night-fun** → https://kingmunz1994-lgtm.github.io/night-fun/
- [x] **night-lend** → https://kingmunz1994-lgtm.github.io/night-lend/
- [x] **night-work** → https://kingmunz1994-lgtm.github.io/night-work/
- [x] **night-save** → https://kingmunz1994-lgtm.github.io/night-save/
- [x] **night-biz** → https://kingmunz1994-lgtm.github.io/night-biz/
- [x] **night-id** → https://kingmunz1994-lgtm.github.io/night-id/
- [x] **night-store** → https://kingmunz1994-lgtm.github.io/night-store/
- [x] **night-markets** → https://kingmunz1994-lgtm.github.io/night-markets/
- [ ] Verify all links in night-hub load correctly (allow 2-3 min for CDN propagation)
- [ ] Verify night-markets `night-poker/` link points to night-poker repo URL

---

## PHASE 2 — Fix SDK Bugs Across All Deploy Scripts ✅ COMPLETE 2026-05-06
*Goal: Every repo can actually deploy its contract.*

Three fixes applied to every repo's `scripts/deploy.ts` + `package.json`:
- Fix 1: `readyFilter` replaces `s.isSynced` (waits unshielded only, avoids 2.5h shielded scan)
- Fix 2: Ledger v7/v8 WASM bridge added (prevents `_assertClass` crash in `deployContract`)
- Fix 3: compact-js 2.4.0 → 2.5.0, compact-runtime 0.14.0 → 0.15.0

- [x] **night-poker** — all 3 fixes applied, package.json upgraded
- [x] **night-fun** — all 3 fixes applied, package.json upgraded
- [x] **night-lend** — all 3 fixes applied, package.json upgraded
- [x] **night-work** — all 3 fixes applied, package.json upgraded
- [x] **night-save** — all 3 fixes applied, package.json upgraded
- [x] **night-biz** — all 3 fixes applied, package.json upgraded

---

## PHASE 3 — Deploy All Contracts to Mainnet
*Goal: Every app has a real on-chain contract. Midnight mainnet is live — target it directly.*
*Prerequisite: Phase 2 complete. Docker proof server running locally.*

### Priority order (night-poker first — best onboarding vehicle for DUST holders):

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

## Funding & Ecosystem Opportunities

- [ ] **Eclipse Bounty** — Tier 1 ($300–500 NIGHT): Write honest dev comparison article
  (Midnight vs Aztec vs Aleo vs Mina vs Zcash). Draft exists from chat. Needs code examples,
  personal Night Markets experience woven in, and heavy rewrite to avoid AI detection.
  Publish on Dev.to. Tag @midnightntwrk. Comment "Ready for review" when done.
- [ ] **Midnight Build Club** — 2-month accelerator, apply at mpc.midnight.network
  Bring: GitHub repos, preprod demo video, short pitch on Night Markets ecosystem value
- [ ] **Project Catalyst** — Midnight Compact DApps track. Non-dilutive treasury grant.
  Apply once Build Club/bounty gives more credibility and content.

---

## PHASE 9 — Full Public Launch
*Midnight mainnet is live. Phase 9 is now about scaling, not waiting for mainnet.*

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
