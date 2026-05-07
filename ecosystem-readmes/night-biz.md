<div align="center">

# Night Biz — ZK Business Loyalty Tokens on Midnight Network

> *Issue loyalty tokens. Let customers prove their tier. Never reveal their balance.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK loyalty token primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-biz)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Biz?

Night Biz lets any business — from a corner café to a multinational enterprise — issue private loyalty tokens on the **Midnight Network**. Customers prove their tier (Bronze, Silver, Gold, Platinum) with a ZK proof — the verification returns a tier level but never reveals their token balance. Revenue is shared automatically with holders every epoch, enforced on-chain.

No loyalty card. No CRM database. No surveillance.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-biz)**

---

## Midnight Network Integration

Night Biz is Midnight-native across every layer.

**Built on Midnight** — The `NightBizToken.compact` contract runs entirely on-chain. Token issuance, ZK tier proofs, revenue recording, epoch snapshots, and holder claims are all Compact circuits with ZK proofs generated client-side.

**Integrates with Midnight** — Wallet connections flow through the Midnight DApp Connector API. Lace and 1AM wallets connect natively.

**Extends Midnight** — Night Biz ships `proveTierStatus()` as a reusable open-source Compact pattern — ZK tier gating that any Midnight protocol, DeFi app, or consumer product can adopt without exposing customer balances.

---

## Features

**🥇 ZK Tier Proofs** — The `proveTierStatus()` circuit returns a tier level (0–4) without revealing the underlying token balance. The network sees Bronze/Silver/Gold/Platinum — not how many tokens the customer holds.

**💰 Automatic Revenue Sharing** — Record a sale with `recordSale()`, close the epoch with `closeEpoch()`, and holders can claim their proportional NIGHT share via `claimRevenue()`. All enforced on-chain, no manual distribution.

**🏢 Any Scale** — Configurable tier thresholds at deploy time. A café deploying 10,000 tokens sets different thresholds than an enterprise deploying 1,000,000,000. The contract handles both.

**🔐 Regional Licensing Gate** — Set `licReq = true` at deploy to require `grantLicense()` before any wallet can hold tokens. Used for franchise control, geographic restrictions, or enterprise partner networks.

**🌙 NIGHT Revenue** — All revenue distributions are denominated in NIGHT tokens. Holders earn NIGHT passively from business sales — without revealing their balance at claim time.

**📊 Revenue Split Config** — `holderBps + creatorBps = 9,500 bps`. Platform takes 5% (500 bps). Default splits 50% to holders, 45% to creator.

---

## How It Works

```
Business                         Customer
   │                                  │
   ├─ initialize(name, tiers, split)  │
   │  ← token deployed on Midnight    │
   │                                  │
   │                                  ├─ transfer(tokens) ← receives loyalty tokens
   │                                  │
   │                                  ├─ proveTierStatus()
   │                                  │  ← ZK: returns tier 0–4
   │                                  │  ← balance NEVER revealed
   │
   ├─ recordSale(amount)             │
   ├─ closeEpoch(sharePerToken)      │
   │                                  ├─ claimRevenue()
   │                                  │  ← NIGHT distributed pro-rata
```

---

## Tier System

| Tier | Default threshold | Example perks |
|------|------------------|---------------|
| 🥉 Bronze | ≥ 100 tokens | 5% discount · priority support |
| 🥈 Silver | ≥ 500 tokens | 10% discount · early access · free shipping |
| 🥇 Gold | ≥ 2,000 tokens | 20% discount · VIP events · revenue boost 2× |
| 💎 Platinum | ≥ 10,000 tokens | Unlimited perks · private access · governance |

Thresholds are fully configurable at deploy time.

---

## ZK Tier Proof

The `proveTierStatus()` circuit generates a zero-knowledge proof that the caller holds ≥ the tier threshold — returning the tier level without revealing their balance:

```compact
export circuit proveTierStatus(): Uint<8> {
  const commit  = callerCommitment();
  const balance = holderTokenBalance();        // witness — stays private
  assert(holder_balance.lookup(commit) == balance, "balance witness mismatch");

  if (balance >= tier_platinum.lookup(pad(32,"tp"))) { return 4; }
  if (balance >= tier_gold.lookup(pad(32,"tg")))     { return 3; }
  if (balance >= tier_silver.lookup(pad(32,"ts")))   { return 2; }
  if (balance >= tier_bronze.lookup(pad(32,"tb")))   { return 1; }
  return 0;
}
```

The verifier sees the tier number. The balance stays hidden.

---

## Smart Contract

`NightBizToken.compact` is written in Compact for the Midnight Network.

```
contracts/
└── NightBizToken.compact      Compact v0.20 (Midnight)
```

### Key Circuits

| Circuit | Who calls | Description |
|---------|-----------|-------------|
| `initialize(name, symbol, supply, holderBps, creatorBps, tiers, licReq)` | Creator | Deploy token with tier config |
| `transfer(to, amount)` | Any holder | Transfer tokens (with optional licence gate) |
| `proveTierStatus()` | Customer | ZK tier proof — balance not revealed |
| `recordSale(amount)` | Creator / PoS | Log sale, add to epoch revenue |
| `closeEpoch(sharePerToken)` | Creator | Snapshot + calculate distributions |
| `claimRevenue()` | Holder | Claim proportional NIGHT revenue |
| `grantLicense(holderCommit)` | Creator | Whitelist wallet for regional gate |

---

## Use Cases

| Business | Tokens | Tier perk example |
|----------|--------|------------------|
| ☕ Café / retail | 10,000 | Bronze = free coffee, Platinum = tasting events |
| 🛍️ DTC brand | 100,000 | Silver = early drops, Gold = co-design access |
| 💻 SaaS | Unlimited | Tiers = API rate limits, support SLA levels |
| 🏢 Enterprise | 1,000,000,000 | Regional licensing gates for distributor networks |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-biz.git
cd night-biz

# Serve locally
npm run dev          # → http://localhost:3008

# Compile the Compact contract
npm install
npm run compile      # → compactc NightBizToken.compact
```

Connect a Midnight-compatible wallet (Lace recommended) or configure and deploy a token in demo mode — state persists in `localStorage`.

---

## The Night Ecosystem

Night Biz is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [**Night Biz**](https://github.com/kingmunz1994-lgtm/night-biz) | **ZK business loyalty tokens** | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Biz Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Your loyalty. Your privacy. Your revenue."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-biz) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/NightBizToken.compact)

</div>
