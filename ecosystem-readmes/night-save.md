<div align="center">

# Night Save — Zero-Knowledge Vault + sUSD on Midnight Network

> *Deposit NIGHT. Mint sUSD. Buy now, pay later. Prove you're healthy. Reveal nothing.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK vault and stablecoin primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-save)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Save?

Night Save (the **Statera Protocol**) is a ZK-private collateral vault built natively on the **Midnight Network**. Deposit NIGHT tokens as collateral and mint sUSD stablecoins at up to 80% LTV — your position stays completely private. The built-in BNPL system splits purchases into four equal on-chain instalments. Prove your vault is healthy to any counterparty without revealing your collateral or debt.

Your balance is yours. Nobody else's business.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-save)**

---

## Midnight Network Integration

Night Save is Midnight-native across every layer.

**Built on Midnight** — The `NightSave.compact` contract runs entirely on-chain. Deposits, mints, repayments, redemptions, BNPL plans, and health proofs are all Compact circuits with ZK proofs generated client-side. Nothing is off-chain.

**Integrates with Midnight** — Wallet connections flow through the Midnight DApp Connector API. Lace and 1AM wallets connect natively.

**Extends Midnight** — Night Save ships the `proveHealthy()` ZK solvency circuit and the `createBnpl()` instalment pattern as reusable open-source Compact primitives for any Midnight lending protocol.

---

## Features

**🔒 ZK-Private Positions** — Your collateral and debt amounts are stored as ZK commitments. No on-chain observer can read your vault balance. Health checks are proofs — not balance lookups.

**💵 sUSD Minting** — Mint the Night ecosystem stablecoin against your NIGHT collateral. sUSD flows across Night Lend, Night Work, and Night Markets as a stable unit of account.

**📦 BNPL in 4 Instalments** — Split any purchase into four equal on-chain payments, enforced by the smart contract. No credit check, no interest, no bank. The instalment schedule lives in the circuit.

**✓ `proveHealthy()` Circuit** — ZK proof that your vault is solvent — reveals only a boolean. Use it across the ecosystem: Night Lend requires it for additional borrowing, Night Work premium tasks check it, Night Markets verifies it for large escrow amounts.

**🏦 Four Vault Tiers** — Quick-fill presets from Micro (1,000 NIGHT) to Obsidian (200,000 NIGHT) for onboarding at any size.

**📈 Animated Health Factor** — Live health factor bar animates green → amber → red as your debt-to-collateral ratio approaches the liquidation threshold. No surprise liquidations.

---

## Key Parameters

| Parameter | Value |
|-----------|-------|
| Max LTV | **80%** — mint up to 80% of collateral value |
| Liquidation threshold | **95%** debt-to-collateral |
| NIGHT price | $0.04 |
| BNPL instalments | 4 equal payments |

### Health Factor Formula

```
HF = (collateral_NIGHT × price × 0.80) / debt_sUSD
```

HF ≥ 1.0 = healthy · HF < 1.0 = liquidatable

---

## Vault Tiers

| Tier | Collateral | Max sUSD |
|------|-----------|---------|
| Micro | 1,000 NIGHT | $32 |
| Standard | 5,000 NIGHT | $160 |
| Premium | 50,000 NIGHT | $1,600 |
| Obsidian | 200,000 NIGHT | $6,400 |

---

## Privacy Model

Your vault state is a ZK commitment. When you call `proveHealthy()`, the circuit pulls your collateral and debt as private witnesses, checks them against the on-chain commitment, and returns a single boolean. The verifier learns your vault is healthy — not how much you deposited or borrowed.

No bank can see your position. No liquidator can target you before the threshold is crossed. Privacy and solvency, enforced simultaneously.

---

## Smart Contract

`NightSave.compact` is written in Compact for the Midnight Network.

```
contracts/
└── NightSave.compact      Compact v0.20 (Midnight)
```

### Key Circuits

| Circuit | Description |
|---------|-------------|
| `deposit(amount)` | Add NIGHT collateral — credited to ZK commitment |
| `mintSusd(amount)` | Mint sUSD (80% LTV enforced in-circuit) |
| `repay(amount)` | Repay sUSD debt — partial repayments supported |
| `redeem(amount)` | Withdraw NIGHT (requires zero debt) |
| `proveHealthy()` | ZK proof: vault is solvent — no amounts revealed |
| `createBnpl(totalAmount)` | Open a BNPL plan (4 equal instalments) |
| `payBnplInstalment()` | Pay one instalment, reduce debt on-chain |

### `proveHealthy()` — ZK Circuit

```compact
export circuit proveHealthy(): Boolean {
  // witnesses: callerCollateral(), callerDebt()
  // asserts witnesses match on-chain commitment
  // returns true — verifier learns "solvent" only
}
```

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-save.git
cd night-save

# Serve locally
npm run dev          # → http://localhost:3005

# Compile the Compact contract
npm install
npm run compile      # → compactc NightSave.compact
```

Connect a Midnight-compatible wallet (Lace recommended) or explore the vault in simulation mode — position state persists in `localStorage`.

---

## The Night Ecosystem

Night Save is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [**Night Save**](https://github.com/kingmunz1994-lgtm/night-save) | **ZK vault + sUSD stablecoin** | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Save Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Your vault. Your collateral. Your privacy."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-save) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/NightSave.compact)

</div>
