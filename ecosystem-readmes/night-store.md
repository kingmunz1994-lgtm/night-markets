<div align="center">

# Night Store — ZK Merch Shop on Midnight Network

> *Spin up a branded storefront. Revenue flows automatically to token holders. No middleman.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK creator economy primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#revenue-sharing)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-store)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Store?

Night Store lets any Night ecosystem project spin up a branded merchandise storefront in seconds. Upload a logo, pick a template, and your store is live — with 50% of every sale flowing automatically to token holders via the Night ecosystem's on-chain epoch system. Revenue is enforced by the `NightFunToken` contract on the Midnight Network, not by trust.

Launch a token on Night Fun. Open a store on Night Store. Watch your holders earn from every sale.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-store)**

---

## Midnight Network Integration

Night Store plugs into Midnight's on-chain revenue infrastructure.

**Built on Midnight** — Revenue distribution uses the `NightFunToken.compact` contract's `recordMerchSale()`, `closeEpoch()`, and `claimRevenue()` circuits running on the Midnight Network. Every sale is recorded on-chain. Every claim is a ZK proof.

**Integrates with Midnight** — Store owners connect via the Midnight DApp Connector API. Lace and 1AM wallets are supported natively.

**Extends Midnight** — Night Store proves that real-world commerce can settle on a ZK-native blockchain. Physical goods, digital tokens, on-chain revenue sharing — one seamless loop.

---

## Features

**🚀 Instant Storefront** — Logo, name, template — your branded store is live in one step. No design tools required.

**👕 8 Default Products** — Hoodie, tee, sticker pack, cap, tote bag, phone case, mug, poster. Fulfilled by Printful. Ships worldwide.

**🎨 4 Store Templates** — Night Dark · Neon · Minimal · Gold. Each is a complete visual identity tuned for the Night ecosystem aesthetic.

**💸 ZK Revenue Sharing** — 50% of every sale flows to token holders. Revenue is recorded via `recordMerchSale()` on the `NightFunToken` contract. Holders claim their proportional share privately — without revealing their balance.

**🤝 Partner Network** — 6 curated Night ecosystem partner stores featured in-app. Cross-promotion built in.

**⛓️ On-Chain Enforcement** — Revenue splits are enforced by smart contract — not by your trust in the creator. The contract cannot distribute more than 100% or change the platform fee.

---

## Revenue Split

Every sale distributes immediately via on-chain circuit:

| Recipient | Share |
|-----------|-------|
| Token holders | **50%** — claimed proportionally via ZK proof |
| Creator | **45%** — withdrawn at any time |
| Platform | **5%** — fixed, enforced in-contract |

Holders call `claimRevenue()` to prove their token balance privately and withdraw NIGHT without revealing how many tokens they hold.

---

## How It Works

```
Creator                         Token Holders
   │                                  │
   ├─ Upload logo + set store name    │
   ├─ Pick template (4 options)       │
   ├─ Products auto-generated         │
   │                                  │
   ├─ recordMerchSale(amount)         │
   │  ← 50% credited to epoch pool    │
   │  ← 45% credited to creator      │
   │  ← 5% platform fee              │
   │                                  │
   ├─ closeEpoch()                   │
   │                                  ├─ claimRevenue()
   │                                  │  ← NIGHT distributed pro-rata (ZK)
```

---

## Products

| Item | Price |
|------|-------|
| Hoodie | $42 |
| Tee | $22 |
| Sticker pack | $9 |
| Cap | $28 |
| Tote bag | $18 |
| Phone case | $15 |
| Mug | $16 |
| Poster | $12 |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-store.git
cd night-store

# Serve locally
npm run dev          # → http://localhost:3007
npm run build        # → dist/ for production
```

Night Store has no on-chain contract of its own — it uses the `NightFunToken` revenue circuits from [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun). Connect a Midnight wallet to record live sales; explore in demo mode without one.

---

## The Night Ecosystem

Night Store is part of the largest dApp ecosystem on Midnight Network.

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
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [**Night Store**](https://github.com/kingmunz1994-lgtm/night-store) | **ZK merch shop** | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Store Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Real goods. On-chain revenue. Zero middlemen."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-store) · [🌑 Midnight Network](https://midnight.network) · [📄 Revenue Contract](https://github.com/kingmunz1994-lgtm/night-fun/blob/main/contracts/NightFunToken.compact)

</div>
