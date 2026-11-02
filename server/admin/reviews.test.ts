import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../shared/roles.js';
import { can } from '../../shared/roles.js';
import { handleReviews } from './reviews.js';
import type { AdminCtx } from './ctx.js';

const real = globalThis.fetch;
const REV = '22222222-2222-4222-8222-222222222222';
const IMG = '55555555-5555-4555-8555-555555555555';
const RPT = '66666666-6666-4666-8666-666666666666';
let rpcs: { fn: string; args: Record<string, any> }[];
let audits: { action: string; detail?: Record<string, unknown> }[];
let urls: string[];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  rpcs = []; audits = []; urls = [];
  process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const u = new URL(String(input)); urls.push(u.pathname + u.search);
    if (u.pathname.includes('/rpc/')) { const fn = u.pathname.split('/rpc/')[1]; rpcs.push({ fn, args: JSON.parse(init?.body ?? '{}') }); return json(200, fn === 'review_moderate' ? { id: REV, status: 'HIDDEN' } : fn === 'review_reply_set' ? { edited: false } : fn === 'review_image_decide' ? { review: REV } : fn === 'review_analytics' ? { byProduct: [], byStatus: {}, trend: [], openReports: 0, moderation: {} } : {}); }
    if (u.pathname.endsWith('/product_reviews')) return new Response(JSON.stringify([{ id: REV, rating: 1, title: 'Bad', body: 'Packaging damaged', status: 'PUBLISHED', members: { name: 'Asha Verma', email: 'secret@example.org' }, review_replies: null, review_images: [], review_reports: [] }]), { status: 200, headers: { 'content-range': '0-0/1' } });
    return json(200, []);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

function ctx(role: AdminRole, method: string, query: Record<string, string>, body?: unknown) {
  const out = { status: 0, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, send() { return this; }, json(b: unknown) { out.body = b; return this; } };
  const c = {
    req: { method, query, body, headers: {} }, res, role, email: `${role}@kaayra.test`, commerceEnabled: true,
    cfg: { db: { url: 'https://db.test', serviceKey: 'k' }, roles: {}, admins: [] },
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return res; },
    audit: async (action: string, detail?: Record<string, unknown>) => { audits.push({ action, detail }); },
  } as unknown as AdminCtx;
  return { c, out };
}
const run = async (role: AdminRole, method: string, action: string, query: Record<string, string> = {}, body?: unknown) => { const x = ctx(role, method, { action, ...query }, body); const handled = await handleReviews(x.c, action); return { ...x.out, handled }; };

describe('review permissions', () => {
  it('owner and manager moderate and reply; support reads and replies but cannot moderate', () => {
    for (const r of ['owner', 'manager'] as const) for (const p of ['reviews.read', 'reviews.moderate', 'reviews.reply'] as const) expect(can(r, p)).toBe(true);
    expect(can('support', 'reviews.read')).toBe(true);
    expect(can('support', 'reviews.reply')).toBe(true);
    expect(can('support', 'reviews.moderate')).toBe(false);
  });
});

describe('admin review moderation', () => {
  it('ignores actions it does not own', async () => {
    expect((await run('owner', 'GET', 'products')).handled).toBe(false);
  });
  it('lists reviews showing only the customer first name, never email', async () => {
    const r = await run('support', 'GET', 'reviews', { status: 'PUBLISHED', rating: '1' });
    expect(r.status).toBe(200);
    expect(r.body.items[0].customer).toBe('Asha');
    expect(JSON.stringify(r.body)).not.toContain('secret@example.org');
    expect(urls.some((u) => u.includes('status=eq.PUBLISHED') && u.includes('rating=eq.1'))).toBe(true);
  });
  it('hide needs a reason and moderate permission, and is audited with the actor from the session', async () => {
    expect((await run('support', 'POST', 'review-moderate', {}, { review: REV, action: 'hide', reason: 'Contains a phone number' })).status).toBe(403);
    expect(rpcs).toHaveLength(0);
    expect((await run('manager', 'POST', 'review-moderate', {}, { review: REV, action: 'hide', reason: '' })).status).toBe(400);
    const ok = await run('manager', 'POST', 'review-moderate', {}, { review: REV, action: 'hide', reason: 'Contains a phone number', actor: 'attacker@x' });
    expect(ok.status).toBe(200);
    expect(rpcs[0].fn).toBe('review_moderate');
    expect(rpcs[0].args.p_actor).toBe('manager@kaayra.test');
    expect(audits.map((a) => a.action)).toContain('review_moderated');
  });
  it('has no way to change stars or text, and no delete', async () => {
    for (const action of ['review-edit', 'review-update', 'review-delete', 'review-rating']) expect((await run('owner', 'POST', action, {}, { review: REV, rating: 5, body: 'new text' })).handled).toBe(false);
    expect((await run('owner', 'POST', 'review-moderate', {}, { review: REV, action: 'edit', rating: 5 })).status).toBe(400);
    expect(rpcs).toHaveLength(0);
  });
  it('brand replies are stored through their own function with the author recorded and audited', async () => {
    expect((await run('support', 'POST', 'review-reply', {}, { review: REV, body: 'Thank you for sharing your feedback. Please contact support.' })).status).toBe(200);
    expect(rpcs[0]).toMatchObject({ fn: 'review_reply_set', args: { p_actor: 'support@kaayra.test' } });
    expect(audits.at(-1)?.action).toBe('review_replied');
    expect((await run('owner', 'POST', 'review-reply', {}, { review: REV, body: 'hi' })).status).toBe(400);
  });
  it('photo approval and report handling need moderate permission', async () => {
    expect((await run('support', 'POST', 'review-image-decide', {}, { image: IMG, approve: true })).status).toBe(403);
    expect((await run('owner', 'POST', 'review-image-decide', {}, { image: IMG, approve: true })).status).toBe(200);
    expect((await run('support', 'POST', 'review-report-handle', {}, { report: RPT, outcome: 'DISMISSED' })).status).toBe(403);
    expect((await run('manager', 'POST', 'review-report-handle', {}, { report: RPT, outcome: 'DELETE' })).status).toBe(400);
    expect((await run('manager', 'POST', 'review-report-handle', {}, { report: RPT, outcome: 'DISMISSED' })).status).toBe(200);
  });
  it('analytics are the database figures, with the window bounded', async () => {
    const r = await run('support', 'GET', 'review-analytics', { days: '99999' });
    expect(r.status).toBe(200);
    expect(rpcs[0].args.p_days).toBe(365);
  });
  it('rejects malformed ids and file names', async () => {
    expect((await run('owner', 'GET', 'review-events', { review: "x'; --" })).status).toBe(400);
    expect((await run('owner', 'GET', 'review-image', { file: '../secret' })).status).toBe(404);
  });
});
