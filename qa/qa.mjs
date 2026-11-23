// Live QA against a deployed environment.
// Usage: node qa/qa.mjs <baseUrl> <expectedTag> <expectedSha>
const [baseUrl, expectedTag, expectedSha] = process.argv.slice(2);
const get = async (path) => (await fetch(`${baseUrl}${path}`)).json();

const checks = [
  ['price', async () => {
    const { total } = await get('/api/price?qty=10');
    return [total === 90, `expected 90 for qty 10, got ${total}`];
  }],
  ['flag', async () => {
    const flags = await get('/api/flags');
    return [flags['bulk-discount'] === true, `expected bulk-discount on, got ${flags['bulk-discount']}`];
  }],
  ['release identity', async () => {
    const v = await get('/version');
    const ok = v.releaseTag === expectedTag && v.sha === expectedSha;
    return [ok, `expected ${expectedTag} @ ${expectedSha}, got ${v.releaseTag} @ ${v.sha}`];
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  const [ok, detail] = await check().catch((err) => [false, `request failed: ${err.cause?.code ?? err.message}`]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
