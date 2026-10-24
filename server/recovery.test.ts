import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMarketingState, redeemRestoreToken, runRecoveryJob, setCartReminders, unsubscribeFromEmail } from './recovery.js';
import { newRestoreToken } from './recoveryToken.js';
import type { MailConfig } from './mail.js';

const DB = { url: 'https://db.test', serviceKey: 'svc' };
const MAIL: MailConfig = { apiKey: 'k', from: 'Kaayra Herbals <no-reply@kaayra.test>', ownerTo: null, replyTo: 'help@kaayra.test', autoReply: true };
const ENV = { SUBSCRIBE_TOKEN_SECRET: 'worker-test-secret-0123456789-abcdefghij', SITE_URL: 'https://kaayra.test', VITE_LEGAL_ENTITY_NAME: 'Kaayra Herbals Private Limited' };
const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V = '11111111-1111-4111-8111-111111111111';
const MSG = '99999999-9999-4999-8999-999999999999';
const CYC = '88888888-8888-4888-8888-888888888888';
const real = globalThis.fetch;

interface World { settings: Record<string, unknown>; claim: unknown[]; preflight: Record<string, unknown>; product: { status: string; price: number; stock: number }; resend: number; }
let w: World;
let rpcs: { fn: string; args: Record<string, any> }[];
let sends: { body: any; headers: Record<string, string> }[];
let paths: string[];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OK_PF = { ok: true, cycle_id: CYC, member_id: M, step: 1, email: 'asha@example.org', name: 'Asha Verma', settings_ttl_hours: 168 };

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.resend.com') {
      sends.push({ body: JSON.parse(init!.body!), headers: init!.headers! });
      return w.resend === 200 ? json(200, { id: 'prov_1' }) : json(w.resend, { message: 'to asha@example.org rejected' });
    }
    const path = url.pathname.replace('/rest/v1/', '');
    paths.push(path);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      const args = init?.body ? JSON.parse(init.body) : {};
      rpcs.push({ fn, args });
      if (fn === 'cart_recovery_sync') return json(200, { closed: 2, attributed: 1, purged: 0 });
      if (fn === 'cart_recovery_detect') return json(200, 3);
      if (fn === 'cart_recovery_claim') { const rows = w.claim; w.claim = []; return json(200, rows); }
      if (fn === 'cart_recovery_preflight') return json(200, w.preflight);
      if (fn === 'marketing_opt_in') return json(200, { result: 'ok' });
      return json(200, null);
    }
    if (path === 'cart_recovery_settings') return json(200, [w.settings]);
    if (path === 'carts') return json(200, [{ cart_items: [{ variant_id: V, qty: 2 }] }]);
    if (path === 'product_variants') return json(200, [{ id: V, pack_size: '200 ml', price_paise: w.product.price, gst_rate: 12, hsn_code: '3004', status: 'active', products: { status: w.product.status, public_name: 'Tulsi syrup', internal_name: 'x' } }]);
    if (path === 'inventory_batches') return json(200, [{ variant_id: V, qty_on_hand: w.product.stock, qty_reserved: 0 }]);
    if (path === 'email_outbox') return json(201, null);
    if (path === 'members') return json(200, [{ email: 'asha@example.org' }]);
    if (path === 'marketing_preferences') return json(200, [{ cart_reminders: true }]);
    return json(404, {});
  }) as typeof fetch;
}
const row = (n = 1, id = MSG) => ({ id, cycle_id: CYC, step: n, member_id: M, idempotency_key: `cart-recovery:${CYC}:${n}`, attempts: 1 });
const finishes = () => rpcs.filter((r) => r.fn === 'cart_recovery_finish').map((r) => r.args);
const run = () => runRecoveryJob(DB, MAIL, { env: ENV });

beforeEach(() => {
  w = { settings: { enabled: true, paused: false, batch_size: 25 }, claim: [row()], preflight: OK_PF, product: { status: 'APPROVED_FOR_SALE', price: 49900, stock: 20 }, resend: 200 };
  rpcs = []; sends = []; paths = [];
  install();
});
afterEach(() => { globalThis.fetch = real; });

describe('switches', () => {
  it('disabled: housekeeping runs, nothing is detected, claimed or sent', async () => {
    w.settings = { enabled: false };
    const r = await run();
    expect(r.status).toBe('disabled');
    expect(r.closed).toBe(2);
    expect(rpcs.map((x) => x.fn)).toEqual(['cart_recovery_sync']);
    expect(sends).toHaveLength(0);
  });
  it('paused (campaign pause): nothing is detected, claimed or sent', async () => {
    w.settings = { enabled: true, paused: true };
    expect((await run()).status).toBe('paused');
    expect(rpcs.map((x) => x.fn)).toEqual(['cart_recovery_sync']);
    expect(sends).toHaveLength(0);
  });
  it('missing email provider: no cycles opened, nothing claimed, nothing marked failed', async () => {
    const r = await runRecoveryJob(DB, null, { env: ENV });
    expect(r.status).toBe('mail_not_configured');
    expect(rpcs.map((x) => x.fn)).toEqual(['cart_recovery_sync']);
  });
  it('missing link configuration behaves the same', async () => {
    const r = await runRecoveryJob(DB, MAIL, { env: { SITE_URL: 'https://kaayra.test' } });
    expect(r.status).toBe('mail_not_configured');
    expect(sends).toHaveLength(0);
  });
});

describe('a normal reminder', () => {
  it('re-checks, re-prices, issues a hashed token, sends once with a fixed idempotency key, records sent', async () => {
    const r = await run();
    expect(r).toMatchObject({ status: 'ok', detected: 3, claimed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(rpcs.map((x) => x.fn)).toEqual(['cart_recovery_sync', 'cart_recovery_detect', 'cart_recovery_claim', 'cart_recovery_preflight', 'cart_recovery_issue_token', 'cart_recovery_finish']);
    const tok = rpcs.find((x) => x.fn === 'cart_recovery_issue_token')!.args;
    expect(tok.p_hash).toMatch(/^[0-9a-f]{64}$/);
    const mail = sends[0]!;
    expect(mail.body.to).toEqual(['asha@example.org']);
    expect(mail.body.subject).toBe('Your Kaayra Herbals cart is waiting 🌿');
    expect(mail.headers['Idempotency-Key']).toBe(`kaayra-cart-recovery-${MSG}`);
    const plainToken = /recover=([A-Za-z0-9_-]{43})/.exec(mail.body.text)![1]!;
    expect(JSON.stringify(rpcs)).not.toContain(plainToken); // the database only ever sees the hash
    expect(mail.body.text).toContain('₹998');
    expect(mail.body.headers['List-Unsubscribe']).toContain('/api/cart/unsubscribe?u=');
    expect(finishes()).toEqual([{ p_message: MSG, p_status: 'sent', p_reason: null, p_provider: 'prov_1' }]);
  });
  it('shows the CURRENT price after a price change', async () => {
    w.product.price = 54900;
    await run();
    expect(sends[0]!.body.text).toContain('₹1,098');
    expect(sends[0]!.body.text).not.toContain('₹998');
  });
  it('reduces the shown quantity when stock fell', async () => {
    w.product.stock = 1;
    await run();
    expect(sends[0]!.body.text).toMatch(/qty 1 \(reduced/);
  });
  it('sends the right subject for steps 2 and 3', async () => {
    w.claim = [row(2)]; w.preflight = { ...OK_PF, step: 2 };
    await run();
    expect(sends[0]!.body.subject).toBe('Still thinking about your Kaayra picks?');
    w.claim = [row(3, '77777777-7777-4777-8777-777777777777')]; w.preflight = { ...OK_PF, step: 3 };
    await run();
    expect(sends[1]!.body.subject).toBe('Your saved Kaayra Herbals items');
  });
});

describe('refusals before sending', () => {
  for (const reason of ['no_consent', 'suppressed', 'purchased', 'cycle_closed', 'duplicate', 'member_limit', 'cart_changed']) {
    it(`${reason}: skipped, no email, no token`, async () => {
      w.preflight = { ok: false, reason };
      const r = await run();
      expect(r.skipped).toBe(1);
      expect(sends).toHaveLength(0);
      expect(rpcs.some((x) => x.fn === 'cart_recovery_issue_token')).toBe(false);
      expect(finishes()[0]).toMatchObject({ p_status: 'skipped', p_reason: reason });
    });
  }
  for (const reason of ['checkout_active', 'min_gap']) {
    it(`${reason}: postponed, not consumed`, async () => {
      w.preflight = { ok: false, defer: true, reason };
      const r = await run();
      expect(r.deferred).toBe(1);
      expect(sends).toHaveLength(0);
      expect(finishes()[0]).toMatchObject({ p_status: 'scheduled', p_reason: reason });
    });
  }
  it('nothing buyable any more (product unpublished): skipped, no email', async () => {
    w.product.status = 'DRAFT';
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(sends).toHaveLength(0);
    expect(finishes()[0]).toMatchObject({ p_status: 'skipped', p_reason: 'nothing_available' });
  });
  it('out of stock: skipped', async () => {
    w.product.stock = 0;
    await run();
    expect(finishes()[0]).toMatchObject({ p_reason: 'nothing_available' });
  });
});

describe('delivery failures', () => {
  it('a provider outage is recorded as failed (the database retries it later) and logs no address', async () => {
    w.resend = 503;
    const logs: string[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
    const r = await run();
    console.error = orig;
    expect(r.failed).toBe(1);
    expect(finishes()[0]).toMatchObject({ p_status: 'failed', p_reason: 'http_503' });
    expect(logs.join(' ')).not.toContain('asha@example.org');
  });
  it('a permanent provider rejection (4xx) is skipped, not retried', async () => {
    w.resend = 422;
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(finishes()[0]).toMatchObject({ p_status: 'skipped' });
  });
  it('an unexpected error returns the reminder for a retry instead of losing it', async () => {
    w.preflight = null as never;
    const orig = console.error; console.error = () => {};
    const r = await run();
    console.error = orig;
    expect(r.failed).toBe(1);
    expect(finishes()[0]).toMatchObject({ p_status: 'failed', p_reason: 'worker_error' });
  });
});

describe('concurrent workers', () => {
  it('two passes at once send one email: the database hands the row to only one of them', async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(1);
    expect(sends).toHaveLength(1);
  });
  it('a re-claimed row uses the same provider idempotency key', async () => {
    await run();
    w.claim = [row()];
    await run();
    expect(sends[0]!.headers['Idempotency-Key']).toBe(sends[1]!.headers['Idempotency-Key']);
  });
});

describe('restore, consent and unsubscribe helpers', () => {
  it('redeem rejects a malformed token without touching the database', async () => {
    expect(await redeemRestoreToken(DB, 'nope', M)).toBe('invalid');
    expect(rpcs).toHaveLength(0);
  });
  it('redeem sends only the token HASH and the signed-in member id', async () => {
    const t = newRestoreToken();
    await redeemRestoreToken(DB, t.token, M);
    expect(rpcs[0]!.args).toEqual({ p_hash: t.hash, p_member: M });
    expect(await redeemRestoreToken(DB, t.token, null)).toBe('invalid'); // mock returns null result -> invalid
    expect(rpcs[1]!.args.p_member).toBeNull();
  });
  it('turning reminders on records the wording version; off is a persistent unsubscribe', async () => {
    await setCartReminders(DB, M, 'asha@example.org', true);
    expect(rpcs[0]).toMatchObject({ fn: 'marketing_opt_in', args: { p_member: M, p_version: 'cart-reminders-v1', p_source: 'account_page' } });
    await setCartReminders(DB, M, 'asha@example.org', false);
    expect(rpcs[1]).toMatchObject({ fn: 'marketing_unsubscribe', args: { p_email: 'asha@example.org', p_source: 'account' } });
  });
  it('unsubscribe from an email link stops marketing for that member', async () => {
    await unsubscribeFromEmail(DB, M);
    expect(rpcs[0]).toMatchObject({ fn: 'marketing_unsubscribe', args: { p_source: 'recovery_email' } });
  });
  it('consent defaults to off when no preference row exists', async () => {
    expect((await getMarketingState(DB, 'not-a-uuid')).cartReminders).toBe(false);
  });
});
