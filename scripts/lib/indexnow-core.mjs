// IndexNow helpers (pure or dependency-injected, so scripts/indexnow.check.mjs can test them without a network).
//
// What IndexNow does and does not do: a 200 or 202 answer means the service ACCEPTED the notification. It does not mean the
// pages were crawled, indexed or will rank. This module never describes an accepted URL as indexed.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const ENDPOINT = 'https://api.indexnow.org/IndexNow';
export const BATCH_SIZE = 100; // the protocol allows 10,000; small batches keep one bad batch from blocking the rest
export const TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 60_000;

/** Paths that must never be submitted, whatever the sitemap says (defence in depth: the sitemap should not list them anyway). */
export const ALWAYS_PRIVATE = ['/admin', '/api', '/product-shell', '/404'];

export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export function privatePrefixes(privateRoutes = []) {
  return [...new Set([...ALWAYS_PRIVATE, ...privateRoutes.map((r) => (typeof r === 'string' ? r : r.path))])];
}

export function isPrivatePath(pathname, prefixes) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/&amp;/g, '&'));
}

/** fetch with a hard timeout. Throws on timeout (AbortError) or network failure. */
export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal, redirect: init.redirect ?? 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

/** Waiting time before attempt n+1: exponential with a little jitter, or the server's Retry-After when it gave one (capped). */
export function backoffMs(attempt, retryAfterHeader, rand = Math.random) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_WAIT_MS);
  return Math.min(1000 * 2 ** (attempt - 1) + Math.floor(rand() * 250), MAX_WAIT_MS);
}

/**
 * How an IndexNow response status is treated.
 *  accepted: the service took the notification (not a statement about indexing)
 *  retry:    try again later (rate limit or a server-side problem)
 *  fatal:    retrying cannot help and the remaining batches would fail the same way
 */
export function classifyStatus(status) {
  if (status === 200) return { kind: 'accepted', note: 'HTTP 200: accepted' };
  if (status === 202) return { kind: 'accepted', note: 'HTTP 202: accepted, key validation still pending on the service side' };
  if (status === 429) return { kind: 'retry', note: 'HTTP 429: rate limited' };
  if (status >= 500) return { kind: 'retry', note: `HTTP ${status}: service error` };
  if (status === 403) return { kind: 'fatal', note: 'HTTP 403: key not valid for this host' };
  if (status === 422) return { kind: 'fatal', note: 'HTTP 422: URLs do not belong to the host, or the key does not match' };
  if (status === 400) return { kind: 'bad', note: 'HTTP 400: bad request' };
  return { kind: 'bad', note: `HTTP ${status}: unexpected response` };
}

/** Submits one batch with bounded retries. Resolves to { ok, status, attempts, note, fatal }; never throws. */
export async function submitBatch({ fetchImpl, host, key, keyLocation, urls, sleep = sleepMs, rand = Math.random, endpoint = ENDPOINT }) {
  let last = { ok: false, status: 0, attempts: 0, note: 'not attempted', fatal: false };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryAfter;
    try {
      const res = await fetchWithTimeout(fetchImpl, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
      });
      retryAfter = res.headers?.get?.('retry-after');
      const c = classifyStatus(res.status);
      last = { ok: c.kind === 'accepted', status: res.status, attempts: attempt, note: c.note, fatal: c.kind === 'fatal' };
      if (c.kind !== 'retry') return last;
    } catch (e) {
      last = { ok: false, status: 0, attempts: attempt, note: e?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS} ms` : `network error: ${e?.message ?? e}`, fatal: false };
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt, retryAfter, rand));
  }
  return { ...last, note: `${last.note} (gave up after ${MAX_ATTEMPTS} attempts)` };
}

/** Text a reader of the page would notice changing: title, description, canonical, headings/body text, link targets and JSON-LD. Asset file names are excluded, so a rebuild alone changes nothing. */
export function fingerprint(html) {
  const pick = (re) => (html.match(re)?.[1] ?? '').trim();
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const hrefs = [...main.matchAll(/<a\s[^>]*href="([^"]+)"/gi)].map((m) => m[1]).join('|');
  const text = main.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('|');
  const parts = [pick(/<title>([^<]*)<\/title>/), pick(/<meta name="description" content="([^"]*)"/), pick(/<link rel="canonical" href="([^"]*)"/), text, hrefs, ld];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** Why a fetched live page must not be submitted, or '' when it is fine. */
export function pageProblem({ url, status, headers, html }) {
  if (status >= 300 && status < 400) return `redirects (HTTP ${status})`;
  if (status !== 200) return `HTTP ${status}`;
  if (/noindex/i.test(headers?.get?.('x-robots-tag') ?? '')) return 'X-Robots-Tag noindex';
  if (/<meta name="robots"[^>]*noindex/i.test(html)) return 'meta robots noindex';
  const canon = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (canon && canon !== url) return `canonical is ${canon}`;
  return '';
}

export function emptyState(host) {
  return { version: 1, host, updatedAt: null, urls: {} };
}

/** Reads the change-tracking file. A damaged file is set aside (never deleted) and treated as empty, with a warning. */
export function loadState(path, host, log = console.warn) {
  if (!existsSync(path)) return emptyState(host);
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    if (s?.version !== 1 || typeof s.urls !== 'object' || s.urls === null) throw new Error('unexpected shape');
    if (s.host !== host) { log(`[indexnow] state file is for ${s.host}, not ${host}: starting fresh`); return emptyState(host); }
    return s;
  } catch (e) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); } catch { /* keep going: a fresh state is still correct */ }
    log(`[indexnow] state file unreadable (${e.message}); moved to ${aside}. Every URL will count as new.`);
    return emptyState(host);
  }
}

/** Write to a temporary file, then rename: a crash can never leave a half-written state file. */
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Splits live URLs into changed / unchanged by comparing fingerprints with the saved state. */
export function planChanges(fingerprints, state, { force = false } = {}) {
  const changed = [];
  const unchanged = [];
  for (const [url, hash] of Object.entries(fingerprints)) {
    const prev = state.urls[url];
    if (force || !prev || prev.hash !== hash) changed.push({ url, hash, reason: force ? 'forced' : prev ? 'content changed' : 'new URL' });
    else unchanged.push(url);
  }
  return { changed, unchanged, removed: Object.keys(state.urls).filter((u) => !(u in fingerprints)) };
}

export function chunk(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Runs async work over a list with at most `limit` in flight. Results keep the input order. */
export async function pool(list, limit, worker) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await worker(list[i], i); }
  }));
  return out;
}
