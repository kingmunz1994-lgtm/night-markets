# Night Ecosystem — Full Build Plan

23 apps. One privacy network. Every mainstream app rebuilt with ZK at the core.

---

## Status Legend

| Badge | Meaning |
|-------|---------|
| **Live** | Deployed on Midnight preprod, UI working |
| **Beta** | Core engine built, needs final wiring |
| **Coming Soon** | Planned for next 6 months, contract design done |
| **Planned** | Design phase, builds after foundation apps |
| **Vision** | Long-term roadmap, awaiting Midnight mainnet maturity |

---

## Build Order Rationale

Build the economic foundation first — every later app depends on Night Pay (value transfer) and Night ID (identity). Night Score depends on Night ID. Night Social depends on Night Score. Night Raise depends on Night Pay. Build bottom-up.

```
Night ID + Night Score  ←  foundation for everything
      ↓
Night Pay               ←  value transfer layer
      ↓
Night Work + Night Lend + Night Save   ←  economic apps
      ↓
Night Chat + Night Social              ←  social layer
      ↓
Night Vote + Night Co-op + Night Data  ←  governance
      ↓
Night Health + Night Legal + Night Drive  ←  regulated verticals
```

---

## Tier 1 — Core Utility

### Night Markets ✅ LIVE
**Replaces:** eBay, Airbnb, Craigslist  
**ZK primitive:** ZK escrow auth (`callerCommitment`), private dispute voting  
**Contract:** `NightMarketsEscrow.compact` — deployed preprod `7473b82b...`  
**Night Score integration:** Seller escrow release rate, buyer dispute rate  
**Viral mechanic:** Sellers can list anything globally without KYC — enters markets excluded from Stripe/PayPal  
**Revenue:** 1% escrow fee → Night Revenue Pool  

### Night Poker 🃏 BETA
**Replaces:** PokerStars, GGPoker, home games  
**ZK primitive:** Private hand commitment, ZK shuffle proof, winner ZK reveal  
**Contract:** `NightPoker.compact` (canon in night-poker repo)  
**Night Score integration:** Win rate, hands played, no-show penalty  
**Viral mechanic:** Host a private game with friends — no app download, just a URL  
**Revenue:** Rake per pot → Night Revenue Pool  
**Next steps:** Deploy contract, wire `commitHand` → `claimPot` ZK proof, LAN multiplayer tested  

### Night Pay 💸 COMING SOON
**Replaces:** Venmo, PayPal, CashApp  
**ZK primitive:** Shielded NIGHT transfer — amount hidden, recipient hidden  
**Contract:** `NightPay.compact` (new — simple shielded transfer + request-to-pay)  
**Night Score integration:** Payment history, on-time rate  
**Viral mechanic:** Send a "pay request link" — anyone with a Midnight wallet can pay, privately  
**Revenue:** 0.2% on fiat off-ramp (future)  
**Dependencies:** Night ID for named addresses  

### Night Store 🏪 COMING SOON
**Replaces:** Shopify, Etsy storefronts  
**ZK primitive:** Purchase proof without linking buyer address to product  
**Contract:** Lightweight storefront ledger  
**Night Score integration:** Purchase volume, review history  
**Viral mechanic:** Sell Night-branded merch, revenue flows back to ecosystem  

---

## Tier 2 — Economic Layer

### Night Fun 🚀 COMING SOON
**Replaces:** Pump.fun, token launchpads  
**ZK primitive:** Hidden buy amounts until bonding curve threshold, fair launch  
**Contract:** `NightFunToken.compact` (compiled in night-markets repo, deploy to night-fun)  
**Night Score integration:** Launch success rate, rug history (on-chain verifiable)  
**Viral mechanic:** "Launch a token without whales front-running you" — solves the core pump.fun problem  
**Revenue:** 1% on launch fee  

### Night Work 💼 COMING SOON
**Replaces:** Fiverr, Upwork, Mechanical Turk  
**ZK primitive:** Private bidding, ZK proof of skill credential  
**Contract:** `NightWork.compact` (new — task ledger, bid commitment, milestone escrow)  
**Night Score integration:** Completion rate, client rating, earnings over time  
**Viral mechanic:** AI agents post bounties and pay other AI agents → agent-to-agent economy  
**Revenue:** 5% platform fee → Night Revenue Pool  
**Key for decentralization:** Replaces `_taskStore` in api-server.ts with on-chain ledger  

### Night Lend 🏦 COMING SOON
**Replaces:** Aave, Compound, MakerDAO  
**ZK primitive:** Private collateral — nobody sees what you've locked  
**Contract:** `NightLend.compact` — already built in night-lend repo (needs 2.5.0 upgrade)  
**Night Score integration:** Liquidation history, repayment record  
**Viral mechanic:** Borrow without revealing your net worth to the counterparty  
**Revenue:** Interest spread  

### Night Save 🔐 COMING SOON
**Replaces:** Savings accounts, Ramp/Transak  
**ZK primitive:** Hidden vault balance, private mint of sUSD  
**Contract:** `NightSave.compact` — already built in night-save repo (needs 2.5.0 upgrade)  
**Night Score integration:** Savings consistency  
**Viral mechanic:** BNPL credit based on ZK proof of savings balance — no credit check  

### Night Trade 📈 PLANNED
**Replaces:** Uniswap, dark pools, OTC trading  
**ZK primitive:** Hidden order size, private execution, no MEV  
**Contract:** `NightTrade.compact` — dark pool AMM, ZK commitment before reveal  
**Night Score integration:** Trading volume, market-making contribution  
**Viral mechanic:** Trade large amounts without moving the market  
**Dependencies:** Night Pay (settlement layer)  

---

## Tier 3 — Identity + Reputation

### Night ID 🪪 COMING SOON
**Replaces:** LinkedIn profile, government ID, ENS  
**ZK primitive:** Attribute proofs — prove age/location/credential without revealing identity  
**Contract:** `NightID.compact` (new — .night name registry, credential ledger, ZK attestation)  
**Night Score integration:** IS Night Score's backbone — score attested via Night ID oracle  
**Viral mechanic:** `.night` names — short, memorable, privacy-preserving identity  
**Key for decentralization:** Replaces `nightid-api.ts` in-memory store with on-chain ledger  
**Builds on:** Nothing (foundation layer)  

### Night Score ⭐ COMING SOON
**Replaces:** Credit scores, Airbnb ratings, StackOverflow reputation  
**ZK primitive:** Cross-app score aggregation with ZK oracle attestation  
**Contract:** `NightScore.compact` (new — epoch snapshots, ZK-attested scores)  
**Current implementation:** In `nightid-api.ts` — in-memory only, not decentralized  
**Viral mechanic:** Your reputation travels across every Night app — build it once, use everywhere  
**Revenue:** Oracle attestation fees  
**Builds on:** Night ID  

### Night Biz 🎖️ COMING SOON
**Replaces:** Shopify Loyalty, Starbucks Rewards  
**ZK primitive:** Private tier verification — prove you're Gold without revealing purchase history  
**Contract:** `NightBiz.compact` — already built in night-biz repo (needs 2.5.0 upgrade)  
**Night Score integration:** Loyalty score feeds Night Score  
**Viral mechanic:** Businesses get a loyalty program without collecting customer data  

---

## Tier 4 — Social Layer

### Night Chat 💬 PLANNED
**Replaces:** WhatsApp, Signal, Telegram  
**ZK primitive:** E2E encrypted messaging + shielded NIGHT payments inside chat  
**Contract:** `NightChat.compact` — message commitments, payment channels  
**Night Score integration:** Chat activity score  
**Viral mechanic:** "Pay your friend in the same app you message them" — Night Pay built into every chat  
**Why Night Chat first among social:** Payment integration is unique killer feature vs Signal  

### Night Social 📣 PLANNED
**Replaces:** Twitter/X, Farcaster, Lens  
**ZK primitive:** ZK-verified identity on posts, private follower graph  
**Contract:** `NightSocial.compact` — post commitments, ZK author proofs  
**Night Score integration:** Engagement score, verified post history  
**Viral mechanic:** Post as a verified human without doxing yourself  
**Builds on:** Night ID + Night Score  

### Night Review 🔎 PLANNED
**Replaces:** Glassdoor, Yelp, Tripadvisor  
**ZK primitive:** Prove you purchased/worked there without revealing your identity  
**Contract:** `NightReview.compact` — purchase proof + review commitment  
**Night Score integration:** Review credibility  
**Viral mechanic:** Honest reviews without employer retaliation — Glassdoor killer  

### Night Match ❤️ VISION
**Replaces:** Tinder, Bumble, Hinge  
**ZK primitive:** Match on ZK attributes (age range, location radius, interests hash) without revealing raw data  
**Contract:** `NightMatch.compact` — mutual ZK attribute intersection  
**Night Score integration:** Trust score for matches  
**Why it works:** Both parties reveal nothing until mutual match — no catfish, no harassment  

---

## Tier 5 — Governance + Data

### Night Vote 🗳️ PLANNED
**Replaces:** Snapshot, Tally, government e-voting  
**ZK primitive:** Private ballot, ZK eligibility proof, public tally  
**Contract:** `NightVote.compact` — builds on NightMarketsEscrow `castVote` pattern  
**Night Score integration:** Governance participation score  
**Viral mechanic:** Companies offer private employee surveys — HR can't see who voted what  

### Night Co-op 🤝 PLANNED
**Replaces:** Worker co-ops, DAOs, guilds  
**ZK primitive:** Private membership, hidden revenue split, ZK treasury  
**Contract:** `NightCoop.compact` — membership commitments, revenue pool (uses NightRevenuePool pattern)  
**Builds on:** Night Work + Night Pay  

### Night Data 🗃️ PLANNED
**Replaces:** Data brokers, survey companies, Nielsen  
**ZK primitive:** Sell a ZK proof of a data attribute — not the data itself  
**Contract:** `NightData.compact` — data proofs marketplace  
**Night Score integration:** Data contribution score  
**Revenue model:** Advertisers pay for ZK proofs of "user is 25-34 in NYC" without seeing who  

### Night Raise 🎯 PLANNED
**Replaces:** Kickstarter, Indiegogo, GoFundMe  
**ZK primitive:** Anonymous contributions, hidden total until close, milestone ZK escrow  
**Contract:** `NightRaise.compact` — extends NightMarketsEscrow with milestone logic  
**Night Score integration:** Creator track record, backer completion rate  
**Viral mechanic:** Whistleblower fundraising — contribute to causes without your name on a list  

---

## Tier 6 — Regulated Verticals (Post-Mainnet)

### Night Health 🏥 VISION
**Replaces:** MyChart, NHS App, insurance portals  
**ZK primitive:** Prove health status (vaccinated, tested negative, in a clinical trial) without full record  
**Regulatory angle:** HIPAA-compliant ZK attestation — the regulator gets proof, not data  
**Why Midnight:** Government trust (Cardano institutional adoption) makes ZK health proofs credible  

### Night Legal ⚖️ VISION
**Replaces:** DocuSign, notaries, apostilles  
**ZK primitive:** ZK timestamp + ZK signature — prove a document existed and was signed at a time  
**Revenue:** Per-notarization fee  
**Regulatory angle:** Midnight's Cardano heritage = government credibility for legal ZK proofs  

### Night Drive 🚗 VISION
**Replaces:** Uber, Lyft, DoorDash  
**ZK primitive:** Private routing, hidden earnings, ZK rating proofs  
**Night Score integration:** Completion rate, rating  
**Why it wins:** Drivers don't reveal home address, income, or identity to a platform  

---

## Shared Infrastructure

All Night apps share:

| Layer | Component | Status |
|-------|-----------|--------|
| Identity | Night ID + .night names | Coming Soon |
| Reputation | Night Score oracle | Coming Soon |
| Revenue sharing | `NightRevenuePool.compact` | Built, not deployed |
| Fee sponsorship | `dust-sponsor.ts` | Built, needs funded wallet |
| API bridge | `api-server.ts` | Live (centralized — decentralize via on-chain contracts) |
| Wallet connect | Lace + Nocturne DApp connector | Live |

---

## Investor Narrative

**ADA + government trust + ZK privacy = unique position**

Cardano has institutional adoption (BlackRock, government pilots). Midnight is Cardano's privacy layer. Night is the application ecosystem on Midnight.

- Governments trust Cardano → they'll trust Midnight → Night has the most credible path to regulated ZK apps (Night Health, Night Legal, Night Vote)
- BlackRock-grade infrastructure underneath consumer apps → rare combination of institutional-grade security + consumer UX
- AI agents are the first non-human users — Night Work + Night ID give agents wallets, identity, and reputation on day one

**The moat:** Night Score. Once users have reputation across Night apps, switching to a competitor means starting over. ZK reputation is portable in theory, but only Night apps read Night Score natively.
