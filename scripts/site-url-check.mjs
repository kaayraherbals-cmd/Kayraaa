// Decides whether the public site address is acceptable for a build. In a production build (Vercel production
// deployments, or REQUIRE_SITE_URL=1) a missing or placeholder address must stop the build: canonical links, the sitemap,
// robots.txt, Open Graph tags and email links would otherwise point at a domain nobody owns. Preview builds only warn.
const PLACEHOLDER_HOST = /(^|\.)(example|test|invalid|localhost)$|^localhost$|^127\.|^0\.0\.0\.0$/i;

export function isProductionBuild(env) {
  return env.VERCEL_ENV === 'production' || env.REQUIRE_SITE_URL === '1';
}

/** Returns { ok, url, problem }. `url` has no trailing slash. */
export function checkSiteUrl(env) {
  const raw = (env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  const production = isProductionBuild(env);
  if (!raw) return { ok: !production, url: 'https://kaayraherbals.example', problem: 'VITE_SITE_URL is not set; the placeholder https://kaayraherbals.example is being used.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, url: raw, problem: `VITE_SITE_URL "${raw}" is not a valid URL.` };
  }
  if (production && u.protocol !== 'https:') return { ok: false, url: raw, problem: `VITE_SITE_URL must start with https:// in production (got "${raw}").` };
  if (production && PLACEHOLDER_HOST.test(u.hostname)) return { ok: false, url: raw, problem: `VITE_SITE_URL "${raw}" is a placeholder or local address, not the real production domain.` };
  if (u.pathname !== '/' && u.pathname !== '') return { ok: false, url: raw, problem: 'VITE_SITE_URL must be the bare site address with no path.' };
  return { ok: true, url: raw, problem: '' };
}
