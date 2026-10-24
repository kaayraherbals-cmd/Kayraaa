// Submits every URL in the LIVE sitemap to IndexNow (Bing, Yandex, etc.).
// Run after a deploy is live:  npm run indexnow
// Optional: SITE_URL=https://example.com npm run indexnow   |   DRY_RUN=1 to only print.
// Not part of `npm run build`, so it can never break a deploy.
const KEY = '71b0d8ddbd3c4363b1eb63478fdfec89';
const site = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://kaayraherbals.com').trim().replace(/\/$/, '');
const host = new URL(site).hostname;

const sm = await fetch(`${site}/sitemap.xml`);
if (!sm.ok) { console.error(`[indexnow] sitemap fetch failed: ${sm.status}`); process.exit(1); }
const urlList = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => new URL(u).hostname === host);
if (!urlList.length) { console.error('[indexnow] no URLs found in sitemap'); process.exit(1); }

const keyLocation = `${site}/${KEY}.txt`;
const k = await fetch(keyLocation);
if (!k.ok || (await k.text()).trim() !== KEY) { console.error(`[indexnow] key file not served correctly at ${keyLocation}; deploy first.`); process.exit(1); }

console.log(`[indexnow] ${urlList.length} URLs for ${host}`);
if (process.env.DRY_RUN === '1') { console.log(urlList.join('\n')); process.exit(0); }

const res = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: KEY, keyLocation, urlList }),
});
console.log(`[indexnow] response ${res.status} ${res.statusText} (200/202 = accepted)`);
if (res.status !== 200 && res.status !== 202) process.exit(1);
