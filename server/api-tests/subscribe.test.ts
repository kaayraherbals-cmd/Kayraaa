import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/subscribe.js';
import { signToken as signUserToken, USER_COOKIE } from '../oauth.js';
import { CONFIRM_TTL_MS, signToken, subscribeConfig, unsubscribeToken, verifyToken } from '../subscribeToken.js';

const SECRET = 'launch-token-secret-0123456789-abcdef';
const SITE = 'https://site.kaayra-test.in';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  RESEND_API_KEY: 're_test_key',
  SUBSCRIBE_TOKEN_SECRET: SECRET,
  SITE_URL: SITE,
  ADMIN_SESSION_SECRET: 'session-secret-0123456789-abcdefghijkl',
};

type Row = { id: string; email: string; name: string | null; status: string; optin_method: string; consented_at: string; confirmation_sent_at: string | null; confirmed_at: string | null; unsubscribed_at: string | null; consent_text_version: string };
let rows: Row[];
let logs: { email_hash: string; event: string }[];
let mails: { to: string[]; subject: string; html: string; text: string; headers?: Record<string, string> }[];
let members: { id: string; email: string; name: string | null; role: string; has_password: boolean }[];
let resendStatus: number;
let n: number;
let ipCounter = 0; // never reset: the limiter lives for the whole process, so every call gets its own address unless a test pins one

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function matches(row: Row, query: URLSearchParams): boolean {
  for (const key of ['email', 'status', 'id'] as const) {
    const f = query.get(key);
    if (!f) continue;
    const [op, ...rest] = f.split('.');
    const v = rest.join('.');
    if (op === 'eq' && (row[key] as string) !== v) return false;
    if (op === 'neq' && (row[key] as string) === v) return false;
  }
  return true;
}

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    if (url.host === 'api.resend.com') {
      if (resendStatus !== 200) return json(resendStatus, { message: 'nope' });
      mails.push(body);
      return json(200, { id: `mail_${mails.length}` });
    }
    if (url.pathname.endsWith('/launch_consent_log')) {
      logs.push(body);
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/members')) {
      const f = url.searchParams.get('email') ?? '';
      return json(200, members.filter((m) => `eq.${m.email}` === f));
    }
    if (url.pathname.endsWith('/email_outbox')) return new Response(null, { status: 201 });
    if (url.pathname.endsWith('/launch_subscribers')) {
      if (method === 'POST') {
        if (rows.some((r) => r.email === body.email)) return json(409, { code: '23505' });
        rows.push({ id: `id-${++n}`, name: null, confirmed_at: null, unsubscribed_at: null, consented_at: new Date().toISOString(), ...body });
        return new Response(null, { status: 201 });
      }
      const hit = rows.filter((r) => matches(r, url.searchParams));
      if (method === 'GET') return json(200, hit.slice(0, 1));
      if (method === 'PATCH') {
        for (const r of hit) Object.assign(r, body);
        return init?.headers?.Prefer === 'return=representation' ? json(200, hit.map((r) => ({ id: r.id, name: r.name }))) : new Response(null, { status: 204 });
      }
    }
    return json(404, {});
  }) as typeof fetch;
}

function call(body: unknown, opts: { query?: Record<string, string>; origin?: string | null; method?: string; ip?: string; cookies?: Record<string, string> } = {}) {
  ipCounter++;
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', 'x-forwarded-for': opts.ip ?? `10.1.${ipCounter >> 8}.${ipCounter & 255}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  const req = { method: opts.method ?? 'POST', headers, body, query: opts.query ?? {}, cookies: opts.cookies ?? {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = {
    setHeader() {},
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      return this;
    },
    send(b: unknown) {
      out.body = b;
      return this;
    },
    end() {
      return this;
    },
  } as never;
  return handler(req, res).then(() => out);
}

const signup = (email = 'asha@example.org', extra: Record<string, unknown> = {}) => call({ email, name: 'Asha', consent: true, ...extra });
const linkToken = (mail: { text: string }, a: 'confirm' | 'unsubscribe') => new RegExp(`a=${a}&t=([\\w.-]+)`).exec(mail.text)![1];

beforeEach(() => {
  rows = [];
  members = [];
  logs = [];
  mails = [];
  resendStatus = 200;
  n = 0;
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  delete process.env.VITE_SITE_URL;
  install();
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('signed links', () => {
  it('verifies only for the purpose it was made for', () => {
    const c = signToken('confirm', 'A@B.co', SECRET);
    expect(verifyToken(c, 'confirm', SECRET)).toBe('a@b.co');
    expect(verifyToken(c, 'unsubscribe', SECRET)).toBeNull();
  });
  it('rejects tampering, the wrong secret and junk', () => {
    const c = signToken('confirm', 'a@b.co', SECRET);
    const [body, sig] = c.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'confirm', e: 'victim@b.co', t: Date.now() })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, 'confirm', SECRET)).toBeNull();
    expect(verifyToken(c, 'confirm', 'another-secret-another-secret-123456')).toBeNull();
    for (const j of [undefined, '', 'x', `${body}.`, '.sig', 42, 'a'.repeat(700)]) expect(verifyToken(j, 'confirm', SECRET)).toBeNull();
  });
  it('confirm links expire after 7 days, unsubscribe links never do', () => {
    const old = Date.now() - CONFIRM_TTL_MS - 1000;
    expect(verifyToken(signToken('confirm', 'a@b.co', SECRET, old), 'confirm', SECRET)).toBeNull();
    expect(verifyToken(signToken('unsubscribe', 'a@b.co', SECRET, 0), 'unsubscribe', SECRET)).toBe('a@b.co');
  });
  it('the launch list stays closed without a long secret or a real https address', () => {
    expect(subscribeConfig({ SITE_URL: SITE })).toBeNull();
    expect(subscribeConfig({ SUBSCRIBE_TOKEN_SECRET: 'short', SITE_URL: SITE })).toBeNull();
    expect(subscribeConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET })).toBeNull();
    expect(subscribeConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'https://kaayraherbals.example' })).toBeNull();
    expect(subscribeConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'http://kaayra.in' })).toBeNull();
    expect(subscribeConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, VITE_SITE_URL: 'https://kaayra.in/' })).toEqual({ secret: SECRET, siteUrl: 'https://kaayra.in' });
  });
});

describe('sign-up (step one of double opt-in)', () => {
  it('saves a PENDING row and sends exactly one confirmation, not a welcome', async () => {
    const r = await signup();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'asha@example.org', status: 'pending', optin_method: 'double', consent_text_version: '2026-10-v2' });
    expect(rows[0].confirmed_at).toBeNull();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/confirm/i);
    expect(mails[0].text).toContain(`${SITE}/subscription?a=confirm&t=`);
    expect(mails[0].text).toContain('a=unsubscribe&t=');
    expect(mails[0].html.length).toBeGreaterThan(100);
    expect(logs.map((l) => l.event)).toEqual(['requested']);
  });
  it('adds one-click unsubscribe headers (RFC 8058)', async () => {
    await signup();
    expect(mails[0].headers?.['List-Unsubscribe']).toMatch(new RegExp(`^<${SITE}/api/subscribe\\?u=`));
    expect(mails[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
  it('never sends a duplicate: a repeat within 15 minutes sends nothing and answers the same', async () => {
    const first = await signup();
    const again = await signup();
    expect(again).toEqual(first);
    expect(mails).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });
  it('re-sends once the 15 minutes have passed and the address is still unconfirmed', async () => {
    await signup();
    rows[0].confirmation_sent_at = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await signup();
    expect(mails).toHaveLength(2);
    expect(rows).toHaveLength(1);
  });
  it('gives the same answer for an address that is already confirmed, and sends nothing', async () => {
    const fresh = await signup('new@example.org');
    await signup('asha@example.org');
    rows.find((r) => r.email === 'asha@example.org')!.status = 'confirmed';
    mails.length = 0;
    const known = await signup('asha@example.org');
    expect(known).toEqual(fresh);
    expect(mails).toHaveLength(0);
  });
  it('stores nothing and sends nothing when the list is not fully configured', async () => {
    for (const key of ['SUBSCRIBE_TOKEN_SECRET', 'RESEND_API_KEY', 'SUPABASE_URL']) {
      const keep = process.env[key];
      delete process.env[key];
      const r = await signup();
      expect(r.status, key).toBe(503);
      expect(r.body.status).toBe('unconfigured');
      process.env[key] = keep;
    }
    process.env.SITE_URL = 'https://kaayraherbals.example';
    expect((await signup()).status).toBe(503);
    expect(rows).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });
  it('validates, requires consent, honours the honeypot and refuses other origins', async () => {
    expect((await signup('not-an-email')).status).toBe(400);
    expect((await call({ email: 'a@b.co', consent: false })).status).toBe(400);
    expect((await signup('bot@example.org', { website: 'http://spam' })).body).toEqual({ status: 'ok' });
    expect((await signup('a@b.co', {})).status).toBe(200);
    expect((await call({ email: 'c@d.co', consent: true }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await call({ email: 'c@d.co', consent: true }, { origin: null })).status).toBe(403);
    expect(rows.map((r) => r.email)).toEqual(['a@b.co']);
  });
  it('rate-limits repeated sign-ups from one address (6th in ten minutes is refused)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 6; i++) results.push((await call({ email: `p${i}@example.org`, consent: true }, { ip: '198.51.100.7' })).status);
    expect(results).toEqual([200, 200, 200, 200, 200, 429]);
    expect(rows).toHaveLength(5);
  });
  it('rejects GET', async () => {
    expect((await call({}, { method: 'GET' })).status).toBe(405);
  });
  it('on a provider failure it tells the visitor, and lets them retry at once', async () => {
    resendStatus = 500;
    const failed = await signup();
    expect(failed.status).toBe(502);
    expect(rows[0].confirmation_sent_at).toBeNull();
    resendStatus = 200;
    expect((await signup()).status).toBe(200);
    expect(mails).toHaveLength(1);
  });
});

describe('confirming (step two)', () => {
  it('confirms from the link, sends the welcome once, and records consent', async () => {
    await signup();
    const token = linkToken(mails[0], 'confirm');
    const r = await call({ action: 'confirm', token });
    expect(r.body).toEqual({ status: 'confirmed' });
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].confirmed_at).not.toBeNull();
    expect(mails).toHaveLength(2);
    expect(mails[1].subject).toMatch(/on the .* list/i);
    expect(logs.map((l) => l.event)).toEqual(['requested', 'confirmed']);
  });
  it('clicking the link twice never sends the welcome twice', async () => {
    await signup();
    const token = linkToken(mails[0], 'confirm');
    await call({ action: 'confirm', token });
    const again = await call({ action: 'confirm', token });
    expect(again.body).toEqual({ status: 'already_confirmed' });
    expect(mails).toHaveLength(2);
  });
  it('refuses forged, expired, wrong-purpose and malformed tokens, leaving the row pending', async () => {
    await signup();
    const good = linkToken(mails[0], 'confirm');
    const unsub = linkToken(mails[0], 'unsubscribe');
    const expired = signToken('confirm', 'asha@example.org', SECRET, Date.now() - CONFIRM_TTL_MS - 5000);
    for (const t of ['junk', `${good}x`, unsub, expired, '']) {
      const r = await call({ action: 'confirm', token: t });
      expect(r.status, t).toBe(400);
      expect(r.body.status).toBe('invalid_link');
    }
    expect(rows[0].status).toBe('pending');
  });
  it('needs a same-origin request', async () => {
    await signup();
    const token = linkToken(mails[0], 'confirm');
    expect((await call({ action: 'confirm', token }, { origin: 'https://evil.test' })).status).toBe(403);
    expect(rows[0].status).toBe('pending');
  });
  it('does not confirm an address that unsubscribed in the meantime', async () => {
    await signup();
    const confirm = linkToken(mails[0], 'confirm');
    await call({ action: 'unsubscribe', token: linkToken(mails[0], 'unsubscribe') });
    const r = await call({ action: 'confirm', token: confirm });
    expect(r.body.status).toBe('was_unsubscribed');
    expect(rows[0].status).toBe('unsubscribed');
  });
});

describe('unsubscribing and withdrawal', () => {
  it('unsubscribes from the page link, records withdrawal, and is repeatable', async () => {
    await signup();
    await call({ action: 'confirm', token: linkToken(mails[0], 'confirm') });
    const token = linkToken(mails[1], 'unsubscribe');
    expect((await call({ action: 'unsubscribe', token })).body).toEqual({ status: 'unsubscribed' });
    expect((await call({ action: 'unsubscribe', token })).body).toEqual({ status: 'unsubscribed' });
    expect(rows[0].status).toBe('unsubscribed');
    expect(rows[0].unsubscribed_at).not.toBeNull();
    expect(logs.map((l) => l.event)).toEqual(['requested', 'confirmed', 'unsubscribed']);
  });
  it('one-click unsubscribe from a mail client works with no Origin header', async () => {
    await signup();
    const r = await call({}, { query: { u: unsubscribeToken({ secret: SECRET, siteUrl: SITE }, 'asha@example.org') }, origin: null });
    expect(r.body).toEqual({ status: 'unsubscribed' });
    expect(rows[0].status).toBe('unsubscribed');
  });
  it('one-click refuses a confirm token or a forged one', async () => {
    await signup();
    expect((await call({}, { query: { u: linkToken(mails[0], 'confirm') }, origin: null })).status).toBe(400);
    expect((await call({}, { query: { u: 'forged.token' }, origin: null })).status).toBe(400);
    expect(rows[0].status).toBe('pending');
  });
  it('answers the same for an address that was never on the list', async () => {
    const t = unsubscribeToken({ secret: SECRET, siteUrl: SITE }, 'nobody@example.org');
    expect((await call({ action: 'unsubscribe', token: t })).body).toEqual({ status: 'unsubscribed' });
    expect(logs).toHaveLength(0);
  });
  it('someone who unsubscribed can sign up again, with a fresh consent record and email', async () => {
    await signup();
    await call({ action: 'unsubscribe', token: linkToken(mails[0], 'unsubscribe') });
    mails.length = 0;
    rows[0].confirmation_sent_at = new Date(Date.now() - 3600_000).toISOString();
    await signup();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].unsubscribed_at).toBeNull();
    expect(mails).toHaveLength(1);
  });
  it('the consent log holds a hash, never the address', async () => {
    await signup();
    expect(JSON.stringify(logs)).not.toContain('asha');
    expect(logs[0].email_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('signed-in members join in one click', () => {
  const sessionFor = (email: string, name: string | null = 'Meera Rao') => ({ [USER_COOKIE]: signUserToken('user', { email, name, role: 'member' }, ENV.ADMIN_SESSION_SECRET, 3600) });
  const addMember = (email = 'meera@example.org', name: string | null = 'Meera Rao') => members.push({ id: 'm-1', email, name, role: 'member', has_password: false });
  const join = (extra: Record<string, unknown> = {}, cookies?: Record<string, string>) => call({ action: 'join_member', consent: true, ...extra }, { cookies });

  it('joins with no email or name in the request, uses the account email, confirms at once and sends one joined email', async () => {
    addMember();
    const r = await join({}, sessionFor('meera@example.org'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'joined' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'meera@example.org', name: 'Meera Rao', status: 'confirmed', optin_method: 'member', consent_text_version: '2026-10-v2' });
    expect(rows[0].confirmed_at).toBeTruthy();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(['meera@example.org']);
    expect(mails[0].subject).toBe('You are on the Kaayra Herbals list');
    expect(mails[0].text).toContain('Thank you for joining.');
    expect(mails[0].text).not.toContain('Thank you for confirming.');
    expect(logs.map((l) => l.event)).toEqual(['requested', 'confirmed']);
  });

  it('ignores any email or name in the request: the address always comes from the session', async () => {
    addMember();
    await join({ email: 'victim@example.org', name: 'Someone Else' }, sessionFor('meera@example.org'));
    expect(rows.map((r) => r.email)).toEqual(['meera@example.org']);
    expect(rows[0].name).toBe('Meera Rao');
  });

  it('needs the consent tick', async () => {
    addMember();
    const r = await join({ consent: false }, sessionFor('meera@example.org'));
    expect(r.status).toBe(400);
    expect(rows).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('refuses without a session, with a forged cookie, or when the member no longer exists', async () => {
    addMember();
    expect((await join({})).status).toBe(401);
    expect((await join({}, { [USER_COOKIE]: 'forged.value' })).status).toBe(401);
    expect((await join({}, sessionFor('gone@example.org'))).status).toBe(401);
    expect(rows).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('a second click sends no second email and changes nothing', async () => {
    addMember();
    await join({}, sessionFor('meera@example.org'));
    const r = await join({}, sessionFor('meera@example.org'));
    expect(r.body).toEqual({ status: 'already_joined' });
    expect(rows).toHaveLength(1);
    expect(mails).toHaveLength(1);
  });

  it('moves a pending or unsubscribed row straight to confirmed', async () => {
    addMember();
    await signup('meera@example.org');
    rows[0].status = 'unsubscribed';
    mails.length = 0;
    const r = await join({}, sessionFor('meera@example.org'));
    expect(r.body).toEqual({ status: 'joined' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'confirmed', optin_method: 'member', unsubscribed_at: null });
    expect(mails).toHaveLength(1);
  });

  it('stays closed without the launch-list secret, and a failed email does not undo the join', async () => {
    addMember();
    resendStatus = 500;
    const r = await join({}, sessionFor('meera@example.org'));
    expect(r.body).toEqual({ status: 'joined' });
    expect(rows[0].status).toBe('confirmed');
    delete process.env.SUBSCRIBE_TOKEN_SECRET;
    rows = [];
    const closed = await join({}, sessionFor('meera@example.org'));
    expect((closed.body as { status: string }).status).toBe('unconfigured');
    expect(rows).toHaveLength(0);
  });

  it('rejects a request from another origin', async () => {
    addMember();
    const r = await call({ action: 'join_member', consent: true }, { cookies: sessionFor('meera@example.org'), origin: 'https://evil.example' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(rows).toHaveLength(0);
  });
});
