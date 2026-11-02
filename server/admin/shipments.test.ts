import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAdminRoles, type AdminRole } from '../../shared/roles.js';
import { makeJson, type AdminConfig, type AdminCtx } from './ctx.js';
import { handleShipments } from './shipments.js';

const ADMINS = ['boss@kaayra.in', 'ops@kaayra.in', 'help@kaayra.in'];
const ROLES = 'boss@kaayra.in:owner,ops@kaayra.in:manager,help@kaayra.in:support';
const O = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const S = '3f8b2e74-4b3a-4c5d-9e9c-7da05b6c8f43';
const I = '7c7c7c7c-4b3a-4c5d-9e9c-7da05b6c8f43';
const cfg: AdminConfig = { db: { url: 'https://db.test', serviceKey: 'service-key' }, anonKey: 'a', secret: 's'.repeat(48), admins: ADMINS, roles: parseAdminRoles(ROLES, ADMINS).roles, mfaMode: 'required', mfaKey: 'm'.repeat(48) };

interface Call { path: string; body: any }
let calls: Call[];
let audits: string[];
let current: { status: string; order_id: string } | null;
let rpcReply: { status: number; body: unknown };
const real = globalThis.fetch;

beforeEach(() => {
  calls = [];
  audits = [];
  current = { status: 'pending', order_id: O };
  rpcReply = { status: 200, body: S };
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const path = new URL(String(input)).pathname.replace('/rest/v1/', '');
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (path === 'rpc/email_enqueue') return json(200, 'ok');
    if (path.startsWith('rpc/')) return json(rpcReply.status, rpcReply.body);
    if (path === 'shipments') return json(200, current ? [current] : []);
    if (path === 'orders') return json(200, [{ customer_email: 'asha@example.org', channel: 'online' }]);
    return json(200, []);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

async function run(action: string, as: { email: string; role: AdminRole }, o: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const reply = { status: 0, body: undefined as any };
  const res = { status(c: number) { reply.status = c; return res; }, json(b: unknown) { reply.body = b; return res; } };
  const req = { method: o.method ?? 'GET', query: { action, ...(o.query ?? {}) }, body: o.body, headers: {} };
  const ctx: AdminCtx = { req: req as never, res: res as never, cfg, email: as.email, role: as.role, commerceEnabled: false, json: makeJson(res as never), audit: async (a) => void audits.push(a) };
  const handled = await handleShipments(ctx, action);
  return { handled, ...reply };
}
const owner = { email: 'boss@kaayra.in', role: 'owner' as const };
const manager = { email: 'ops@kaayra.in', role: 'manager' as const };
const support = { email: 'help@kaayra.in', role: 'support' as const };
const rpcCalls = (n: string) => calls.filter((c) => c.path === `rpc/${n}`);
const POST = { method: 'POST' };

describe('permissions', () => {
  it('lets support look but not change anything', async () => {
    expect((await run('shipments', support)).status).toBe(200);
    expect((await run('shipment-create', support, { ...POST, body: { order_id: O, items: [{ order_item_id: I, qty: 1 }] } })).status).toBe(403);
    expect((await run('shipment-status', support, { ...POST, body: { shipment_id: S, status: 'cancelled' } })).status).toBe(403);
    expect((await run('shipment-note', support, { ...POST, body: { shipment_id: S, note: 'x' } })).status).toBe(403);
    expect((await run('delivery-exception-resolve', support, { ...POST, body: { exception_id: S } })).status).toBe(403);
    expect(calls.filter((c) => c.path.startsWith('rpc/'))).toHaveLength(0);
    expect(audits.filter((a) => a === 'permission_denied')).toHaveLength(4);
  });
  it('lets a manager and an owner change shipments', async () => {
    expect((await run('shipment-create', manager, { ...POST, body: { order_id: O, items: [{ order_item_id: I, qty: 1 }] } })).status).toBe(201);
    expect((await run('shipment-create', owner, { ...POST, body: { order_id: O, items: [{ order_item_id: I, qty: 1 }] } })).status).toBe(201);
  });
  it('ignores actions that are not its own', async () => {
    expect((await run('orders', owner)).handled).toBe(false);
  });
});

describe('shipment-create', () => {
  it('rejects a bad body without calling the database', async () => {
    const r = await run('shipment-create', manager, { ...POST, body: { order_id: O, items: [] } });
    expect(r.status).toBe(400);
    expect(rpcCalls('shipment_create')).toHaveLength(0);
  });
  it('passes the acting admin to the database and audits', async () => {
    await run('shipment-create', manager, { ...POST, body: { order_id: O, items: [{ order_item_id: I, qty: 2 }] } });
    expect(rpcCalls('shipment_create')[0].body).toEqual({ p_order: O, p_items: [{ order_item_id: I, qty: 2 }], p_actor: 'ops@kaayra.in' });
    expect(audits).toContain('shipment_create');
  });
  it('reports the database refusing an order that is not packed', async () => {
    rpcReply = { status: 400, body: { code: 'P0001', message: 'KH:BAD_STATE:order must be packed to create a shipment' } };
    const r = await run('shipment-create', manager, { ...POST, body: { order_id: O, items: [{ order_item_id: I, qty: 1 }] } });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('packed');
    expect(audits).not.toContain('shipment_create');
  });
});

describe('shipment-status', () => {
  const dispatch = { shipment_id: S, status: 'dispatched', courier: 'Test Courier', tracking_no: 'TRK123' };
  it('refuses an illegal move before the database is asked', async () => {
    current = { status: 'pending', order_id: O };
    const r = await run('shipment-status', manager, { ...POST, body: { shipment_id: S, status: 'delivered' } });
    expect(r.status).toBe(400);
    expect(rpcCalls('shipment_set_status')).toHaveLength(0);
  });
  it('needs courier and tracking to dispatch', async () => {
    expect((await run('shipment-status', manager, { ...POST, body: { shipment_id: S, status: 'dispatched' } })).status).toBe(400);
  });
  it('404s an unknown shipment', async () => {
    current = null;
    expect((await run('shipment-status', manager, { ...POST, body: dispatch })).status).toBe(404);
  });
  it('queues the customer mail only AFTER the database accepted the move', async () => {
    const r = await run('shipment-status', manager, { ...POST, body: dispatch });
    expect(r.status).toBe(200);
    const order = calls.map((c) => c.path);
    expect(order.indexOf('rpc/shipment_set_status')).toBeGreaterThan(-1);
    expect(order.indexOf('rpc/email_enqueue')).toBeGreaterThan(order.indexOf('rpc/shipment_set_status'));
    expect(rpcCalls('email_enqueue')[0].body).toMatchObject({ p_kind: 'shipment_dispatched', p_dedupe: `shipment_dispatched:${S}`, p_payload: { orderId: O, shipmentId: S } });
    expect(audits).toContain('shipment_status');
  });
  it('queues no mail when the database refuses the move', async () => {
    rpcReply = { status: 400, body: { code: 'P0001', message: 'KH:SHIPMENT_BAD_TRANSITION:pending>dispatched' } };
    const r = await run('shipment-status', manager, { ...POST, body: dispatch });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/shipment cannot move/i);
    expect(rpcCalls('email_enqueue')).toHaveLength(0);
    expect(audits).not.toContain('shipment_status');
  });
  it('sends no customer mail for a step that has none (in transit)', async () => {
    current = { status: 'dispatched', order_id: O };
    await run('shipment-status', manager, { ...POST, body: { shipment_id: S, status: 'in_transit' } });
    expect(rpcCalls('email_enqueue')).toHaveLength(0);
  });
});
