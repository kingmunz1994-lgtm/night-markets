/**
 * test-api.ts — Night Markets API smoke tests
 *
 * Tests all non-contract endpoints. No Midnight stack required.
 * Contract endpoints (escrow) are tested for correct 503 behaviour when offline.
 *
 * Run:
 *   npm run api-server          # terminal 1
 *   npx tsx scripts/test-api.ts # terminal 2
 */

const BASE = process.env.API_URL ?? 'http://localhost:3001';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failures.push(`${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json() };
}

// ── 1. Health ────────────────────────────────────────────────────────────────

console.log('\n🌙 Night Markets API Tests\n');
console.log('── Health ──────────────────────────────────────────────────────');

await test('GET /api/status returns status object', async () => {
  const { status, body } = await get('/api/status');
  assert(status === 200, `expected 200, got ${status}`);
  assert('ready' in body, 'missing ready field');
  assert('contractAddress' in body, 'missing contractAddress');
  assert('network' in body, 'missing network');
});

await test('GET /health returns ok', async () => {
  const { status, body } = await get('/health');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.ok === true, 'health not ok');
});

// ── 2. Listings ──────────────────────────────────────────────────────────────

console.log('\n── Listings ────────────────────────────────────────────────────');

const testListingId = `test-${Date.now()}`;

await test('POST /api/listings/create — digital listing', async () => {
  const { status, body } = await post('/api/listings/create', {
    id: testListingId,
    title: 'Test Ebook',
    desc: 'A test digital product',
    cat: 'ebooks',
    price: 500,
    type: 'digital',
    deliveryUrl: 'https://example.com/secret-file',
    sellerId: 'seller_test_123',
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok not true');
  assert(!body.listing.deliveryUrl, 'deliveryUrl must be stripped from response');
  assert(body.listing.type === 'digital', 'wrong type');
});

await test('GET /api/listings returns array', async () => {
  const { status, body } = await get('/api/listings');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.listings), 'listings must be array');
  assert(body.listings.length > 0, 'should have at least the test listing');
});

await test('GET /api/listings/:id returns listing without deliveryUrl', async () => {
  const { status, body } = await get(`/api/listings/${testListingId}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.listing.id === testListingId, 'wrong id');
  assert(!body.listing.deliveryUrl, 'deliveryUrl must not be exposed to buyers');
});

await test('GET /api/listings/:id 404 for unknown id', async () => {
  const { status } = await get('/api/listings/nonexistent-id-xyz');
  assert(status === 404, `expected 404, got ${status}`);
});

const printfulListingId = `pf-test-${Date.now()}`;
await test('POST /api/listings/create — printful listing', async () => {
  const { status, body } = await post('/api/listings/create', {
    id: printfulListingId,
    title: 'Night Markets Tee',
    desc: 'Custom tee with Night logo',
    cat: 'clothing',
    price: 750,
    type: 'printful',
    printfulProductType: 'tshirt',
    designUrl: 'https://example.com/design.png',
    printfulColor: 'Black',
    sizes: ['S', 'M', 'L', 'XL'],
    sellerId: 'seller_test_123',
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.listing.printfulProductType === 'tshirt', 'wrong product type');
  assert(body.listing.designUrl === 'https://example.com/design.png', 'designUrl not stored');
  assert(body.listing.printfulColor === 'Black', 'color not stored');
});

// ── 3. Shipping ──────────────────────────────────────────────────────────────

console.log('\n── Shipping ────────────────────────────────────────────────────');

await test('POST /api/listings/shipping — store buyer address', async () => {
  const { status, body } = await post('/api/listings/shipping', {
    orderId: printfulListingId,
    name: 'Luke Test',
    address1: '123 Test St',
    city: 'Sydney',
    countryCode: 'AU',
    zip: '2000',
    email: 'luke@test.com',
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.ok === true, 'ok not true');
});

await test('POST /api/listings/shipping — missing required fields', async () => {
  const { status } = await post('/api/listings/shipping', {
    orderId: printfulListingId,
    name: 'Luke Test',
    // missing address1 and countryCode
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('GET /api/listings/shipping/:id returns address', async () => {
  const { status, body } = await get(`/api/listings/shipping/${printfulListingId}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.shipping.name === 'Luke Test', 'wrong name');
  assert(body.shipping.countryCode === 'AU', 'wrong country');
});

// ── 4. Digital delivery gate ─────────────────────────────────────────────────

console.log('\n── Delivery gate ───────────────────────────────────────────────');

await test('GET /api/delivery/download/:id blocked before release', async () => {
  const { status, body } = await get(`/api/delivery/download/${testListingId}`);
  assert(status === 403, `expected 403 before release, got ${status}: ${JSON.stringify(body)}`);
});

await test('GET /api/delivery/download/:id 400 for non-digital listing', async () => {
  const { status } = await get(`/api/delivery/download/${printfulListingId}`);
  assert(status === 400, `expected 400 for non-digital, got ${status}`);
});

// ── 5. Printful catalog ───────────────────────────────────────────────────────

console.log('\n── Printful catalog ────────────────────────────────────────────');

await test('GET /api/printful/catalog returns products with pricing', async () => {
  const { status, body } = await get('/api/printful/catalog');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.catalog), 'catalog must be array');
  assert(body.catalog.length >= 6, `expected 6+ products, got ${body.catalog.length}`);
  const tshirt = body.catalog.find((p: any) => p.id === 'tshirt');
  assert(tshirt, 'tshirt not in catalog');
  assert(tshirt.suggestedPriceNIGHT > 0, 'suggestedPriceNIGHT must be > 0');
  assert(tshirt.baseCostNIGHT > 0, 'baseCostNIGHT must be > 0');
  assert(Array.isArray(tshirt.colors), 'colors must be array');
  assert(Array.isArray(tshirt.sizes), 'sizes must be array');
});

// ── 6. Ratings ───────────────────────────────────────────────────────────────

console.log('\n── Ratings ─────────────────────────────────────────────────────');

await test('POST /api/ratings/submit stores and averages', async () => {
  const { status, body } = await post('/api/ratings/submit', {
    sellerId: 'seller_test_123',
    buyerId: 'buyer_abc',
    stars: 5,
    comment: 'Great seller, fast delivery',
    orderId: testListingId,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.avg === 5, 'avg should be 5');
  assert(body.count === 1, 'count should be 1');
});

await test('POST /api/ratings/submit second rating updates avg', async () => {
  const { status, body } = await post('/api/ratings/submit', {
    sellerId: 'seller_test_123',
    stars: 3,
    orderId: testListingId + '-2',
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.avg === 4, 'avg of 5+3 should be 4');
  assert(body.count === 2, 'count should be 2');
});

await test('GET /api/ratings/:sellerId returns reviews', async () => {
  const { status, body } = await get('/api/ratings/seller_test_123');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.count === 2, `expected 2 reviews, got ${body.count}`);
  assert(body.avg === 4, `expected avg 4, got ${body.avg}`);
});

// ── 7. Night ID ──────────────────────────────────────────────────────────────

console.log('\n── Night ID ────────────────────────────────────────────────────');

const testAddr = 'midnight_test_' + Math.random().toString(36).slice(2, 10);

await test('POST /api/nightid/register registers a .night name', async () => {
  const { status, body } = await post('/api/nightid/register', {
    name: 'testluke',
    address: testAddr,
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.name === 'testluke.night', 'name should be testluke.night');
  assert(body.address === testAddr, 'wrong address');
});

await test('POST /api/nightid/register — name too short', async () => {
  const { status } = await post('/api/nightid/register', { name: 'ab', address: testAddr });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('POST /api/nightid/register — conflict on different address', async () => {
  const { status } = await post('/api/nightid/register', {
    name: 'testluke',
    address: 'some_other_address',
  });
  assert(status === 409, `expected 409, got ${status}`);
});

await test('GET /api/nightid/resolve/:name resolves to address', async () => {
  const { status, body } = await get('/api/nightid/resolve/testluke');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.address === testAddr, 'wrong address');
});

await test('GET /api/nightid/lookup/:addr reverse lookups', async () => {
  const { status, body } = await get(`/api/nightid/lookup/${testAddr}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.name === 'testluke.night', 'wrong name in reverse lookup');
});

await test('POST /api/nightid/record-action adds to score', async () => {
  const { status, body } = await post('/api/nightid/record-action', {
    holderAddress: testAddr,
    appId: 'night-markets',
    points: 50,
    eventType: 4,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.newTotal === 50, `expected 50, got ${body.newTotal}`);
});

await test('GET /api/nightid/action-score/:addr returns cumulative score', async () => {
  const { status, body } = await get(`/api/nightid/action-score/${testAddr}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.total === 50, `expected 50, got ${body.total}`);
  assert(body.byApp['night-markets'] === 50, 'byApp breakdown wrong');
  assert(body.threshold200 === false, 'should not have crossed 200 threshold yet');
});

// ── 8. Night Fun bonding curve ────────────────────────────────────────────────

console.log('\n── Night Fun bonding curve ─────────────────────────────────────');

const testTokenAddr = `token_test_${Date.now()}`;

await test('POST /api/nightfun/launch-curve initialises curve', async () => {
  const { status, body } = await post('/api/nightfun/launch-curve', {
    tokenAddress: testTokenAddr,
    initialTokens: 1_000_000_000,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.ok === true, 'ok not true');
  assert(body.curve.tokenAddress === testTokenAddr, 'wrong tokenAddress');
});

await test('POST /api/nightfun/launch-curve — duplicate rejected', async () => {
  const { status } = await post('/api/nightfun/launch-curve', {
    tokenAddress: testTokenAddr,
    initialTokens: 1_000_000_000,
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('POST /api/nightfun/buy returns tokens', async () => {
  const { status, body } = await post('/api/nightfun/buy', {
    tokenAddress: testTokenAddr,
    nightIn: 1,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(BigInt(body.tokensOut) > 0n, 'should receive tokens');
});

await test('GET /api/nightfun/curve returns curve state', async () => {
  const { status, body } = await get(`/api/nightfun/curve?addr=${testTokenAddr}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(Number(body.nightReserve) > 0, 'nightReserve should be > 0 after buy');
  assert('pricePerToken' in body, 'missing pricePerToken');
  assert('graduationPct' in body, 'missing graduationPct');
});

await test('POST /api/nightfun/sell returns NIGHT', async () => {
  const { status, body } = await post('/api/nightfun/sell', {
    tokenAddress: testTokenAddr,
    tokensIn: 1000,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(BigInt(body.nightOut) > 0n, 'should receive NIGHT');
});

// ── 9. Tokens ────────────────────────────────────────────────────────────────

console.log('\n── Tokens ──────────────────────────────────────────────────────');

await test('GET /api/tokens returns pre-seeded tokens', async () => {
  const { status, body } = await get('/api/tokens');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.tokens.length >= 9, `expected 9+ tokens, got ${body.tokens.length}`);
});

await test('POST /api/tokens/create creates new token', async () => {
  const { status, body } = await post('/api/tokens/create', {
    name: 'TestCoin',
    symbol: 'TEST',
    emoji: '🧪',
    desc: 'Test token',
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.token.symbol === 'TEST', 'wrong symbol');
  assert(body.token.address.startsWith('token_'), 'address should start with token_');
});

// ── 10. Night Work ───────────────────────────────────────────────────────────

console.log('\n── Night Work ──────────────────────────────────────────────────');

let createdTaskId = '';

await test('POST /api/nightwork/post creates task', async () => {
  const { status, body } = await post('/api/nightwork/post', {
    title: 'Test photography task',
    reward: 50,
    category: 'photography',
    poster: testAddr,
  });
  assert(status === 200, `expected 200, got ${status}`);
  createdTaskId = body.task.id;
  assert(createdTaskId, 'missing task id');
});

await test('GET /api/tasks returns tasks including new one', async () => {
  const { status, body } = await get('/api/tasks');
  assert(status === 200, `expected 200, got ${status}`);
  const found = body.tasks.find((t: any) => t.id === createdTaskId);
  assert(found, 'created task not in list');
});

await test('POST /api/nightwork/accept accepts task', async () => {
  const { status, body } = await post('/api/nightwork/accept', {
    taskId: createdTaskId,
    worker: testAddr,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.state === 'accepted', 'wrong state');
});

await test('POST /api/nightwork/submit submits proof', async () => {
  const { status, body } = await post('/api/nightwork/submit', {
    taskId: createdTaskId,
    proof: 'ipfs://QmTestProofHash123',
    worker: testAddr,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.state === 'submitted', 'wrong state');
});

await test('GET /api/nightwork/my-tasks/:addr lists worker tasks', async () => {
  const { status, body } = await get(`/api/nightwork/my-tasks/${testAddr}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.tasks.length > 0, 'should have at least 1 task');
  assert(body.tasks[0].workerState === 'submitted', 'wrong worker state');
});

// ── 11. Night Save ───────────────────────────────────────────────────────────

console.log('\n── Night Save ──────────────────────────────────────────────────');

await test('POST /api/nightsave/deposit adds collateral', async () => {
  const { status, body } = await post('/api/nightsave/deposit', {
    address: testAddr,
    amount: 10000,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.collateral === 10000, `expected 10000, got ${body.collateral}`);
});

await test('POST /api/nightsave/mint within LTV succeeds', async () => {
  const { status, body } = await post('/api/nightsave/mint', {
    address: testAddr,
    amount: 100, // well within 80% LTV of 10000 NIGHT @ $0.04 = $400 max
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.debt === 100, `expected 100, got ${body.debt}`);
});

await test('POST /api/nightsave/mint over LTV rejected', async () => {
  const { status } = await post('/api/nightsave/mint', {
    address: testAddr,
    amount: 99999, // way over LTV
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('GET /api/nightsave/state/:addr returns vault', async () => {
  const { status, body } = await get(`/api/nightsave/state/${testAddr}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.collateral === 10000, 'wrong collateral');
  assert(body.debt === 100, 'wrong debt');
});

// ── 12. Night Lend ───────────────────────────────────────────────────────────

console.log('\n── Night Lend ──────────────────────────────────────────────────');

await test('GET /api/nightlend/pools returns pools', async () => {
  const { status, body } = await get('/api/nightlend/pools');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.pools), 'pools must be array');
  assert(body.pools.length === 3, `expected 3 pools, got ${body.pools.length}`);
});

await test('POST /api/nightlend/deposit and GET state', async () => {
  const { status } = await post('/api/nightlend/deposit', {
    address: testAddr,
    asset: 'NIGHT',
    amount: 5000,
  });
  assert(status === 200, `expected 200, got ${status}`);
  const { status: s2, body } = await get(`/api/nightlend/state/${testAddr}`);
  assert(s2 === 200, `expected 200, got ${s2}`);
  assert(body.deposits.NIGHT === 5000, `expected 5000, got ${body.deposits.NIGHT}`);
});

await test('POST /api/nightlend/borrow rejects over 75% LTV', async () => {
  const { status } = await post('/api/nightlend/borrow', {
    address: testAddr,
    asset: 'sUSD',
    amount: 99999,
  });
  assert(status === 400, `expected 400, got ${status}`);
});

// ── 13. Night Biz ────────────────────────────────────────────────────────────

console.log('\n── Night Biz ───────────────────────────────────────────────────');

await test('POST /api/nightbiz/deploy creates loyalty token', async () => {
  const { status, body } = await post('/api/nightbiz/deploy', {
    address: testAddr,
    name: 'Test Rewards',
    symbol: 'TREW',
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.token.symbol === 'TREW', 'wrong symbol');
});

await test('POST /api/nightbiz/tier returns correct tier', async () => {
  const { status, body } = await post('/api/nightbiz/tier', {
    address: testAddr,
    balance: 1500,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.tier === 'Silver', `expected Silver, got ${body.tier}`);
});

// ── 14. Poker ────────────────────────────────────────────────────────────────

console.log('\n── Poker ───────────────────────────────────────────────────────');

await test('POST /api/poker/create creates a room', async () => {
  const { status, body } = await post('/api/poker/create', {
    name: 'Test Table',
    buyin: 1000,
    sb: 25,
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.roomId.startsWith('room-'), `expected room- prefix, got ${body.roomId}`);
  assert(body.buyin === 1000, 'wrong buyin');
});

await test('GET /api/poker/rooms lists rooms', async () => {
  const { status, body } = await get('/api/poker/rooms');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.rooms), 'rooms must be array');
  assert(body.rooms.length > 0, 'should have at least the test room');
});

// ── 15. Escrow (contract offline check) ──────────────────────────────────────

console.log('\n── Escrow (offline guard) ──────────────────────────────────────');

await test('POST /api/escrow/action — returns 503 or proceeds when contract offline', async () => {
  const { status } = await post('/api/escrow/action', {
    action: 'create',
    orderId: 'test-order-1',
    amountNight: '1000000',
    sellerNightAddr: 'seller_addr_test',
  });
  // Either 503 (contract not connected) or 200 (contract live) are valid
  assert(status === 503 || status === 200, `unexpected status ${status}`);
});

await test('POST /api/escrow/action — body-action routing works', async () => {
  const { status } = await post('/api/escrow/action', { action: 'wallet-address' });
  // 503 if contract offline, 200 if live — both mean routing reached the handler
  assert(status === 503 || status === 200, `routing failed — got ${status}`);
});

// ── 16. 404 ──────────────────────────────────────────────────────────────────

console.log('\n── Edge cases ──────────────────────────────────────────────────');

await test('Unknown endpoint returns 404', async () => {
  const { status } = await get('/api/nonexistent-endpoint');
  assert(status === 404, `expected 404, got ${status}`);
});

await test('POST /api/listings/create — missing required fields returns 400', async () => {
  const { status } = await post('/api/listings/create', { title: 'No id or price' });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('POST /api/nightid/record-action — invalid appId rejected', async () => {
  const { status } = await post('/api/nightid/record-action', {
    holderAddress: testAddr,
    appId: 'not-a-real-app',
    points: 10,
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('POST /api/nightid/record-action — points out of range rejected', async () => {
  const { status } = await post('/api/nightid/record-action', {
    holderAddress: testAddr,
    appId: 'night-markets',
    points: 999,
  });
  assert(status === 400, `expected 400, got ${status}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
if (failures.length) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`    • ${f}`);
}
console.log(`${'─'.repeat(60)}\n`);
process.exit(failed > 0 ? 1 : 0);
