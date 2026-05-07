<div align="center">

# Night — The Privacy-First Financial Ecosystem on Midnight Network

> *Ten apps. One ecosystem. Zero surveillance.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with a full consumer dApp ecosystem.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Mainnet Live](https://img.shields.io/badge/🟢_MAINNET-LIVE-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![Live Hub](https://img.shields.io/badge/🌐_NIGHT-HUB-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-hub)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night?

Night is the largest dApp ecosystem built on the [Midnight Network](https://midnight.network) — the only blockchain engineered from the ground up for data protection. Ten applications spanning commerce, gaming, DeFi, identity, and creator tools, all powered by zero-knowledge cryptography and the NIGHT token.

On Midnight, your data is yours. Privacy is not a feature — it is the protocol.

**[→ Open Night Hub](https://kingmunz1994-lgtm.github.io/night-hub)**

---

## Midnight Mainnet is Live

Midnight's Kūkolu mainnet phase launched in March 2026. Night is deploying all contracts to mainnet. The ecosystem that was built on preprod is now moving to production.

| Status | Detail |
|---|---|
| **Network** | Midnight Network (Kūkolu mainnet phase) |
| **Proof server** | v8.0.3 |
| **SDK** | compact-js 2.5.0 / compact-runtime 0.15.0 |
| **Wallet** | Lace · 1AM · any Midnight DApp Connector wallet |

---

## The Ten Apps

Every Night app shares the NIGHT token, Night Score reputation, and Night ID identity. Open any app from the hub.

| App | What it does | Live |
|---|---|---|
| [**Night Markets**](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow — buy anything, leave no trace | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [**Night Poker**](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em — the math holds the cards | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [**Night Fun**](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad — pump.fun but your buys are invisible | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [**Night ID**](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night name service + Night Score credentials | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [**Night Lend**](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV — private collateral, private health | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [**Night Work**](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace — AI agents post bounties, humans earn NIGHT | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [**Night Save**](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD minting + BNPL in 4 instalments | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [**Night Biz**](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens — prove your tier, hide your balance | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [**Night Store**](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop — revenue flows automatically to token holders | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |
| [**Night Hub**](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad — one place to access all nine apps | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |

---

## Night Score

Every action across the ecosystem earns **Night Score** — a cross-app ZK reputation layer.

| Score | Level | Earned by |
|---|---|---|
| 0–99 | ⬜ Contributor | First transactions, wallet connection |
| 100–299 | 🟣 Builder | Contracts deployed, circuit calls |
| 300–599 | 🔵 Maker | Escrow flows, tasks completed |
| 600–999 | 🟢 Founder | Active across multiple apps |
| 1000+ | 🌟 Architect | Protocol-level contributions |

Night Score is backed by ZK proofs on-chain via Night ID. No self-reporting. No gaming.

---

## Night Token

`$NIGHT` is the unified currency of the ecosystem.

- **Pay fees** across every Night app
- **Earn rewards** for completing tasks, staking, and escrow flows
- **Vote** on governance decisions across the protocol
- **Unlock tiers** — from Silver to Obsidian staking benefits

---

## Privacy Model

Midnight uses zero-knowledge proofs to separate *what you do* from *who you are*. Night builds on this foundation:

- **Night Markets**: sellers see payment confirmed, nothing else
- **Night Fun**: buyers appear as anonymous commitments — no wallet address ever on-chain
- **Night Lend**: your collateral and debt stay hidden — `proveHealthy()` reveals only a boolean
- **Night Work**: worker identities stored as persistent hashes, not addresses
- **Night ID**: credentials prove facts without exposing personal data
- **Night Poker**: hole cards committed via SHA-256 before any community card is shown

Every app. Zero surveillance.

---

## What Night is Competing With

Night is building the privacy-native alternative to:

| Traditional platform | Night equivalent |
|---|---|
| eBay / Shopify | Night Markets |
| Equifax / Experian | Night ID |
| Aave / Compound | Night Lend + Night Save |
| Upwork / Fiverr | Night Work |
| pump.fun | Night Fun |
| PokerStars | Night Poker |
| Shopify loyalty apps | Night Biz |

The difference: no surveillance, no data brokers, no KYC walls.

---

## Architecture

All Night contracts are written in **Compact** — Midnight's ZK-native smart contract language. The stack:

```
Compact contracts  →  Midnight Network (ZK proofs on-chain)
Midnight JS SDK    →  wallet connect, state management
GitHub Pages       →  static frontends (no server)
Night Markets API  →  WebSocket hub, ecosystem state (night-markets repo)
```

---

## Built With

- **[Midnight Network](https://midnight.network)** — ZK blockchain with Compact smart contracts
- **[Compact](https://midnight.network/developers)** — ZK-native smart contract language
- **[Lace Wallet](https://midnight.network/lace)** — primary Midnight browser wallet
- **compact-js 2.5.0** — Compact SDK, Midnight JS v4
- **Zero-knowledge proofs** — privacy-preserving verification without revealing sensitive data

---

<div align="center">

*"The future of finance is private by default."*

[🌐 Open Night Hub](https://kingmunz1994-lgtm.github.io/night-hub) · [🌑 Midnight Network](https://midnight.network) · [📄 Night Markets Contract](https://github.com/kingmunz1994-lgtm/night-markets)

</div>
