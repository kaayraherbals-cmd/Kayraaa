import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAdminRoles, type AdminRole } from '../../shared/roles.js';
import { handleDelivery } from './delivery.js';
import type { AdminConfig, AdminCtx } from './ctx.js';

interface Call { method: string; url: string; body: any }
let calls: Call[];
let audits: { action: string; detail?: Record<string, unknown> }[];
let existing: Record<string, unknown>[];
let rpcStatus: number;
const real = globalThis.fetch;
const res = (status: number, b: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...h } });

beforeEach(() => {
  calls = [];
  audits = [];
  existing = [{ pincode: '221005', active: true, rate_paise: 6000, free_above_paise: 150000, city: 'Varanasi', state: 'Uttar Pradesh', updated_at: '2026-10-20T00:00:00Z' }];
  rpcStatus = 200;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/rpc/delivery_areas_upsert')) return rpcStatus === 200 ? res(200, { added: 2, updated: 1, skipped: 0 }) : res(rpcStatus, { code: 'P0001', message: 'KH:INVALID' });
    if (method === 'POST' && url.endsWith('/shipping_pincodes')) return calls.at(-1)!.body.pincode === '221005' ? res(409, { code: '23505' }) : res(201, [calls.at(-1)!.body]);
    if (method === 'PATCH') return res(200, url.includes('221005') ? [{ ...existing[0], ...calls.at(-1)!.body }] : []);
    return res(200, existing, { 'content-range': '0-0/1' });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

function ctx(role: AdminRole, method: string, query: Record<string, string> = {}, body?: unknown) {
  const out = { status: 0, body: undefined as any };
  const r = { status(s: number) { out.status = s; return r; }, json(b: unknown) { out.body = b; return r; } };
  const c = {
    req: { method, query, body },
    cfg: { db: { url: 'https://db.test', serviceKey: 'k' } } as unknown as AdminConfig,
    email: 'x@kaayra.in', role, commerceEnabled: true,
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return r as never; },
    audit: async (action: string, detail?: Record<string, unknown>) => { audits.push({ action, detail }); },
  } as unknown as AdminCtx;
  return { c, out };
}
const run = async (role: AdminRole, action: string, method: string, query: Record<string, string> = {}, body?: unknown) => {
  const { c, out } = ctx(role, method, query, body);
  const handled = await handleDelivery(c, action);
  return { handled, ...out };
};

describe('delivery areas API', () => {
  it('lets every role read, with on/off counts', async () => {
    for (const role of ['owner', 'manager', 'support'] as const) {
      const r = await run(role, 'delivery-areas', 'GET');
      expect(r.status).toBe(200);
      expect(r.body.items).toHaveLength(1);
      expect(r.body.counts).toEqual({ on: 1, off: 1 });
    }
  });
  it('searches a PIN prefix by pincode and text by city or state, with unsafe characters removed', async () => {
    await run('owner', 'delivery-areas', 'GET', { q: '2210' });
    expect(calls[0].url).toContain('pincode=like.2210*');
    calls.length = 0;
    await run('owner', 'delivery-areas', 'GET', { q: "var),pincode.gt.0('", status: 'off' });
    expect(calls[0].url).toContain('active=eq.false');
    expect(calls[0].url).not.toContain("'");
    expect(calls[0].url).not.toMatch(/var\)/);
  });
  it('refuses every change for manager and support, and records the attempt, without touching the database', async () => {
    for (const role of ['manager', 'support'] as const) {
      for (const [action, method, query, body] of [
        ['delivery-area', 'POST', {}, { pincode: '221006', ratePaise: 6000 }],
        ['delivery-area', 'PATCH', { pincode: '221005' }, { active: false }],
        ['delivery-areas-bulk', 'POST', {}, { text: '221006', ratePaise: 0, active: true, onExisting: 'skip' }],
      ] as const) {
        const r = await run(role, action, method, query as Record<string, string>, body);
        expect(r.status).toBe(403);
        expect(r.body.permission).toBe('delivery.write');
      }
    }
    expect(calls).toHaveLength(0);
    expect(audits.filter((a) => a.action === 'permission_denied')).toHaveLength(6);
  });
  it('adds one PIN code, stores paise and the label, and audits it', async () => {
    const r = await run('owner', 'delivery-area', 'POST', {}, { pincode: '221006', ratePaise: 0, freeAbovePaise: null, city: ' Varanasi ', state: 'Uttar Pradesh' });
    expect(r.status).toBe(201);
    expect(calls[0].body).toMatchObject({ pincode: '221006', active: true, rate_paise: 0, free_above_paise: null, city: 'Varanasi' });
    expect(audits[0]).toMatchObject({ action: 'delivery_area_add' });
  });
  it('says so when the PIN code is already listed, and rejects bad input before any database call', async () => {
    expect((await run('owner', 'delivery-area', 'POST', {}, { pincode: '221005', ratePaise: 100 })).status).toBe(409);
    calls.length = 0;
    expect((await run('owner', 'delivery-area', 'POST', {}, { pincode: '1', ratePaise: -4 })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('switches on or off with a toggle audit, and edits with an update audit', async () => {
    const t = await run('owner', 'delivery-area', 'PATCH', { pincode: '221005' }, { active: false });
    expect(t.status).toBe(200);
    expect(calls[0].url).toContain('pincode=eq.221005');
    expect(calls[0].body).toMatchObject({ active: false });
    expect(audits[0]).toMatchObject({ action: 'delivery_area_toggle', detail: { pincode: '221005', active: false } });
    const e = await run('owner', 'delivery-area', 'PATCH', { pincode: '221005' }, { ratePaise: 4000, freeAbovePaise: null });
    expect(e.status).toBe(200);
    expect(audits[1]).toMatchObject({ action: 'delivery_area_update' });
  });
  it('404s an unknown PIN code and refuses a malformed one', async () => {
    expect((await run('owner', 'delivery-area', 'PATCH', { pincode: '221009' }, { active: true })).status).toBe(404);
    expect((await run('owner', 'delivery-area', 'PATCH', { pincode: "221005' or 1=1" }, { active: true })).status).toBe(400);
  });
  it('bulk: sends one atomic call with the shared label as a fallback, and audits the counts', async () => {
    const r = await run('owner', 'delivery-areas-bulk', 'POST', {}, { text: '221005, Kashi\n221006', ratePaise: 6000, freeAbovePaise: 150000, active: true, city: 'Varanasi', state: 'Uttar Pradesh', onExisting: 'update' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: 2, updated: 1, skipped: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      p_rows: [{ pincode: '221005', city: 'Kashi', state: 'Uttar Pradesh' }, { pincode: '221006', city: 'Varanasi', state: 'Uttar Pradesh' }],
      p_rate: 6000, p_free: 150000, p_active: true, p_update: true,
    });
    expect(audits[0]).toMatchObject({ action: 'delivery_areas_bulk', detail: { count: 2, onExisting: 'update' } });
  });
  it('bulk: applies nothing when a line is bad', async () => {
    const r = await run('owner', 'delivery-areas-bulk', 'POST', {}, { text: '221005\nnope', ratePaise: 6000, active: true, onExisting: 'skip' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Line 2/);
    expect(calls).toHaveLength(0);
  });
  it('bulk: reports a database refusal as a plain failure', async () => {
    rpcStatus = 400;
    const r = await run('owner', 'delivery-areas-bulk', 'POST', {}, { text: '221005', ratePaise: 6000, active: true, onExisting: 'skip' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it('ignores other actions and methods, and has no delete', async () => {
    expect((await run('owner', 'shipments', 'GET')).handled).toBe(false);
    expect((await run('owner', 'delivery-area', 'DELETE', { pincode: '221005' })).handled).toBe(false);
  });
});

describe('role parsing still works with the new permissions', () => {
  it('keeps ADMIN_ROLES parsing unchanged', () => {
    expect(parseAdminRoles('a@x.co:owner', ['a@x.co']).ok).toBe(true);
  });
});

describe('dry run and export', () => {
  it('dry run counts new versus listed PIN codes and writes nothing', async () => {
    const r = await run('owner', 'delivery-areas-bulk', 'POST', {}, { text: '221005\n221006\n221007', ratePaise: 6000, active: true, onExisting: 'update', dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, total: 3, existing: 1, added: 2 });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls[0].url).toContain('pincode=in.(221005,221006,221007)');
    expect(audits).toHaveLength(0);
  });
  it('dry run is for the owner only', async () => {
    expect((await run('manager', 'delivery-areas-bulk', 'POST', {}, { text: '221005', ratePaise: 0, active: true, onExisting: 'skip', dryRun: true })).status).toBe(403);
  });
  it('exports a CSV for every role that can read, and audits it', async () => {
    const headers: Record<string, string> = {};
    const { c } = ctx('support', 'GET');
    (c as any).res = { setHeader: (k: string, v: string) => { headers[k] = v; }, status: () => ({ send: (b: string) => { headers.body = b; } }) };
    expect(await handleDelivery(c, 'delivery-areas-export')).toBe(true);
    expect(headers['Content-Type']).toMatch(/text\/csv/);
    expect(headers.body).toContain('"pincode","city","state","charge_inr","free_above_inr","active","updated_at"');
    expect(headers.body).toContain('"221005","Varanasi","Uttar Pradesh","60.00","1500.00","on"');
    expect(audits[0]).toMatchObject({ action: 'export_delivery_areas', detail: { count: 1 } });
  });
});
