import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/reviews/[action].js';
import { signToken } from '../oauth.js';

const SECRET = 'reviews-test-session-secret-0123456789-abcdef';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_SESSION_SECRET: SECRET };
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const M_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const M_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const M_F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const P1 = '11111111-1111-4111-8111-111111111111';
const R_A = '22222222-2222-4222-8222-222222222222';
const R_B = '33333333-3333-4333-8333-333333333333';
const FILE = '44444444-4444-4444-8444-444444444444.jpg';
let ip = 0;
let rpcCalls: { fn: string; args: Record<string, any> }[];
let rpcReply: (fn: string, args: Record<string, any>) => Response | null;
let stored: { path: string; body: Uint8Array }[];
let imageApproved = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const members = [
  { id: M_A, email: 'a@example.org', name: 'Asha V', role: 'member', has_password: true },
  { id: M_B, email: 'b@example.org', name: 'Ravi K', role: 'member', has_password: true },
  { id: M_C, email: 'c@example.org', name: 'Cara', role: 'member', has_password: true },
  { id: M_D, email: 'd@example.org', name: 'Dev', role: 'member', has_password: true },
  { id: M_E, email: 'e@example.org', name: 'Esha', role: 'member', has_password: true },
  { id: M_F, email: 'f@example.org', name: 'Farah', role: 'member', has_password: true },
];
const reviews = [{ id: R_A, member_id: M_A, status: 'PUBLISHED', review_images: [] }, { id: R_B, member_id: M_B, status: 'PUBLISHED', review_images: [] }];

beforeEach(() => {
  rpcCalls = [];
  stored = [];
  rpcReply = () => null;
  imageApproved = true;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown; method?: string }) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/storage/v1/object/review-images/')) {
      if (init?.method === 'POST') { stored.push({ path: url.pathname, body: init.body as Uint8Array }); return json(200, {}); }
      if (init?.method === 'DELETE') return json(200, {});
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
    }
    const path = url.pathname.replace('/rest/v1/', '');
    const q = (k: string) => (url.searchParams.get(k) ?? '').replace(/^eq\./, '');
    if (path === 'members') return json(200, members.filter((m) => m.email === q('email')));
    if (path === 'public_products') return json(200, q('slug') === 'tulsi-syrup' ? [{ slug: 'tulsi-syrup' }] : []);
    if (path === 'products') return json(200, q('slug') === 'tulsi-syrup' ? [{ id: P1 }] : []);
    if (path === 'product_reviews') return json(200, reviews.filter((r) => r.id === q('id') && r.member_id === q('member_id')));
    if (path === 'review_images' && init?.method === 'POST') return json(201, {});
    if (path === 'review_images') return json(200, imageApproved ? [{ id: 'x' }] : []);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      const args = JSON.parse(String(init?.body ?? '{}'));
      if (fn === 'rate_limit_hit') return json(200, false);
      rpcCalls.push({ fn, args });
      const custom = rpcReply(fn, args);
      if (custom) return custom;
      if (fn === 'review_submit') return json(200, { id: R_A, status: 'PUBLISHED' });
      if (fn === 'review_update_own') return json(200, { id: R_A, status: 'PUBLISHED' });
      if (fn === 'review_stats') return json(200, { count: 2, average: 4.5, distribution: { '5': 1, '4': 1, '3': 0, '2': 0, '1': 0 } });
      if (fn === 'review_public_list') return json(200, { items: [{ id: R_A, rating: 5, title: 'Good', body: 'Nice', name: 'Asha', verified: true }] });
      if (fn === 'review_eligible_items') return json(200, [{ order_item_id: 'i' }]);
      return json(200, { ok: true });
    }
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const cookieFor = (email: string) => signToken('user', { email, name: 'N', role: 'member' }, SECRET, 3600);
function call(action: string, opts: { method?: string; query?: Record<string, string>; email?: string | null; body?: unknown; csrf?: boolean } = {}) {
  ip++;
  const method = opts.method ?? (['submit', 'update', 'withdraw', 'report', 'upload-image'].includes(action) ? 'POST' : 'GET');
  const headers: Record<string, string> = { host: 'x.test', origin: 'https://x.test', 'x-forwarded-for': `10.8.${ip >> 8}.${ip & 255}` };
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const req = { method, headers, query: { action, ...(opts.query ?? {}) }, body: opts.body, cookies: opts.email === null ? {} : { kaayra_user: cookieFor(opts.email ?? 'a@example.org') } } as never;
  const out = { status: 200, body: undefined as any, headers: {} as Record<string, string>, sent: undefined as unknown };
  const res = { setHeader(k: string, v: string) { out.headers[k] = v; }, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; }, send(b: unknown) { out.sent = b; return this; }, end() { return this; } } as never;
  return (handler as (a: never, b: never) => Promise<unknown>)(req, res).then(() => out);
}
const good = { product: 'tulsi-syrup', rating: 5, title: 'Very good syrup', body: 'Used it daily for a month and the taste is pleasant.' };
const jpeg = (n = 0) => Buffer.from(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, ...new Array(n).fill(0), 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])).toString('base64');

describe('public reviews API', () => {
  it('lists stats and a bounded page for a publicly approved product, with no private fields', async () => {
    const r = await call('list', { email: null, query: { product: 'tulsi-syrup', rating: '9', sort: 'drop', page: '99999' } });
    expect(r.status).toBe(200);
    expect(r.body.stats.count).toBe(2);
    const list = rpcCalls.find((c) => c.fn === 'review_public_list')!.args;
    expect(list.p_limit).toBe(10);
    expect(list.p_rating).toBeNull();
    expect(list.p_sort).toBe('recent');
    expect(list.p_offset).toBe(4990);
    expect(JSON.stringify(r.body)).not.toMatch(/email|phone|address|order_no|member_id/i);
  });
  it('404s an unknown, unapproved or malformed product slug', async () => {
    expect((await call('list', { email: null, query: { product: 'draft-product' } })).status).toBe(404);
    expect((await call('list', { email: null, query: { product: "x'; drop table--" } })).status).toBe(404);
  });
  it('does not accept POST on list or GET on submit', async () => {
    expect((await call('list', { method: 'POST', email: null })).status).toBe(405);
    expect((await call('submit', { method: 'GET' })).status).toBe(405);
  });
});

describe('submitting a review', () => {
  it('refuses an anonymous visitor and requires the CSRF header', async () => {
    expect((await call('submit', { email: null, body: good })).status).toBe(401);
    expect((await call('submit', { body: good, csrf: false })).status).toBe(403);
    expect(rpcCalls.filter((c) => c.fn === 'review_submit')).toHaveLength(0);
  });
  it('rejects invalid star ratings and bad text before the database is called', async () => {
    for (const rating of [0, 6, -2, 3.5, '5', null]) expect((await call('submit', { body: { ...good, rating } })).status).toBe(400);
    expect((await call('submit', { body: { ...good, title: 'ab' } })).status).toBe(400);
    expect(rpcCalls.filter((c) => c.fn === 'review_submit')).toHaveLength(0);
  });
  it('uses the signed-in customer, ignoring a forged member, order, verified flag or status in the body', async () => {
    const r = await call('submit', { email: 'a@example.org', body: { ...good, member_id: M_B, order_item_id: 'forged', verified_purchase: true, status: 'PUBLISHED', order: 'KH-2026-000009' } });
    expect(r.status).toBe(201);
    const args = rpcCalls.find((c) => c.fn === 'review_submit')!.args;
    expect(args.p_member).toBe(M_A);
    expect(Object.keys(args).sort()).toEqual(['p_body', 'p_flags', 'p_has_images', 'p_member', 'p_product', 'p_rating', 'p_title']);
    expect(args.p_product).toBe(P1);
    expect(args.p_has_images).toBe(false);
  });
  it('strips HTML before storing', async () => {
    await call('submit', { body: { ...good, title: '<img src=x onerror=alert(1)>Lovely', body: 'Works <script>alert(1)</script> well for me, taste is ok.' } });
    const args = rpcCalls.find((c) => c.fn === 'review_submit')!.args;
    expect(args.p_title).toBe('Lovely');
    expect(args.p_body).not.toMatch(/[<>]/);
  });
  it('passes safety flags so unsafe health claims are held for a person', async () => {
    await call('submit', { body: { ...good, body: 'This cured my diabetes and I stopped my insulin completely.' } });
    expect(rpcCalls.find((c) => c.fn === 'review_submit')!.args.p_flags).toEqual(expect.arrayContaining(['cure_claim', 'stop_medication']));
  });
  it('reports a held review as held, a published one as not held', async () => {
    rpcReply = (fn) => (fn === 'review_submit' ? json(200, { id: R_A, status: 'PENDING' }) : null);
    const r = await call('submit', { body: good });
    expect(r.body.held).toBe(true);
    expect(r.body.reviewStatus).toBe('PENDING');
  });
  it('an ineligible purchase (not delivered, not paid, not theirs) is refused with 403', async () => {
    rpcReply = (fn) => (fn === 'review_submit' ? json(400, { message: 'KH:NOT_ELIGIBLE:x', code: 'P0001' }) : null);
    const r = await call('submit', { body: good });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/delivered, paid order/);
  });
  it('a duplicate (unique violation) is a 409, and concurrent submits give one success and one refusal', async () => {
    let n = 0;
    rpcReply = (fn) => (fn === 'review_submit' ? (n++ === 0 ? null : json(400, { message: 'KH:NOT_ELIGIBLE:x' })) : null);
    const [a, b] = await Promise.all([call('submit', { email: 'c@example.org', body: good }), call('submit', { email: 'c@example.org', body: good })]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    rpcReply = (fn) => (fn === 'review_submit' ? json(409, { code: '23505', message: 'duplicate key' }) : null);
    expect((await call('submit', { email: 'd@example.org', body: good })).status).toBe(409);
  });
  it('a database failure shows a generic message, never SQL details', async () => {
    rpcReply = (fn) => (fn === 'review_submit' ? json(500, { message: 'relation "orders" has secret row a@example.org', code: 'XX000' }) : null);
    const r = await call('submit', { email: 'b@example.org', body: good });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('example.org');
  });
});

describe('editing, withdrawing and reporting', () => {
  it('edits only through the signed-in customer id (cross-customer edit is refused by the database as not found)', async () => {
    rpcReply = (fn, a) => (fn === 'review_update_own' && a.p_member !== M_E ? json(400, { message: 'KH:NOT_FOUND:review not found' }) : null);
    expect((await call('update', { email: 'e@example.org', body: { review: R_A, rating: 4, title: 'Updated title', body: 'Updated review text is here.' } })).status).toBe(200);
    expect((await call('update', { email: 'b@example.org', body: { review: R_A, rating: 1, title: 'Hijacked title', body: 'Not my review at all really.' } })).status).toBe(404);
    expect(rpcCalls.every((c) => c.fn !== 'review_update_own' || c.args.p_member !== 'forged')).toBe(true);
  });
  it('withdraw and delete of another customer\'s review is refused', async () => {
    rpcReply = (fn, a) => (fn === 'review_withdraw_own' && a.p_member !== M_F ? json(400, { message: 'KH:NOT_FOUND:x' }) : null);
    expect((await call('withdraw', { email: 'b@example.org', body: { review: R_A } })).status).toBe(404);
    expect((await call('withdraw', { email: 'f@example.org', body: { review: R_A } })).status).toBe(200);
    expect((await call('withdraw', { email: 'f@example.org', body: { review: 'not-a-uuid' } })).status).toBe(400);
  });
  it('validates the report reason and gives the same answer for a repeat report', async () => {
    expect((await call('report', { email: 'b@example.org', body: { review: R_A, reason: 'because' } })).status).toBe(400);
    const a = await call('report', { email: 'b@example.org', body: { review: R_A, reason: 'spam' } });
    const b = await call('report', { email: 'b@example.org', body: { review: R_A, reason: 'spam' } });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(rpcCalls.find((c) => c.fn === 'review_report_add')!.args.p_reporter).toBe(M_B);
  });
  it('an anonymous visitor cannot report', async () => {
    expect((await call('report', { email: null, body: { review: R_A, reason: 'spam' } })).status).toBe(401);
  });
  it('report abuse is rate limited per customer', async () => {
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await call('report', { email: 'c@example.org', body: { review: R_A, reason: 'spam' } })).status;
    expect(last).toBe(429);
  });
});

describe('review photo uploads', () => {
  it('stores a valid photo with metadata removed, under a random name, as PENDING approval', async () => {
    const r = await call('upload-image', { email: 'a@example.org', body: { review: R_A, data: `data:image/jpeg;base64,${jpeg()}` } });
    expect(r.status).toBe(201);
    expect(stored).toHaveLength(1);
    expect(stored[0].path).toMatch(/review-images\/[0-9a-f-]{36}\.jpg$/);
    expect(Buffer.from(stored[0].body).includes(Buffer.from('Exif'))).toBe(false);
  });
  it('refuses executables, scripts, SVG and a renamed non-image', async () => {
    for (const text of ['MZ\x90\x00executable', '<?php system($_GET[1]); ?>', '<svg onload=alert(1)>', 'GIF89a....']) {
      const r = await call('upload-image', { email: 'a@example.org', body: { review: R_A, data: Buffer.from(text).toString('base64') } });
      expect(r.status).toBe(400);
    }
    expect(stored).toHaveLength(0);
  });
  it('refuses an oversized photo and bad base64', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2_100_000)]).toString('base64');
    expect((await call('upload-image', { email: 'a@example.org', body: { review: R_A, data: big } })).status).toBe(400);
    expect((await call('upload-image', { email: 'a@example.org', body: { review: R_A, data: '!!!not base64***' } })).status).toBe(400);
    expect(stored).toHaveLength(0);
  });
  it('does not let a customer attach a photo to someone else\'s review', async () => {
    const r = await call('upload-image', { email: 'b@example.org', body: { review: R_A, data: jpeg() } });
    expect(r.status).toBe(404);
    expect(stored).toHaveLength(0);
  });
  it('serves a photo publicly only while approved on a published review', async () => {
    const ok = await call('image', { email: null, query: { file: FILE } });
    expect(ok.status).toBe(200);
    expect(ok.headers['Content-Type']).toBe('image/jpeg');
    expect(ok.headers['X-Content-Type-Options']).toBe('nosniff');
    imageApproved = false;
    expect((await call('image', { email: null, query: { file: FILE } })).status).toBe(404);
    expect((await call('image', { email: null, query: { file: '../../etc/passwd' } })).status).toBe(404);
  });
});

describe('eligibility lookup', () => {
  it('needs sign-in and uses only the cookie identity', async () => {
    expect((await call('mine', { email: null, query: { product: 'tulsi-syrup' } })).status).toBe(401);
    await call('mine', { email: 'a@example.org', query: { product: 'tulsi-syrup', member: M_B } });
    expect(rpcCalls.find((c) => c.fn === 'review_eligible_items')!.args.p_member).toBe(M_A);
  });
});
