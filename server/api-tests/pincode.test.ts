import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/checkout/[action].js';

const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const pins = [
  { pincode: '221005', active: true, rate_paise: 6000, free_above_paise: 150000 },
  { pincode: '221001', active: false, rate_paise: 6000, free_above_paise: null },
];
let ip = 0;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/shipping_pincodes')) return json(200, pins.filter((p) => p.pincode === (url.searchParams.get('pincode') ?? '').replace(/^eq\./, '')));
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

function call(pin: string | undefined, method = 'GET') {
  ip++;
  const req = { method, headers: { host: 'x.test', 'x-forwarded-for': `10.77.${ip >> 8}.${ip & 255}` }, query: { action: 'pincode', ...(pin === undefined ? {} : { pin }) }, cookies: {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}

describe('public PIN code check', () => {
  it('works without signing in and reports rate and free-delivery threshold', async () => {
    const r = await call('221005');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ serviceable: true, ratePaise: 6000, freeAbovePaise: 150000 });
  });
  it('says not serviceable for an inactive or unknown PIN, with no rate', async () => {
    for (const pin of ['221001', '560001']) {
      const r = await call(pin);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ serviceable: false, ratePaise: null, freeAbovePaise: null });
    }
  });
  it('rejects malformed PINs and non-GET methods', async () => {
    expect((await call('22100')).status).toBe(400);
    expect((await call("1' or 1=1")).status).toBe(400);
    expect((await call(undefined)).status).toBe(400);
    expect((await call('221005', 'POST')).status).toBe(405);
  });
});
