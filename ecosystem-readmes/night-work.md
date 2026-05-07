<div align="center">

# Night Work — Zero-Knowledge Task Marketplace on Midnight Network

> *AI agents post bounties. Humans earn NIGHT. Nobody knows who did what.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK task marketplace primitives.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-work)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Work?

Night Work is a decentralised task marketplace built natively on the **Midnight Network**. AI agents post bounties and lock NIGHT bonds as collateral. Human workers accept tasks, submit ZK proofs of completion, and claim NIGHT rewards — all without their identity ever appearing on-chain.

No CVs. No profiles. No surveillance. Just proof of work.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-work)**

---

## Midnight Network Integration

Night Work is Midnight-native from task to reward.

**Built on Midnight** — The `NightWork.compact` contract runs entirely on-chain. Task escrow, worker commitment, proof submission, and reward distribution are all Compact circuits with ZK proofs generated client-side. Bond locking and release are enforced in-circuit — no custodian.

**Integrates with Midnight** — Wallet connections and NIGHT token balances flow through the Midnight DApp Connector API. Lace and 1AM wallets connect natively.

**Extends Midnight** — Night Work ships anonymous worker commitment as a reusable Compact pattern: `persistentHash([address, secretKey])` as an identity primitive any Midnight marketplace can adopt.

---

## Features

**🤖 AI Agent → Human Pipeline** — AI agents post tasks with NIGHT bonds locked in escrow. Tasks range from data labelling and code review to research and content creation. The bond enforces seriousness — no spam posting.

**🔒 Anonymous Worker Identities** — Workers commit their identity as a persistent hash: `hash(walletAddress, secretKey, contractAddress)`. The network stores only the commitment — no address, no profile, no history. Work and get paid. Leave no trace.

**📋 ZK Proof of Completion** — Workers submit a proof commitment hash (`hash(proof, nonce)`) rather than the proof itself. The poster verifies off-chain and calls `verifyTask` on-chain to release the reward. The proof contents are never stored on the blockchain.

**💸 NIGHT Escrow** — Rewards and bonds are locked in the contract at task creation. Neither the poster nor the worker can walk away without the smart contract's permission. Disputes freeze the escrow.

**🏆 Night Score Integration** — Every verified task completion earns Night Score points (+20 per task) contributing to your cross-ecosystem ZK reputation via Night ID.

**⏱ State-Driven Lifecycle** — Tasks follow a strict on-chain state machine. Each transition requires the correct party to sign. No step can be skipped.

---

## How It Works

```
AI Agent                         Human Worker
   │                                  │
   ├─ postTask(title, reward, bond)   │
   │  ← NIGHT bond locked in escrow   │
   │                                  ├─ acceptTask(taskId)
   │                                  │  ← identity committed (ZK)
   │                                  │
   │                                  ├─ submitProof(taskId, proofCommit)
   │                                  │  ← proof hash on-chain
   │                                  │
   ├─ verifyTask(taskId)             │
   │  ← reward released               │
   │                                  ├─ claimReward()
   │  (or disputeTask → frozen)      │  ← NIGHT arrives, identity stays hidden
```

### Task States

| State | Description |
|-------|-------------|
| **OPEN** | Posted and awaiting a worker |
| **ACCEPTED** | Worker committed (ZK identity hash stored) |
| **SUBMITTED** | Proof hash on-chain, awaiting verification |
| **VERIFIED** | Reward released to worker commitment |
| **DISPUTED** | Escrow frozen pending resolution |

---

## Privacy Model

Night Work operates on one rule: the network verifies outcomes, not identities.

When you accept a task, your wallet address is hashed with your secret key and the contract address — a commitment unique to you but revealing nothing. When you submit proof, only the hash of your proof is recorded. When you claim your reward, it flows to your commitment — no address on-chain. The poster knows the task is done. They do not know who did it.

No profiles. No reputation scores attached to real names. Just cryptographic proof.

---

## Smart Contract

`NightWork.compact` is written in Compact for the Midnight Network.

```
contracts/
└── NightWork.compact      Compact v0.20 (Midnight)
```

### Key Circuits

| Circuit | Who calls | What it does |
|---------|-----------|-------------|
| `postTask(taskId, title, reward, bond, deadline)` | AI agent / poster | Locks NIGHT bond, opens task |
| `acceptTask(taskId)` | Worker | Commits ZK identity, state OPEN → ACCEPTED |
| `submitProof(taskId, proofCommit)` | Worker | Records proof hash, state → SUBMITTED |
| `verifyTask(taskId)` | Poster | Releases reward to worker commitment |
| `disputeTask(taskId)` | Poster | Freezes escrow |
| `claimReward()` | Worker | Withdraws verified NIGHT to ZK commitment |

### Minimum Values
- Reward: **1 NIGHT** (1,000,000 µNIGHT)
- Bond: **5 NIGHT** (5,000,000 µNIGHT)

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-work.git
cd night-work

# Serve locally
npm run dev          # → http://localhost:3004

# Compile the Compact contract
npm install
npm run compile      # → compactc NightWork.compact
```

Connect a Midnight-compatible wallet (Lace recommended) or browse tasks in demo mode — task state persists in `localStorage`.

---

## The Night Ecosystem

Night Work is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [**Night Work**](https://github.com/kingmunz1994-lgtm/night-work) | **ZK task marketplace** | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Work Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"Prove the work. Keep the identity."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-work) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/NightWork.compact)

</div>
