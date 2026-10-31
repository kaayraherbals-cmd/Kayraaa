// Tests for the IndexNow helpers. Run: npm run indexnow:test  (= node --test scripts/indexnow.check.mjs). No network, no dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backoffMs, chunk, classifyStatus, fingerprint, isPrivatePath, loadState, pageProblem, parseSitemap, planChanges, pool, privatePrefixes,
  saveState, submitBatch,
} from './lib/indexnow-core.mjs';

const hdr = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const reply = (status, headers) => ({ status, headers: hdr(headers) });
const base = { host: 'kaayraherbals.com', key: 'k', keyLocation: 'https://kaayraherbals.com/k.txt', urls: ['https://kaayraherbals.com/'], sleep: async () => {}, rand: () => 0 };

test('sitemap parsing and private-route exclusion', () => {
  const urls = parseSitemap('<urlset><url><loc>https://kaayraherbals.com/</loc></url><url><loc>https://kaayraherbals.com/a?x=1&amp;y=2</loc></url></urlset>');
  assert.deepEqual(urls, ['https://kaayraherbals.com/', 'https://kaayraherbals.com/a?x=1&y=2']);
  const prefixes = privatePrefixes([{ path: '/wishlist' }, { path: '/bundles' }, { path: '/forgot-password' }, { path: '/set-password' }]);
  for (const p of ['/wishlist', '/bundles', '/forgot-password', '/set-password', '/admin', '/api/products', '/product-shell', '/track-order/abc']) assert.equal(isPrivatePath(p, privatePrefixes([...prefixes, '/track-order'])), true, p);
  for (const p of ['/', '/founders', '/journal/reading-an-ayurvedic-label', '/ingredients']) assert.equal(isPrivatePath(p, prefixes), false, p);
  assert.equal(isPrivatePath('/bundles-and-more', prefixes), false, 'prefix must match whole path segments');
});

test('status classification: only 200 and 202 count as accepted', () => {
  assert.equal(classifyStatus(200).kind, 'accepted');
  assert.equal(classifyStatus(202).kind, 'accepted');
  assert.equal(classifyStatus(429).kind, 'retry');
  assert.equal(classifyStatus(503).kind, 'retry');
  assert.equal(classifyStatus(403).kind, 'fatal');
  assert.equal(classifyStatus(422).kind, 'fatal');
  assert.equal(classifyStatus(400).kind, 'bad');
  assert.equal(classifyStatus(301).kind, 'bad');
  assert.equal(classifyStatus(204).kind, 'bad', 'an unlisted 2xx is not treated as success');
});

test('backoff grows, honours Retry-After and is capped', () => {
  assert.equal(backoffMs(1, null, () => 0), 1000);
  assert.equal(backoffMs(2, null, () => 0), 2000);
  assert.equal(backoffMs(1, '7'), 7000);
  assert.equal(backoffMs(1, '9999'), 60_000);
});

test('submitBatch: accepted on first try, no retry', async () => {
  let calls = 0;
  const r = await submitBatch({ ...base, fetchImpl: async () => { calls++; return reply(200); } });
  assert.deepEqual([r.ok, r.status, r.attempts, calls], [true, 200, 1, 1]);
});

test('submitBatch: retries 429 then succeeds, waiting as told', async () => {
  const waits = [];
  const seq = [reply(429, { 'retry-after': '3' }), reply(202)];
  const r = await submitBatch({ ...base, sleep: async (ms) => waits.push(ms), fetchImpl: async () => seq.shift() });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.deepEqual(waits, [3000]);
});

test('submitBatch: gives up after bounded attempts and never reports success', async () => {
  let calls = 0;
  const r = await submitBatch({ ...base, fetchImpl: async () => { calls++; return reply(500); } });
  assert.equal(r.ok, false);
  assert.equal(calls, 3);
  assert.match(r.note, /gave up after 3 attempts/);
});

test('submitBatch: network errors and timeouts are retried, then reported as failure', async () => {
  let calls = 0;
  const r = await submitBatch({ ...base, fetchImpl: async () => { calls++; const e = new Error('x'); e.name = 'AbortError'; throw e; } });
  assert.equal(r.ok, false);
  assert.equal(calls, 3);
  assert.match(r.note, /timed out/);
});

test('submitBatch: 403 and 422 are fatal and are not retried', async () => {
  for (const status of [403, 422]) {
    let calls = 0;
    const r = await submitBatch({ ...base, fetchImpl: async () => { calls++; return reply(status); } });
    assert.deepEqual([r.ok, r.fatal, calls], [false, true, 1], String(status));
  }
});

test('submitBatch: the request carries host, key, keyLocation and the URL list', async () => {
  let sent;
  await submitBatch({ ...base, fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return reply(200); } });
  assert.deepEqual(sent, { host: base.host, key: base.key, keyLocation: base.keyLocation, urlList: base.urls });
});

test('fingerprint ignores asset file names and markup, but sees real content changes', () => {
  const page = (css, body, title = 'T') => `<html><head><title>${title}</title><meta name="description" content="d"><link rel="canonical" href="https://kaayraherbals.com/x"><link rel="stylesheet" href="/assets/${css}.css"></head><body><main><h1>${body}</h1><a href="/y">y</a></main></body></html>`;
  assert.equal(fingerprint(page('a1', 'Hello')), fingerprint(page('b2', 'Hello')), 'a rebuild with new asset hashes is not a content change');
  assert.notEqual(fingerprint(page('a1', 'Hello')), fingerprint(page('a1', 'Hello there')));
  assert.notEqual(fingerprint(page('a1', 'Hello')), fingerprint(page('a1', 'Hello', 'New title')));
});

test('pageProblem rejects redirects, errors, noindex and non-canonical pages', () => {
  const url = 'https://kaayraherbals.com/founders';
  const ok = `<link rel="canonical" href="${url}">`;
  assert.equal(pageProblem({ url, status: 200, headers: hdr(), html: ok }), '');
  assert.match(pageProblem({ url, status: 301, headers: hdr(), html: '' }), /redirect/);
  assert.match(pageProblem({ url, status: 404, headers: hdr(), html: '' }), /404/);
  assert.match(pageProblem({ url, status: 200, headers: hdr({ 'x-robots-tag': 'noindex, nofollow' }), html: ok }), /X-Robots-Tag/);
  assert.match(pageProblem({ url, status: 200, headers: hdr(), html: '<meta name="robots" content="noindex">' + ok }), /meta robots/);
  assert.match(pageProblem({ url, status: 200, headers: hdr(), html: '<link rel="canonical" href="https://kaayraherbals.com/">' }), /canonical/);
});

test('planChanges: new and changed pages are submitted, unchanged are not, removed are reported', () => {
  const state = { version: 1, host: 'h', urls: { a: { hash: '1' }, b: { hash: '2' }, gone: { hash: '9' } } };
  const plan = planChanges({ a: '1', b: 'CHANGED', c: '3' }, state);
  assert.deepEqual(plan.changed.map((c) => [c.url, c.reason]), [['b', 'content changed'], ['c', 'new URL']]);
  assert.deepEqual(plan.unchanged, ['a']);
  assert.deepEqual(plan.removed, ['gone']);
  assert.equal(planChanges({ a: '1' }, state, { force: true }).changed.length, 1);
});

test('state: atomic save, round trip, damaged file set aside, other host starts fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-'));
  const path = join(dir, 'sub', 'state.json');
  const warnings = [];
  const fresh = loadState(path, 'kaayraherbals.com', (m) => warnings.push(m));
  assert.deepEqual(fresh.urls, {});
  fresh.urls['https://kaayraherbals.com/'] = { hash: 'abc' };
  saveState(path, fresh);
  assert.equal(readdirSync(join(dir, 'sub')).filter((f) => f.includes('.tmp-')).length, 0, 'no temporary file is left behind');
  assert.equal(loadState(path, 'kaayraherbals.com').urls['https://kaayraherbals.com/'].hash, 'abc');
  assert.deepEqual(loadState(path, 'other.example', (m) => warnings.push(m)).urls, {});
  writeFileSync(path, '{ not json');
  assert.deepEqual(loadState(path, 'kaayraherbals.com', (m) => warnings.push(m)).urls, {});
  assert.equal(existsSync(path), false, 'the damaged file was moved, not left in place');
  assert.equal(readdirSync(join(dir, 'sub')).some((f) => f.includes('.corrupt-')), true, 'and it was kept for inspection');
  assert.ok(warnings.length >= 2);
  assert.ok(readFileSync(join(dir, 'sub', readdirSync(join(dir, 'sub')).find((f) => f.includes('.corrupt-'))), 'utf8').includes('not json'));
});

test('chunk and pool are bounded', async () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  let live = 0, peak = 0;
  const out = await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(peak <= 3);
});
