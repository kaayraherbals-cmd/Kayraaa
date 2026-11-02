import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/checkout/[action].js';
import { signToken } from '../oauth.js';

/**
 * Customer payment API tests. The database and Razorpay are imitated in memory: the imitation of each SQL function follows
 * supabase/payments_checkout.sql line by line, so these tests prove what the API sends, believes and refuses. They do NOT
 * prove the SQL itself; that needs supabase/payments_checkout_selftest.sql on a real database (never run yet).
 */
const SECRET = 'checkout-test-session-secret-0123456789-abcdef';
const SITE = 'https://site.kaayra-test.in';
const KEY_ID = 'rzp_test_ABCDEF123456';
const KEY_SECRET = 'razorpay-key-secret-for-tests';
const CRON = 'cron-secret-long-enough-0123';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret', ADMIN_SESSION_SECRET: SECRET,
  FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on', FEATURE_PAYMENT_TEST_MODE: 'on',
  RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, CRON_SECRET: CRON,
};
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const O1 = '00000000-0000-4000-8000-000000000001';
const O2 = '00000000-0000-4000-8000-000000000002';
const O_B = '00000000-0000-4000-8000-0000000000bb';

type Order = { id: string; order_no: string; member_id: string; status: string; total_paise: number; pay_by: string; is_test: boolean };
type Pay = { id: string; order_id: string; rp_order_id: string; rp_payment_id: string | null; amount_paise: number; status: string; flagged: string | null; created_at: string; authorized_at?: number };
type RpPay = { id: string; order_id: string; amount: number; currency: string; status: string; method?: string };

let orders: Order[];
let pays: Pay[];
let events: Set<string>;
let cartCleared: string[];
let released: string[];
let audits: { action: string; detail: Record<string, unknown> }[];
let rpCreated: { amount: number; receipt: string }[];
let rpPayments: RpPay[];
let dueIgnoresHold = false; // test switch: lets an order into the due list that order_expire then holds (a payment authorised in between)
let rpDown: boolean;
let rpAmountOverride: number | null;
let dbDown: boolean;
let rpCalls: string[];
let ipCounter = 0;
let seq = 0;
const realNow = Date.now;
let clock = realNow();

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const eq = (q: string | null) => (q ?? '').replace(/^eq\./, '');
const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
// Mirrors supabase/payments_checkout.sql (KH6-012): an attempt authorised in the last 24 hours holds its order. Rows with no timestamp count as fresh.
const heldByAuthorised = (orderId: string) => pays.some((p) => p.order_id === orderId && p.status === 'authorized' && Date.now() - (p.authorized_at ?? Date.now()) < 24 * 3600 * 1000);
const minsAhead = (m: number) => new Date(Date.now() + m * 60000).toISOString();
const mkOrder = (id: string, member: string, over: Partial<Order> = {}): Order => ({ id, order_no: `KH-2026-${id.slice(-6).replace(/[^0-9]/g, '0').padStart(6, '0')}`, member_id: member, status: 'placed', total_paise: 105900, pay_by: minsAhead(30), is_test: true, ...over });

// ---- imitation of supabase/payments_checkout.sql ----
function applyEvent(a: Record<string, any>): string {
  if (events.has(a.p_event_id)) return 'duplicate';
  events.add(a.p_event_id);
  const pay = pays.find((p) => p.rp_order_id === a.p_rp_order);
  if (!pay) return 'unknown_order';
  if (a.p_event === 'payment.authorized') { if (pay.status === 'created') { pay.status = 'authorized'; pay.authorized_at = Date.now(); pay.rp_payment_id ??= a.p_rp_payment; } return 'authorized'; }
  if (a.p_event === 'payment.failed') { if (pay.status !== 'captured') pay.status = 'failed'; return 'failed'; }
  if (a.p_event === 'payment.captured' || a.p_event === 'order.paid') {
    if (pay.status === 'captured') return 'captured';
    if (a.p_amount !== pay.amount_paise) { pay.flagged = 'amount_mismatch'; return 'amount_mismatch'; }
    pay.status = 'captured'; pay.rp_payment_id = a.p_rp_payment;
    const o = orders.find((x) => x.id === pay.order_id)!;
    if (o.status === 'placed') { o.status = 'paid'; cartCleared.push(o.member_id); return 'captured'; }
    if (o.status === 'paid') return 'captured';
    pay.flagged = 'order_not_open';
    return 'order_not_open';
  }
  return 'ignored';
}
function cancelOrder(o: Order) { o.status = 'cancelled'; released.push(o.id); }

function rpc(fn: string, a: Record<string, any>): Response {
  if (fn === 'payment_prepare') {
    const o = orders.find((x) => x.id === a.p_order && x.member_id === a.p_member);
    if (!o) return json(400, { message: 'KH:NOT_FOUND' });
    if (pays.some((p) => p.order_id === o.id && p.status === 'captured') || ['paid', 'packed', 'shipped', 'delivered'].includes(o.status)) return json(400, { message: 'KH:ALREADY_PAID' });
    if (o.status !== 'placed') return json(400, { message: `KH:BAD_TRANSITION:${o.status}>paid` });
    if (new Date(o.pay_by).getTime() <= Date.now()) return json(400, { message: 'KH:PAY_WINDOW_ENDED' });
    const open = pays.filter((p) => p.order_id === o.id && ['authorized', 'created'].includes(p.status)).sort((x, y) => (y.status === 'authorized' ? 1 : 0) - (x.status === 'authorized' ? 1 : 0))[0];
    return json(200, { order_no: o.order_no, amount_paise: o.total_paise, is_test: o.is_test, pay_by: o.pay_by, customer_name: 'Asha Verma', customer_email: 'a@example.org', customer_phone: '+919876543210', reuse: open ? { payment_id: open.id, rp_order_id: open.rp_order_id, status: open.status } : null });
  }
  if (fn === 'payment_attach') {
    const o = orders.find((x) => x.id === a.p_order && x.member_id === a.p_member);
    if (!o) return json(400, { message: 'KH:NOT_FOUND' });
    if (o.status !== 'placed') return json(400, { message: `KH:BAD_TRANSITION:${o.status}>paid` });
    if (a.p_amount !== o.total_paise) return json(400, { message: 'KH:INVALID' });
    const open = pays.find((p) => p.order_id === o.id && ['authorized', 'created'].includes(p.status));
    if (open) return json(200, { payment_id: open.id, rp_order_id: open.rp_order_id, reused: true });
    const p: Pay = { id: `p-${++seq}`, order_id: o.id, rp_order_id: a.p_rp_order, rp_payment_id: null, amount_paise: o.total_paise, status: 'created', flagged: null, created_at: `${Date.now()}-${seq}` };
    pays.push(p);
    return json(200, { payment_id: p.id, rp_order_id: p.rp_order_id, reused: false });
  }
  if (fn === 'payment_apply_event') return json(200, applyEvent(a));
  if (fn === 'order_cancel_own') {
    const o = orders.find((x) => x.id === a.p_order && x.member_id === a.p_member);
    if (!o) return json(400, { message: 'KH:NOT_FOUND' });
    if (o.status === 'cancelled') return json(200, 'cancelled');
    if (o.status !== 'placed') return json(400, { message: `KH:BAD_TRANSITION:${o.status}>cancelled` });
    if (pays.some((p) => p.order_id === o.id && ['authorized', 'captured'].includes(p.status))) return json(400, { message: 'KH:PAYMENT_IN_PROGRESS' });
    pays.filter((p) => p.order_id === o.id && p.status === 'created').forEach((p) => (p.status = 'failed'));
    cancelOrder(o);
    return json(200, 'cancelled');
  }
  if (fn === 'orders_due_for_expiry') {
    const due = orders.filter((o) => o.status === 'placed' && new Date(o.pay_by).getTime() < Date.now() - 2 * 60000 && (dueIgnoresHold || !heldByAuthorised(o.id))).map((o) => ({ order_id: o.id, order_no: o.order_no, rp_orders: pays.filter((p) => p.order_id === o.id && p.status !== 'captured').map((p) => p.rp_order_id) }));
    return json(200, due);
  }
  if (fn === 'order_expire') {
    const o = orders.find((x) => x.id === a.p_order);
    if (!o) return json(400, { message: 'KH:NOT_FOUND' });
    if (o.status !== 'placed') return json(200, o.status === 'cancelled' ? 'skipped' : 'paid');
    if (pays.some((p) => p.order_id === o.id && p.status === 'captured')) return json(200, 'paid');
    if (new Date(o.pay_by).getTime() >= Date.now() - 2 * 60000) return json(200, 'skipped');
    if (heldByAuthorised(o.id)) return json(200, 'held');
    pays.filter((p) => p.order_id === o.id && ['created', 'authorized'].includes(p.status)).forEach((p) => (p.status = 'failed'));
    cancelOrder(o);
    return json(200, 'expired');
  }
  return json(404, {});
}

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    if (url.host === 'api.razorpay.com') {
      rpCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (rpDown) throw new TypeError('network down');
      if (init?.method === 'POST' && url.pathname === '/v1/orders') {
        const b = JSON.parse(init.body!);
        rpCreated.push({ amount: b.amount, receipt: b.receipt });
        return json(200, { id: `order_TEST${String(rpCreated.length).padStart(4, '0')}ABC`, amount: rpAmountOverride ?? b.amount, currency: 'INR', receipt: b.receipt, status: 'created' });
      }
      const one = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)$/.exec(url.pathname);
      if (one) { const p = rpPayments.find((x) => x.id === one[1]); return p ? json(200, p) : json(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'not found' } }); }
      const many = /^\/v1\/orders\/(order_[A-Za-z0-9]+)\/payments$/.exec(url.pathname);
      if (many) return json(200, { items: rpPayments.filter((p) => p.order_id === many[1]) });
      return json(404, {});
    }
    if (dbDown) return json(500, { message: 'connection to server at "10.0.0.5" failed: password authentication failed' });
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') return json(200, [{ id: M_A, email: 'a@example.org', name: 'A', role: 'member', has_password: true }, { id: M_B, email: 'b@example.org', name: 'B', role: 'member', has_password: true }].filter((m) => m.email === eq(url.searchParams.get('email'))));
    if (path === 'orders') return json(200, orders.filter((o) => o.id === eq(url.searchParams.get('id')) && o.member_id === eq(url.searchParams.get('member_id'))));
    if (path === 'order_payments') {
      const oid = eq(url.searchParams.get('order_id'));
      const rp = url.searchParams.get('rp_order_id');
      return json(200, pays.filter((p) => p.order_id === oid && (!rp || p.rp_order_id === eq(rp))).sort((x, y) => (x.created_at < y.created_at ? 1 : -1)));
    }
    if (path === 'admin_audit') { audits.push({ action: body.action, detail: body.detail }); return new Response(null, { status: 201 }); }
    if (path.startsWith('rpc/')) return rpc(path.slice(4), body);
    return json(404, {});
  }) as typeof fetch;
}

const cookieFor = (email: string) => signToken('user', { email, name: 'Asha', role: 'member' }, SECRET, 3600);
const asA = () => cookieFor('a@example.org');
const asB = () => cookieFor('b@example.org');

function call(action: string, opts: { method?: string; body?: unknown; cookie?: string | null; origin?: string | null; csrf?: boolean; auth?: string } = {}) {
  ipCounter++;
  const method = opts.method ?? (action === 'config' || action === 'reconcile' ? 'GET' : 'POST');
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', 'x-forwarded-for': `10.7.${ipCounter >> 8}.${ipCounter & 255}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  if (opts.auth) headers.authorization = opts.auth;
  const req = { method, headers, body: opts.body, query: { action }, cookies: opts.cookie ? { kaayra_user: opts.cookie } : {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}
const pay = (orderId = O1, cookie: string | null = asA()) => call('pay', { cookie, body: { orderId } });
const sigFor = (rpOrder: string, rpPay: string, secret = KEY_SECRET) => createHmac('sha256', secret).update(`${rpOrder}|${rpPay}`).digest('hex');
const verifyBody = (orderId: string, rpOrder: string, rpPay: string, signature = sigFor(rpOrder, rpPay)) => ({ orderId, razorpay_order_id: rpOrder, razorpay_payment_id: rpPay, razorpay_signature: signature });
const verify = (b: unknown, cookie: string | null = asA()) => call('verify', { cookie, body: b });
const cron = (auth: string | null = `Bearer ${CRON}`) => call('reconcile', { auth: auth ?? undefined });
const RP_PAY = 'pay_TESTPAY0001';

/** Starts a payment on O1 and returns the Razorpay order id. */
async function started(orderId = O1): Promise<string> {
  const r = await pay(orderId);
  expect(r.status).toBe(200);
  return r.body.razorpayOrderId as string;
}
const providerPays = (rpOrder: string, over: Partial<RpPay> = {}) => rpPayments.push({ id: RP_PAY, order_id: rpOrder, amount: 105900, currency: 'INR', status: 'captured', method: 'upi', ...over });

beforeEach(() => {
  clock += 11 * 60 * 1000;
  Date.now = () => clock;
  orders = [mkOrder(O1, M_A), mkOrder(O2, M_A), mkOrder(O_B, M_B, { total_paise: 55000 })];
  pays = []; events = new Set(); cartCleared = []; released = []; audits = []; rpCreated = []; rpPayments = []; rpCalls = [];
  rpDown = false;
  dueIgnoresHold = false; rpAmountOverride = null; dbDown = false;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  saved.VERCEL_ENV = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  install();
});
afterEach(() => {
  Date.now = realNow;
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('payment is closed unless every switch is on', () => {
  it('is open with a TEST key outside production', async () => {
    delete process.env.FEATURE_PAYMENT_TEST_MODE;
    expect((await call('config')).body).toMatchObject({ checkoutOpen: true, paymentOpen: true });
  });
  it('rejects a LIVE key outside approved production', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_live_ABCDEF123456';
    expect((await call('config')).body.paymentOpen).toBe(false);
  });
  it('is closed in production before live-sales approval', async () => {
    process.env.VERCEL_ENV = 'production';
    expect((await call('config')).body).toMatchObject({ checkoutOpen: false, paymentOpen: false });
  });
  it('production with a live key stays closed before approval', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.RAZORPAY_KEY_ID = 'rzp_live_ABCDEF123456';
    expect((await call('config')).body.paymentOpen).toBe(false);
  });
  it('says so plainly when the Razorpay keys are missing', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const r = await pay();
    expect(r.status).toBe(404); // key not usable, so payment is not open at all
    delete process.env.RAZORPAY_KEY_ID;
    expect((await pay()).status).toBe(404);
    expect(rpCalls).toHaveLength(0);
  });
});

describe('who may call it', () => {
  it('needs a signed-in member', async () => {
    const r = await pay(O1, null);
    expect(r.status).toBe(401);
    expect(r.body.errorCode).toBe('KH-PAY-002');
    expect(rpCalls).toHaveLength(0);
  });
  it('needs same-origin and the CSRF header', async () => {
    expect((await call('pay', { cookie: asA(), body: { orderId: O1 }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('pay', { cookie: asA(), body: { orderId: O1 }, origin: null })).status).toBe(403);
    expect((await call('pay', { cookie: asA(), body: { orderId: O1 }, csrf: false })).status).toBe(403);
    expect((await call('verify', { cookie: asA(), body: {}, csrf: false })).status).toBe(403);
    expect(rpCalls).toHaveLength(0);
  });
  it('rejects GET on the payment actions', async () => {
    expect((await call('pay', { method: 'GET', cookie: asA() })).status).toBe(405);
  });
  it('cannot pay for, read or cancel another customer\'s order', async () => {
    expect((await pay(O_B, asA())).status).toBe(404);
    expect((await call('status', { cookie: asA(), body: { orderId: O_B } })).status).toBe(404);
    expect((await call('cancel', { cookie: asA(), body: { orderId: O_B } })).status).toBe(404);
    expect((await verify(verifyBody(O_B, 'order_X12345678', RP_PAY), asA())).status).toBe(404);
    expect(rpCalls).toHaveLength(0);
    expect(orders.find((o) => o.id === O_B)!.status).toBe('placed');
  });
  it('rate-limits payment starts per member', async () => {
    let last = 200;
    for (let i = 0; i < 22; i++) last = (await pay()).status;
    expect(last).toBe(429);
  });  it('refuses to START a payment, but still accepts a verify, when the shared rate limiter is unavailable', async () => {
    process.env.RATE_LIMIT_SHARED = 'on'; // the test environment switches the shared layer off; here it is on and its database function is unreachable
    try {
      const started = await pay(O1, asA());
      expect(started.status).toBe(503);
      expect(started.body.errorCode).toBe('KH-PAY-009');
      expect(rpCalls).toHaveLength(0); // Razorpay was never asked, so nothing can have been charged
      const verified = await verify(verifyBody(O1, 'order_X12345678', RP_PAY), asA());
      expect(verified.status).not.toBe(503); // recording a payment is never blocked by the limiter
    } finally {
      process.env.RATE_LIMIT_SHARED = 'off';
    }
  });
});

describe('pay: starting a payment', () => {
  it('creates a Razorpay order for exactly the total stored on the order, and returns the public key id only', async () => {
    const r = await call('pay', { cookie: asA(), body: { orderId: O1, amountPaise: 1, amount: 1, totalPaise: 1, keySecret: 'x' } });
    expect(r.status).toBe(200);
    expect(rpCreated).toEqual([{ amount: 105900, receipt: mkOrder(O1, M_A).order_no }]);
    expect(r.body).toMatchObject({ keyId: KEY_ID, amountPaise: 105900, currency: 'INR', isTest: true });
    expect(JSON.stringify(r.body)).not.toContain(KEY_SECRET);
    expect(pays).toHaveLength(1);
    expect(pays[0].amount_paise).toBe(105900);
  });
  it('charges the discounted total when the order carries a coupon, whatever the browser sends', async () => {
    // The database stores total = subtotal - discount + shipping on the order (coupons.sql); payment_prepare reads that total.
    orders = [mkOrder(O1, M_A, { total_paise: 95820, discount_paise: 9980, coupon_code: 'KAAYRA10' } as never)];
    const r = await call('pay', { cookie: asA(), body: { orderId: O1, amountPaise: 105800, discountPaise: 0, couponCode: 'NONE' } });
    expect(r.status).toBe(200);
    expect(rpCreated).toEqual([{ amount: 95820, receipt: orders[0].order_no }]);
    expect(r.body.amountPaise).toBe(95820);
    expect(pays[0].amount_paise).toBe(95820);
  });
  it('rejects a missing, malformed or non-uuid order id', async () => {
    for (const body of [{}, { orderId: 'nope' }, { orderId: 5 }, { orderId: `${O1}'; drop table orders;--` }, null]) {
      expect((await call('pay', { cookie: asA(), body })).status).toBe(400);
    }
    expect(rpCalls).toHaveLength(0);
  });
  it('reuses the open attempt instead of creating a second Razorpay order', async () => {
    const a = await started();
    const b = await started();
    expect(b).toBe(a);
    expect(rpCreated).toHaveLength(1);
    expect(pays).toHaveLength(1);
  });
  it('a double tap leaves exactly one open attempt and both screens get the same Razorpay order', async () => {
    const [x, y] = await Promise.all([pay(), pay()]);
    expect(x.status).toBe(200);
    expect(y.status).toBe(200);
    expect(x.body.razorpayOrderId).toBe(y.body.razorpayOrderId);
    expect(pays.filter((p) => p.status === 'created')).toHaveLength(1);
  });
  it('allows a fresh attempt after the previous one failed (retry)', async () => {
    const first = await started();
    pays[0].status = 'failed';
    const second = await started();
    expect(second).not.toBe(first);
    expect(pays).toHaveLength(2);
  });
  it('does not open a second attempt beside an authorised payment', async () => {
    const first = await started();
    pays[0].status = 'authorized';
    expect(await started()).toBe(first);
    expect(rpCreated).toHaveLength(1);
  });
  it('refuses once the payment window has ended, without calling Razorpay', async () => {
    orders[0].pay_by = minsAgo(1);
    const r = await pay();
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-PAY-005');
    expect(rpCalls).toHaveLength(0);
  });
  it('refuses an order that is cancelled or already paid', async () => {
    orders[0].status = 'cancelled';
    expect((await pay()).status).toBe(409);
    orders[1].status = 'paid';
    expect((await pay(O2)).status).toBe(409);
    expect(rpCalls).toHaveLength(0);
  });
  it('stores nothing when Razorpay is down, and says nothing was charged', async () => {
    rpDown = true;
    const r = await pay();
    expect(r.status).toBe(502);
    expect(r.body.errorCode).toBe('KH-PAY-007');
    expect(pays).toHaveLength(0);
  });
  it('stores nothing when Razorpay reports a different amount than the order total', async () => {
    rpAmountOverride = 1000;
    expect((await pay()).status).toBe(502);
    expect(pays).toHaveLength(0);
  });
  it('does not leak database errors', async () => {
    dbDown = true;
    const r = await pay();
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|password|service-key/);
  });
});

describe('verify: the browser callback is checked, then confirmed with Razorpay', () => {
  it('marks the order paid and empties the bag only when signature, order, amount and status all agree', async () => {
    const rp = await started();
    providerPays(rp);
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('paid');
    expect(orders[0].status).toBe('paid');
    expect(cartCleared).toEqual([M_A]);
    expect(rpCalls).toContain(`GET /v1/payments/${RP_PAY}`);
  });
  it('rejects a bad signature and leaves the order unpaid; Razorpay is never asked', async () => {
    const rp = await started();
    providerPays(rp);
    const r = await verify(verifyBody(O1, rp, RP_PAY, sigFor(rp, RP_PAY, 'wrong-secret-entirely')));
    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe('KH-PAY-004');
    expect(orders[0].status).toBe('placed');
    expect(cartCleared).toHaveLength(0);
    expect(rpCalls.filter((c) => c.startsWith('GET'))).toHaveLength(0);
    expect(audits.map((a) => a.action)).toContain('payment_verify_bad_signature');
  });
  it('rejects a signature that is valid for a different payment id', async () => {
    const rp = await started();
    providerPays(rp);
    const r = await verify(verifyBody(O1, rp, RP_PAY, sigFor(rp, 'pay_SOMEOTHER001')));
    expect(r.status).toBe(400);
    expect(orders[0].status).toBe('placed');
  });
  it('rejects a Razorpay order id that we never created for this order', async () => {
    await started();
    providerPays('order_NOTOURS0001');
    const r = await verify(verifyBody(O1, 'order_NOTOURS0001', RP_PAY));
    expect(r.status).toBe(400);
    expect(orders[0].status).toBe('placed');
    expect(audits.map((a) => a.action)).toContain('payment_verify_unknown_order');
  });
  it('does not mark paid when Razorpay says the payment belongs to a different order', async () => {
    const rp = await started();
    providerPays('order_ANOTHER0001');
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.status).toBe(400);
    expect(orders[0].status).toBe('placed');
    expect(audits.map((a) => a.action)).toContain('payment_verify_mismatch');
  });
  it('flags an amount mismatch for a person and does not mark the order paid', async () => {
    const rp = await started();
    providerPays(rp, { amount: 100 });
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.body.state).toBe('review');
    expect(orders[0].status).toBe('placed');
    expect(pays[0].flagged).toBe('amount_mismatch');
    expect(cartCleared).toHaveLength(0);
  });
  it('treats a different currency as a mismatch and applies nothing', async () => {
    const rp = await started();
    providerPays(rp, { currency: 'USD' });
    expect((await verify(verifyBody(O1, rp, RP_PAY))).status).toBe(400);
    expect(orders[0].status).toBe('placed');
    expect(pays[0].status).toBe('created');
  });
  it('shows "processing" while the payment is only authorised, and never paid', async () => {
    const rp = await started();
    providerPays(rp, { status: 'authorized' });
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.body.state).toBe('processing');
    expect(orders[0].status).toBe('placed');
  });
  it('shows "processing" (not paid) when Razorpay cannot be reached, even with a good signature', async () => {
    const rp = await started();
    rpDown = true;
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('processing');
    expect(orders[0].status).toBe('placed');
  });
  it('records a failed payment, keeps the order open for a retry and the bag untouched', async () => {
    const rp = await started();
    providerPays(rp, { status: 'failed' });
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.body.state).toBe('failed');
    expect(orders[0].status).toBe('placed');
    expect(pays[0].status).toBe('failed');
    expect(cartCleared).toHaveLength(0);
    const again = await started();
    expect(again).not.toBe(rp);
  });
  it('is safe to repeat: the same callback twice captures once', async () => {
    const rp = await started();
    providerPays(rp);
    const a = await verify(verifyBody(O1, rp, RP_PAY));
    const b = await verify(verifyBody(O1, rp, RP_PAY));
    expect(a.body.state).toBe('paid');
    expect(b.body.state).toBe('paid');
    expect(cartCleared).toHaveLength(1);
    expect(pays.filter((p) => p.status === 'captured')).toHaveLength(1);
  });
  it('does not let a webhook or reconciliation capture the same payment twice either', async () => {
    const rp = await started();
    providerPays(rp);
    await verify(verifyBody(O1, rp, RP_PAY));
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.body.paidFound).toBe(0); // already paid, so not due
    expect(cartCleared).toHaveLength(1);
  });
  it('rejects malformed callback fields before touching Razorpay', async () => {
    const rp = await started();
    const before = rpCalls.length;
    const good = verifyBody(O1, rp, RP_PAY);
    for (const bad of [{ ...good, razorpay_order_id: 'x' }, { ...good, razorpay_payment_id: '../payments' }, { ...good, razorpay_signature: 'zz' }, { ...good, orderId: 'no' }, { ...good, razorpay_payment_id: 'pay_a/../../orders' }, {}, null]) {
      expect((await verify(bad)).status).toBe(400);
    }
    expect(rpCalls.length).toBe(before);
  });
  it('another signed-in customer cannot confirm someone else\'s payment', async () => {
    const rp = await started();
    providerPays(rp);
    const r = await verify(verifyBody(O1, rp, RP_PAY), asB());
    expect(r.status).toBe(404);
    expect(orders[0].status).toBe('placed');
  });
  it('payment received after the order was cancelled is flagged for refund, never marked paid', async () => {
    const rp = await started();
    orders[0].status = 'cancelled';
    pays[0].status = 'failed';
    providerPays(rp);
    pays[0].status = 'created'; // the attempt was still open when the order was cancelled elsewhere
    const r = await verify(verifyBody(O1, rp, RP_PAY));
    expect(r.body.state).toBe('review');
    expect(orders[0].status).toBe('cancelled');
    expect(pays[0].flagged).toBe('order_not_open');
    expect(audits.map((a) => a.action)).toContain('payment_order_not_open');
  });
  it('a late webhook-style capture found by reconciliation settles an order the customer saw as processing', async () => {
    const rp = await started();
    providerPays(rp, { status: 'authorized' });
    expect((await verify(verifyBody(O1, rp, RP_PAY))).body.state).toBe('processing');
    rpPayments[0].status = 'captured';
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.body).toMatchObject({ paidFound: 1, expired: 0 });
    expect(orders[0].status).toBe('paid');
    expect(released).toHaveLength(0);
  });
});

describe('status and cancel', () => {
  it('reports the state of the member\'s own order', async () => {
    expect((await call('status', { cookie: asA(), body: { orderId: O1 } })).body.state).toBe('unpaid');
    const rp = await started();
    providerPays(rp);
    await verify(verifyBody(O1, rp, RP_PAY));
    const s = await call('status', { cookie: asA(), body: { orderId: O1 } });
    expect(s.body.state).toBe('paid');
    expect(JSON.stringify(s.body)).not.toMatch(/Asha|a@example|9876543210/);
  });
  it('cancels an unpaid order and releases its stock, and repeating is harmless', async () => {
    await started();
    const a = await call('cancel', { cookie: asA(), body: { orderId: O1 } });
    expect(a.body.state).toBe('cancelled');
    expect(released).toEqual([O1]);
    const b = await call('cancel', { cookie: asA(), body: { orderId: O1 } });
    expect(b.status).toBe(200);
    expect(released).toEqual([O1]);
    expect(pays[0].status).toBe('failed');
  });
  it('will not cancel while a payment is authorised or captured', async () => {
    await started();
    pays[0].status = 'authorized';
    const r = await call('cancel', { cookie: asA(), body: { orderId: O1 } });
    expect(r.status).toBe(409);
    expect(orders[0].status).toBe('placed');
    expect(released).toHaveLength(0);
  });
  it('cannot cancel a paid order from here', async () => {
    orders[0].status = 'paid';
    expect((await call('cancel', { cookie: asA(), body: { orderId: O1 } })).status).toBe(409);
  });
});

describe('reconcile: expiry and late payments', () => {
  it('needs the scheduler secret and otherwise looks like a missing page', async () => {
    for (const auth of [null, 'Bearer nope', `bearer ${CRON}`, CRON, `Bearer ${CRON}x`]) {
      const r = await cron(auth);
      expect(r.status).toBe(404);
    }
    delete process.env.CRON_SECRET;
    expect((await cron(`Bearer ${CRON}`)).status).toBe(404);
    process.env.CRON_SECRET = 'short';
    expect((await cron('Bearer short')).status).toBe(404);
  });
  it('releases stock held by an unpaid order whose window ended, and leaves current orders alone', async () => {
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ checked: 1, expired: 1, paidFound: 0, deferred: 0 });
    expect(orders[0].status).toBe('cancelled');
    expect(released).toEqual([O1]);
    expect(orders[1].status).toBe('placed');
  });
  it('waits out the grace period before expiring', async () => {
    orders[0].pay_by = minsAgo(1);
    expect((await cron()).body.expired).toBe(0);
    expect(orders[0].status).toBe('placed');
  });
  it('marks the order paid, not cancelled, when Razorpay shows it was captured', async () => {
    const rp = await started();
    providerPays(rp);
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.body).toMatchObject({ paidFound: 1, expired: 0 });
    expect(orders[0].status).toBe('paid');
    expect(released).toHaveLength(0);
    expect(cartCleared).toEqual([M_A]);
  });
  it('keeps the stock held (deferred) when Razorpay cannot be asked', async () => {
    await started();
    orders[0].pay_by = minsAgo(10);
    rpDown = true;
    const r = await cron();
    expect(r.body).toMatchObject({ deferred: 1, expired: 0 });
    expect(orders[0].status).toBe('placed');
    expect(released).toHaveLength(0);
  });
  it('holds an order whose payment was authorised recently: no expiry, stock kept (KH6-012)', async () => {
    await started();
    pays[0].status = 'authorized';
    pays[0].authorized_at = Date.now() - 60 * 60000; // authorised an hour ago
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.body).toMatchObject({ checked: 0, expired: 0, deferred: 0 });
    expect(orders[0].status).toBe('placed');
    expect(released).toHaveLength(0);
  });
  it('expires an order whose authorised payment has been silent for over 24 hours (KH6-012)', async () => {
    await started();
    pays[0].status = 'authorized';
    pays[0].authorized_at = Date.now() - 25 * 3600 * 1000;
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.body).toMatchObject({ checked: 1, expired: 1 });
    expect(orders[0].status).toBe('cancelled');
    expect(released).toEqual([O1]);
  });
  it('counts a hold the database applies at the last moment as deferred, not expired (KH6-012)', async () => {
    await started();
    pays[0].status = 'authorized';
    pays[0].authorized_at = Date.now();
    orders[0].pay_by = minsAgo(10);
    dueIgnoresHold = true;
    const r = await cron();
    expect(r.body).toMatchObject({ checked: 1, expired: 0, deferred: 1 });
    expect(orders[0].status).toBe('placed');
    expect(released).toHaveLength(0);
  });
  it('flags a captured amount that does not match instead of paying the order', async () => {
    const rp = await started();
    providerPays(rp, { amount: 5 });
    orders[0].pay_by = minsAgo(10);
    await cron();
    expect(pays[0].flagged).toBe('amount_mismatch');
    expect(orders[0].status).not.toBe('paid');
  });
  it('still works with every flag off or in production, and returns counts only', async () => {
    process.env.VERCEL_ENV = 'production';
    orders[0].pay_by = minsAgo(10);
    const r = await cron();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['checked', 'deferred', 'expired', 'paidFound', 'status']);
    expect(JSON.stringify(r.body)).not.toContain(O1);
  });
  it('is idempotent: running twice expires once', async () => {
    orders[0].pay_by = minsAgo(10);
    await cron();
    const again = await cron();
    expect(again.body.checked).toBe(0);
    expect(released).toEqual([O1]);
  });
});

describe('what reaches the browser and the logs', () => {
  it('never returns secrets or internal ids in any payment response', async () => {
    const rp = await started();
    providerPays(rp);
    const bodies = [await pay(), await verify(verifyBody(O1, rp, RP_PAY)), await call('status', { cookie: asA(), body: { orderId: O1 } })].map((r) => JSON.stringify(r.body));
    for (const b of bodies) {
      expect(b).not.toContain(KEY_SECRET);
      expect(b).not.toContain('service-key-secret');
      expect(b).not.toContain(CRON);
    }
  });
  it('audit rows hold ids and amounts, not customer details', async () => {
    const rp = await started();
    providerPays(rp, { amount: 100 });
    await verify(verifyBody(O1, rp, RP_PAY));
    await verify(verifyBody(O1, rp, RP_PAY, sigFor(rp, RP_PAY, 'wrong-secret-entirely')));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toMatch(/Asha|a@example|9876543210|Varanasi/);
  });
});
