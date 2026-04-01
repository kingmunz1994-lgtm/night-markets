// probe.ts — finds which package fails to import
const steps: [string, () => Promise<unknown>][] = [
  ['compact-runtime',                    () => import('@midnight-ntwrk/compact-runtime')],
  ['compact-js',                         () => import('@midnight-ntwrk/compact-js')],
  ['ledger-v7',                          () => import('@midnight-ntwrk/ledger-v7')],
  ['midnight-js-network-id',             () => import('@midnight-ntwrk/midnight-js-network-id')],
  ['midnight-js-types',                  () => import('@midnight-ntwrk/midnight-js-types')],
  ['midnight-js-contracts',              () => import('@midnight-ntwrk/midnight-js-contracts')],
  ['midnight-js-http-client-proof-provider', () => import('@midnight-ntwrk/midnight-js-http-client-proof-provider')],
  ['midnight-js-indexer-public-data-provider', () => import('@midnight-ntwrk/midnight-js-indexer-public-data-provider')],
  ['midnight-js-level-private-state-provider', () => import('@midnight-ntwrk/midnight-js-level-private-state-provider')],
  ['midnight-js-node-zk-config-provider',() => import('@midnight-ntwrk/midnight-js-node-zk-config-provider')],
  ['wallet-sdk-hd',                      () => import('@midnight-ntwrk/wallet-sdk-hd')],
  ['wallet-sdk-shielded',                () => import('@midnight-ntwrk/wallet-sdk-shielded')],
  ['wallet-sdk-unshielded-wallet',       () => import('@midnight-ntwrk/wallet-sdk-unshielded-wallet')],
  ['wallet-sdk-dust-wallet',             () => import('@midnight-ntwrk/wallet-sdk-dust-wallet')],
  ['wallet-sdk-facade',                  () => import('@midnight-ntwrk/wallet-sdk-facade')],
  ['wallet-sdk-address-format',          () => import('@midnight-ntwrk/wallet-sdk-address-format')],
];

for (const [name, load] of steps) {
  try {
    await load();
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    console.error(`  ✗ ${name}  <-- FAILED`);
    if (err instanceof Error) {
      console.error(`    ${err.message}`);
      console.error(`    ${err.stack?.split('\n').slice(0,4).join('\n    ')}`);
    } else {
      try { console.error('   ', JSON.stringify(err)); } catch { console.error('   ', String(err)); }
      console.error('    Raw:', err);
    }
    process.exit(1);
  }
}
console.log('\nAll imports OK — the crash is elsewhere.');
