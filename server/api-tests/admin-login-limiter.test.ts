import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/admin/[action].js';

/** Admin sign-in fails CLOSED when the shared rate-limit counter is unavailable (Phase 7 Step 2.5). */
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key',
  ADMIN_SESSION_SECRET: 's'.repeat(48), ADMIN_EMAILS: 'boss@kaayra.in', ADMIN_ROLES: 'boss@kaayra.in:owner', ADMIN_MFA_KEY: 'm'.repeat(48), ADMIN_MFA: 'required',
  RATE_LIMIT_SHARED: 'on',
};
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
let counterReply: () => Response;
let paths: string[];
let n = 0;

beforeEach(() => {
  paths = [];
  counterReply = () => new Response('false', { status: 200 });
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  saved.RATE_LIMIT_BREAKGLASS_UNTIL = process.env.RATE_LIMIT_BREAKGLASS_UNTIL;
  delete process.env.RATE_LIMIT_BREAKGLASS_UNTIL;
  globalThis.fetch = (async (input: unknown) => {
    const u = String(input);
    paths.push(u.replace('https://db.test', ''));
    if (u.includes('rpc/rate_limit_hit')) return counterReply();
    // Anything else is the password check: refuse it, as a wrong password would be.
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function login(email = 'boss@kaayra.in') {
  n++;
  const headers: Record<string, string> = { host: 'site.test', origin: 'https://site.test', 'x-kaayra-admin': '1', 'x-forwarded-for': `10.7.0.${n}` };
  const req = { method: 'POST', headers, body: { email, password: 'not-the-password' }, query: { action: 'login' }, cookies: {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(k: string, v: string) { out.headers[k] = v; }, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}
const passwordChecks = () => paths.filter((p) => p.startsWith('/auth/v1/token')).length;

describe('admin sign-in and the shared limiter', () => {
  it('works normally while the shared counter is healthy (wrong password is a normal refusal)', async () => {
    const r = await login();
    expect(r.status).not.toBe(503);
    expect(passwordChecks()).toBe(1);
  });
  it('refuses with 503 and Retry-After, and never checks a password, when the counter is down', async () => {
    counterReply = () => new Response('{}', { status: 500 });
    const r = await login();
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('unavailable');
    expect(r.headers['Retry-After']).toBe('60');
    expect(passwordChecks()).toBe(0);
  });
  it('says "too many attempts" (429) when the shared counter says the caller is over the limit', async () => {
    counterReply = () => new Response('true', { status: 200 });
    const r = await login();
    expect(r.status).toBe(429);
    expect(passwordChecks()).toBe(0);
  });
  it('lets sign-in through on in-memory limits during a valid break-glass window, and not after it', async () => {
    counterReply = () => new Response('{}', { status: 500 });
    process.env.RATE_LIMIT_BREAKGLASS_UNTIL = new Date(Date.now() + 15 * 60_000).toISOString();
    expect((await login()).status).not.toBe(503);
    process.env.RATE_LIMIT_BREAKGLASS_UNTIL = new Date(Date.now() + 5 * 3600_000).toISOString(); // too far ahead: refused
    expect((await login()).status).toBe(503);
  });
  it('ignores RATE_LIMIT_SHARED=off in production', async () => {
    counterReply = () => new Response('{}', { status: 500 });
    process.env.RATE_LIMIT_SHARED = 'off';
    process.env.VERCEL_ENV = 'production';
    try {
      expect((await login()).status).toBe(503);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});
