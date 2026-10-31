import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/checkout/[action].js';

/** The scheduled email job (/api/checkout/outbox): secret-protected, counts only, runs with every commerce flag off. */
const CRON = 'cron-secret-long-enough-0123';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
let paths: string[];
let ip = 0;

beforeEach(() => {
  paths = [];
  for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CRON_SECRET: CRON, RESEND_API_KEY: '', VERCEL_ENV: 'production' })) {
    saved[k] = process.env[k];
    if (v === '') delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = (async (input: unknown) => {
    const path = new URL(String(input)).pathname.replace('/rest/v1/', '');
    paths.push(path);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === 'rpc/email_claim_due') return json([]);
    if (path === 'rpc/email_purge') return json(3);
    return json([]);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function call(auth?: string, method = 'GET') {
  ip++;
  const headers: Record<string, string> = { host: 'site.test', 'x-forwarded-for': `10.9.0.${ip}` };
  if (auth) headers.authorization = auth;
  const req = { method, headers, body: undefined, query: { action: 'outbox' }, cookies: {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}

describe('outbox cron', () => {
  it('is hidden from anyone without the secret, and never touches the database for them', async () => {
    expect((await call()).status).toBe(404);
    expect((await call('Bearer wrong-secret-wrong-secret')).status).toBe(404);
    expect(paths).toHaveLength(0);
  });
  it('rejects other methods', async () => {
    expect((await call(`Bearer ${CRON}`, 'DELETE')).status).toBe(405);
  });
  it('runs in production with commerce off and returns counts only', async () => {
    const r = await call(`Bearer ${CRON}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.drain).toEqual({ claimed: 0, sent: 0, deferred: 0, skipped: 0, retried: 0, dead: 0 });
    expect(r.body.purged).toBe(3);
    expect(paths).toContain('rpc/email_claim_due');
    expect(paths).toContain('rpc/email_purge');
  });
  it('is safe to run twice', async () => {
    const a = await call(`Bearer ${CRON}`);
    const b = await call(`Bearer ${CRON}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});
