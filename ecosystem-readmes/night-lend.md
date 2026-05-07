<div align="center">

# Night Lend — Zero-Knowledge DeFi Lending on Midnight Network

> *Borrow against private collateral. Prove you're healthy. Reveal nothing.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK DeFi lending primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-lend)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Lend?

Night Lend is a privacy-first DeFi lending protocol built natively on the **Midnight Network**. Deposit assets to earn yield. Borrow against your collateral at up to 75% LTV. Your entire position — deposits, borrows, and health factor — stays ZK-private. The `proveHealthy()` circuit lets you prove solvency to any counterparty without revealing a single number.

No bank. No credit check. No one can see your position.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-lend)**

---

## Midnight Network Integration

Night Lend is Midnight-native at every layer.

**Built on Midnight** — The `NightLend.compact` contract runs entirely on-chain. Every deposit, borrow, repayment, and health proof is a Compact circuit with ZK proofs generated client-side. Nothing is off-chain.

**Integrates with Midnight** — Wallet connections and NIGHT token balances flow through the Midnight DApp Connector API. Lace and 1AM wallets connect natively.

**Extends Midnight** — Night Lend ships `proveHealthy()` as an open-source Compact circuit pattern — a reusable ZK solvency proof any Midnight lending protocol can adopt.

---

## Features

**🔒 ZK-Private Positions** — Your deposit and borrow amounts are stored as ZK commitments. No on-chain observer can determine your balance. Health checks generate proofs — not balance lookups.

**💰 Multi-Asset Pools** — Deposit and borrow NIGHT, sUSD, and tDUST. Each pool has independent yield rates set by market dynamics.

**📊 75% LTV** — Borrow up to 75% of your deposited collateral value. Liquidation triggers when health factor drops below 1.0. The protocol enforces this in-circuit — no oracle manipulation possible.

**✓ `proveHealthy()` Circuit** — Generate a ZK proof that your position is solvent without revealing collateral or debt amounts. Use it to access Night Work premium tasks, Night Save BNPL, or any third-party protocol that requires solvency verification.

**🔁 Reentrancy Guard** — Every state-changing circuit calls `lock()` at entry and `unlock()` at exit. A second call within the same transaction reverts with `"reentrant call"`.

**🌙 NIGHT Rewards** — Lenders earn NIGHT token rewards on top of interest yield. Rate set by governance.

---

## Key Parameters

| Parameter | Value |
|-----------|-------|
| Max LTV | **75%** — borrow up to 75% of deposit value |
| Liquidation threshold | Health factor < 1.0 |
| Reentrancy guard | Yes — `lock()` / `unlock()` on every circuit |
| Supported assets | NIGHT · sUSD · tDUST |

---

## Supported Pools

| Asset | Deposit APY | Borrow Rate |
|-------|------------|-------------|
| NIGHT | 18.4% | 22.1% |
| sUSD | 8.2% | 11.5% |
| tDUST | 31.7% | 38.4% |

---

## Privacy Model

Night Lend operates on one rule: your financial position is yours alone.

When you deposit collateral, the amount is committed as a ZK hash — the network sees a commitment, not a number. When you prove solvency, the circuit checks your witnesses against the on-chain commitment and returns a boolean — no raw figures cross the boundary. When you borrow, the loan amount is enforced by the circuit without being exposed to third parties.

No bank. No credit bureau. No surveillance.

---

## Smart Contract

`NightLend.compact` is written in Compact for the Midnight Network.

```
contracts/
└── NightLend.compact      Compact v0.20 (Midnight)
```

### Key Circuits

| Circuit | Description |
|---------|-------------|
| `depositNight(amount)` | Deposit NIGHT to earn yield |
| `depositSusd(amount)` | Deposit sUSD to earn yield |
| `borrow(amountUsd)` | Borrow against collateral (75% LTV enforced in-circuit) |
| `repayAll()` | Clear entire borrow position |
| `withdrawNight(amount)` | Withdraw collateral (requires zero borrows) |
| `proveHealthy()` | ZK proof: position is solvent — no amounts revealed |

### `proveHealthy()` — ZK Circuit

```compact
export circuit proveHealthy(): Boolean {
  // witnesses: callerDepositUsd(), callerBorrowUsd()
  // asserts: borUsd <= depUsd * 75 / 100
  // returns true — verifier learns only "solvent"
}
```

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-lend.git
cd night-lend

# Serve locally
npm run dev          # → http://localhost:3006

# Compile the Compact contract
npm install
npm run compile      # → compactc NightLend.compact
```

Connect a Midnight-compatible wallet (Lace recommended) or explore the UI in simulation mode — position state persists in `localStorage`.

---

## The Night Ecosystem

Night Lend is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [**Night Lend**](https://github.com/kingmunz1994-lgtm/night-lend) | **ZK lending at 75% LTV** | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Lend Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Your collateral. Your terms. Your privacy."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-lend) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/NightLend.compact)

</div>
