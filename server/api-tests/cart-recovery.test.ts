import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import cart from '../../api/cart/[action].js';
import checkout from '../../api/checkout/[action].js';
import { signToken } from '../oauth.js';
import { newRestoreToken, signUnsubscribeToken } from '../recoveryToken.js';

const SECRET = 'recovery-api-session-secret-0123456789-abcdef';
const UNSUB = 'recovery-api-unsub-secret-0123456789-abcdef-xyz';
const CRON = 'cron-secret-cron-secret-1234567890';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret', ADMIN_SESSION_SECRET: SECRET, SUBSCRIBE_TOKEN_SECRET: UNSUB, CRON_SECRET: CRON, FEATURE_CART_PREVIEW: 'on' };
const V = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAILS: Record<string, string> = { [A]: 'a@example.org', [B]: 'b@example.org' };

interface Tok { member: string; expires: number; revoked: boolean; clicks: number }
let tokens: Map<string, Tok>;
let rpcs: { fn: string; args: any }[];
let price: number;
let cartCoupon: string | null;
let couponValid: boolean;
let prefsOn: boolean;
let settingsEnabled: boolean;
let ip = 0;

const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  tokens = new Map(); rpcs = []; price = 49900; cartCoupon = null; couponValid = true; prefsOn = false; settingsEnabled = true;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  saved.VERCEL_ENV = process.env.VERCEL_ENV; delete process.env.VERCEL_ENV;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input)); const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') {
      const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, ''); const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
      const found = Object.entries(EMAILS).find(([mid, e]) => e === email || mid === id);
      return json(200, found ? [{ id: found[0], email: found[1], name: 'X', role: 'member', has_password: true }] : []);
    }
    if (path === 'product_variants') return json(200, [{ id: V, pack_size: '200 ml', price_paise: price, gst_rate: 12, hsn_code: '3004', status: 'active', products: { status: 'APPROVED_FOR_SALE', public_name: 'Tulsi', internal_name: 'x' } }]);
    if (path === 'inventory_batches') return json(200, [{ variant_id: V, qty_on_hand: 50, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' }]);
    if (path === 'carts') return url.searchParams.get('select') === 'coupon_code' ? json(200, [{ coupon_code: cartCoupon }]) : json(200, [{ cart_items: [{ variant_id: V, qty: 2 }] }]);
    if (path === 'cart_recovery_settings') return json(200, [{ enabled: settingsEnabled }]);
    if (path === 'marketing_preferences') return json(200, [{ cart_reminders: prefsOn }]);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); rpcs.push({ fn, args: body });
      if (fn === 'coupon_quote') return json(200, couponValid ? { ok: true, code: 'KAAYRA10', description: 'Welcome', discount_paise: 9980, eligible_paise: 99800, subtotal_paise: 99800, allocations: [{ ref: V, discount_paise: 9980 }] } : { ok: false, reason: 'EXPIRED' });
      if (fn === 'cart_recovery_redeem') {
        const t = tokens.get(body.p_hash);
        if (!t) return json(200, { result: 'invalid' });
        if (t.revoked) return json(200, { result: 'closed' });
        if (t.expires <= Date.now()) return json(200, { result: 'expired' });
        if (!body.p_member) return json(200, { result: 'signin_required' });
        if (body.p_member !== t.member) return json(200, { result: 'wrong_account' });
        t.clicks++;
        return json(200, { result: 'ok' });
      }
      if (fn === 'marketing_opt_in') { prefsOn = true; return json(200, { result: 'ok' }); }
      if (fn === 'marketing_unsubscribe') { prefsOn = false; return json(200, null); }
      return json(200, null);
    }
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const cookieFor = (email: string) => signToken('user', { email, name: 'X', role: 'member' }, SECRET, 3600);
function call(action: string, opts: { method?: string; body?: unknown; query?: Record<string, string>; as?: string | null; csrf?: boolean } = {}) {
  ip++;
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', origin: 'https://site.kaayra-test.in', 'x-forwarded-for': `10.7.${ip >> 8}.${ip & 255}` };
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const req = { method: opts.method ?? 'POST', headers, body: opts.body, query: { action, ...(opts.query ?? {}) }, cookies: opts.as ? { kaayra_user: cookieFor(opts.as) } : {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return cart(req, res).then(() => out);
}
const issue = (member: string, over: Partial<Tok> = {}) => { const t = newRestoreToken(); tokens.set(t.hash, { member, expires: Date.now() + 3600_000, revoked: false, clicks: 0, ...over }); return t.token; };

describe('restore link', () => {
  it('without a session: asks to sign in, reveals nothing about the bag, counts no click', async () => {
    const r = await call('recover', { body: { token: issue(A) } });
    expect(r.status).toBe(401);
    expect(r.body.status).toBe('signin_required');
    expect(JSON.stringify(r.body)).not.toMatch(/lines|totals|a@example/);
    expect([...tokens.values()][0]!.clicks).toBe(0);
  });
  it('another signed-in customer cannot open it, sees no cart data, and no click is counted', async () => {
    const t = issue(A);
    const r = await call('recover', { body: { token: t }, as: EMAILS[B]! });
    expect(r.status).toBe(403);
    expect(r.body.status).toBe('wrong_account');
    expect(JSON.stringify(r.body)).not.toMatch(/lines|totals|Tulsi|a@example/);
    expect([...tokens.values()][0]!.clicks).toBe(0);
  });
  it('the right customer gets their own bag, re-priced at TODAY\'s price, and a click is counted', async () => {
    price = 54900;
    const r = await call('recover', { body: { token: issue(A) }, as: EMAILS[A]! });
    expect(r.status).toBe(200);
    expect(r.body.recover).toBe('ok');
    expect(r.body.lines[0].unitPaise).toBe(54900);
    expect(r.body.totals.subtotalPaise).toBe(109800);
    expect([...tokens.values()][0]!.clicks).toBe(1);
  });
  it('an expired link is refused (410) with no cart data', async () => {
    const r = await call('recover', { body: { token: issue(A, { expires: Date.now() - 1000 }) }, as: EMAILS[A]! });
    expect(r.status).toBe(410);
    expect(r.body.status).toBe('expired');
    expect(r.body.lines).toBeUndefined();
  });
  it('a link for a bag that was bought, changed or unsubscribed (revoked) is refused', async () => {
    const r = await call('recover', { body: { token: issue(A, { revoked: true }) }, as: EMAILS[A]! });
    expect(r.status).toBe(410);
    expect(r.body.status).toBe('closed');
  });
  it('unknown and malformed tokens look the same and never reach the database as raw text', async () => {
    const a = await call('recover', { body: { token: newRestoreToken().token }, as: EMAILS[A]! });
    const b = await call('recover', { body: { token: "' or 1=1" }, as: EMAILS[A]! });
    expect(a.status).toBe(404); expect(b.status).toBe(404);
    expect(rpcs.every((x) => x.args.p_hash === undefined || /^[0-9a-f]{64}$/.test(x.args.p_hash))).toBe(true);
  });
  it('is rate limited per IP', async () => {
    const t = issue(A);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call('recover', { body: { token: t }, as: EMAILS[A]!, query: {} })).status;
    // each call() uses a new IP, so hit one IP explicitly
    const hits: number[] = [];
    for (let i = 0; i < 25; i++) {
      const headers = { host: 'site.kaayra-test.in', origin: 'https://site.kaayra-test.in', 'x-forwarded-for': '10.200.0.1', 'x-kaayra-csrf': '1' };
      const req = { method: 'POST', headers, body: { token: t }, query: { action: 'recover' }, cookies: {}, socket: {} } as never;
      const out = { status: 200 };
      await cart(req, { setHeader() {}, status(s: number) { out.status = s; return this; }, json() { return this; } } as never);
      hits.push(out.status);
    }
    expect(last).toBe(200);
    expect(hits).toContain(429);
  });
  it('the stored coupon is re-checked on restore: an expired coupon gives no discount and shows why', async () => {
    cartCoupon = 'KAAYRA10'; couponValid = false;
    const r = await call('recover', { body: { token: issue(A) }, as: EMAILS[A]! });
    expect(r.status).toBe(200);
    expect(r.body.totals.discountPaise).toBe(0);
    expect(r.body.coupon.valid ?? false).toBe(false);
  });
  it('a valid coupon still applies through the normal path, and restoring creates, issues or consumes nothing', async () => {
    cartCoupon = 'KAAYRA10';
    const r = await call('recover', { body: { token: issue(A) }, as: EMAILS[A]! });
    expect(r.body.totals.discountPaise).toBe(9980);
    const writes = rpcs.map((x) => x.fn).filter((f) => /coupon_(cart_apply|reserve|redeem|create)|coupon_.*commit/.test(f));
    expect(writes).toEqual([]);
  });
});

describe('unsubscribe', () => {
  it('one-click link stops reminders without a session or CSRF header, and is idempotent', async () => {
    const t = signUnsubscribeToken(A, UNSUB);
    for (let i = 0; i < 2; i++) {
      const r = await call('unsubscribe', { query: { u: t }, csrf: false });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('unsubscribed');
    }
    expect(rpcs.filter((x) => x.fn === 'marketing_unsubscribe')[0]!.args).toEqual({ p_email: 'a@example.org', p_source: 'recovery_email' });
  });
  it('rejects a forged, foreign or malformed token', async () => {
    for (const u of ['x.y', signUnsubscribeToken(A, UNSUB + 'zz'), 'a'.repeat(400)]) expect((await call('unsubscribe', { query: { u } , csrf: false })).status).toBe(400);
    expect(rpcs.filter((x) => x.fn === 'marketing_unsubscribe')).toHaveLength(0);
  });
  it('the /subscription page button works the same way, but needs the CSRF header', async () => {
    const t = signUnsubscribeToken(A, UNSUB);
    expect((await call('unsubscribe', { body: { token: t }, csrf: false })).status).toBe(403);
    expect((await call('unsubscribe', { body: { token: t } })).body.status).toBe('unsubscribed');
  });
  it('a member who no longer exists still gets a calm success and nothing is changed', async () => {
    const r = await call('unsubscribe', { query: { u: signUnsubscribeToken('cccccccc-cccc-4ccc-8ccc-cccccccccccc', UNSUB) }, csrf: false });
    expect(r.status).toBe(200);
    expect(rpcs.filter((x) => x.fn === 'marketing_unsubscribe')).toHaveLength(0);
  });
});

describe('reminder preference', () => {
  it('needs sign-in', async () => {
    expect((await call('prefs', { method: 'GET' })).status).toBe(401);
    expect((await call('prefs', { body: { cartReminders: true } })).status).toBe(401);
  });
  it('is OFF by default, reports whether recovery is available, and shows the consent wording', async () => {
    const r = await call('prefs', { method: 'GET', as: EMAILS[A]! });
    expect(r.body).toMatchObject({ cartReminders: false, available: true, consentVersion: 'cart-reminders-v1' });
    expect(r.body.consentText).toMatch(/switch this off/i);
    settingsEnabled = false;
    expect((await call('prefs', { method: 'GET', as: EMAILS[A]! })).body.available).toBe(false);
  });
  it('turns on only from an explicit boolean, records the version, and can be turned off', async () => {
    expect((await call('prefs', { body: { cartReminders: 'yes' }, as: EMAILS[A]! })).status).toBe(400);
    expect((await call('prefs', { body: { cartReminders: true }, as: EMAILS[A]! })).body.cartReminders).toBe(true);
    expect(rpcs.find((x) => x.fn === 'marketing_opt_in')!.args).toMatchObject({ p_member: A, p_version: 'cart-reminders-v1' });
    expect((await call('prefs', { body: { cartReminders: false }, as: EMAILS[A]! })).body.cartReminders).toBe(false);
    expect(rpcs.some((x) => x.fn === 'marketing_unsubscribe')).toBe(true);
  });
});

describe('scheduler endpoint', () => {
  function cron(action: string, auth?: string) {
    const out = { status: 200, body: undefined as any };
    const req = { method: 'POST', headers: { host: 'site.kaayra-test.in', ...(auth ? { authorization: auth } : {}) }, query: { action }, body: {}, cookies: {}, socket: {} } as never;
    return checkout(req, { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never).then(() => out);
  }
  it('is hidden without the secret and touches nothing', async () => {
    expect((await cron('recovery')).status).toBe(404);
    expect((await cron('recovery', 'Bearer wrong-wrong-wrong-wrong-wrong-wr')).status).toBe(404);
    expect(rpcs).toHaveLength(0);
  });
  it('with the secret it runs and returns counts only', async () => {
    const r = await cron('recovery', `Bearer ${CRON}`);
    expect(r.status).toBe(200);
    expect(r.body.recovery.status).toBe('mail_not_configured');
    expect(JSON.stringify(r.body)).not.toMatch(/@/);
  });
});
