#!/usr/bin/env node
// Smoke test for a deployed environment.
//   node scripts/smoke.mjs <siteOrApiBase> [idToken]
//
// Without a token it checks the public endpoints (health, scores, gallery).
// With a Cognito ID token it also exercises the guarded generate flow far
// enough to confirm auth + quota wiring (upload-url), without spending Bedrock
// unless you pass --full.
const [, , baseArg, token, ...rest] = process.argv;
if (!baseArg) {
  console.error('usage: node scripts/smoke.mjs <siteOrApiBase> [idToken] [--full]');
  process.exit(2);
}
const full = rest.includes('--full');
const base = baseArg.replace(/\/$/, '') + (baseArg.includes('/api') ? '' : '/api');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}
async function get(path, headers = {}) {
  const res = await fetch(base + path, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

await check('GET /health is ok', async () => {
  const r = await get('/health');
  if (r.status !== 'ok') throw new Error('unexpected health payload');
});
await check('GET /scores public', async () => {
  const r = await get('/scores');
  if (!Array.isArray(r.scores)) throw new Error('no scores array');
});
await check('GET /gallery public', async () => {
  const r = await get('/gallery');
  if (!Array.isArray(r.creations)) throw new Error('no creations array');
});
await check('protected route rejects anonymous (401)', async () => {
  const res = await fetch(base + '/generate', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 401 && res.status !== 403) throw new Error(`expected 401/403, got ${res.status}`);
});

if (token) {
  await check('POST /upload-url with token returns presigned url', async () => {
    const res = await fetch(base + '/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: 1024 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    if (!/^https:\/\//.test(r.url) || !r.key) throw new Error('missing url/key');
  });
  if (full) {
    console.log('… --full Bedrock generation flow is manual; run via the UI to avoid unintended spend.');
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
