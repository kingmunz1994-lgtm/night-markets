<div align="center">

![Night Poker](./public/night-poker-banner.svg)

</div>

# Night Poker — Zero-Knowledge Poker Room

> *Every shuffle provably fair. Every hand cryptographically sealed.*

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with additional developer tooling.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![Mental Poker](https://img.shields.io/badge/🃏_XOR_MENTAL-POKER-b97dff?style=for-the-badge&labelColor=090714)](#xor-mental-poker-protocol)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-score--midnight-wallet)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-poker)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Poker?

Night Poker is a provably fair, privacy-first Texas Hold'em room built natively on the **Midnight Network**. No house server controls the deck. No trusted dealer decides the cards. Every shuffle is cryptographically committed by the players themselves using the XOR mental poker protocol, and every showdown is verified on-chain with zero-knowledge proofs.

The house cannot cheat. Neither can any player. The math proves it.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-poker)**

---

## Midnight Network Integration

Night Poker is Midnight-native from the deck down.

**Built on Midnight** — The `poker.compact` contract runs entirely on the Midnight Network. Table creation, XOR shuffle accumulation, hole card dealing, street settlement, showdown card revelation, and pot distribution are all Compact circuits with ZK proofs generated client-side.

**Integrates with Midnight** — Wallet connections and NIGHT token balances flow through the Midnight DApp Connector API. Any Midnight-compatible wallet (Lace recommended) connects at the lobby and signs state channel updates off-chain.

**Extends Midnight** — Night Poker ships the `MentalPokerCrypto` and `StateChannel` primitives as open-source building blocks any Midnight developer can drop into a card game, auction, or any protocol that needs verifiable secret permutations.

---

## Features

**🃏 XOR Mental Poker** — Provably fair card shuffling with no trusted dealer. Each player applies their secret XOR key to the encrypted deck; the commutative property guarantees every participant contributed before a single card is dealt. Adapted from the zkpoker / ottodevs research on ZK-efficient mental poker.

**🔒 SHA-256 Commitments** — Your hole cards are committed via `hashCommit(card, nonce)` before anyone acts. The resulting hash — shown as `0x<hash>…` beneath your cards at the table — is a cryptographic seal: you cannot change your cards after seeing the flop, and the commitment is verifiable by anyone.

**✓ ZK Proof Badge** — At showdown, opponent cards are revealed on-chain through the `revealHand` circuit. The contract verifies `xor16(encCard, playerKey) == padCard(plaintextCard)` in zero knowledge. A green **✓ ZK** badge appears on each opponent's seat once their commitment is verified, confirming no card substitution occurred.

**🂠 Texas Hold'em Rules** — Full preflop → flop → turn → river → showdown lifecycle. 7-card best-5 hand evaluator with proper straight (including A-low wheel), flush, full house, quads, and straight flush detection. Pot is awarded with rake deducted on-chain.

**🏛 Multiplayer Table Lobby** — Browse open tables by stake level (Micro Stakes to High Roller Room), see seat availability at a glance, and create custom tables with your own blind and buy-in settings. AI bot opponents fill seats while real multiplayer is wired up.

**⚡ Off-Chain State Channels** — Betting rounds run off-chain for low-latency play. Players sign state updates locally; only the final signed state root is posted to the contract via `settleStreet`, avoiding block-time delays on every action.

**🌙 Night Score & Midnight Wallet** — Connect a Midnight wallet to load your NIGHT token balance and dust, or use demo mode to jump straight to the felt. Night Score integration tracks performance across the Night ecosystem.

**⏱ Timeout Enforcement** — The `claimTimeout` circuit lets any player auto-fold an idle opponent after 30 blocks, keeping games moving without trusting anyone to act in good faith.

---

## XOR Mental Poker Protocol

The protocol is adapted from the **zkpoker** project by **ottodevs**, chosen because XOR encryption is far cheaper in ZK circuits than hash-based card commitments.

### How it works

```
loadOrGenerateKey(tableId)
  └─ 16-byte secret key persisted per table in localStorage

shuffle(deck)
  └─ Fisher-Yates using crypto.getRandomValues — browser-grade entropy

encryptDeck(shuffledDeck)
  └─ encrypt(card) = xor16(padCard(card), key)
     padCard: card byte → Uint8Array(16)  (card in byte 0, zeros elsewhere)

applyShuffleKey  [on-chain, poker.compact]
  └─ Each player XORs every slot of encryptedDeck with their key
     XOR commutativity: E_A(E_B(x)) == E_B(E_A(x))
     All players must contribute before phase transitions to PREFLOP

decrypt(encCard)
  └─ xor16(encCard, key)[0]  — XOR is its own inverse
```

At showdown, the `revealHand` circuit proves in zero knowledge:

```
xor16(seats[seat].encCard0, myDecryptKey) == padCard(myCard0)
xor16(seats[seat].encCard1, myDecryptKey) == padCard(myCard1)
```

No valid ZK proof means no valid reveal. The pot cannot be awarded to a player who cannot prove their cards.

### SHA-256 Commitment

Before any community cards are shown, your hole cards are sealed:

```js
const nonce = crypto.getRandomValues(new Uint8Array(8));
const commitHash = await poker_crypto.hashCommit(myCards[0], [...nonce]);
// displayed as: 0x3f8a1c2b…
```

`hashCommit(value, nonce)` calls `crypto.subtle.digest('SHA-256', [value, ...nonce])`. The commitment hash appears under your seat throughout the hand and is verifiable against your revealed card at showdown.

---

## Smart Contract

`contracts/poker.compact` is the on-chain game engine, written in Compact for the Midnight Network.

### Ledger state

| Field | Type | Purpose |
|---|---|---|
| `encryptedDeck` | `Vector<52, Bytes<16>>` | XOR-encrypted 52-card deck |
| `shuffleCount` | `Uint<8>` | Players who have applied their shuffle key |
| `seats` | `Vector<6, SeatState>` | Per-seat chips, encrypted hole cards, revealed cards |
| `communityCards` | `Vector<5, Uint<8>>` | Board cards (255 = unrevealed) |
| `stateChannelRoot` | `Bytes<32>` | Off-chain betting state root |
| `phase` | `GamePhase` | `WAITING → SHUFFLE → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → COMPLETE` |

### Circuits

| Circuit | Description |
|---|---|
| `createTable` | Initialise table parameters and reset deck |
| `joinTable` | Sit down with a buy-in; validates seat and stack bounds |
| `startHand` | Transition to SHUFFLE, reset per-hand state |
| `applyShuffleKey` | Player XORs their secret key into the deck; auto-deals when all players have contributed |
| `settleStreet` | Post signed off-chain state root and advance phase; reveals flop/turn/river |
| `revealHand` | ZK proof that plaintext hole cards match on-chain encrypted cards |
| `awardPot` | Transfer pot minus rake to winner |
| `claimTimeout` | Auto-fold idle player after 30 blocks |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-poker.git
cd night-poker

# Serve the frontend locally (no build step required)
npm run dev
# → http://localhost:3001
```

Connect a Midnight-compatible wallet (Lace recommended) to load your NIGHT balance, or click **Demo** at the wallet prompt to play instantly with a mock address.

**To compile the Compact contract:**

```bash
# Install dependencies
npm install

# Compile poker.compact → src/poker_contract/
npm run compile
```

The compiled contract artefacts are written to `src/poker_contract/` and can be deployed to Midnight Preprod via the Midnight SDK.

---

## Project Structure

```
night-poker/
├── contracts/
│   └── poker.compact          # On-chain ZK game engine (Compact)
├── public/
│   ├── index.html             # Single-page app shell
│   └── js/
│       ├── crypto.js          # MentalPokerCrypto + StateChannel primitives
│       ├── game.js            # Game state, XOR shuffle flow, rendering
│       └── cards.js           # Card encoding, rendering, 7-card hand evaluator
└── src/
    └── poker_contract/        # Compiled contract output (compactc artefacts)
```

---

## Night Score & Midnight Wallet

Connect any Midnight-compatible wallet via the Midnight DApp Connector API (`@midnight-ntwrk/dapp-connector-api`). Your NIGHT token balance and dust are loaded from the wallet and displayed in the top bar. Night Score — Night's cross-app reputation layer — will track win rates, pot size history, and ZK proof submission counts as the network matures.

---

## The Night Ecosystem

Night Poker is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [**Night Poker**](https://github.com/kingmunz1994-lgtm/night-poker) | **Provably fair ZK Texas Hold'em** | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [Night Fun](https://github.com/kingmunz1994-lgtm/night-fun) | ZK token launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Poker Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"The deck never lies when the math holds the cards."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-poker) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/poker.compact)

</div>
