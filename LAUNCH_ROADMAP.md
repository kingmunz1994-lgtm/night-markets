# Night Ecosystem — Full Launch Roadmap

Last audited: 2026-05-08

This is the master checklist from current state to full public launch.
Each Claude session should READ THIS FIRST, mark completed items, and pick the next unchecked item.
Do not ask "what's next?" — the answer is always the first unchecked item in the lowest-numbered phase.

---

## Current State (as of 2026-05-08)

| Repo | Contract | Deployed | Frontend | GitHub Pages | SDK | proof-server |
|---|---|---|---|---|---|---|
| night-markets | ✅ | ✅ preprod | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-poker | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-fun | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-lend | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-work | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-save | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-biz | ✅ compiled | ❌ | ✅ | ✅ | ✅ 2.5.0 | ✅ 8.0.3 |
| night-id | ❌ no contract | ❌ | ✅ multi-chain | ✅ | — | — |
| night-store | no contract (API) | — | ✅ Printful | ✅ | — | — |
| night-hub | — | — | ✅ | ✅ | — | — |

**Railway API:** `https://night-markets-94-production.up.railway.app`
- Night Score (ETH/SOL/ADA/Midnight multi-chain) ✅
- Night ID (.night names, registration, lookup) ✅
- Night Store (Printful checkout, NIGHT balance deduction) ✅
- Poker WebSocket rooms + table registry ✅

---

## PHASE 1 — Get Everything Publicly Visible ✅ COMPLETE

All repos have `pages.yml` — every push to main auto-deploys to GitHub Pages.

- [x] night-hub — `kingmunz1994-lgtm.github.io/night-hub/`
- [x] night-poker — `kingmunz1994-lgtm.github.io/night-poker/`
- [x] night-fun — `kingmunz1994-lgtm.github.io/night-fun/`
- [x] night-lend — `kingmunz1994-lgtm.github.io/night-lend/`
- [x] night-work — `kingmunz1994-lgtm.github.io/night-work/`
- [x] night-save — `kingmunz1994-lgtm.github.io/night-save/`
- [x] night-biz — `kingmunz1994-lgtm.github.io/night-biz/`
- [x] night-id — `kingmunz1994-lgtm.github.io/night-id/`
- [x] night-store — `kingmunz1994-lgtm.github.io/night-store/`

---

## PHASE 2 — SDK + Infrastructure ✅ COMPLETE

- [x] compact-js 2.5.0 + compact-runtime 0.15.0 across all repos
- [x] proof-server 8.0.3 across all repos
- [x] Ledger v7/v8 WASM bridge in all deploy.ts scripts
- [x] `dustBal` helper (no `.balance()` on DustWalletState) in all deploy.ts
- [x] `isSynced` removed, replaced with `readyFilter` in all deploy.ts
- [x] `new WalletFacade(...)` constructor (no static init) in all deploy.ts
- [x] `overrides` pinned correctly (compact-js 2.5.0) in all package.json
- [x] Railway: nightid-api.ts serving Night Score, .night names, store API, poker WS
- [x] Poker WebSocket rooms on Railway (`/ws/poker/{tableId}`) + `/api/poker/tables`
- [x] night-poker: dynamic WS URL (localhost vs Railway), live table loading from API
- [x] night-poker: compiled artifacts (keys, zkir, contract/index.js) committed
- [x] Night Store: Printful checkout, NIGHT balance tracking, shopper UI
- [x] Night Hub: correct app count (9), updated descriptions and icons

---

## PHASE 3 — Deploy Contracts to Preprod
*Requires: Docker + proof server running locally. Cannot be done from Railway/remote.*
*Priority order: most user-visible impact first.*

### Deploy command pattern (same for every repo):
```bash
# Terminal 1:
npm run proof-server   # midnightntwrk/proof-server:8.0.3

# Terminal 2 (in repo dir):
npm install && npm run compile && npm run deploy
# Outputs: CONTRACT_ADDRESS=<hex>

# Then:
# 1. echo "CONTRACT_ADDRESS=<hex>" >> .env
# 2. Update README.md with address + block
# 3. Update CLAUDE.md deployed contracts table
```

- [ ] **night-poker** — deploy `poker.compact`
  - After deploy: wire `commitHand`/`claimPot` ZK circuits into nightid-api.ts WS handler
  - After deploy: update night-poker README
- [ ] **night-fun** — deploy `NightFunToken.compact`
  - After deploy: replace bonding curve simulation in api-server.ts with real contract calls
  - After deploy: update night-fun README
- [ ] **night-lend** — deploy `NightLend.compact`
  - After deploy: wire deposit/borrow/repay/withdraw to contract
- [ ] **night-work** — deploy `NightWork.compact`
  - After deploy: wire postTask/acceptTask/submitProof/claimReward to contract
- [ ] **night-save** — deploy `NightSave.compact`
  - After deploy: wire deposit/mintSUSD/BNPL/redeem to contract
- [ ] **night-biz** — deploy `NightBizToken.compact`
  - After deploy: wire deployToken/transfer/proveTier to contract
- [ ] Update CLAUDE.md deployed contracts table after each deploy

---

## PHASE 4 — night-id Contract
*night-id has multi-chain frontend + Railway API but NO on-chain contract.*
*.night names and Night Score live in Redis only — not ZK-provable.*

- [ ] Write `NightID.compact` with circuits:
  - `registerName(name: Bytes<32>)` — ZK-authenticated .night name claim
  - `resolveName(name: Bytes<32>) → commitment` — name → address commitment
  - `issueCredential(subject, key, value)` — issuer grants attribute
  - `proveAttribute(attrKey, attrValue)` — prove claim without revealing data
- [ ] Deploy NightID contract to preprod
- [ ] Update nightid-api.ts register/resolve to write to contract (not Redis-only)
- [ ] Connect night-hub Night Score to on-chain credential data

---

## PHASE 5 — Night Store + Night Score Polish

- [ ] Test real Printful order: POST /api/store/checkout with a test shipping address
- [ ] Verify night-print.svg loads correctly at GitHub Pages URL (Printful fetches it for print)
- [ ] Decide: NIGHT payment = Night Score points (current) OR real tNIGHT wallet balance
  - Night Score (current) works without mainnet token — recommended for now
  - Real wallet requires NightFunToken deployed + wallet integration
- [ ] Expose `spent` field in `/api/nightid/action-score` response so frontends show real available NIGHT
- [ ] Add `record-action` calls in all standalone app frontends (night-fun, night-lend etc.) — night-poker already does this ✅
- [ ] Optional: expand Printful catalog (stickers, poster, phone case)

---

## PHASE 6 — Cross-App Integration + Night Hub Live Data
*Goal: Night Hub shows real numbers. Night Score driven by real on-chain events.*

- [ ] **Night Hub live stats** — wire to real APIs:
  - Active poker tables: `/api/poker/tables` (already available) ✅ — just add to hub UI
  - Night Score leaderboard: query Redis for top N addresses by total score
  - Total .night names registered: count Redis `ns:name:*` keys
- [ ] **Night Score from contract events** (blocked on Phase 3):
  - Query Midnight indexer for escrow calls → award points server-side
  - Query poker contract for completed hands → award points server-side
- [ ] **NIGHT balance in all frontends** — update hub to show `total - spent` not just `total`

---

## PHASE 7 — End-to-End Testing
*Prerequisite: Phase 3 complete. Needs real Lace wallet with tDUST.*

- [ ] night-markets: Lace → create listing → fund escrow → release → verify tDUST received
- [ ] night-poker: two wallets → join room → play hand → ZK showdown → verify pot on-chain
- [ ] night-fun: Lace → launch token → buy on curve → sell → graduation threshold
- [ ] night-lend: deposit → borrow sUSD → health factor → repay
- [ ] night-work: post task → accept → submit proof → verify → claim reward
- [ ] night-save: deposit → mint sUSD → BNPL → repay → redeem
- [ ] night-biz: deploy token → transfer → prove Bronze tier
- [ ] night-id: register .night name → resolve → prove attribute

---

## PHASE 8 — Pre-Launch Polish
*Can be done in parallel with Phase 3.*

- [ ] All frontends: `parseDustAmt()` balance fix (from night-markets) applied everywhere
- [ ] All frontends: wallet poll backoff to prevent APIError spam when Lace is locked
- [ ] night-hub: add live poker table count chip to landing strip
- [ ] night-hub: Night Score leaderboard section (top addresses by score)
- [ ] All READMEs: update with deployed addresses after Phase 3
- [ ] midnight-ai-kit: update case study metrics (currently 1 deployed contract → will be 7+)
- [ ] midnight-ai-kit CURRENT_SPRINT.md: keep updated each session

---

## PHASE 9 — Mainnet
*Blocked on: Midnight mainnet stability + Mōhalu DUST sponsorship phase (mid-2026)*

- [ ] DUST sponsorship live (`dust-sponsor.ts` with funded sponsor wallet)
- [ ] Upgrade to compact-js 2.6.0 / runtime 0.16.0 when available
- [ ] Deploy all contracts to Midnight mainnet
- [ ] Switch all endpoints to mainnet indexer + RPC
- [ ] Announce via night-hub

---

## Deployed Contract Addresses

| Contract | Address | Block |
|---|---|---|
| NightMarketsEscrow | `7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711` | 127,350 |
| NightPoker | not deployed | — |
| NightFunToken | not deployed | — |
| NightLend | not deployed | — |
| NightWork | not deployed | — |
| NightSave | not deployed | — |
| NightBizToken | not deployed | — |
| NightID | not written yet | — |
