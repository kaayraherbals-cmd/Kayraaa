import { afterEach, describe, expect, it } from 'vitest';
import { COOKIE_NAME, verifySession } from '../session.js';
import { credentialHash, newChallenge, signTicket, b64u, verifyRegistration } from '../webauthn.js';
import { assertion, ec, registration } from '../webauthn-testkit.js';
import { handlePasskeyLogin, handlePasskeys } from './passkeys.js';
import { makeJson, type AdminConfig, type AdminCtx } from './ctx.js';

const SECRET = 's'.repeat(48);
const BOSS = 'boss@kaayra.in';
const cfg: AdminConfig = { db: { url: 'https://db.test', serviceKey: 'svc' }, anonKey: 'anon', secret: SECRET, admins: [BOSS], roles: { [BOSS]: 'owner' }, mfaMode: 'required', mfaKey: 'm'.repeat(48) };

interface Call { method: string; url: string; body: any }
let calls: Call[] = [];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply() {
  const r = { status: 0, body: undefined as any, headers: {} as Record<string, any> };
  const res = {
    status(c: number) { r.status = c; return res; },
    json(b: unknown) { r.body = b; return res; },
    setHeader(k: string, v: unknown) { r.headers[k.toLowerCase()] = v; return res; },
  };
  return { r, res };
}
const req = (body: unknown, method = 'POST', query: Record<string, string> = {}) => ({ method, body, query, headers: { host: 'admin.kaayra.in' }, cookies: {} }) as any;

/** Mocks the admin_passkeys REST table. */
function db(rows: Record<string, any>[], opts: { insert?: number } = {}) {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.includes('/rest/v1/admin_audit')) return new Response(null, { status: 201 });
    if (url.includes('/rest/v1/admin_passkeys')) {
      if (method === 'POST') return new Response(null, { status: opts.insert ?? 201 });
      if (method === 'PATCH') return json(200, [{}]);
      if (method === 'DELETE') return json(200, rows.slice(0, 1));
      const cred = /credential_id=eq\.([^&]+)/.exec(url);
      if (cred) return json(200, rows.filter((r) => r.credential_id === decodeURIComponent(cred[1])));
      const hash = /id_hash=eq\.([^&]+)/.exec(url);
      if (hash) return json(200, rows.filter((r) => r.id_hash === decodeURIComponent(hash[1])).map((r) => ({ id: r.id })));
      const mail = /email=eq\.([^&]+)/.exec(url);
      return json(200, rows.filter((r) => !mail || r.email === decodeURIComponent(mail[1])));
    }
    return json(404, {});
  }) as typeof fetch;
}

async function login(action: 'passkey-login-begin' | 'passkey-login-finish', body: unknown, limit: 'ok' | 'limited' | 'unavailable' = 'ok') {
  const { r, res } = reply();
  await handlePasskeyLogin({ req: req(body), res: res as any, cfg, json: makeJson(res as any), secure: true, limit: async () => limit }, action);
  return r;
}

/** A saved passkey for BOSS, plus a function that signs in with it. */
function saved(email = BOSS) {
  const key = ec();
  const credId = b64u(Buffer.from('credential-id-0123456789abcdef0123'));
  const reg = verifyRegistration(registration({ challenge: 'setup', cose: key.cose, credId: Buffer.from(credId, 'base64url') }).input);
  if (!reg.ok) throw new Error('setup');
  const row = { id: '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10', email, credential_id: credId, id_hash: credentialHash(credId), public_key: reg.publicKey, alg: -7, sign_count: 0, transports: ['internal'], name: 'Laptop', backed_up: false, created_at: '2026-10-20T10:00:00Z', last_used_at: null };
  const finishBody = (o: { ticketEmail?: string; badSignature?: boolean } = {}) => {
    const challenge = newChallenge();
    const a = assertion(key, reg.publicKey, { challenge });
    return { ticket: signTicket('auth', o.ticketEmail ?? BOSS, challenge, SECRET), email: o.ticketEmail ?? BOSS, credential: { id: credId, rawId: credId, response: { clientDataJSON: a.clientDataJSON, authenticatorData: a.authenticatorData, signature: o.badSignature ? 'AAAA' : a.signature, userHandle: '' } } };
  };
  return { row, finishBody, credId };
}

describe('passkey sign-in', () => {
  it('gives an unknown address and an admin with no passkeys the same shape of answer', async () => {
    db([]);
    const stranger = await login('passkey-login-begin', { email: 'nobody@example.com' });
    const bareAdmin = await login('passkey-login-begin', { email: BOSS });
    expect(stranger.status).toBe(200);
    expect(bareAdmin.status).toBe(200);
    expect(stranger.body.options.allowCredentials.length).toBe(1);
    expect(bareAdmin.body.options.allowCredentials.length).toBe(1);
    expect(stranger.body.options.userVerification).toBe('required');
    expect(stranger.body.options.rpId).toBe('admin.kaayra.in');
  });
  it('lists the real passkeys for an admin, and none for usernameless sign-in', async () => {
    const p = saved();
    db([p.row]);
    expect((await login('passkey-login-begin', { email: BOSS })).body.options.allowCredentials[0].id).toBe(p.credId);
    expect((await login('passkey-login-begin', {})).body.options.allowCredentials.length).toBe(0);
  });
  it('signs in with a valid passkey and ties the session to that passkey', async () => {
    const p = saved();
    db([p.row]);
    const r = await login('passkey-login-finish', p.finishBody());
    expect(r.status).toBe(200);
    expect(r.body.email).toBe(BOSS);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    const token = cookie.split(';')[0].slice(COOKIE_NAME.length + 1);
    expect(verifySession(token, SECRET)?.pk).toBe(p.row.id_hash);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    expect(calls.some((c) => c.url.includes('admin_audit') && c.body?.action === 'login_passkey')).toBe(true);
  });
  it('refuses a bad signature, a ticket for someone else, an unknown passkey and a non-admin', async () => {
    const p = saved();
    db([p.row]);
    expect((await login('passkey-login-finish', p.finishBody({ badSignature: true }))).status).toBe(401);
    expect((await login('passkey-login-finish', p.finishBody({ ticketEmail: 'other@kaayra.in' }))).status).toBe(401);
    db([]);
    expect((await login('passkey-login-finish', p.finishBody())).status).toBe(401);
    const outsider = saved('former@kaayra.in');
    db([outsider.row]);
    const r = await login('passkey-login-finish', outsider.finishBody({ ticketEmail: '' }));
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBe(undefined);
  });
  it('refuses a forged, expired-kind or missing ticket', async () => {
    const p = saved();
    db([p.row]);
    const b = p.finishBody();
    expect((await login('passkey-login-finish', { ...b, ticket: 'x.y' })).status).toBe(401);
    expect((await login('passkey-login-finish', { ...b, ticket: signTicket('reg', BOSS, 'c', SECRET) })).status).toBe(401);
    expect((await login('passkey-login-finish', { credential: b.credential })).status).toBe(401);
  });
  it('is rate limited and fails closed', async () => {
    db([]);
    expect((await login('passkey-login-begin', { email: BOSS }, 'limited')).status).toBe(429);
    expect((await login('passkey-login-begin', { email: BOSS }, 'unavailable')).status).toBe(503);
  });
});

function ctxFor(body: unknown, method: string, query: Record<string, string> = {}) {
  const { r, res } = reply();
  const audits: string[] = [];
  const ctx: AdminCtx = { req: req(body, method, query), res: res as any, cfg, email: BOSS, role: 'owner', commerceEnabled: false, json: makeJson(res as any), audit: async (a) => void audits.push(a) };
  return { ctx, r, audits };
}

describe('passkey management', () => {
  it('starts registration with the existing passkeys excluded and user verification required', async () => {
    const p = saved();
    db([p.row]);
    const { ctx, r } = ctxFor({}, 'POST');
    expect(await handlePasskeys(ctx, 'passkey-register-begin', '')).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body.options.excludeCredentials[0].id).toBe(p.credId);
    expect(r.body.options.authenticatorSelection.userVerification).toBe('required');
    expect(r.body.options.attestation).toBe('none');
  });
  it('saves a new passkey after a valid registration and stores only the public key', async () => {
    db([]);
    const challenge = newChallenge();
    const reg = registration({ challenge });
    const credential = { id: b64u(reg.credId), rawId: b64u(reg.credId), response: { clientDataJSON: reg.input.clientDataJSON, attestationObject: reg.input.attestationObject, transports: ['internal', '<script>'] } };
    const { ctx, r, audits } = ctxFor({ ticket: signTicket('reg', BOSS, challenge, SECRET), name: ' Work <b>laptop ', credential }, 'POST');
    await handlePasskeys(ctx, 'passkey-register-finish', '');
    expect(r.status).toBe(200);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('admin_passkeys'));
    expect(insert?.body.email).toBe(BOSS);
    expect(insert?.body.name).toBe('Work blaptop');
    expect(insert?.body.transports).toEqual(['internal']);
    expect(typeof insert?.body.public_key).toBe('string');
    expect(Object.keys(insert?.body).includes('private_key')).toBe(false);
    expect(audits).toEqual(['passkey_added']);
  });
  it('refuses a registration with the wrong challenge, or a ticket from another account', async () => {
    db([]);
    const reg = registration({ challenge: 'real' });
    const credential = { id: b64u(reg.credId), rawId: b64u(reg.credId), response: { clientDataJSON: reg.input.clientDataJSON, attestationObject: reg.input.attestationObject } };
    const wrong = ctxFor({ ticket: signTicket('reg', BOSS, 'different', SECRET), credential }, 'POST');
    await handlePasskeys(wrong.ctx, 'passkey-register-finish', '');
    expect(wrong.r.status).toBe(400);
    expect(wrong.audits).toEqual(['passkey_failed']);
    const other = ctxFor({ ticket: signTicket('reg', 'other@kaayra.in', 'real', SECRET), credential }, 'POST');
    await handlePasskeys(other.ctx, 'passkey-register-finish', '');
    expect(other.r.status).toBe(400);
  });
  it('reports a duplicate, lists without key material, and removes only your own', async () => {
    const p = saved();
    db([p.row], { insert: 409 });
    const challenge = newChallenge();
    const reg = registration({ challenge });
    const credential = { id: b64u(reg.credId), rawId: b64u(reg.credId), response: { clientDataJSON: reg.input.clientDataJSON, attestationObject: reg.input.attestationObject } };
    const dup = ctxFor({ ticket: signTicket('reg', BOSS, challenge, SECRET), credential }, 'POST');
    await handlePasskeys(dup.ctx, 'passkey-register-finish', '');
    expect(dup.r.status).toBe(409);

    const list = ctxFor(undefined, 'GET');
    await handlePasskeys(list.ctx, 'passkeys', p.row.id_hash);
    expect(list.r.body.items[0].current).toBe(true);
    expect(JSON.stringify(list.r.body).includes('public_key')).toBe(false);
    expect(JSON.stringify(list.r.body).includes(p.credId)).toBe(false);

    const del = ctxFor(undefined, 'DELETE', { id: p.row.id });
    await handlePasskeys(del.ctx, 'passkey', '');
    expect(del.r.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes(`email=eq.${encodeURIComponent(BOSS)}`))).toBe(true);
    const bad = ctxFor(undefined, 'DELETE', { id: 'not-a-uuid' });
    await handlePasskeys(bad.ctx, 'passkey', '');
    expect(bad.r.status).toBe(400);
  });
});
