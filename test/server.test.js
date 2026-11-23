import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

const identity = {
  packageVersion: '0.2.0',
  releaseTag: 'v0.2.0-rc.1',
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  commitSubject: 'feat: add bulk tier PLT-1652',
  buildTime: '2026-11-23T14:02:00Z',
  runUrl: 'https://github.com/devansh-helfie/release-flow-pilot/actions/runs/42',
  changelog: '# Changelog\n\n## 0.2.0\n- add bulk tier',
};

async function start(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rfp-'));
  const cfg = {
    env: 'dev',
    qaDemo: '',
    flagsFile: join(dir, 'flags.json'),
    flagDefaults: { 'bulk-discount': true },
    identity,
    ...overrides,
  };
  if (cfg.flagsFileContent !== undefined) writeFileSync(cfg.flagsFile, cfg.flagsFileContent);
  const server = createServer(cfg);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function json(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

test('health is ok', async () => {
  const app = await start();
  assert.deepEqual((await json(`${app.base}/health`)).body, { status: 'ok' });
  await app.close();
});

test('version returns identity', async () => {
  const app = await start({ env: 'test' });
  const { body } = await json(`${app.base}/version`);
  assert.deepEqual(body, {
    environment: 'test',
    packageVersion: '0.2.0',
    releaseTag: 'v0.2.0-rc.1',
    sha: identity.sha,
    commitSubject: identity.commitSubject,
    buildTime: identity.buildTime,
    runUrl: identity.runUrl,
  });
  await app.close();
});

test('price uses bulk discount by default', async () => {
  const app = await start();
  assert.equal((await json(`${app.base}/api/price?qty=10`)).body.total, 90);
  await app.close();
});

test('qa defect applies only in test with QA_DEMO=fail', async () => {
  const testApp = await start({ env: 'test', qaDemo: 'fail' });
  assert.equal((await json(`${testApp.base}/api/price?qty=10`)).body.total, 99);
  await testApp.close();
  for (const env of ['dev', 'prod']) {
    const app = await start({ env, qaDemo: 'fail' });
    assert.equal((await json(`${app.base}/api/price?qty=10`)).body.total, 90, env);
    await app.close();
  }
});

test('bad qty returns 400 with error', async () => {
  const app = await start();
  const { status, body } = await json(`${app.base}/api/price?qty=abc`);
  assert.equal(status, 400);
  assert.match(body.error, /whole number/);
  await app.close();
});

test('flag panel turns bulk discount off', async () => {
  const app = await start();
  const res = await fetch(`${app.base}/admin/flags`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'bulk-discount=off',
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.deepEqual((await json(`${app.base}/api/flags`)).body, { 'bulk-discount': false });
  assert.equal((await json(`${app.base}/api/price?qty=10`)).body.total, 100);
  await app.close();
});

test('corrupt flags file falls back to defaults', async () => {
  const app = await start({ flagsFileContent: 'not json' });
  assert.deepEqual((await json(`${app.base}/api/flags`)).body, { 'bulk-discount': true });
  await app.close();
});

test('home page shows identity, links and env colour', async () => {
  const app = await start({ env: 'test' });
  const html = await (await fetch(`${app.base}/`)).text();
  for (const text of [
    'v0.2.0-rc.1',
    'feat: add bulk tier PLT-1652',
    '2026-11-23T14:02:00Z',
    identity.runUrl,
    'class="env env-test"',
    `https://github.com/devansh-helfie/release-flow-pilot/commit/${identity.sha}`,
    'https://github.com/devansh-helfie/release-flow-pilot/tree/v0.2.0-rc.1',
  ]) {
    assert.ok(html.includes(text), `missing: ${text}`);
  }
  await app.close();
});

test('home page has no tag link when unreleased', async () => {
  const app = await start({ identity: { ...identity, releaseTag: 'unreleased' } });
  const html = await (await fetch(`${app.base}/`)).text();
  assert.ok(html.includes('unreleased'));
  assert.ok(!html.includes('/tree/'));
  await app.close();
});

test('home page escapes html in changelog and subject', async () => {
  const app = await start({
    identity: { ...identity, commitSubject: '<script>x</script>', changelog: '<script>y</script>' },
  });
  const html = await (await fetch(`${app.base}/`)).text();
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  await app.close();
});
