<div align="center">

# Night ID — Zero-Knowledge Identity on Midnight Network

> *Prove what you built. Prove who you are. Share nothing else.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with on-chain identity primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-score--zk-builder-credential)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-id)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night ID?

Night ID is a zero-knowledge identity layer for the Midnight Network. Three systems in one:

1. **`.night` Name Registry** — claim a human-readable name tied to your wallet commitment, resolved on-chain
2. **ZK Credential System** — trusted issuers (KYC partners, institutions) grant private attributes; holders prove facts without revealing data
3. **Night Score** — cross-ecosystem reputation built from real on-chain actions, privately accumulated

Every credential is backed by real on-chain data. You prove. The network confirms. Nothing else leaves your device.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-id)**

---

## Midnight Network Integration

Night ID is Midnight-native from wallet connection to credential issuance.

**Built on Midnight** — The `NightID.compact` contract implements all three identity systems on-chain. `.night` name registration, credential issuance, attribute proofs, Night Score events, and admin initialization are all Compact circuits with ZK proofs generated client-side.

**Integrates with Midnight** — Wallet detection uses the Midnight DApp Connector API. Lace (`window.midnight.mnLace`) and 1AM (`midnight#ready` UUID injection) are both supported natively.

**Extends Midnight** — Night ID ships W3C VC Data Model v2.0-compatible credentials, the Brick Towers `identity-api` pattern, and the `.night` name service as open-source Compact primitives the entire ecosystem can build on.

---

## Features

**🪪 .night Name Registry** — Claim a human-readable `.night` name on Midnight. The name hash is published on-chain; the actual name string stays private. ZK-prove ownership to any app in the ecosystem without revealing which name you hold.

**🔒 ZK Credential System** — Trusted issuers grant attributes (KYC level, age, country, income range). Holders prove any condition — `age >= 18`, `kycLevel >= 2`, `income between X and Y` — with a single ZK proof. Seven operators supported: `==`, `<`, `>`, `<=`, `>=`, `exists`, `between`. No PII ever touches the chain.

**🏗 Night Score — ZK Builder Credential** — Score is calculated from real on-chain activity: contracts deployed, ZK circuit calls, escrow flows completed. Score root is published on-chain; raw value stays private. Prove your score is above any threshold — applications see `score >= 650`, not the number.

| Score Range | Level |
|---|---|
| 0–99 | ⬜ Contributor |
| 100–299 | 🟣 Builder |
| 300–599 | 🔵 Maker |
| 600–999 | 🟢 Founder |
| 1000+ | 🌟 Architect |

**🔑 Real Wallet Detection** — DApp Connector API polled on load and on `midnight#ready` events. Lace and 1AM both detected automatically. Any future wallet implementing the spec connects without code changes.

**⛓ Live Contract Activity Feed** — Real `ContractDeploy`, `ContractCall`, and `ContractUpdate` events from the Night Markets Escrow contract polled live from the Midnight indexer every 30 seconds. No mock data.

**🌐 Share Credentials** — Export your Night Score credential as a formatted block and post to X or copy as a Discord code block. Your proof of work, portable across the internet.

---

## Privacy Model

Night ID operates on one rule: the credential proves, it does not reveal.

- **Names**: only the name hash is public — the actual `.night` name is private
- **Credentials**: only commitments (hashes) go on-chain — KYC docs, passport, DOB never touched
- **Night Score**: only the Merkle root is public — raw score value stays private
- **Attribute proofs**: verifier receives a boolean result — the underlying value never disclosed
- **Income proofs**: verifier learns `income >= minIncome && income <= maxIncome` — not the figure

No personal data. No surveillance. Prove everything, reveal nothing.

---

## Smart Contract — NightID.compact

`NightID.compact` is a three-system Compact contract ready for deployment on the Midnight Network.

```
contracts/
└── NightID.compact    Three-system ZK identity contract (Compact v0.20)
```

### On-Chain Ledger State

```compact
// Name Registry
export ledger nameOwner:       Map<Bytes<32>, Bytes<32>>;
export ledger nameTarget:      Map<Bytes<32>, Bytes<32>>;
export ledger nameTaken:       Map<Bytes<32>, Boolean>;
export ledger totalNames:      Uint<32>;

// Credential Registry
export ledger credentialRoot:  Map<Bytes<32>, Bytes<32>>;
export ledger issuerTrusted:   Map<Bytes<32>, Boolean>;

// Night Score
export ledger scoreRoot:       Map<Bytes<32>, Bytes<32>>;
export ledger isRevoked:       Map<Bytes<32>, Boolean>;
```

### Key Circuits

| System | Circuit | Description |
|---|---|---|
| **Name Registry** | `registerName` | Claim a `.night` name — hash on-chain, string stays private |
| | `transferName` | Transfer name to new target commitment |
| | `releaseName` | Release (burn) a name permanently |
| | `resolveName` | Look up target commitment for a name hash |
| | `proveNameOwnership` | ZK-prove you own a registered name |
| **Credentials** | `registerIssuer` | Admin registers a trusted credential issuer |
| | `issueCredential` | Trusted issuer grants an attribute to a holder |
| | `proveAttribute` | ZK-prove any attribute with 7 operators |
| | `proveIdentity` | Prove KYC level + age + country in one call |
| | `revokeCredential` | Holder or issuer revokes a credential |
| **Night Score** | `recordScoreEvent` | Record a score-building event (8 types) |
| | `proveScore` | ZK-prove score is above a threshold |
| | `proveIncomeRange` | ZK-prove income is within a range |

### Compiling and Deploying

```bash
# In the night-markets repo (NightID.compact lives there):
npm run compile:nightid   # → contracts/managed/night-id/

# Deploy to Midnight Network:
npm run deploy
```

---

## Credential Issuance

Night ID implements the **W3C Verifiable Credentials Data Model v2.0** for off-chain credential envelopes, with on-chain commitment anchoring via Compact circuits.

| Field | Value |
|---|---|
| **Issuer** | Night Markets Protocol / trusted KYC partners |
| **Standard** | W3C VC v2.0 · Midnight ZK |
| **On-chain** | Credential commitment hash only — no PII |
| **Signing key** | EC P-256 · ZK verified |
| **Privacy** | Zero personal data on-chain |

---

## Score Breakdown

| Action | Points |
|---|---|
| Night Markets contract deployed | +200 |
| Any smart contract deployed | +100 per contract |
| ZK circuit call on-chain | +15 per transaction |
| Full escrow flow completed | +75 bonus |
| Night Work task verified | +20 per task |
| Night Poker hand played | +2 per hand |

NIGHT token rewards: 1 NIGHT per 10 score points.

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-id.git
cd night-id

# Serve locally — no build step required
npm run dev          # → http://localhost:3003
```

**To connect a wallet:**
1. Install [Lace](https://midnight.network/lace) or [1AM](https://1am.xyz)
2. Open Night ID — wallet detected automatically on load
3. Approve the connection — address auto-fills, Night Score loads immediately

**Manual verification:** Paste any `mn_addr1...` address and press Enter.

---

## The Night Ecosystem

Night ID is the identity layer for the entire Night ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [**Night ID**](https://github.com/kingmunz1994-lgtm/night-id) | **ZK identity + .night names + Night Score** | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night ID Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Your proof of work. Your proof of identity. Nothing more."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-id) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](https://github.com/kingmunz1994-lgtm/night-markets/blob/main/contracts/NightID.compact)

</div>
