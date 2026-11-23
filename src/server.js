import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { priceFor, parseQty } from './pricing.js';
import { readFlags, writeFlags } from './flags.js';

const REPO_URL = 'https://github.com/devansh-helfie/release-flow-pilot';

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

function homePage(env, id) {
  const tag = id.releaseTag === 'unreleased'
    ? 'unreleased'
    : `<a href="${REPO_URL}/tree/${escapeHtml(id.releaseTag)}">${escapeHtml(id.releaseTag)}</a>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(env.toUpperCase())} release-flow-pilot</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; }
  .env { padding: 12px 24px; color: #fff; font-size: 20px; font-weight: bold; }
  .env-dev { background: #1f6feb; } .env-test { background: #d4a72c; } .env-prod { background: #1a7f37; }
  main { padding: 16px 24px; } th { text-align: left; padding-right: 16px; }
  pre { background: #f6f8fa; padding: 12px; }
</style></head>
<body>
<div class="env env-${escapeHtml(env)}">${escapeHtml(env.toUpperCase())}</div>
<main>
<table>
  <tr><th>Release</th><td>${tag}</td></tr>
  <tr><th>Package version</th><td>${escapeHtml(id.packageVersion)}</td></tr>
  <tr><th>Commit</th><td><a href="${REPO_URL}/commit/${escapeHtml(id.sha)}">${escapeHtml(id.sha.slice(0, 7))}</a> ${escapeHtml(id.commitSubject)}</td></tr>
  <tr><th>Built</th><td>${escapeHtml(id.buildTime)} <a href="${escapeHtml(id.runUrl)}">workflow run</a></td></tr>
</table>
<p><a href="/admin/flags">Feature flags</a></p>
<h2>Changelog</h2>
<pre>${escapeHtml(id.changelog)}</pre>
</main></body></html>`;
}

function flagsPage(flags) {
  const checked = flags['bulk-discount'] ? 'checked' : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Feature flags</title></head>
<body style="font-family: system-ui, sans-serif; padding: 16px 24px">
<h1>Feature flags</h1>
<form method="post">
  <input type="hidden" name="bulk-discount" value="off">
  <label><input type="checkbox" name="bulk-discount" value="on" ${checked}> bulk-discount (10% off for 10 or more)</label>
  <p><button type="submit">Save</button> <a href="/">Back</a></p>
</form>
</body></html>`;
}

export function createServer(cfg) {
  const qaDefect = cfg.env === 'test' && cfg.qaDemo === 'fail';
  const flags = () => readFlags(cfg.flagsFile, cfg.flagDefaults);
  const id = cfg.identity;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') return sendJson(res, 200, { status: 'ok' });

    if (url.pathname === '/version') {
      return sendJson(res, 200, {
        environment: cfg.env,
        packageVersion: id.packageVersion,
        releaseTag: id.releaseTag,
        sha: id.sha,
        commitSubject: id.commitSubject,
        buildTime: id.buildTime,
        runUrl: id.runUrl,
      });
    }

    if (url.pathname === '/api/flags') return sendJson(res, 200, flags());

    if (url.pathname === '/api/price') {
      try {
        const qty = parseQty(url.searchParams.get('qty'));
        return sendJson(res, 200, priceFor(qty, { bulkDiscount: flags()['bulk-discount'], qaDefect }));
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (url.pathname === '/admin/flags' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      // The checkbox sends "on" after the hidden "off", so the last value wins.
      writeFlags(cfg.flagsFile, { ...flags(), 'bulk-discount': form.getAll('bulk-discount').at(-1) === 'on' });
      res.writeHead(303, { location: '/admin/flags' });
      return res.end();
    }

    if (url.pathname === '/admin/flags') return sendHtml(res, flagsPage(flags()));

    if (url.pathname === '/') return sendHtml(res, homePage(cfg.env, id));

    sendJson(res, 404, { error: 'not found' });
  });
}

// Started directly (node src/server.js): read config from the environment.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const env = process.env;
  const server = createServer({
    env: env.APP_ENV ?? 'local',
    qaDemo: env.QA_DEMO ?? '',
    flagsFile: env.FLAGS_FILE ?? '/data/flags.json',
    flagDefaults: { 'bulk-discount': env.BULK_DISCOUNT_DEFAULT !== 'off' },
    identity: {
      packageVersion: pkg.version,
      releaseTag: env.RELEASE_TAG || 'unreleased',
      sha: env.GIT_SHA ?? 'unknown',
      commitSubject: env.COMMIT_SUBJECT ?? '',
      buildTime: env.BUILD_TIME ?? '',
      runUrl: env.RUN_URL ?? '',
      changelog: readFileSync(new URL('CHANGELOG.md', root), 'utf8'),
    },
  });
  server.listen(3000, () => console.log(`release-flow-pilot ${env.APP_ENV} listening on 3000`));
}
