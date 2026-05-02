import * as fs from 'node:fs';

const addr = process.argv[2];
if (!addr || !/^[0-9a-f]{64}$/.test(addr)) {
  console.error('Usage: npx tsx scripts/set-contract-address.ts <64-hex-address>');
  process.exit(1);
}

// 1. Update .env
const env = fs.readFileSync('.env', 'utf8');
const envWithout = env.replace(/^CONTRACT_ADDRESS=.*\n?/m, '');
fs.writeFileSync('.env', envWithout.trimEnd() + `\nCONTRACT_ADDRESS=${addr}\n`);

// 2. Patch full-flow.ts and transact.ts
for (const f of ['scripts/full-flow.ts', 'scripts/transact.ts']) {
  const src = fs.readFileSync(f, 'utf8');
  const patched = src.replace(
    /const CONTRACT_ADDRESS = '[0-9a-f]{64}'/,
    `const CONTRACT_ADDRESS = '${addr}'`,
  );
  fs.writeFileSync(f, patched);
}

// 3. Patch index.html (both occurrences)
const html = fs.readFileSync('index.html', 'utf8');
const patchedHtml = html.replace(
  /var NM_CONTRACT_ADDRESS = '[0-9a-f]{64}'/g,
  `var NM_CONTRACT_ADDRESS = '${addr}'`,
);
fs.writeFileSync('index.html', patchedHtml);

console.log(`✅  Contract address updated to ${addr}`);
console.log(`    .env, full-flow.ts, transact.ts, index.html`);
