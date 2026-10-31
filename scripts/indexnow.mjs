// Tells IndexNow (Bing, Yandex and other participating engines) about public pages that are NEW or CHANGED since the last run.
//
//   npm run indexnow                      submit what changed
//   DRY_RUN=1 npm run indexnow            show the plan; send nothing, save nothing
//   INDEXNOW_BASELINE=1 npm run indexnow  record the current pages as already known; send nothing
//   INDEXNOW_FORCE=1 npm run indexnow     treat every page as changed (use sparingly)
//   SITE_URL=https://example.com ...      other site address (default https://kaayraherbals.com)
//   INDEXNOW_ENDPOINT=url                 test double for the IndexNow API (default https://api.indexnow.org/IndexNow)
//   INDEXNOW_STATE=path                   change-tracking file (default .indexnow/state.json)
//
// How it decides: it reads the LIVE sitemap, fetches each listed page, skips any page that is not a plain 200 with no noindex and its own
// canonical, fingerprints the readable content, and compares with the saved state. Unchanged pages are not sent again. A page is written
// to the state only after the service accepted it, so a failed submission is retried on the next run.
//
// Honest wording: "accepted" means IndexNow took the notification. It does not mean the page was crawled, indexed or will rank.
// Not part of `npm run build`, so it can never break a deploy.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunk, fetchWithTimeout, fingerprint, isPrivatePath, loadState, pageProblem, parseSitemap, planChanges, pool,
  privatePrefixes, saveState, sleepMs, submitBatch, backoffMs, MAX_ATTEMPTS,
} from './lib/indexnow-core.mjs';

const KEY = '71b0d8ddbd3c4363b1eb63478fdfec89';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const site = (env.SITE_URL || env.VITE_SITE_URL || 'https://kaayraherbals.com').trim().replace(/\/$/, '');
const host = new URL(site).hostname;
const statePath = resolve(env.INDEXNOW_STATE || join(root, '.indexnow/state.json'));
const dry = env.DRY_RUN === '1';
const baseline = env.INDEXNOW_BASELINE === '1';
const force = env.INDEXNOW_FORCE === '1';

const log = { submitted: [], skipped: [], failed: [] };
const say = (kind, url, why) => { log[kind].push({ url, why }); console.log(`[indexnow] ${kind.toUpperCase().padEnd(9)} ${url}${why ? `  (${why})` : ''}`); };

/** GET with a timeout and bounded retries on network errors, 429 and 5xx. Returns the response, or null after the last failed attempt. */
async function getWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryAfter;
    try {
      const res = await fetchWithTimeout(fetch, url, { headers: { 'User-Agent': 'KaayraIndexNowCheck/1.0' } });
      if (res.status !== 429 && res.status < 500) return res;
      retryAfter = res.headers.get('retry-after');
    } catch { /* timeout or network error: retry */ }
    if (attempt < MAX_ATTEMPTS) await sleepMs(backoffMs(attempt, retryAfter));
  }
  return null;
}

const sitemapRes = await getWithRetry(`${site}/sitemap.xml`);
if (!sitemapRes || !sitemapRes.ok) { console.error(`[indexnow] sitemap fetch failed: ${sitemapRes ? sitemapRes.status : 'no response'}`); process.exit(1); }
const privateRoutes = existsSync(join(root, 'shared/private-routes.json')) ? JSON.parse(readFileSync(join(root, 'shared/private-routes.json'), 'utf8')) : [];
const prefixes = privatePrefixes(privateRoutes);

const listed = parseSitemap(await sitemapRes.text());
const candidates = [];
for (const u of [...new Set(listed)]) {
  let parsed;
  try { parsed = new URL(u); } catch { say('skipped', u, 'not a valid URL'); continue; }
  if (parsed.hostname !== host) { say('skipped', u, `other host (${parsed.hostname})`); continue; }
  if (isPrivatePath(parsed.pathname, prefixes)) { say('skipped', u, 'private route'); continue; }
  candidates.push(u);
}
if (!candidates.length) { console.error('[indexnow] no public URLs found in the sitemap'); process.exit(1); }

const keyLocation = `${site}/${KEY}.txt`;
const keyRes = await getWithRetry(keyLocation);
if (!keyRes || !keyRes.ok || (await keyRes.text()).trim() !== KEY) { console.error(`[indexnow] key file not served correctly at ${keyLocation}; deploy first.`); process.exit(1); }

// Fetch every candidate page once (4 at a time) and keep only pages that are fit to submit.
const fingerprints = {};
await pool(candidates, 4, async (url) => {
  const res = await getWithRetry(url);
  if (!res) return say('skipped', url, 'could not be fetched, so it is not submitted');
  const html = res.status === 200 ? await res.text() : '';
  const problem = pageProblem({ url, status: res.status, headers: res.headers, html });
  if (problem) return say('skipped', url, problem);
  fingerprints[url] = fingerprint(html);
});

const state = loadState(statePath, host);
const plan = planChanges(fingerprints, state, { force });
for (const u of plan.unchanged) say('skipped', u, 'unchanged since last accepted submission');
for (const u of plan.removed) console.log(`[indexnow] REMOVED   ${u}  (no longer in the sitemap; dropped from the state, nothing sent)`);

if (baseline) {
  for (const [url, hash] of Object.entries(fingerprints)) state.urls[url] = { hash, baseline: true, recordedAt: new Date().toISOString() };
  for (const u of plan.removed) delete state.urls[u];
  if (!dry) saveState(statePath, state);
  console.log(`[indexnow] baseline ${dry ? 'would record' : 'recorded'} ${Object.keys(fingerprints).length} pages as already known. Nothing was sent.`);
  process.exit(0);
}

console.log(`[indexnow] ${host}: ${plan.changed.length} to submit, ${plan.unchanged.length} unchanged, ${log.skipped.length - plan.unchanged.length} skipped for other reasons`);
if (dry) { for (const c of plan.changed) console.log(`[indexnow] WOULD SUBMIT ${c.url}  (${c.reason})`); process.exit(0); }

let stop = false;
for (const batch of chunk(plan.changed)) {
  if (stop) { for (const c of batch) say('failed', c.url, 'not attempted: an earlier batch failed in a way that retrying cannot fix'); continue; }
  const r = await submitBatch({ fetchImpl: fetch, host, key: KEY, keyLocation, urls: batch.map((c) => c.url), ...(env.INDEXNOW_ENDPOINT ? { endpoint: env.INDEXNOW_ENDPOINT } : {}) });
  if (r.ok) {
    for (const c of batch) { state.urls[c.url] = { hash: c.hash, submittedAt: new Date().toISOString(), status: r.status }; say('submitted', c.url, `${c.reason}; ${r.note}`); }
    saveState(statePath, state); // saved after every accepted batch, so a later crash loses nothing
  } else {
    for (const c of batch) say('failed', c.url, `${r.note}; ${r.attempts} attempt(s)`);
    if (r.fatal || r.status === 429) stop = true;
  }
}
for (const u of plan.removed) delete state.urls[u];
saveState(statePath, state);

console.log(`[indexnow] summary: ${log.submitted.length} accepted by IndexNow, ${log.skipped.length} skipped, ${log.failed.length} failed. "Accepted" is not "indexed".`);
process.exit(log.failed.length ? 1 : 0);
