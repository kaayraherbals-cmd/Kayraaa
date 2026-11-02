// Brand facts for build-time structured data, read from the website's own configuration (src/config/site.ts)
// so the config stays the single authoritative source. Nothing here is invented: every value below is already
// published on the site. The same pattern is used by scripts/build-site-knowledge.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const field = (src, key) => src.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];

/**
 * The profile URL used in structured data and AI-readable files: the configured Instagram account without any
 * tracking query string. VITE_INSTAGRAM_URL (if set in the environment) overrides the default, exactly as it does
 * for the site footer, so the structured data can never point at a different account from the visible link.
 */
export function cleanInstagramUrl(url) {
  const u = new URL(url);
  const name = u.pathname.split('/').filter(Boolean)[0];
  return `https://www.instagram.com/${name}/`;
}

export function readBrandFacts(siteTsPath, env = {}) {
  const src = readFileSync(siteTsPath, 'utf8');
  const username = src.match(/INSTAGRAM_USERNAME\s*=\s*'([^']+)'/)?.[1];
  const siteInstagram = src.match(/instagram:\s*clean\(env\.VITE_INSTAGRAM_URL\)\s*\|\|\s*'([^']+)'/)?.[1];
  const envInstagram = (env.VITE_INSTAGRAM_URL || '').trim();
  const instagramUrl = cleanInstagramUrl(envInstagram || siteInstagram || `https://www.instagram.com/${username}/`);
  const location = field(src, 'registeredLocation') ?? '';
  const [locality, region, country] = location.split(',').map((s) => s.trim());
  const facts = {
    name: src.match(/name:\s*'(Kaayra Herbals)'/)?.[1],
    legalName: field(src, 'displayName'),
    tagline: field(src, 'tagline'),
    incorporatedOn: field(src, 'incorporatedOn'),
    locality,
    region,
    country,
    instagramUsername: username,
    instagramUrl,
  };
  for (const [k, v] of Object.entries(facts)) if (!v) throw new Error(`[brand-facts] could not read "${k}" from ${siteTsPath}`);
  if (country !== 'India') throw new Error(`[brand-facts] unexpected country "${country}" in registeredLocation`);
  const gstin = field(src, 'gstin');
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new Error(`[brand-facts] gstin "${gstin}" is not a valid GSTIN shape`);
  return { ...facts, ...(gstin ? { gstin } : {}), countryCode: 'IN', logo: readLogo(siteTsPath) };
}

/**
 * The logo used for Organization.logo: the path is registered in src/content/brand.ts (SCHEMA_LOGO_PATH) and the size is read
 * from the real PNG file in /public, so the structured data can never describe a file that is missing or a different size.
 */
export function readLogo(siteTsPath) {
  const srcDir = join(dirname(siteTsPath), '..'); // src/
  const brandSrc = readFileSync(join(srcDir, 'content/brand.ts'), 'utf8');
  const path = brandSrc.match(/SCHEMA_LOGO_PATH\s*=\s*'([^']+)'/)?.[1];
  if (!path || !path.startsWith('/')) throw new Error('[brand-facts] SCHEMA_LOGO_PATH is not set in src/content/brand.ts');
  const buf = readFileSync(join(srcDir, '..', 'public', path));
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error(`[brand-facts] ${path} is not a PNG`);
  return { path, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
