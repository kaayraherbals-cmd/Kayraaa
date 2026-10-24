import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type AdminRole } from '../../shared/roles.js';
import { handleRecovery } from './recovery.js';
import type { AdminCtx } from './ctx.js';

const real = globalThis.fetch;
let calls: { method: string; path: string; body?: any }[];
let audits: { action: string; detail?: any }[];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = []; audits = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const u = new URL(String(input)); const path = u.pathname.replace('/rest/v1/', '');
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(init.body) : undefined });
    if (path === 'rpc/cart_recovery_stats') return json(200, { abandoned_carts: 5, eligible_carts: 2, emails_sent: 4, recovered_orders: 1, attributed_revenue_paise: 99800, conversion_rate: 0.5, top_products: [{ product: 'Tulsi', pack_size: '200 ml', carts: 2 }] });
    if (path === 'cart_recovery_settings') return json(200, [{ enabled: false, paused: false, inactivity_minutes: 60, batch_size: 25 }]);
    if (path === 'cart_recovery_cycles') return json(200, [{ id: 'c1', created_at: '2026-10-20T10:00:00Z', abandoned_at: '2026-10-20T11:00:00Z', line_count: 2, status: 'open', members: { email: 'asha.verma@gmail.com' }, cart_recovery_messages: [] }]);
    if (path === 'cart_recovery_messages') return json(200, [{ id: 'm1', step: 1, status: 'failed', reason: 'http_503', attempts: 3, updated_at: '2026-10-20T12:00:00Z' }]);
    return json(200, []);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

function run(role: AdminRole, method: string, action: string, query: Record<string, string> = {}, body?: unknown) {
  const out = { status: 0, body: undefined as any };
  const res = {};
  const c = {
    req: { method, query: { action, ...query }, body, headers: {} }, res, role, email: `${role}@kaayra.test`, commerceEnabled: true,
    cfg: { db: { url: 'https://db.test', serviceKey: 'k' }, roles: {}, admins: [] },
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return res; },
    audit: async (a: string, d?: unknown) => { audits.push({ action: a, detail: d }); },
  } as unknown as AdminCtx;
  return handleRecovery(c, action).then((handled) => ({ ...out, handled }));
}

describe('permissions', () => {
  it('only the owner holds recovery permissions', () => {
    for (const p of ['recovery.read', 'recovery.manage'] as const) {
      expect(PERMISSIONS).toContain(p);
      expect(can('owner', p)).toBe(true);
      expect(can('manager', p)).toBe(false);
      expect(can('support', p)).toBe(false);
    }
  });
  it('manager and support are refused on every action, audited, and nothing is read or written', async () => {
    for (const role of ['manager', 'support'] as const) {
      expect((await run(role, 'GET', 'recovery-overview')).status).toBe(403);
      expect((await run(role, 'PATCH', 'recovery-settings', {}, { enabled: true })).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
    expect(audits.filter((a) => a.action === 'permission_denied')).toHaveLength(4);
  });
  it('ignores actions it does not own', async () => {
    expect((await run('owner', 'GET', 'products')).handled).toBe(false);
  });
});

describe('overview (read only)', () => {
  it('returns settings, numbers with definitions, masked customers and failures', async () => {
    const r = await run('owner', 'GET', 'recovery-overview', { period: '30d' });
    expect(r.status).toBe(200);
    expect(r.body.period).toBe('30d');
    expect(r.body.stats.recovered_orders).toBe(1);
    expect(r.body.definitions.attributed_revenue).toMatch(/ATTRIBUTED/);
    expect(r.body.cycles[0].customer).toBe('a***@g***.com');
    expect(JSON.stringify(r.body)).not.toContain('asha.verma');
    expect(r.body.failures).toHaveLength(1);
  });
  it('only reads: GET requests and the stats function, never a write', async () => {
    await run('owner', 'GET', 'recovery-overview');
    expect(calls.every((c) => c.method === 'GET' || c.path === 'rpc/cart_recovery_stats')).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE' || c.path.includes('email_outbox'))).toBe(false);
  });
  it('an unknown period falls back to 7 days', async () => {
    expect((await run('owner', 'GET', 'recovery-overview', { period: 'forever' })).body.period).toBe('7d');
  });
});

describe('settings', () => {
  it('rejects invalid input with plain problems and writes nothing', async () => {
    const r = await run('owner', 'PATCH', 'recovery-settings', {}, { batchSize: 5000, sendNow: true });
    expect(r.status).toBe(400);
    expect(r.body.problems.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });
  it('saves a valid change, stamps who changed it, and audits old and new values', async () => {
    const r = await run('owner', 'PATCH', 'recovery-settings', {}, { enabled: true, inactivityMinutes: 90 });
    expect(r.status).toBe(200);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('cart_recovery_settings');
    expect(patch.body).toMatchObject({ enabled: true, inactivity_minutes: 90, updated_by: 'owner@kaayra.test' });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('recovery_settings_changed');
    expect(audits[0]!.detail.from.enabled).toBe(false);
    expect(audits[0]!.detail.to).toEqual({ enabled: true, inactivityMinutes: 90 });
  });
  it('pausing is just a settings change and is audited', async () => {
    await run('owner', 'PATCH', 'recovery-settings', {}, { paused: true });
    expect(calls.find((c) => c.method === 'PATCH')!.body.paused).toBe(true);
    expect(audits[0]!.action).toBe('recovery_settings_changed');
  });
  it('the dashboard has no route that sends mail, edits a bag, issues a discount, or touches orders, payments or stock', async () => {
    for (const a of ['recovery-send', 'recovery-coupon', 'recovery-order', 'recovery-inventory']) {
      const r = await run('owner', 'POST', a);
      expect(r.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });
});
