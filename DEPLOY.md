# Deploying Night Ecosystem Contracts

Step-by-step guide to deploy all 7 Compact contracts to Midnight Preprod.

---

## One-time Setup

### 1. Install the Compact compiler

Download from the Midnight developer portal:
```
https://docs.midnight.network/develop/tutorial/building/prereqs
```

Verify installation:
```bash
compact --version
# compact 0.22.x
```

### 2. Install Node.js dependencies (night-markets)

```bash
cd night-markets
npm install
```

### 3. Start the proof server (Docker required)

```bash
# Run in a separate terminal — keep it running during all deployments
npm run proof-server
# Starts at http://127.0.0.1:6300

# Verify it's ready (wait ~30s for first start):
curl http://127.0.0.1:6300/health
```

### 4. Get a funded preprod wallet

Generate a fresh seed:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fund it at the Midnight preprod faucet — you need both **tNIGHT** and **tDUST**:
```
https://faucet.preprod.midnight.network
```

---

## Deploy NightMarketsEscrow (main contract)

```bash
cd night-markets

# Compile
npm run compile

# Deploy
AGENT_SEED=<your-64-char-hex> npm run deploy
# Output: CONTRACT_ADDRESS=mn1abc...

# Save to .env
echo "CONTRACT_ADDRESS=<address>" >> .env
echo "AGENT_SEED=<your-seed>" >> .env
```

---

## Deploy Ecosystem Contracts

Each repo follows the same pattern. Run these from their respective directories.

### Night Fun (token launchpad)

```bash
cd night-fun
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

### Night Work (task marketplace)

```bash
cd night-work
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

### Night Lend (lending protocol)

```bash
cd night-lend
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

### Night Save (vault + sUSD)

```bash
cd night-save
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

### Night Biz (loyalty tokens)

```bash
cd night-biz
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

### Night Poker (ZK poker room)

```bash
cd night-poker
npm install
npm run compile
AGENT_SEED=<hex> npm run deploy
```

---

## After Deploying All Contracts

Update the night-markets API server with all addresses:

```bash
# night-markets/.env
NIGHT_MARKETS_CONTRACT=mn1...
NIGHT_FUN_CONTRACT=mn1...
NIGHT_WORK_CONTRACT=mn1...
NIGHT_LEND_CONTRACT=mn1...
NIGHT_SAVE_CONTRACT=mn1...
NIGHT_BIZ_CONTRACT=mn1...
NIGHT_POKER_CONTRACT=mn1...
AGENT_SEED=<deployer-seed>
```

Then start the API server:
```bash
cd night-markets
npm run api-server
```

---

## Troubleshooting

**"compact: command not found"**
- Install the Compact compiler from the Midnight developer portal

**"Proof server not reachable"**
- Ensure Docker is running and the proof server container started
- Check `docker ps` to confirm `midnightntwrk/proof-server` is running

**"Insufficient dust"**
- Every transaction requires tDUST for gas — get more from the faucet

**"Wallet not synced"**
- Preprod sync can take 1-2 minutes — the deploy script waits automatically

**Proof generation is slow (5-10 min)**
- Normal for first deployment — ZK circuit compilation is cached after first run

---

## Contract Addresses (after deployment)

| Contract | Address |
|----------|---------|
| NightMarketsEscrow | *(deploy to get)* |
| NightFunToken | *(deploy to get)* |
| NightWork | *(deploy to get)* |
| NightLend | *(deploy to get)* |
| NightSave | *(deploy to get)* |
| NightBizToken | *(deploy to get)* |
| NightPoker | *(deploy to get)* |
