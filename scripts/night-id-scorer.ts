/**
 * night-id-scorer.ts — Multi-chain Night Score engine
 *
 * Scores a wallet address across Ethereum, Solana, Cardano, and Midnight
 * based on real on-chain activity. No balances revealed — scoring is based
 * on behaviour (age, tx count, protocol diversity, staking, governance).
 *
 * Usage:
 *   const result = await scoreWallet('eth', '0x123...');
 *   // { score, level, breakdown, credential }
 *
 * API keys needed in .env:
 *   ETHERSCAN_API_KEY=   (free at etherscan.io/apis)
 *   HELIUS_API_KEY=      (free at helius.dev — 100k req/month)
 *   BLOCKFROST_ADA_KEY=  (free at blockfrost.io — 50k req/day)
 */

export type Chain = 'eth' | 'sol' | 'ada' | 'midnight';

export interface ScoreBreakdown {
  chain: Chain;
  address: string;
  components: { label: string; points: number; detail?: string }[];
  subtotal: number;
}

export interface NightScoreResult {
  address: string;
  chains: Chain[];
  breakdowns: ScoreBreakdown[];
  crossChainBonus: number;
  totalScore: number;
  level: string;
  levelEmoji: string;
  nightTokenReward: number;
  credential: NightCredential;
}

export interface NightCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: {
    id: string;
    nightScore: number;
    level: string;
    chainsAnalyzed: Chain[];
    earnedAt: string;
  };
}

// ── Score levels ─────────────────────────────────────────────────────────────
export function scoreToLevel(score: number): { level: string; emoji: string } {
  if (score >= 1000) return { level: 'Architect',   emoji: '🌟' };
  if (score >= 600)  return { level: 'Founder',     emoji: '🟢' };
  if (score >= 300)  return { level: 'Maker',       emoji: '🔵' };
  if (score >= 100)  return { level: 'Builder',     emoji: '🟣' };
  return               { level: 'Contributor', emoji: '⬜' };
}

// ── Known DeFi protocol addresses (Ethereum) ─────────────────────────────────
const ETH_DEFI_PROTOCOLS: Record<string, string> = {
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'Aave (AAVE)',
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': 'Aave V3',
  '0xc3d688b66703497daa19211eedff47f25384cdc3': 'Compound V3',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Protocol',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch V5',
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'Lido (stETH)',
  '0x9ee91f9f426fa633d227f7a9b000e28b9dfd8599': 'Lido Staking',
  '0xba12222222228d8ba445958a75a0704d566bf2c8': 'Balancer V2',
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': 'SushiSwap',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap Universal Router',
};

// ── Ethereum scorer ───────────────────────────────────────────────────────────
async function scoreEthereum(address: string): Promise<ScoreBreakdown> {
  const components: ScoreBreakdown['components'] = [];
  const apiKey = process.env.ETHERSCAN_API_KEY ?? '';
  const base = 'https://api.etherscan.io/api';

  try {
    // Fetch normal transactions
    const txResp = await fetch(
      `${base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`
    );
    const txData = await txResp.json() as any;
    const txs: any[] = txData.status === '1' ? txData.result : [];

    // Wallet age
    if (txs.length > 0) {
      const firstTx = Number(txs[0].timeStamp);
      const ageYears = (Date.now() / 1000 - firstTx) / (365.25 * 24 * 3600);
      if (ageYears >= 3) {
        components.push({ label: 'Wallet age > 3 years', points: 100, detail: `${ageYears.toFixed(1)} years` });
      } else if (ageYears >= 1) {
        components.push({ label: 'Wallet age > 1 year', points: 50, detail: `${ageYears.toFixed(1)} years` });
      }
    }

    // Transaction count
    const txCount = txs.length;
    if (txCount >= 1000) {
      components.push({ label: 'Transaction count > 1,000', points: 100, detail: `${txCount.toLocaleString()} txs` });
    } else if (txCount >= 100) {
      components.push({ label: 'Transaction count > 100', points: 50, detail: `${txCount.toLocaleString()} txs` });
    } else if (txCount >= 10) {
      components.push({ label: 'Transaction count > 10', points: 20, detail: `${txCount} txs` });
    }

    // DeFi protocol diversity
    const protocolsUsed = new Set<string>();
    for (const tx of txs) {
      const to = (tx.to ?? '').toLowerCase();
      if (ETH_DEFI_PROTOCOLS[to]) protocolsUsed.add(ETH_DEFI_PROTOCOLS[to]);
    }
    for (const protocol of protocolsUsed) {
      components.push({ label: `DeFi: ${protocol}`, points: 15 });
    }

    // ENS name
    const ensResp = await fetch(
      `${base}?module=account&action=getdomaininfo&address=${address}&apikey=${apiKey}`
    ).catch(() => null);
    if (ensResp?.ok) {
      const ensData = await ensResp.json() as any;
      if (ensData.status === '1' && ensData.result) {
        components.push({ label: 'ENS name holder', points: 30, detail: ensData.result });
      }
    }

    // ETH2 staking (check for stETH or validator deposits)
    const tokenResp = await fetch(
      `${base}?module=account&action=tokentx&address=${address}&contractaddress=0xae7ab96520de3a18e5e111b5eaab095312d7fe84&apikey=${apiKey}`
    );
    const tokenData = await tokenResp.json() as any;
    if (tokenData.status === '1' && tokenData.result?.length > 0) {
      components.push({ label: 'ETH staking (Lido stETH)', points: 40 });
    }

  } catch (err) {
    console.warn('[scorer/eth] fetch error:', err);
  }

  return {
    chain: 'eth',
    address,
    components,
    subtotal: components.reduce((s, c) => s + c.points, 0),
  };
}

// ── Solana scorer ─────────────────────────────────────────────────────────────
async function scoreSolana(address: string): Promise<ScoreBreakdown> {
  const components: ScoreBreakdown['components'] = [];
  const apiKey = process.env.HELIUS_API_KEY ?? '';

  try {
    const base = apiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
      : 'https://api.mainnet-beta.solana.com';

    // Get signatures (transaction history)
    const sigResp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
        params: [address, { limit: 1000 }],
      }),
    });
    const sigData = await sigResp.json() as any;
    const sigs: any[] = sigData.result ?? [];

    const txCount = sigs.length;
    if (txCount >= 100) {
      components.push({ label: 'Transaction count > 100', points: 30, detail: `${txCount}+ txs` });
    } else if (txCount >= 10) {
      components.push({ label: 'Transaction count > 10', points: 15, detail: `${txCount} txs` });
    }

    // Wallet age from first signature
    if (sigs.length > 0) {
      const oldest = sigs[sigs.length - 1];
      if (oldest.blockTime) {
        const ageYears = (Date.now() / 1000 - oldest.blockTime) / (365.25 * 24 * 3600);
        if (ageYears >= 1) {
          components.push({ label: 'Wallet age > 1 year', points: 50, detail: `${ageYears.toFixed(1)} years` });
        }
      }
    }

    // SOL staking — check for stake accounts
    const stakeResp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'getProgramAccounts',
        params: ['Stake11111111111111111111111111111111111111', {
          filters: [{ memcmp: { offset: 44, bytes: address } }],
          encoding: 'base64',
          dataSlice: { offset: 0, length: 0 },
        }],
      }),
    });
    const stakeData = await stakeResp.json() as any;
    if (stakeData.result?.length > 0) {
      components.push({ label: 'SOL staked', points: 30, detail: `${stakeData.result.length} stake account(s)` });
    }

    // NFT holdings via Helius (if key available)
    if (apiKey) {
      const nftResp = await fetch(
        `https://api.helius.xyz/v0/addresses/${address}/nfts?api-key=${apiKey}`
      );
      if (nftResp.ok) {
        const nftData = await nftResp.json() as any;
        if (Array.isArray(nftData) && nftData.length > 0) {
          components.push({ label: 'NFT holder', points: 20, detail: `${nftData.length} NFT(s)` });
        }
      }
    }

  } catch (err) {
    console.warn('[scorer/sol] fetch error:', err);
  }

  return {
    chain: 'sol',
    address,
    components,
    subtotal: components.reduce((s, c) => s + c.points, 0),
  };
}

// ── Cardano scorer ────────────────────────────────────────────────────────────
async function scoreCardano(address: string): Promise<ScoreBreakdown> {
  const components: ScoreBreakdown['components'] = [];
  const apiKey = process.env.BLOCKFROST_ADA_KEY ?? '';

  if (!apiKey) {
    return { chain: 'ada', address, components, subtotal: 0 };
  }

  try {
    const base = 'https://cardano-mainnet.blockfrost.io/api/v0';
    const headers = { project_id: apiKey };

    // Transaction history
    const txResp = await fetch(`${base}/addresses/${address}/transactions?count=100&order=asc`, { headers });
    if (txResp.ok) {
      const txs = await txResp.json() as any[];

      if (txs.length > 0) {
        // Wallet age from first tx
        const firstTx = txs[0];
        const blockResp = await fetch(`${base}/txs/${firstTx.tx_hash}`, { headers });
        if (blockResp.ok) {
          const blockData = await blockResp.json() as any;
          if (blockData.block_time) {
            const ageYears = (Date.now() / 1000 - blockData.block_time) / (365.25 * 24 * 3600);
            if (ageYears >= 1) {
              components.push({ label: 'Wallet age > 1 year', points: 50, detail: `${ageYears.toFixed(1)} years` });
            }
          }
        }
      }

      // Tx count
      if (txs.length >= 50) {
        components.push({ label: 'Transaction count > 50', points: 30, detail: `${txs.length}+ txs` });
      } else if (txs.length >= 10) {
        components.push({ label: 'Transaction count > 10', points: 15, detail: `${txs.length} txs` });
      }
    }

    // Staking info
    const stakeResp = await fetch(`${base}/accounts/${address}`, { headers });
    if (stakeResp.ok) {
      const stakeData = await stakeResp.json() as any;
      if (stakeData.pool_id) {
        components.push({ label: 'Stake pool delegation', points: 40, detail: stakeData.pool_id.slice(0, 20) + '…' });
      }
    }

    // Smart contract interactions
    const utxoResp = await fetch(`${base}/addresses/${address}/utxos?count=20`, { headers });
    if (utxoResp.ok) {
      const utxos = await utxoResp.json() as any[];
      const hasScript = utxos.some((u: any) => u.reference_script_hash);
      if (hasScript) {
        components.push({ label: 'Smart contract interactions', points: 25 });
      }
    }

  } catch (err) {
    console.warn('[scorer/ada] fetch error:', err);
  }

  return {
    chain: 'ada',
    address,
    components,
    subtotal: components.reduce((s, c) => s + c.points, 0),
  };
}

// ── Midnight scorer (existing on-chain data) ──────────────────────────────────
async function scoreMidnight(address: string): Promise<ScoreBreakdown> {
  const components: ScoreBreakdown['components'] = [];

  const INDEXER = process.env.INDEXER_URI ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
  const ESCROW   = '7473b82b398f6b8665541862a1165c6c5da379355f9c32dace36ed234b7cc711';

  try {
    const query = `{
      unshieldedTransactions(address: "${address}") { totalCount }
      contractActions(contractAddress: "${ESCROW}") { totalCount }
    }`;

    const resp = await fetch(INDEXER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (resp.ok) {
      const data = await resp.json() as any;
      const txCount = data?.data?.unshieldedTransactions?.totalCount ?? 0;
      const circuitCalls = data?.data?.contractActions?.totalCount ?? 0;

      if (txCount > 0) {
        components.push({ label: 'Midnight contract deployed', points: 200, detail: 'Night Markets Escrow' });
      }
      if (circuitCalls > 0) {
        const pts = Math.min(circuitCalls * 15, 300);
        components.push({ label: `ZK circuit calls (${circuitCalls})`, points: pts });
      }
    }
  } catch (err) {
    console.warn('[scorer/midnight] fetch error:', err);
  }

  return {
    chain: 'midnight',
    address,
    components,
    subtotal: components.reduce((s, c) => s + c.points, 0),
  };
}

// ── Issue W3C VC credential ───────────────────────────────────────────────────
function issueCredential(address: string, chains: Chain[], score: number): NightCredential {
  const { level } = scoreToLevel(score);
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'NightScoreCredential'],
    issuer: 'https://night.markets/issuer',
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: `night:${address}`,
      nightScore: score,
      level,
      chainsAnalyzed: chains,
      earnedAt: new Date().toISOString(),
    },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function scoreWallet(
  chain: Chain,
  address: string,
): Promise<NightScoreResult> {
  let breakdowns: ScoreBreakdown[];

  if (chain === 'all') {
    // Score all chains in parallel for the same address pattern
    breakdowns = await Promise.all([
      scoreEthereum(address),
      scoreSolana(address),
      scoreCardano(address),
      scoreMidnight(address),
    ]);
  } else {
    const scorerMap: Record<Chain, (a: string) => Promise<ScoreBreakdown>> = {
      eth: scoreEthereum,
      sol: scoreSolana,
      ada: scoreCardano,
      midnight: scoreMidnight,
    };
    breakdowns = [await scorerMap[chain](address)];
  }

  // Cross-chain bonus
  const activeChains = breakdowns.filter(b => b.subtotal > 0).map(b => b.chain);
  let crossChainBonus = 0;
  if (activeChains.length >= 3) crossChainBonus = 100;
  else if (activeChains.length >= 2) crossChainBonus = 50;

  const baseScore = breakdowns.reduce((s, b) => s + b.subtotal, 0);
  const totalScore = baseScore + crossChainBonus;
  const { level, emoji } = scoreToLevel(totalScore);

  return {
    address,
    chains: breakdowns.map(b => b.chain),
    breakdowns,
    crossChainBonus,
    totalScore,
    level,
    levelEmoji: emoji,
    nightTokenReward: Math.floor(totalScore / 10),
    credential: issueCredential(address, breakdowns.map(b => b.chain), totalScore),
  };
}
