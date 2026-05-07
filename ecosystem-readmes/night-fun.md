<div align="center">

# Night Fun — ZK Token Launchpad on Midnight

> *pump.fun, but your buys are invisible.*

</div>

---

🌑 **This project is built on the Midnight Network.**
🔗 **This project integrates with the Midnight Network.**
🛠 **This project extends the Midnight Network with ZK token primitives any developer can fork.**

[![Built On Midnight](https://img.shields.io/badge/⬛_BUILT_ON-MIDNIGHT_NETWORK-7c3aed?style=for-the-badge&labelColor=090714)](https://midnight.network)
[![ZK Proofs](https://img.shields.io/badge/🔒_ZK_PROOFS-ENABLED-00d68f?style=for-the-badge&labelColor=090714)](https://midnight.network/developers)
[![NIGHT Token](https://img.shields.io/badge/🌙_$NIGHT-POWERED-b97dff?style=for-the-badge&labelColor=090714)](#night-token)
[![Live Demo](https://img.shields.io/badge/🌐_LIVE-DEMO-38bdf8?style=for-the-badge&labelColor=090714)](https://kingmunz1994-lgtm.github.io/night-fun)
[![License MIT](https://img.shields.io/badge/LICENSE-MIT-475569?style=for-the-badge&labelColor=090714)](./LICENSE)

---

## What is Night Fun?

Night Fun is a pump.fun-style token launchpad built natively on the **Midnight Network**. Launch a token and a merch store in five minutes. Trade on a constant-product bonding curve where every buy is ZK-shielded — your wallet address never appears on-chain. When the curve graduates at 85 tNIGHT, liquidity migrates automatically to the zswap DEX. Holders earn from every merch sale, forever.

No front-running. No sniping. No one can see you buying.

**[→ Live Demo](https://kingmunz1994-lgtm.github.io/night-fun)**

---

## Midnight Network Integration

Night Fun is Midnight-native at every layer.

**Built on Midnight** — The `NightFunToken.compact` contract runs entirely on-chain: private token balances, the constant-product bonding curve, merch revenue epochs, creator bonds, ZK membership proofs, and tier gating are all enforced by Compact circuits on the Midnight Network. Nothing is off-chain.

**Integrates with Midnight** — Wallet connections flow through the Midnight dApp Connector API (`@midnight-ntwrk/dapp-connector-api`). Lace and 1AM wallets are supported natively. Token transfers use shielded UTXOs through Midnight's Zswap layer.

**Extends Midnight** — Night Fun ships the `NightFunToken.compact` contract as open-source infrastructure: a reusable ZK token primitive with bonding curve, revenue sharing, tier system, and OpenZeppelin-style patterns (SafeOwnable, ERC20-style approve/transferFrom, Burnable, Mintable, ReentrancyGuard) implemented in Compact that any Midnight developer can deploy.

---

## Features

**🚀 Launch in 5 Minutes** — Fill in a name, symbol, supply, and bond amount. The deploy flow compiles the Compact circuit, generates a ZK proof, deploys the contract to Midnight Preprod, locks the creator bond, mints supply to the deployer's shielded commitment, seeds the bonding curve, and brings the Night Store merch integration live — all in a single guided sequence.

**🔒 ZK-Private Buys** — Buyers appear on-chain only as anonymous commitments derived from their secret key and the contract address. No wallet address is ever revealed. Every buy produces a ZK proof of purchase; the live trade feed shows anonymous labels like `shadow_x7f` rather than real addresses.

**🌊 Bonding Curve AMM** — Constant-product (`x * y = k`) pricing with slippage protection. Output amounts are computed off-chain by a witness function and verified in the circuit using tight division-free bounds — no division operators needed in ZK constraints. Buy and sell previews update in real time.

**🎓 Graduation to zswap** — Once the NIGHT reserve in the curve crosses 85 tNIGHT (85,000,000 µNIGHT on-chain), the `graduateCurve` circuit fires — permissionless, callable by anyone. The token is marked graduated and liquidity migrates to the zswap DEX. The progress bar and graduation tab track every token approaching this threshold.

**🔗 Creator Bond — No-Dump Mechanism** — Creators post a minimum bond of 10 tNIGHT when deploying. The bond and the creator's own tokens are locked on-chain for 30 days. This is enforced in the launch flow and surfaced prominently in the UI. Prevents rug pulls at the protocol level.

**🏪 Merch Revenue Sharing** — Every token launch simultaneously opens a Night Store. When a merch sale is recorded via `recordMerchSale`, the revenue splits on-chain immediately using configurable basis points. Holders receive 50% of merch revenue (5,000 bps) by default. Revenue accumulates per epoch; holders call `claimRevenue` to prove their token balance privately and withdraw their proportional share without ever revealing how many tokens they hold.

**⏱ Revenue Epochs** — The creator calls `closeEpoch` to snapshot accumulated revenue and open a new distribution window. Holders can claim across multiple past epochs. The dashboard shows the current epoch, epoch revenue, total merch sales, and each holder's claimable NIGHT balance.

**👑 King of the Hill** — A dedicated community competition tab. Two communities — **Peace** (financial freedom, privacy as a human right) and **War** (burn the old system, privacy as a weapon) — compete to generate the most merch revenue. Whichever community sells more wins. Real on-chain data, no handicaps.

**🌙 Night-ID (.night Names)** — Register a human-readable `.night` identity minted on Midnight. The name is validated (3–32 lowercase alphanumeric chars), registered via the Night Markets API, and stored locally. It appears on your token profile and throughout the UI. Falls back to local storage if the API is offline.

**📊 Token Discovery Grid** — Three tabs: **Trending** (sorted by buy count), **New** (newest tokens first), and **Graduating** (tokens above 60% of the graduation threshold, sorted by progress). Each card shows the token emoji, symbol, tNIGHT raised, buy/sell counts, a graduation progress bar, and a ZK badge.

**📡 Live Trade Feed** — A real-time sidebar feed streams buy and sell events every three seconds. All traders are shown as anonymous labels. Each event is marked `⊘ ZK shielded`. The feed caps at 20 items and smoothly animates new entries.

---

## Privacy Model

Night Fun operates on one rule: your on-chain footprint from buying a token must be zero.

When you buy on the bonding curve, the contract credits your balance to a commitment — a hash of your secret key and the contract address. No wallet address appears anywhere. When you claim merch revenue, you prove your token balance privately via witness; the circuit verifies the balance matches the ledger without disclosing the amount. When you check your tier, you get back a number (0–4) with no balance leaked.

The live feed intentionally shows anonymous labels. The ZK badge on every token card is a reminder of the guarantee, not a marketing claim.

---

## Smart Contract

The `NightFunToken.compact` contract is the single on-chain primitive powering every token launched on Night Fun.

View the contract: [`contracts/NightFunToken.compact`](./contracts/NightFunToken.compact)

### What the contract does

| Circuit | Description |
|---|---|
| `initialize` | Deploy once — sets name, symbol, supply, revenue split (basis points), tier thresholds, license gate, and mints all tokens to the creator's ZK commitment. |
| `transfer` | ZK-private token transfer. Sender proves balance via private witness without revealing it; licence gate enforced for enterprise tokens. |
| `buyCurve` | Pay NIGHT, receive tokens at constant-product price. Output verified via division-free bounds check. |
| `sellCurve` | Return tokens, receive NIGHT. Same division-free verification pattern. |
| `graduateCurve` | Permissionless — anyone triggers graduation once the NIGHT reserve reaches 85 tNIGHT (85,000,000 µNIGHT). |
| `recordMerchSale` | Creator/oracle records a sale; revenue splits to holder epoch pool and creator pending immediately on-chain. |
| `closeEpoch` | Snapshots epoch revenue and advances the epoch counter. |
| `claimRevenue` | Holder proves balance privately, claims proportional NIGHT from past epochs. |
| `creatorClaim` | Creator withdraws their accumulated revenue share. |
| `getHolderTier` | Returns tier (0=none through 4=platinum) via ZK proof — no balance revealed. |
| `proveHolder` | Returns `true` if caller holds > 0 tokens. Used for "verified holder" badges. |
| `approve` / `transferFrom` | ERC20-style ZK delegate spending. Both owner and spender identities are commitments. |
| `burn` | Holder burns their own tokens, permanently reducing total supply. |
| `mint` | Creator mints additional tokens up to an optional hard cap. |
| `proposeCreatorTransfer` / `acceptCreatorRole` | Two-step SafeOwnable-style creator role handoff. |
| `grantLicense` / `revokeLicense` | Enterprise licensing gate — restrict token holding to approved commitment holders. |
| `pause` / `unpause` | Emergency circuit breaker, creator-only. |

**Revenue split config:** `holderRevBps + creatorBps + 500 (platform) = 10,000 bps`. The platform takes a fixed 5% fee. Default launch config sets `holderRevBps = 5000` (50% to holders).

**Bonding curve constants:** virtual NIGHT reserve starts at 1, graduation threshold is `85,000,000 µNIGHT` (85 tNIGHT). The privacy toggle (`curve_privacy_on`) seals trade amounts inside ZK proofs when enabled — buyers and sellers appear as commitments only.

---

## NIGHT Token

The `$NIGHT` token is the unit of value flowing through Night Fun. Buyers pay tNIGHT into the bonding curve. Merch revenue is denominated in NIGHT and distributed to token holders per epoch. Creator bonds are posted in tNIGHT. The graduation threshold is measured in tNIGHT. Night-ID registration fees are paid in NIGHT.

---

## API Server

Night Fun connects to the **Night Markets API server** running at `localhost:3001`. The API layer (`public/js/api.js`) probes `GET /api/status` with a 2-second timeout on load.

If the server is reachable, live chain state, curve trades, epoch operations, and Night-ID registrations are all routed through it. If the server is offline or unreachable, every operation falls back silently to local simulation — curve math runs in-browser, epoch closes are simulated with random revenue values, and Night-IDs are stored in `localStorage`. The UI surface is identical in both modes.

API endpoints used:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Health check — `{ ready: true }` |
| `POST` | `/api/nightfun/launch-curve` | Initialise bonding curve for a token |
| `POST` | `/api/nightfun/buy` | Execute a curve buy |
| `POST` | `/api/nightfun/sell` | Execute a curve sell |
| `POST` | `/api/nightfun/close-epoch` | Close revenue epoch and distribute |
| `GET` | `/api/nightfun/state` | Fetch on-chain token state |
| `POST` | `/api/nightid/register` | Register a `.night` name |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/kingmunz1994-lgtm/night-fun.git
cd night-fun

# Serve the frontend (no build step required)
npm run dev
# → http://localhost:3002

# (Optional) Point at a live Night Markets API server
# Edit public/js/api.js and set NF_API to your server URL.
# The app runs in simulation mode if the server is unreachable.
```

Connect a Midnight-compatible wallet (Lace or 1AM) to deploy tokens and trade on the bonding curve. Click **Try Demo Mode** to explore the full UI without a real wallet — demo mode uses simulated tNIGHT with no real funds.

**To compile the Compact contract:**

```bash
# Install dependencies
npm install

# Compile NightFunToken.compact to WASM
npm run compile
# Output: src/nightfun_contract/
```

---

## Deployment

Night Fun is deployed as a static site on **GitHub Pages** — no server required. The frontend is pure HTML, CSS, and vanilla JavaScript under `public/`. Simulation fallback ensures the demo works without any backend.

```
public/
  index.html          # App shell — nav, hero, tabs, modals
  css/
    nightfun.css      # Full UI theme
  js/
    api.js            # API layer with simulation fallback
    tokens.js         # Token grid, live feed, seed data
    launch.js         # Deploy flow, bonding curve, Night-ID

contracts/
  NightFunToken.compact   # The on-chain primitive
```

---

## The Night Ecosystem

Night Fun is part of the largest dApp ecosystem on Midnight Network.

| App | What it does | Live |
|---|---|---|
| [Night Hub](https://github.com/kingmunz1994-lgtm/night-hub) | Central launchpad | [↗](https://kingmunz1994-lgtm.github.io/night-hub/) |
| [Night Markets](https://github.com/kingmunz1994-lgtm/night-markets) | ZK global marketplace + escrow | [↗](https://kingmunz1994-lgtm.github.io/night-markets/) |
| [Night Poker](https://github.com/kingmunz1994-lgtm/night-poker) | Provably fair ZK Texas Hold'em | [↗](https://kingmunz1994-lgtm.github.io/night-poker/) |
| [**Night Fun**](https://github.com/kingmunz1994-lgtm/night-fun) | **ZK token launchpad** | [↗](https://kingmunz1994-lgtm.github.io/night-fun/) |
| [Night ID](https://github.com/kingmunz1994-lgtm/night-id) | ZK identity + .night names | [↗](https://kingmunz1994-lgtm.github.io/night-id/) |
| [Night Lend](https://github.com/kingmunz1994-lgtm/night-lend) | ZK lending at 75% LTV | [↗](https://kingmunz1994-lgtm.github.io/night-lend/) |
| [Night Work](https://github.com/kingmunz1994-lgtm/night-work) | ZK task marketplace | [↗](https://kingmunz1994-lgtm.github.io/night-work/) |
| [Night Save](https://github.com/kingmunz1994-lgtm/night-save) | ZK vault + sUSD stablecoin | [↗](https://kingmunz1994-lgtm.github.io/night-save/) |
| [Night Biz](https://github.com/kingmunz1994-lgtm/night-biz) | ZK business loyalty tokens | [↗](https://kingmunz1994-lgtm.github.io/night-biz/) |
| [Night Store](https://github.com/kingmunz1994-lgtm/night-store) | ZK merch shop | [↗](https://kingmunz1994-lgtm.github.io/night-store/) |

---

## License

MIT © Night Fun Contributors — *Built on the Midnight Network.*

---

<div align="center">

*"No one knows you're buying. That's the point."*

[🌐 Live Demo](https://kingmunz1994-lgtm.github.io/night-fun) · [🌑 Midnight Network](https://midnight.network) · [📄 Contract](./contracts/NightFunToken.compact)

</div>
