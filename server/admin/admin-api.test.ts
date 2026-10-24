import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/admin/[action].js';
import { COOKIE_NAME, signSession } from '../session.js';
import { codeForStep, encryptSecret, generateSecret, stepAt } from '../totp.js';
import { handleBackoffice } from './backoffice.js';
import { makeJson, type AdminConfig, type AdminCtx } from './ctx.js';
import { parseAdminRoles } from '../../shared/roles.js';

const SECRET = 's'.repeat(48);
const MFA_KEY = 'm'.repeat(48);
const ADMINS = ['boss@kaayra.in', 'ops@kaayra.in', 'help@kaayra.in'];
const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  ADMIN_SESSION_SECRET: SECRET,
  ADMIN_EMAILS: ADMINS.join(','),
  ADMIN_ROLES: 'boss@kaayra.in:owner,ops@kaayra.in:manager,help@kaayra.in:support',
  ADMIN_MFA_KEY: MFA_KEY,
  ADMIN_MFA: 'required',
};
const V = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';

interface Call { method: string; url: string; body: unknown }
let calls: Call[];
let mfaRows: Record<string, unknown>;
let passkeyRows: { id: string; email: string; name: string }[]; // rows the mocked admin_passkeys table holds for the owner-removal tests
let passkeyHashes: string[]; // fingerprints of the passkeys the mocked admin_passkeys table holds for boss
let orderRow: { status: string; channel?: string }; // what the mocked orders read returns
let rpcReply: (fn: string, args: Record<string, unknown>) => { status: number; body: unknown };
const realFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  calls = [];
  mfaRows = {};
  passkeyHashes = [];
  passkeyRows = [];
  rpcReply = () => ({ status: 200, body: null });
  orderRow = { status: 'placed' };
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    if (rpc) {
      const r = rpcReply(rpc[1], body);
      return json(r.status, r.body);
    }
    const byId = /\/rest\/v1\/admin_passkeys\?(?:.*&)?id=eq\.([^&]+)/.exec(url);
    if (byId) {
      const hit = passkeyRows.filter((r) => r.id === decodeURIComponent(byId[1]));
      if (method === 'DELETE') {
        passkeyRows = passkeyRows.filter((r) => r.id !== decodeURIComponent(byId[1]));
        return json(200, hit);
      }
      return json(200, hit);
    }
    const pk = /\/rest\/v1\/admin_passkeys\?.*id_hash=eq\.([^&]+)/.exec(url);
    if (pk && method === 'GET') return json(200, passkeyHashes.includes(decodeURIComponent(pk[1])) ? [{ id: 'row' }] : []);
    const pkMail = /\/rest\/v1\/admin_passkeys\?.*email=eq\.([^&]+)/.exec(url);
    if (pkMail && method === 'GET') return json(200, passkeyRows.filter((r) => r.email === decodeURIComponent(pkMail[1])).map((r) => ({ ...r, credential_id: 'c', id_hash: 'h', public_key: 'k', alg: -7, sign_count: 0, transports: [], backed_up: false, created_at: '2026-10-20T10:00:00Z', last_used_at: null })));
    if (url.includes('/rest/v1/admin_passkeys') && method === 'GET') return json(200, passkeyRows.map((r) => ({ email: r.email })));
    const mfa = /\/rest\/v1\/admin_mfa\?.*email=eq\.([^&]+)/.exec(url);
    if (mfa && method === 'GET') {
      const row = mfaRows[decodeURIComponent(mfa[1])];
      return json(200, row ? [row] : []);
    }
    if (mfa && method === 'PATCH') return json(200, [{}]);
    if (mfa && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.includes('/rest/v1/order_events') && method === 'POST') return new Response(null, { status: 201 });
    if (url.includes('/rest/v1/admin_mfa') && method === 'POST') return new Response(null, { status: 201 });
    if (url.includes('/rest/v1/admin_audit') && method === 'GET') return json(200, [{ id: 2, actor: 'boss@kaayra.in', action: 'login', detail: {}, at: '2026-10-17T10:00:00Z' }], { 'content-range': '0-0/1' });
    if (url.includes('/rest/v1/admin_audit')) return new Response(null, { status: 201 });
    if (url.includes('/rest/v1/launch_subscribers')) return json(200, [], { 'content-range': '*/0' });
    if (url.includes('/rest/v1/orders?select=status')) return json(200, [orderRow]);
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

interface Reply { status: number; body: any; headers: Record<string, unknown> }
async function call(action: string, opts: { method?: string; email?: string; mfa?: number; pk?: string; query?: Record<string, string>; body?: unknown; noCookie?: boolean } = {}): Promise<Reply> {
  const reply: Reply = { status: 0, body: undefined, headers: {} };
  const res = {
    status(c: number) { reply.status = c; return res; },
    json(b: unknown) { reply.body = b; return res; },
    send(b: unknown) { reply.body = b; return res; },
    end() { return res; },
    setHeader(k: string, v: unknown) { reply.headers[k.toLowerCase()] = v; return res; },
  };
  const method = opts.method ?? 'GET';
  const req = {
    method,
    query: { action, ...(opts.query ?? {}) },
    body: opts.body,
    cookies: opts.noCookie ? {} : { [COOKIE_NAME]: signSession(opts.email ?? 'boss@kaayra.in', SECRET, Date.now(), 3600, opts.mfa ?? 0, opts.pk ?? '') },
    headers: { origin: 'https://kaayra.test', host: 'kaayra.test', 'x-kaayra-admin': '1' },
    socket: { remoteAddress: '1.1.1.1' },
  };
  await handler(req as never, res as never);
  return reply;
}

/** An enrolled authenticator for an email, plus the session epoch that proves it was verified. */
function enrol(email: string) {
  const secret = generateSecret();
  const enabled = new Date(Date.now() - 3600_000).toISOString();
  mfaRows[email] = { email, secret_enc: encryptSecret(secret, MFA_KEY), enabled_at: enabled, last_step: 0, recovery_hashes: [] };
  return { secret, epoch: Math.floor(Date.parse(enabled) / 1000) };
}

describe('passkey sessions', () => {
  it('lets a session signed in with a passkey through without a two-step code, while that passkey exists', async () => {
    passkeyHashes = ['hash-of-key-1'];
    const s = await call('session', { pk: 'hash-of-key-1' });
    expect(s.status).toBe(200);
    expect(s.body.mfa).toBe('ok');
    expect(s.body.viaPasskey).toBe(true);
    expect(s.body.permissions.length).toBeGreaterThan(0);
    expect((await call('subscribers', { pk: 'hash-of-key-1' })).status).toBe(200);
  });
  it('ends the passkey session the moment its passkey is removed', async () => {
    passkeyHashes = [];
    const s = await call('session', { pk: 'hash-of-key-1' });
    expect(s.status).toBe(401);
    expect(String(s.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await call('subscribers', { pk: 'hash-of-key-1' })).status).toBe(401);
  });
  it('ends a removed passkey\'s session even when two-step is optional and the admin has not enrolled (KH-V5-001)', async () => {
    process.env.ADMIN_MFA = 'optional';
    passkeyHashes = [];
    const s = await call('session', { pk: 'hash-of-key-1' });
    expect(s.status).toBe(401);
    expect(s.body.permissions).toBeUndefined();
    expect((await call('subscribers', { pk: 'hash-of-key-1' })).status).toBe(401);
    expect((await call('passkeys', { pk: 'hash-of-key-1' })).status).toBe(401);
  });
  it('ends a removed passkey\'s session when two-step is off, and fails closed when the passkey check itself errors (KH-V5-001)', async () => {
    process.env.ADMIN_MFA = 'off';
    passkeyHashes = [];
    expect((await call('subscribers', { pk: 'hash-of-key-1' })).status).toBe(401);
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => (String(input).includes('/rest/v1/admin_passkeys') ? new Response('boom', { status: 500 }) : real(input as never, init as never))) as typeof fetch;
    const r = await call('subscribers', { pk: 'hash-of-key-1' });
    expect(r.status).toBe(503);
  });
  it('does not accept a passkey fingerprint that belongs to another passkey', async () => {
    passkeyHashes = ['hash-of-key-1'];
    expect((await call('session', { pk: 'hash-of-key-2' })).status).toBe(401);
  });
  it('keeps passkey management behind the signed-in gate', async () => {
    expect((await call('passkeys')).status).toBe(401);
    expect((await call('passkey-register-begin', { method: 'POST', body: {} })).status).toBe(401);
    expect((await call('passkeys', { noCookie: true })).status).toBe(401);
  });
  it('lists passkeys for a passkey session', async () => {
    passkeyHashes = ['hash-of-key-1'];
    const r = await call('passkeys', { pk: 'hash-of-key-1' });
    expect(r.status).toBe(200);
  });
});

describe('configuration', () => {
  it('fails closed and names what is missing, never values', async () => {
    delete process.env.ADMIN_MFA_KEY;
    const r = await call('session');
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('unconfigured');
    expect(r.body.missing.join(' ')).toContain('ADMIN_MFA_KEY');
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
  });
  it('refuses an invalid ADMIN_ROLES instead of guessing', async () => {
    process.env.ADMIN_ROLES = 'boss@kaayra.in:owner,ops@kaayra.in:wizard';
    const r = await call('session');
    expect(r.status).toBe(503);
    expect(r.body.missing.join(' ')).toContain('ADMIN_ROLES');
  });
  it('refuses the whole admin when ADMIN_ROLES is missing or blank (no default owner)', async () => {
    for (const v of [undefined, '', '   ']) {
      if (v === undefined) delete process.env.ADMIN_ROLES;
      else process.env.ADMIN_ROLES = v;
      const r = await call('session');
      expect(r.status).toBe(503);
      expect(r.body.missing.join(' ')).toContain('ADMIN_ROLES');
    }
  });
  it('needs a signed-in admin', async () => {
    expect((await call('session', { noCookie: true })).status).toBe(401);
    expect((await call('session', { email: 'stranger@x.co' })).status).toBe(401);
  });
});

describe('two-step verification gate', () => {
  it('sends an admin with no authenticator to setup, and blocks every other action', async () => {
    const s = await call('session');
    expect(s.body).toMatchObject({ status: 'ok', mfa: 'enroll', role: 'owner', permissions: [] });
    const r = await call('subscribers');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ status: 'mfa_required', mfa: 'enroll', errorCode: 'KH-ADMIN-008' });
  });
  it('asks an enrolled admin for a code when this session has not verified, and blocks actions', async () => {
    enrol('boss@kaayra.in');
    expect((await call('session')).body.mfa).toBe('verify');
    expect((await call('subscribers')).body).toMatchObject({ status: 'mfa_required', mfa: 'verify' });
  });
  it('lets a verified session in with its permissions', async () => {
    const { epoch } = enrol('boss@kaayra.in');
    const s = await call('session', { mfa: epoch });
    expect(s.body.mfa).toBe('ok');
    expect(s.body.permissions).toContain('audit.read');
    expect((await call('subscribers', { mfa: epoch })).status).toBe(200);
  });
  it('does not trust a session verified against an older enrolment (after a reset and re-enrol)', async () => {
    const { epoch } = enrol('boss@kaayra.in');
    expect((await call('subscribers', { mfa: epoch - 1000 })).status).toBe(401);
  });
  it('accepts a correct code once, sets the session cookie, and refuses a replay', async () => {
    const { secret } = enrol('boss@kaayra.in');
    const good = codeForStep(secret, stepAt(Date.now()));
    const r = await call('mfa-verify', { method: 'POST', body: { code: good } });
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toContain('HttpOnly');
    const bad = await call('mfa-verify', { method: 'POST', body: { code: '000000' } });
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ status: 'mfa_denied', errorCode: 'KH-ADMIN-011' });
    expect(calls.some((c) => c.url.includes('admin_audit') && c.method === 'POST' && (c.body as { action: string }).action === 'mfa_failed')).toBe(true);
  });
  it('begins setup, never returns anything but the secret and link, and refuses to overwrite an existing authenticator', async () => {
    const r = await call('mfa-begin', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.body.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(r.body.secret).toMatch(/^[A-Z2-7 ]+$/);
    const stored = calls.find((c) => c.url.includes('admin_mfa') && c.method === 'POST')!.body as { secret_enc: string };
    expect(stored.secret_enc.startsWith('v1.')).toBe(true);
    enrol('boss@kaayra.in');
    expect((await call('mfa-begin', { method: 'POST' })).status).toBe(409);
  });
  it('rate-limits code guessing', async () => {
    enrol('boss@kaayra.in');
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('mfa-verify', { method: 'POST', body: { code: '111111' } })).status;
    expect(last).toBe(429);
  });
  it('can be optional, in which case an admin without an authenticator is let through', async () => {
    process.env.ADMIN_MFA = 'optional';
    const s = await call('session');
    expect(s.body.mfa).toBe('ok');
    expect((await call('subscribers')).status).toBe(200);
  });
  it('fails closed when two-step is required but its table cannot be read', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => (String(input).includes('admin_mfa') ? new Response('{}', { status: 404 }) : original(input as string, init as RequestInit))) as typeof fetch;
    const r = await call('subscribers');
    expect(r.status).toBe(503);
    expect(r.body.errorCode).toBe('KH-ADMIN-012');
  });
});

describe('roles', () => {
  const verified = (email: string) => ({ email, mfa: enrol(email).epoch });

  it('keeps destructive actions with the owner', async () => {
    const del = { method: 'DELETE', query: { id: V } };
    expect((await call('subscribers', { ...del, ...verified('help@kaayra.in') })).status).toBe(403);
    expect((await call('subscribers', { ...del, ...verified('ops@kaayra.in') })).status).toBe(403);
    expect((await call('subscribers', { ...del, ...verified('boss@kaayra.in') })).status).toBe(200);
  });
  it('answers forbidden with the role error code and records the attempt', async () => {
    const r = await call('audit', verified('ops@kaayra.in'));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ status: 'forbidden', errorCode: 'KH-ADMIN-007' });
    const logged = calls.filter((c) => c.url.includes('admin_audit') && c.method === 'POST').map((c) => c.body as { action: string; actor: string; detail: { role: string } });
    expect(logged.some((l) => l.action === 'permission_denied' && l.actor === 'ops@kaayra.in' && l.detail.role === 'manager')).toBe(true);
  });
  it('lets only the owner read the audit log and the team page, and export', async () => {
    for (const a of ['audit', 'team', 'export', 'orders-export']) {
      expect((await call(a, verified('ops@kaayra.in'))).status).toBe(403);
      expect((await call(a, verified('help@kaayra.in'))).status).toBe(403);
    }
    expect((await call('audit', verified('boss@kaayra.in'))).body.items).toHaveLength(1);
    expect((await call('team', verified('boss@kaayra.in'))).body.items).toHaveLength(3);
  });
  it('lets a manager receive stock but not support, and not change prices', async () => {
    const body = { variant_id: V, batch_no: 'kh-1', expiry_date: '2099-01-01', qty: 5 };
    rpcReply = () => ({ status: 200, body: V });
    expect((await call('batches', { method: 'POST', body, ...verified('help@kaayra.in') })).status).toBe(403);
    expect((await call('batches', { method: 'POST', body, ...verified('ops@kaayra.in') })).status).toBe(201);
    const priced = await call('variants', { method: 'PATCH', query: { id: V }, body: { price_paise: 29900 }, ...verified('ops@kaayra.in') });
    expect(priced.status).toBe(403);
    expect(calls.some((c) => c.url.includes('product_variants?id=eq') && c.method === 'PATCH')).toBe(false);
  });
  it('stops managers publishing a product or changing its price through the product record', async () => {
    const status = await call('products', { method: 'PATCH', query: { id: V }, body: { status: 'APPROVED_FOR_PREVIEW' }, ...verified('ops@kaayra.in') });
    expect(status.status).toBe(403);
    const price = await call('products', { method: 'PATCH', query: { id: V }, body: { price_paise: 100 }, ...verified('boss@kaayra.in') });
    expect(price.status).toBe(400);
    const photo = await call('products', { method: 'PATCH', query: { id: V }, body: { public_image: null }, ...verified('boss@kaayra.in') });
    expect(photo.status).toBe(400);
  });
  it('lets support add an order note but not change an order', async () => {
    const o = '3e9f5e31-8fac-4ecd-9041-6c5d2f4a0b43';
    expect((await call('order-note', { method: 'POST', body: { order_id: o, note: 'Called the customer' }, ...verified('help@kaayra.in') })).status).toBe(201);
    expect((await call('order-status', { method: 'POST', body: { order_id: o, status: 'paid' }, ...verified('help@kaayra.in') })).status).toBe(403);
  });
  it('never lets anyone mark an online order paid by hand, and records the attempt (KH6-013)', async () => {
    const o = '3e9f5e31-8fac-4ecd-9041-6c5d2f4a0b43';
    orderRow = { status: 'placed', channel: 'online' };
    for (const who of ['boss@kaayra.in', 'ops@kaayra.in']) {
      calls = [];
      const r = await call('order-status', { method: 'POST', body: { order_id: o, status: 'paid' }, ...verified(who) });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Razorpay confirms the payment/);
      expect(calls.some((c) => c.url.includes('/rpc/order_set_status'))).toBe(false);
      expect(calls.some((c) => c.url.includes('/rest/v1/admin_audit') && c.method === 'POST' && (c.body as { action?: string } | undefined)?.action === 'order_paid_by_hand_refused')).toBe(true);
    }
  });
  it('still lets a manager mark a manual order paid, and an online order move on after payment (KH6-013)', async () => {
    const o = '3e9f5e31-8fac-4ecd-9041-6c5d2f4a0b43';
    orderRow = { status: 'placed', channel: 'manual' };
    const manual = await call('order-status', { method: 'POST', body: { order_id: o, status: 'paid' }, ...verified('ops@kaayra.in') });
    expect(manual.status).toBe(200);
    orderRow = { status: 'paid', channel: 'online' };
    const packed = await call('order-status', { method: 'POST', body: { order_id: o, status: 'packed' }, ...verified('ops@kaayra.in') });
    expect(packed.status).toBe(200);
  });
  it('turns the database refusal into a clear conflict, not a generic error (KH6-013)', async () => {
    const o = '3e9f5e31-8fac-4ecd-9041-6c5d2f4a0b43';
    orderRow = { status: 'placed' }; // channel not reported: the database guard is the backstop
    rpcReply = () => ({ status: 400, body: { message: 'KH:PAYMENT_REQUIRED' } });
    const r = await call('order-status', { method: 'POST', body: { order_id: o, status: 'paid' }, ...verified('ops@kaayra.in') });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Razorpay confirms the payment/);
  });
  it('lets an owner reset someone else’s two-step, never their own, and never a stranger’s', async () => {
    const owner = verified('boss@kaayra.in');
    const ok = await call('team-mfa-reset', { method: 'POST', body: { email: 'help@kaayra.in' }, ...owner });
    expect(ok.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('admin_mfa?email=eq.help%40kaayra.in'))).toBe(true);
    expect((await call('team-mfa-reset', { method: 'POST', body: { email: 'boss@kaayra.in' }, ...owner })).status).toBe(409);
    expect((await call('team-mfa-reset', { method: 'POST', body: { email: 'x@y.co' }, ...owner })).status).toBe(404);
    expect((await call('team-mfa-reset', { method: 'POST', body: { email: 'help@kaayra.in' }, ...verified('ops@kaayra.in') })).status).toBe(403);
  });
});

describe('owner removes another admin’s passkey', () => {
  const PK = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
  const PK_OWN = '1c7d3c1f-6d8a-4cab-9e2f-4a3bad2e8f21';
  const verified = (email: string) => ({ email, mfa: enrol(email).epoch });
  const seed = () => {
    passkeyRows = [
      { id: PK, email: 'help@kaayra.in', name: 'Old phone' },
      { id: PK_OWN, email: 'boss@kaayra.in', name: 'My laptop' },
    ];
  };

  it('shows passkey counts in the Team list and lists a teammate’s passkeys without key material', async () => {
    seed();
    const owner = verified('boss@kaayra.in');
    const team = await call('team', owner);
    expect(team.status).toBe(200);
    const items = (team.body as { items: { email: string; passkeyCount: number }[] }).items;
    expect(items.find((i) => i.email === 'help@kaayra.in')?.passkeyCount).toBe(1);
    const list = await call('team-passkeys', { query: { email: 'help@kaayra.in' }, ...owner });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body).includes('public_key')).toBe(false);
    expect((await call('team-passkeys', { query: { email: 'x@y.co' }, ...owner })).status).toBe(404);
  });

  it('lets an owner remove a teammate’s passkey and records it in the audit log', async () => {
    seed();
    const r = await call('team-passkey', { method: 'DELETE', query: { id: PK }, ...verified('boss@kaayra.in') });
    expect(r.status).toBe(200);
    expect(passkeyRows.some((p) => p.id === PK)).toBe(false);
    const audit = calls.find((c) => c.method === 'POST' && c.url.includes('admin_audit'));
    expect(JSON.stringify(audit?.body)).toContain('passkey_removed_by_owner');
    expect(JSON.stringify(audit?.body)).toContain('help@kaayra.in');
  });

  it('refuses the owner’s own passkey, an unknown id, a bad id, and anyone who is not an owner', async () => {
    seed();
    const owner = verified('boss@kaayra.in');
    expect((await call('team-passkey', { method: 'DELETE', query: { id: PK_OWN }, ...owner })).status).toBe(409);
    expect(passkeyRows.some((p) => p.id === PK_OWN)).toBe(true);
    expect((await call('team-passkey', { method: 'DELETE', query: { id: '2d8e4d2a-7e9b-4dbc-8f30-5b4cbe3f9a32' }, ...owner })).status).toBe(404);
    expect((await call('team-passkey', { method: 'DELETE', query: { id: 'nope' }, ...owner })).status).toBe(400);
    expect((await call('team-passkey', { method: 'DELETE', query: { id: PK }, ...verified('ops@kaayra.in') })).status).toBe(403);
    expect((await call('team-passkeys', { query: { email: 'help@kaayra.in' }, ...verified('ops@kaayra.in') })).status).toBe(403);
    expect(passkeyRows.some((p) => p.id === PK)).toBe(true);
  });
});

describe('request protection', () => {
  it('rejects state changes without the same-origin header', async () => {
    const { epoch } = enrol('boss@kaayra.in');
    const reply: { status: number } = { status: 0 };
    const res = { status(c: number) { reply.status = c; return res; }, json() { return res; }, setHeader() { return res; } };
    await handler({ method: 'DELETE', query: { action: 'subscribers', id: V }, cookies: { [COOKIE_NAME]: signSession('boss@kaayra.in', SECRET, Date.now(), 3600, epoch) }, headers: { origin: 'https://evil.test', host: 'kaayra.test' }, socket: {} } as never, res as never);
    expect(reply.status).toBe(403);
  });
});

describe('orders and stock', () => {
  const verified = (email: string) => ({ email, mfa: enrol(email).epoch });
  const order = { customer_name: 'Asha', ship_address: '12 Lanka Road, Varanasi', ship_pincode: '221005', items: [{ variant_id: V, qty: 1 }] };

  it('refuses to create an order when the commerce switch is off (switch passed in directly)', async () => {
    const cfg: AdminConfig = { db: { url: 'https://db.test', serviceKey: 'k' }, anonKey: 'a', secret: SECRET, admins: ADMINS, roles: parseAdminRoles(ENV.ADMIN_ROLES, ADMINS).roles, mfaMode: 'required', mfaKey: MFA_KEY };
    const reply: Reply = { status: 0, body: undefined, headers: {} };
    const res = { status(c: number) { reply.status = c; return res; }, json(b: unknown) { reply.body = b; return res; }, send(b: unknown) { reply.body = b; return res; }, setHeader() { return res; } };
    const req = { method: 'POST', query: { action: 'orders' }, body: order, headers: {} };
    rpcReply = () => ({ status: 200, body: '9f5e31aa-8fac-4ecd-9041-6c5d2f4a0b43' });
    const ctx: AdminCtx = { req: req as never, res: res as never, cfg, email: 'ops@kaayra.in', role: 'manager', commerceEnabled: false, json: makeJson(res as never), audit: async () => undefined };
    expect(await handleBackoffice(ctx, 'orders')).toBe(true);
    expect(reply.status).toBe(409);
    expect(calls.some((c) => c.url.includes('rpc/order_create'))).toBe(false);
  });
  it('creates an order through the API now that COMMERCE_ENABLED is true (owner decision)', async () => {
    rpcReply = () => ({ status: 200, body: '9f5e31aa-8fac-4ecd-9041-6c5d2f4a0b43' });
    const r = await call('orders', { method: 'POST', body: order, ...verified('boss@kaayra.in') });
    expect(r.status).toBe(201);
    expect(calls.some((c) => c.url.includes('rpc/order_create'))).toBe(true);
  });
  it('maps database refusals to plain conflicts (not enough stock) without leaking internals', async () => {
    rpcReply = () => ({ status: 400, body: { code: 'P0001', message: 'KH:NEGATIVE_STOCK' } });
    const r = await call('batch-adjust', { method: 'POST', body: { batch_id: V, kind: 'write_off', delta: -5, reason: 'Damaged in transit' }, ...verified('ops@kaayra.in') });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-ADMIN-009');
    rpcReply = () => ({ status: 500, body: { message: 'relation "secret_internal" does not exist' } });
    const u = await call('batch-adjust', { method: 'POST', body: { batch_id: V, kind: 'write_off', delta: -5, reason: 'Damaged in transit' }, ...verified('ops@kaayra.in') });
    expect(u.status).toBe(502);
    expect(JSON.stringify(u.body)).not.toContain('secret_internal');
  });
  it('rejects an expired batch before it reaches the database', async () => {
    const r = await call('batches', { method: 'POST', body: { variant_id: V, batch_no: 'OLD-1', expiry_date: '2020-01-01', qty: 5 }, ...verified('ops@kaayra.in') });
    expect(r.status).toBe(400);
    expect(calls.some((c) => c.url.includes('rpc/inventory_receive'))).toBe(false);
  });
  it('when selling is unlocked (tests only), takes prices from the database and passes no client price', async () => {
    const cfg: AdminConfig = { db: { url: 'https://db.test', serviceKey: 'k' }, anonKey: 'a', secret: SECRET, admins: ADMINS, roles: parseAdminRoles(ENV.ADMIN_ROLES, ADMINS).roles, mfaMode: 'required', mfaKey: MFA_KEY };
    const reply: Reply = { status: 0, body: undefined, headers: {} };
    const res = { status(c: number) { reply.status = c; return res; }, json(b: unknown) { reply.body = b; return res; }, send(b: unknown) { reply.body = b; return res; }, setHeader() { return res; } };
    const req = { method: 'POST', query: { action: 'orders' }, body: { ...order, unit_price_paise: 1, items: [{ variant_id: V, qty: 2, unit_price_paise: 1 }] }, headers: {} };
    rpcReply = () => ({ status: 200, body: '9f5e31aa-8fac-4ecd-9041-6c5d2f4a0b43' });
    const ctx: AdminCtx = { req: req as never, res: res as never, cfg, email: 'ops@kaayra.in', role: 'manager', commerceEnabled: true, json: makeJson(res as never), audit: async () => undefined };
    expect(await handleBackoffice(ctx, 'orders')).toBe(true);
    expect(reply.status).toBe(201);
    const sent = calls.find((c) => c.url.includes('rpc/order_create'))!.body as { p_order: { items: Record<string, unknown>[] }; p_min_days: number };
    expect(sent.p_min_days).toBe(30);
    expect(JSON.stringify(sent.p_order)).not.toContain('unit_price');
  });
});

describe('overview, members and audit export', () => {
  const M = '1d6f0c52-2f1e-4a3b-9c7a-5b8e3f4a6d21';
  const A = '2e7a1d63-3a2f-4b4c-8d8b-6c9f4a5b7e32';
  const verified = (email: string) => ({ email, mfa: enrol(email).epoch });
  const MEMBERS: Record<string, { id: string; email: string; role: 'admin' | 'member'; name: string | null; provider: string; has_password: boolean; created_at: string; last_login_at: string }> = {
    [M]: { id: M, email: 'asha@example.com', role: 'member', name: '=cmd()', provider: 'google', has_password: true, created_at: '2026-10-01T00:00:00Z', last_login_at: '2026-10-17T00:00:00Z' },
    [A]: { id: A, email: 'boss@kaayra.in', role: 'admin', name: null, provider: 'password', has_password: true, created_at: '2026-09-01T00:00:00Z', last_login_at: '2026-10-17T00:00:00Z' },
  };
  beforeEach(() => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
      if (url.includes('/auth/v1/admin/users/') && method === 'DELETE') {
        calls.push({ method, url, body: undefined });
        return new Response(null, { status: 200 });
      }
      if (url.includes('/rest/v1/members')) {
        calls.push({ method, url, body: undefined });
        if (method === 'DELETE') return new Response(null, { status: 204 });
        const one = /id=eq\.([0-9a-f-]+)/.exec(url);
        if (one) return json(200, MEMBERS[one[1]] ? [MEMBERS[one[1]]] : []);
        if (url.includes('select=id&limit=1')) return json(200, [], { 'content-range': '*/7' });
        return json(200, Object.values(MEMBERS), { 'content-range': '0-1/2' });
      }
      if (url.includes('select=id&limit=1')) {
        calls.push({ method, url, body: undefined });
        return json(200, [], { 'content-range': '*/3' });
      }
      if (url.includes('/rest/v1/products?select=status')) return json(200, [{ status: 'DRAFT' }, { status: 'DRAFT' }, { status: 'APPROVED_FOR_PREVIEW' }]);
      if (url.includes('/rest/v1/product_variants')) return json(200, [{ id: V, pack_size: '200 ml', low_stock_threshold: 5, status: 'active', products: { internal_name: 'Iron Syrup', public_name: null } }]);
      if (url.includes('/rest/v1/inventory_batches')) return json(200, [{ variant_id: V, status: 'active', expiry_date: '2020-01-01', qty_on_hand: 4, qty_reserved: 0 }]);
      if (url.includes('/rest/v1/admin_audit') && method === 'GET') return json(200, [{ id: 9, actor: 'boss@kaayra.in', action: 'login', detail: { password: 'hunter2', note: 'ok' }, at: '2026-10-17T10:00:00Z' }]);
      return inner(input as string, init as RequestInit);
    }) as typeof fetch;
  });

  it('shows the overview behind the two-step gate, with stock problems listed worst first', async () => {
    expect((await call('dashboard')).status).toBe(401);
    const r = await call('dashboard', verified('boss@kaayra.in'));
    expect(r.status).toBe(200);
    expect(r.body.members).toEqual({ total: 7, last7: 7 });
    expect(r.body.messages).toEqual({ new: 3 });
    expect(r.body.products.byStatus).toEqual({ DRAFT: 2, APPROVED_FOR_PREVIEW: 1 });
    expect(r.body.orders).toMatchObject({ byStatus: { placed: 1 }, toHandle: 1 });
    expect(r.body.inventory).toMatchObject({ variants: 1, expired: 1, out: 1 });
    expect(r.body.inventory.attention[0]).toMatchObject({ kind: 'expired', product: 'Iron Syrup' });
  });

  it('still shows the overview when one table is missing, and names what could not load', async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input).includes('/rest/v1/orders?select=status')) return new Response(JSON.stringify({ code: 'PGRST205', message: 'missing' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return inner(input as string, init);
    }) as typeof fetch;
    const r = await call('dashboard', verified('boss@kaayra.in'));
    globalThis.fetch = inner;
    expect(r.status).toBe(200);
    expect(r.body.members).toEqual({ total: 7, last7: 7 });
    expect(r.body.orders).toBeUndefined();
    expect(r.body.unavailable).toHaveLength(1);
    expect(r.body.unavailable[0]).toMatchObject({ area: 'Orders' });
    expect(r.body.unavailable[0].hint).toContain('inventory_orders.sql');
  });

  it('lets support and managers read members but not export or delete', async () => {
    expect((await call('members', verified('help@kaayra.in'))).status).toBe(200);
    expect((await call('members', verified('ops@kaayra.in'))).body.items).toHaveLength(2);
    for (const who of ['help@kaayra.in', 'ops@kaayra.in']) {
      expect((await call('members-export', verified(who))).status).toBe(403);
      expect((await call('members', { method: 'DELETE', query: { id: M }, ...verified(who) })).status).toBe(403);
    }
  });

  it('exports members for the owner as CSV, neutralises formulas and audits it', async () => {
    const r = await call('members-export', verified('boss@kaayra.in'));
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/csv');
    expect(String(r.body)).toContain('"\'=cmd()"');
    expect(String(r.body)).not.toMatch(/password"?:/i);
    expect(calls.some((c) => c.url.includes('admin_audit') && (c.body as { action?: string } | undefined)?.action === 'export_members')).toBe(true);
  });

  it('deletes an ordinary member, removes the sign-in identity, and logs only the id', async () => {
    const r = await call('members', { method: 'DELETE', query: { id: M }, ...verified('boss@kaayra.in') });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/auth/v1/admin/users/' + M))).toBe(true);
    const logged = calls.filter((c) => c.url.includes('admin_audit') && c.method === 'POST').map((c) => c.body as { action: string; detail: Record<string, unknown> });
    const entry = logged.find((l) => l.action === 'delete_member')!;
    expect(entry.detail).toMatchObject({ id: M });
    expect(JSON.stringify(entry)).not.toContain('asha@example.com');
  });

  it('refuses to delete an administrator, a bad id, or an unknown member', async () => {
    const own = verified('boss@kaayra.in');
    expect((await call('members', { method: 'DELETE', query: { id: A }, ...own })).status).toBe(409);
    expect((await call('members', { method: 'DELETE', query: { id: 'nope' }, ...own })).status).toBe(400);
    expect((await call('members', { method: 'DELETE', query: { id: V }, ...own })).status).toBe(404);
    expect(calls.some((c) => c.url.includes('/auth/v1/admin/users/'))).toBe(false);
  });

  it('exports the audit log for the owner only, masks secret-looking keys, and records the export', async () => {
    expect((await call('audit-export', verified('ops@kaayra.in'))).status).toBe(403);
    expect((await call('audit-export', verified('help@kaayra.in'))).status).toBe(403);
    const r = await call('audit-export', { query: { actor: 'boss' }, ...verified('boss@kaayra.in') });
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain('Signed in');
    expect(String(r.body)).toContain('••••');
    expect(String(r.body)).not.toContain('hunter2');
    const logged = calls.filter((c) => c.url.includes('admin_audit') && c.method === 'POST').map((c) => c.body as { action: string; detail: { count: number; actor: string } });
    expect(logged.find((l) => l.action === 'export_audit')?.detail).toMatchObject({ count: 1, actor: 'boss' });
  });
});

describe('refunds and returns', () => {
  const R = '3f8b2e74-4b3a-4c5d-9e9c-7da05b6c8f43';
  const verified = (email: string) => ({ email, mfa: enrol(email).epoch });
  let current = 'requested';
  beforeEach(() => {
    current = 'requested';
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
      if (url.includes('/rest/v1/order_refunds') && method === 'GET') {
        if (url.includes('select=status,order_id')) return json(200, [{ status: current, order_id: V }]);
        if (url.includes('select=amount_paise')) return json(200, [{ amount_paise: 20000, status: 'requested' }, { amount_paise: 10000, status: 'rejected' }]);
        if (url.includes('select=id&limit=1')) return json(200, [], { 'content-range': '*/2' });
        return json(200, [{ id: R, order_id: V, status: current, amount_paise: 20000 }], { 'content-range': '0-0/1' });
      }
      if (url.includes('/rest/v1/orders?select=total_paise')) return json(200, [{ total_paise: 50000 }]);
      return inner(input as string, init as RequestInit);
    }) as typeof fetch;
  });
  const body = { order_id: V, kind: 'refund_only', reason_code: 'damaged', reason_note: 'Cracked bottle', amount_paise: 20000 };

  it('lets a manager request a refund through the database function and audits it', async () => {
    rpcReply = () => ({ status: 200, body: R });
    const r = await call('refunds', { method: 'POST', body, ...verified('ops@kaayra.in') });
    expect(r.status).toBe(201);
    const rpcCall = calls.find((c) => c.url.includes('/rpc/refund_create'))!;
    expect(rpcCall.body).toMatchObject({ p_order: V, p_amount: 20000, p_actor: 'ops@kaayra.in', p_reason: 'damaged' });
    expect(calls.some((c) => c.url.includes('admin_audit') && (c.body as { action?: string } | undefined)?.action === 'refund_create')).toBe(true);
  });
  it('keeps support read-only and refuses bad input before the database is called', async () => {
    expect((await call('refunds', { method: 'POST', body, ...verified('help@kaayra.in') })).status).toBe(403);
    expect((await call('refunds', verified('help@kaayra.in'))).status).toBe(200);
    const bad = await call('refunds', { method: 'POST', body: { ...body, amount_paise: -5 }, ...verified('ops@kaayra.in') });
    expect(bad.status).toBe(400);
    expect(calls.some((c) => c.url.includes('/rpc/refund_create'))).toBe(false);
  });
  it('turns the database rules into plain conflicts (unpaid order, over-refund)', async () => {
    rpcReply = () => ({ status: 400, body: { message: 'KH:NOT_PAID' } });
    const a = await call('refunds', { method: 'POST', body, ...verified('ops@kaayra.in') });
    expect(a.status).toBe(409);
    expect(a.body.message).toMatch(/never marked as paid/);
    rpcReply = () => ({ status: 400, body: { message: 'KH:REFUND_EXCEEDS:5000' } });
    const b = await call('refunds', { method: 'POST', body, ...verified('ops@kaayra.in') });
    expect(b.body.message).toContain('₹50 left');
  });
  it('shows what is still refundable on an order', async () => {
    const r = await call('refunds', { query: { order_id: V }, ...verified('boss@kaayra.in') });
    expect(r.body).toMatchObject({ orderTotalPaise: 50000, refundablePaise: 30000 });
  });
  it('lets only the owner approve, reject or pay out, and checks the ladder and required fields first', async () => {
    const pay = { refund_id: R, status: 'approved' };
    expect((await call('refund-status', { method: 'POST', body: pay, ...verified('ops@kaayra.in') })).status).toBe(403);
    expect((await call('refund-status', { method: 'POST', body: { refund_id: R, status: 'rejected' }, ...verified('boss@kaayra.in') })).status).toBe(400);
    expect((await call('refund-status', { method: 'POST', body: { refund_id: R, status: 'refunded', payment_ref: 'UTR 4098123' }, ...verified('boss@kaayra.in') })).status).toBe(400);
    expect(calls.some((c) => c.url.includes('/rpc/refund_set_status'))).toBe(false);
    const ok = await call('refund-status', { method: 'POST', body: pay, ...verified('boss@kaayra.in') });
    expect(ok.status).toBe(200);
    expect(calls.find((c) => c.url.includes('/rpc/refund_set_status'))!.body).toMatchObject({ p_refund: R, p_to: 'approved', p_actor: 'boss@kaayra.in' });
    const logged = calls.filter((c) => c.url.includes('admin_audit') && c.method === 'POST').map((c) => c.body as { action: string; detail: Record<string, unknown> });
    expect(logged.find((l) => l.action === 'refund_status')!.detail).toMatchObject({ from: 'requested', to: 'approved' });
  });
  it('refuses to reopen a finished refund', async () => {
    current = 'refunded';
    const r = await call('refund-status', { method: 'POST', body: { refund_id: R, status: 'rejected', note: 'Changed our mind' }, ...verified('boss@kaayra.in') });
    expect(r.status).toBe(400);
  });
});
