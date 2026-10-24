import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { checkSiteUrl } from './site-url-check.mjs';

type Env = Record<string, string | undefined>;
const prod = (e: Env = {}): Env => ({ VERCEL_ENV: 'production', ...e });

describe('site URL check', () => {
  it('stops a production build with no VITE_SITE_URL', () => {
    const r = checkSiteUrl(prod());
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/not set/);
  });
  it('stops a production build that uses a placeholder, local or non-https address', () => {
    for (const u of ['https://kaayraherbals.example', 'http://kaayraherbals.in', 'https://localhost:3000', 'https://shop.test', 'not a url']) {
      expect(checkSiteUrl(prod({ VITE_SITE_URL: u })).ok, u).toBe(false);
    }
  });
  it('accepts a real https address in production, with or without a trailing slash', () => {
    expect(checkSiteUrl(prod({ VITE_SITE_URL: 'https://www.kaayraherbals.in/' }))).toMatchObject({ ok: true, url: 'https://www.kaayraherbals.in' });
  });
  it('only warns on preview builds and local builds', () => {
    expect(checkSiteUrl({}).ok).toBe(true);
    expect(checkSiteUrl({ VERCEL_ENV: 'preview' }).ok).toBe(true);
  });
  it('can be forced on with REQUIRE_SITE_URL=1', () => {
    expect(checkSiteUrl({ REQUIRE_SITE_URL: '1' }).ok).toBe(false);
  });
});
