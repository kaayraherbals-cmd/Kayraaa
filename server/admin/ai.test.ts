import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../shared/roles.js';
import { loadAiConfig, type AiConfig } from '../ai/config.js';
import type { Transport } from '../ai/gemini.js';
import { loadSnapshot } from '../ai/data.js';
import { handleAi } from './ai.js';
import type { AdminConfig, AdminCtx } from './ctx.js';

interface Call { method: string; url: string; body: any }
let calls: Call[];
let audits: { action: string; detail?: Record<string, unknown> }[];
let reserve: 'ok' | 'limit' | 'missing';
let limiter: 'ok' | 'limited' | 'broken';
let draftRow: { flags: string[]; body: string };
const real = globalThis.fetch;
const NOW = Date.parse('2026-10-22T10:00:00Z');
const PID = '22222222-2222-4222-8222-222222222222';
const DID = '33333333-3333-4333-8333-333333333333';
const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const summary = { orders: 3, units: 4, gross_sales_paise: 300000, discount_paise: 0, net_incl_tax_paise: 300000, gst_paise: 0, shipping_charged_paise: 0, cogs_paise: 0, units_with_cost: 0, units_without_cost: 4, refund_count: 1, refund_paise: 50000, fee_paise: 0, fee_orders: 0, ship_cost_confirmed_paise: 0, ship_cost_estimated_paise: 0, ship_cost_orders: 0, online_orders: 3, shipped_orders: 0, expenses: {}, cancelled_paid_without_refund: 0 };
const created = (h: number) => new Date(Date.parse('2026-10-22T00:00:00+05:30') + h * 3_600_000).toISOString();

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv'; delete process.env.RATE_LIMIT_SHARED;
  limiter = 'ok'; calls = []; audits = []; reserve = 'ok'; draftRow = { flags: [], body: 'A calm herbal syrup.' };
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = decodeURIComponent(String(input)); const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.includes('/rpc/rate_limit_hit')) return limiter === 'broken' ? json(500, {}) : json(200, limiter === 'limited');
    if (url.includes('/rpc/ai_usage_reserve')) return reserve === 'missing' ? json(404, { code: 'PGRST202' }) : json(200, reserve === 'ok');
    if (url.includes('/rpc/ai_usage_add_tokens')) return json(200, null);
    if (url.includes('/rpc/finance_period_summary')) return json(200, summary);
    if (url.includes('/rpc/finance_refund_impact')) return json(200, { pending_paise: 0, by_reason: [], by_month: [] });
    if (url.includes('/rpc/finance_inventory_valuation')) return json(200, { as_of: '2026-10-22', cost_value_paise: 0, units_without_cost: 5, expired_units: 0, expiring_units: 2, expiry_window_days: 90, low_stock_variants: 1, slow_units: 0, slow_window_days: 90 });
    if (url.includes('/rpc/finance_daily_series')) return json(200, []);
    if (url.includes('/orders?select=id,status,channel')) return json(200, [
      { id: 'o1', status: 'paid', channel: 'online', total_paise: 49900, ship_pincode: '110001', created_at: created(2) },
      { id: 'o2', status: 'delivered', channel: 'online', total_paise: 29900, ship_pincode: '110001', created_at: created(5) },
      { id: 'o3', status: 'cancelled', channel: 'online', total_paise: 12300, ship_pincode: '110001', created_at: created(6) },
    ]);
    if (url.includes('/shipping_pincodes')) return json(200, []);
    if (url.includes('/order_items')) return json(200, [{ order_id: 'o1', variant_id: 'v1', product_name: 'Tulsi Syrup', qty: 2, line_total_paise: 49900 }, { order_id: 'o2', variant_id: 'v1', product_name: 'Tulsi Syrup', qty: 1, line_total_paise: 29900 }]);
    if (url.includes('/product_variants')) return json(200, [{ id: 'v1', pack_size: '200 ml', price_paise: 24950, low_stock_threshold: 10, products: { internal_name: 'Tulsi Syrup', public_name: null } }]);
    if (url.includes('/inventory_batches')) return json(200, [{ variant_id: 'v1', status: 'active', expiry_date: '2027-12-31', qty_on_hand: 4, qty_reserved: 0 }]);
    if (url.includes('select=id&is_test')) return json(200, [], { 'content-range': '*/4' });
    if (url.includes('/shipments?')) return json(200, [{ shipment_no: 'KS-1', status: 'in_transit', estimated_delivery: '2026-10-19', dispatched_at: null }]);
    if (url.includes('/order_refunds?')) return json(200, [{ status: 'requested' }, { status: 'approved' }]);
    if (url.includes('/order_payments?')) return json(200, [], { 'content-range': '*/1' });
    if (url.includes('/products?select=internal_name')) return json(200, [{ internal_name: 'Tulsi Syrup', public_name: 'Tulsi Syrup', form: 'Syrup', pack_size: '200 ml', ingredients: ['Tulsi'], composition_verified: false, public_description: null }]);
    if (url.includes('/ai_drafts?select=flags,body')) return json(200, [draftRow]);
    if (url.includes('/ai_drafts') && (method === 'POST' || method === 'PATCH')) return json(200, [{ id: DID, ...body }]);
    if (url.includes('/ai_briefings')) return json(200, []);
    return json(200, []);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

const ready = (over: Record<string, string> = {}): AiConfig => loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: 'k', ...over });
let sent: string[];
const reply = (obj: unknown): Transport => async (_c, r) => { sent.push(r.user); return { text: JSON.stringify(obj), inputTokens: 10, outputTokens: 5 }; };

function ctxFor(role: AdminRole, method: string, body?: unknown, email = 'owner@kaayra.in') {
  const out = { status: 0, body: undefined as any };
  const ctx = {
    req: { method, query: {}, body }, cfg: { db: { url: 'https://db.test', serviceKey: 'k' } } as unknown as AdminConfig,
    email, role, commerceEnabled: true,
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return {} as never; },
    audit: async (action: string, detail?: Record<string, unknown>) => { audits.push({ action, detail }); },
  } as unknown as AdminCtx;
  return { ctx, out };
}
async function run(role: AdminRole, action: string, method: string, body: unknown, deps: { cfg?: AiConfig; transport?: Transport } = {}, email?: string) {
  sent = [];
  const { ctx, out } = ctxFor(role, method, body, email);
  const handled = await handleAi(ctx, action, { cfg: deps.cfg ?? ready(), transport: deps.transport, now: NOW });
  return { handled, ...out };
}

describe('Kaayra Intelligence: access is enforced on the server', () => {
  it('ignores actions that are not AI actions', async () => {
    expect((await run('owner', 'orders', 'GET', undefined)).handled).toBe(false);
  });
  it('denies support and manager roles the owner assistant, audits it, and never calls Gemini', async () => {
    for (const role of ['support', 'manager'] as const) {
      const r = await run(role, 'ai-ask', 'POST', { question: 'How much revenue?' }, { transport: reply({ answer: 'x' }) });
      expect(r.status).toBe(403);
      expect(sent).toEqual([]);
    }
    expect(audits.filter((a) => a.action === 'permission_denied')).toHaveLength(2);
    expect((await run('manager', 'ai-snapshot', 'GET', undefined)).status).toBe(403);
    expect((await run('manager', 'ai-briefing', 'POST', {})).status).toBe(403);
  });
  it('lets an admin the owner named use it, but they still only see what their own role can read', async () => {
    const cfg = ready({ AI_INTELLIGENCE_EMAILS: 'ops@kaayra.in' });
    const r = await run('support', 'ai-snapshot', 'GET', undefined, { cfg }, 'ops@kaayra.in');
    expect(r.status).toBe(200);
    // Revenue and profit are owner-only: no finance figure is read or shown, whoever the owner authorises.
    expect(r.body.snapshot.finance).toBeUndefined();
    expect(r.body.snapshot.unavailableSections).toContain('finance and profit (owner only)');
    expect(calls.some((c) => c.url.includes('/rpc/finance'))).toBe(false);
  });
});

describe('financial accuracy: figures come from the finance and analytics services, not the model', () => {
  it('owner snapshot matches the existing Business Intelligence and Analytics definitions', async () => {
    const snap = await loadSnapshot({ url: 'https://db.test', serviceKey: 'k' }, 'owner', NOW);
    expect(snap.finance?.last30Days).toMatchObject({ netCollected: '₹2500.00', orders: 3, refundsPaid: '₹500.00', averageOrder: '₹1000.00', profitStatus: expect.stringMatching(/partial|unavailable/), netProfit: null });
    expect(snap.finance?.today.orders).toBe(3);
    expect(snap.finance?.last7Days.growthVsPrevious7Days).toBe('0.00%');
    expect(snap.sales).toMatchObject({ orders: 2, revenue: '₹798.00', averageOrder: '₹399.00', cancelled: 1, awaitingPayment: 4, paidToFulfil: 4 });
    expect(snap.sales?.topProducts[0]).toMatchObject({ name: 'Tulsi Syrup', units: 3 });
    expect(snap.inventory?.lowStock).toEqual([{ product: 'Tulsi Syrup', pack: '200 ml', units: 4 }]);
    expect(snap.operations?.shipments?.delayed).toEqual([{ shipment_no: 'KS-1', status: 'in_transit', daysLate: 3 }]);
    expect(snap.operations?.refundQueue).toEqual({ awaitingDecision: 1, approvedNotYetPaid: 1 });
    expect(snap.operations?.paymentsNeedingReview).toBe(1);
  });
  it('profit is never stated when cost data is incomplete', async () => {
    const snap = await loadSnapshot({ url: 'https://db.test', serviceKey: 'k' }, 'owner', NOW);
    expect(snap.finance?.last30Days.grossProfit).toBeNull();
    expect(snap.finance?.last30Days.gaps.length).toBeGreaterThan(0);
  });
  it('sends no personal data and no raw database keys to the model', async () => {
    const r = await run('owner', 'ai-ask', 'POST', { question: 'Summarise my business performance.' }, { transport: reply({ answer: 'Net collected was ₹2500.00.' }) });
    expect(r.status).toBe(200);
    expect(sent[0]).not.toMatch(/email|phone|address|service[_-]?key|ship_pincode/i);
    expect(calls.every((c) => !/select=[^&]*(email|phone|name,|address)/i.test(c.url) || !c.url.includes('/orders'))).toBe(true);
  });
  it('a section that fails is reported as unavailable, never filled in', async () => {
    const fail = globalThis.fetch;
    globalThis.fetch = (async (i: unknown, init?: never) => (String(i).includes('/rpc/finance_') ? json(500, { message: 'x' }) : fail(i as never, init))) as typeof fetch;
    const snap = await loadSnapshot({ url: 'https://db.test', serviceKey: 'k' }, 'owner', NOW);
    expect(snap.finance).toBeUndefined();
    expect(snap.unavailableSections.join(' ')).toMatch(/finance/);
    expect(snap.sales?.orders).toBe(2);
  });
});

describe('answers are checked before they are shown', () => {
  it('returns an answer whose numbers all come from the verified figures', async () => {
    const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'Net collected over 30 days was ₹2500.00 from 3 orders.' }) });
    expect(r.body).toMatchObject({ status: 'ok' });
  });
  it('withholds an answer that contains a figure the server never supplied', async () => {
    const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'Revenue was ₹98765.00 this week.' }) });
    expect(r.body.status).toBe('unverified');
    expect(r.body.answer).toBeUndefined();
  });
  it('handles an unusable model reply with a safe message', async () => {
    const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: async () => ({ text: 'not json', inputTokens: 1, outputTokens: 1 }) });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|Error:|api/i);
  });
});

describe('budget protection and configuration', () => {
  it('does nothing when AI is off or the key is missing', async () => {
    for (const cfg of [loadAiConfig({}), loadAiConfig({ AI_ENABLED: 'on' })]) {
      const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { cfg, transport: reply({ answer: 'x' }) });
      expect(r.status).toBe(503);
      expect(sent).toEqual([]);
    }
  });
  it('pauses AI when the shared rate limiter is unavailable (fails closed), and rate limits a busy person', async () => {
    limiter = 'broken';
    const a = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'x' }) });
    expect(a.status).toBe(503);
    limiter = 'limited';
    const b = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'x' }) });
    expect(b.status).toBe(429);
    expect(sent).toEqual([]);
  });
  it('stops at the daily limit', async () => {
    reserve = 'limit';
    const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'x' }) });
    expect(r.status).toBe(429);
    expect(sent).toEqual([]);
  });
  it('fails closed when the usage counter is unavailable (database failure)', async () => {
    reserve = 'missing';
    const r = await run('owner', 'ai-ask', 'POST', { question: 'How are sales?' }, { transport: reply({ answer: 'x' }) });
    expect(r.status).toBe(503);
    expect(r.body.hint).toMatch(/ai\.sql/);
    expect(sent).toEqual([]);
  });
  it('rejects a one-word question and an oversize one is cut to 300 characters', async () => {
    expect((await run('owner', 'ai-ask', 'POST', { question: 'hi' }, { transport: reply({ answer: 'x' }) })).status).toBe(400);
    await run('owner', 'ai-ask', 'POST', { question: 'q'.repeat(2000) }, { transport: reply({ answer: 'x' }) });
    expect(sent[0]).toContain('q'.repeat(300));
    expect(sent[0]).not.toContain('q'.repeat(301));
  });
  it('status shows usage and never the key', async () => {
    const r = await run('owner', 'ai-status', 'GET', undefined, { cfg: ready({ GEMINI_API_KEY: 'AIza-secret-123' }) });
    expect(r.body).toMatchObject({ ready: true, model: 'gemini-3.1-flash-lite', canIntelligence: true });
    expect(JSON.stringify(r.body)).not.toContain('AIza-secret-123');
  });
});

describe('AI Content Studio: drafts only, human approval', () => {
  const body = { kind: 'product_description', product_id: PID };
  it('lets a manager draft content, using only verified facts (unverified ingredients are withheld from the model)', async () => {
    const r = await run('manager', 'ai-content', 'POST', body, { transport: reply({ text: 'A calm, traditional syrup.' }) });
    expect(r.status).toBe(200);
    expect(sent[0]).toContain('not verified');
    expect(sent[0]).not.toContain('"verified_ingredients"');
    const save = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ai_drafts'));
    expect(save?.body).toMatchObject({ kind: 'product_description', product_id: PID, flags: [], created_by: 'owner@kaayra.in' });
    expect(save?.body.status).toBeUndefined();
    expect(calls.some((c) => c.url.includes('/products') && c.method !== 'GET')).toBe(false);
  });
  it('support cannot use the content studio', async () => {
    expect((await run('support', 'ai-content', 'POST', body, { transport: reply({ text: 'x' }) })).status).toBe(403);
    expect((await run('support', 'ai-drafts', 'GET', undefined)).status).toBe(403);
  });
  it('requires a product for product content and a valid kind', async () => {
    expect((await run('owner', 'ai-content', 'POST', { kind: 'product_description' }, { transport: reply({ text: 'x' }) })).status).toBe(400);
    expect((await run('owner', 'ai-content', 'POST', { kind: 'hack', product_id: PID }, { transport: reply({ text: 'x' }) })).status).toBe(400);
  });
  it('flags unsupported claims on the draft instead of hiding them', async () => {
    await run('owner', 'ai-content', 'POST', body, { transport: reply({ text: 'This syrup cures anxiety and is clinically proven. Only ₹199.' }) });
    const save = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ai_drafts'));
    expect(save?.body.flags.length).toBeGreaterThan(0);
  });
  it('only the owner can approve, and never a draft that makes an unsupported claim', async () => {
    expect((await run('manager', 'ai-draft-decide', 'POST', { id: DID, decision: 'approved' })).status).toBe(403);
    draftRow = { flags: [], body: 'This product cures anxiety.' };
    expect((await run('owner', 'ai-draft-decide', 'POST', { id: DID, decision: 'approved' })).status).toBe(409);
    draftRow = { flags: [], body: 'A calm, traditional syrup.' };
    const ok = await run('owner', 'ai-draft-decide', 'POST', { id: DID, decision: 'approved' });
    expect(ok.status).toBe(200);
    const patch = calls.filter((c) => c.method === 'PATCH').pop();
    expect(patch?.body).toMatchObject({ status: 'approved', decided_by: 'owner@kaayra.in' });
  });
  it('a manager may reject, and an edit returns a draft to "draft" with a fresh check', async () => {
    expect((await run('manager', 'ai-draft-decide', 'POST', { id: DID, decision: 'rejected' })).status).toBe(200);
    await run('manager', 'ai-draft-edit', 'POST', { id: DID, body: 'Guaranteed to heal.' });
    const patch = calls.filter((c) => c.method === 'PATCH').pop();
    expect(patch?.body).toMatchObject({ status: 'draft', decided_by: null });
    expect(patch?.body.flags.length).toBeGreaterThan(0);
  });
  it('rejects a malformed draft id', async () => {
    expect((await run('owner', 'ai-draft-delete', 'POST', { id: "1' or 1=1" })).status).toBe(400);
  });
});
