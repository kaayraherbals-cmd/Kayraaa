import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BREAKGLASS_MAX_MINUTES, breakGlassActive, createLimiter, isLimited, limitDecision, sharedKeyHash } from './http.js';

const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
let calls: { url: string; body: any }[];
let reply: () => Response;

beforeEach(() => {
  calls = [];
  reply = () => new Response('false', { status: 200 });
  for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RATE_LIMIT_SHARED: 'on', ADMIN_SESSION_SECRET: 'x'.repeat(40), RATE_LIMIT_BREAKGLASS_UNTIL: '', VERCEL_ENV: '' })) {
    saved[k] = process.env[k];
    if (v === '') delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined });
    return reply();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('shared rate limiter', () => {
  it('asks the database, and sends only a hash of the key', async () => {
    const l = createLimiter(15 * 60_000, 5, 'login_test');
    expect(await l.shared('203.0.113.9')).toBe(false);
    expect(calls[0].url).toBe('https://db.test/rest/v1/rpc/rate_limit_hit');
    expect(calls[0].body).toMatchObject({ p_bucket: 'login_test', p_window_seconds: 900, p_max: 5 });
    expect(calls[0].body.p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls[0].body)).not.toContain('203.0.113.9');
  });
  it('blocks when the database says the caller is over the limit', async () => {
    reply = () => new Response('true', { status: 200 });
    expect(await isLimited(createLimiter(60_000, 1, 'b1'), 'k')).toBe(true);
  });
  it('is shared: a second instance (a new limiter, empty memory) still sees the same count', async () => {
    reply = () => new Response('true', { status: 200 });
    const instanceA = createLimiter(60_000, 1, 'b2');
    const instanceB = createLimiter(60_000, 1, 'b2');
    expect(instanceA('k')).toBe(false); // memory alone would allow this
    expect(await isLimited(instanceB, 'k')).toBe(true);
    expect(calls[0].body.p_key_hash).toBe(sharedKeyHash('b2', 'k', 'x'.repeat(40)));
  });
  it('spares the database when the in-memory layer already says no', async () => {
    const l = createLimiter(60_000, 1, 'b3');
    l('k');
    l('k');
    expect(await isLimited(l, 'k')).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it('fails open when the database is down, so an outage does not lock customers out', async () => {
    reply = () => new Response('{}', { status: 500 });
    expect(await isLimited(createLimiter(60_000, 1, 'b4'), 'k')).toBe(false);
    reply = () => {
      throw new Error('network');
    };
    expect(await isLimited(createLimiter(60_000, 1, 'b5'), 'k')).toBe(false);
  });
  it('uses different hashes for different buckets and keys', () => {
    expect(sharedKeyHash('a', 'k', 's')).not.toBe(sharedKeyHash('b', 'k', 's'));
    expect(sharedKeyHash('a', 'k', 's')).not.toBe(sharedKeyHash('a', 'j', 's'));
  });
  it('does nothing without a bucket name, when switched off, or without a database', async () => {
    expect(await createLimiter(60_000, 1).shared('k')).toBe(false);
    process.env.RATE_LIMIT_SHARED = 'off';
    expect(await createLimiter(60_000, 1, 'b6').shared('k')).toBe(false);
    process.env.RATE_LIMIT_SHARED = 'on';
    delete process.env.SUPABASE_URL;
    expect(await createLimiter(60_000, 1, 'b7').shared('k')).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('failure policy when the shared counter is unavailable', () => {
  const down = () => {
    reply = () => new Response('{}', { status: 500 });
  };
  it('an OPEN limiter lets the request through (public forms, payment verify)', async () => {
    down();
    expect(await limitDecision(createLimiter(60_000, 5, 'p1', 'open'), 'k')).toBe('allow');
  });
  it('a CLOSED limiter refuses (admin sign-in, place order, start payment)', async () => {
    down();
    expect(await limitDecision(createLimiter(60_000, 5, 'p2', 'closed'), 'k')).toBe('unavailable');
  });
  it('a CLOSED limiter also refuses when the database is not configured or answers nonsense', async () => {
    delete process.env.SUPABASE_URL;
    expect(await limitDecision(createLimiter(60_000, 5, 'p3', 'closed'), 'k')).toBe('unavailable');
    process.env.SUPABASE_URL = 'https://db.test';
    reply = () => new Response('"yes"', { status: 200 });
    expect(await limitDecision(createLimiter(60_000, 5, 'p3b', 'closed'), 'k')).toBe('unavailable');
  });
  it('a CLOSED limiter still says "limited" before it says "unavailable"', async () => {
    down();
    const l = createLimiter(60_000, 1, 'p4', 'closed');
    l('k');
    l('k');
    expect(await limitDecision(l, 'k')).toBe('limited');
  });
  it('a healthy shared counter decides as usual for a closed limiter', async () => {
    reply = () => new Response('false', { status: 200 });
    expect(await limitDecision(createLimiter(60_000, 5, 'p5', 'closed'), 'k')).toBe('allow');
    reply = () => new Response('true', { status: 200 });
    expect(await limitDecision(createLimiter(60_000, 5, 'p6', 'closed'), 'k')).toBe('limited');
  });
  it('RATE_LIMIT_SHARED=off is ignored by a closed limiter in production, and honoured elsewhere', async () => {
    process.env.RATE_LIMIT_SHARED = 'off';
    down();
    expect(await limitDecision(createLimiter(60_000, 5, 'p7', 'closed'), 'k')).toBe('allow');
    process.env.VERCEL_ENV = 'production';
    expect(await limitDecision(createLimiter(60_000, 5, 'p8', 'closed'), 'k')).toBe('unavailable');
  });
});

describe('break-glass recovery window', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
  it('is active only for a time in the next hour', () => {
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: at(30) }, now)).toBe(true);
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: at(BREAKGLASS_MAX_MINUTES) }, now)).toBe(true);
  });
  it('is refused when it has expired, is too far ahead, is empty or is not a date', () => {
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: at(-1) }, now)).toBe(false);
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: at(BREAKGLASS_MAX_MINUTES + 1) }, now)).toBe(false);
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: '2099-01-01T00:00:00Z' }, now)).toBe(false);
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: '' }, now)).toBe(false);
    expect(breakGlassActive({ RATE_LIMIT_BREAKGLASS_UNTIL: 'soon' }, now)).toBe(false);
    expect(breakGlassActive({}, now)).toBe(false);
  });
  it('lets a closed limiter run on its in-memory limit while active, and not otherwise', async () => {
    reply = () => new Response('{}', { status: 500 });
    process.env.RATE_LIMIT_BREAKGLASS_UNTIL = new Date(Date.now() + 20 * 60_000).toISOString();
    expect(await limitDecision(createLimiter(60_000, 5, 'bg1', 'closed'), 'k')).toBe('allow');
    process.env.RATE_LIMIT_BREAKGLASS_UNTIL = new Date(Date.now() - 60_000).toISOString();
    expect(await limitDecision(createLimiter(60_000, 5, 'bg2', 'closed'), 'k')).toBe('unavailable');
  });
  it('still enforces the in-memory limit during the window', async () => {
    reply = () => new Response('{}', { status: 500 });
    process.env.RATE_LIMIT_BREAKGLASS_UNTIL = new Date(Date.now() + 20 * 60_000).toISOString();
    const l = createLimiter(60_000, 1, 'bg3', 'closed');
    l('k');
    l('k');
    expect(await limitDecision(l, 'k')).toBe('limited');
  });
});
