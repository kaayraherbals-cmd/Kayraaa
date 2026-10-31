import type { VercelRequest, VercelResponse } from '@vercel/node';
import { UUID_RE } from '../../shared/admin.js';
import { isAdminEmail, sessionCookie, signSession, SESSION_TTL_SECONDS } from '../session.js';
import { deletePasskey, findByCredential, insertPasskey, listPasskeys, MAX_PASSKEYS_PER_ADMIN, publicPasskey, renamePasskey, touchPasskey, type PasskeyRow } from '../passkeys.js';
import { b64u, credentialHash, decoyCredentialId, fromB64u, newChallenge, readTicket, rpContext, signTicket, userHandle, verifyAssertion, verifyRegistration, MAX_CREDENTIAL_ID_BYTES } from '../webauthn.js';
import { bodyOf, writeAudit, type AdminConfig, type AdminCtx } from './ctx.js';

const DENIED = { status: 'denied', message: 'That passkey did not work. Check you are using the right one, or sign in with your password instead.' };
const TIMEOUT_MS = 60_000;

interface BrowserCredential {
  id: string;
  rawId: string;
  response: Record<string, unknown>;
}
function credentialOf(v: unknown): BrowserCredential | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.rawId !== 'string' || typeof c.response !== 'object' || c.response === null) return null;
  return { id: typeof c.id === 'string' ? c.id : '', rawId: c.rawId, response: c.response as Record<string, unknown> };
}
  // eslint-disable-next-line no-control-regex -- intentional: rejects control characters in names
const cleanName = (v: unknown): string => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Passkey';
const descriptors = (rows: PasskeyRow[]) => rows.map((p) => ({ type: 'public-key', id: p.credential_id, transports: p.transports }));

export type PasskeyLimit = (email: string) => Promise<'ok' | 'limited' | 'unavailable'>;
interface LoginArgs {
  req: VercelRequest;
  res: VercelResponse;
  cfg: AdminConfig;
  json: (status: number, body: unknown) => VercelResponse;
  secure: boolean;
  limit: PasskeyLimit;
}

/** Sign in with a passkey: needs no session. Email is optional (without it the browser offers any passkey saved for this site). */
export async function handlePasskeyLogin(a: LoginArgs, action: 'passkey-login-begin' | 'passkey-login-finish'): Promise<void> {
  const { req, res, cfg, json } = a;
  if ((req.method ?? 'GET') !== 'POST') return void json(405, { status: 'error', message: 'Method not allowed.' });
  const rp = rpContext(req.headers);
  if (!rp) return void json(400, { status: 'invalid', message: 'This address cannot be used for passkeys.' });
  const body = bodyOf(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  const gate = await a.limit(email);
  if (gate === 'unavailable') {
    res.setHeader('Retry-After', '60');
    return void json(503, { status: 'unavailable', message: 'Sign-in is temporarily unavailable. Please try again in a few minutes.' });
  }
  if (gate === 'limited') {
    res.setHeader('Retry-After', '900');
    return void json(429, { status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  }
  try {
    if (action === 'passkey-login-begin') {
      const challenge = newChallenge();
      let allow: ReturnType<typeof descriptors> = [];
      if (email) {
        const rows = isAdminEmail(email, cfg.admins) ? await listPasskeys(cfg.db, email) : [];
        // An address with no passkeys gets one decoy credential, so the answer looks the same either way.
        allow = rows.length ? descriptors(rows) : [{ type: 'public-key', id: decoyCredentialId(email, cfg.secret), transports: [] }];
      }
      return void json(200, { status: 'ok', ticket: signTicket('auth', email, challenge, cfg.secret), options: { challenge, rpId: rp.rpId, timeout: TIMEOUT_MS, userVerification: 'required', allowCredentials: allow } });
    }

    const tk = readTicket(body.ticket, 'auth', cfg.secret);
    const cred = credentialOf(body.credential);
    const rawId = cred ? fromB64u(cred.rawId, MAX_CREDENTIAL_ID_BYTES) : null;
    if (!tk || !cred || !rawId) return void json(401, DENIED);
    const row = await findByCredential(cfg.db, b64u(rawId));
    const denied = async (actor: string, reason: string) => {
      await writeAudit(cfg, actor || 'unknown', 'login_denied', { method: 'passkey', reason });
      return void json(401, DENIED);
    };
    if (!row) return denied(tk.email, 'unknown passkey');
    if (tk.email && row.email !== tk.email) return denied(row.email, 'passkey belongs to another account');
    if (!isAdminEmail(row.email, cfg.admins)) return denied(row.email, 'not an admin');
    const handle = fromB64u(cred.response.userHandle, 128);
    if (handle && handle.length > 0 && b64u(handle) !== userHandle(row.email)) return denied(row.email, 'user handle mismatch');
    const v = verifyAssertion({ clientDataJSON: cred.response.clientDataJSON, authenticatorData: cred.response.authenticatorData, signature: cred.response.signature, challenge: tk.challenge, rp, publicKey: row.public_key, alg: row.alg, storedCount: Number(row.sign_count) });
    if (!v.ok) {
      await writeAudit(cfg, row.email, 'passkey_failed', { step: 'sign-in', reason: v.reason });
      return void json(401, DENIED);
    }
    if (!(await touchPasskey(cfg.db, row, v.signCount, v.backedUp)) && v.signCount > 0) return denied(row.email, 'response already used');
    res.setHeader('Set-Cookie', sessionCookie(signSession(row.email, cfg.secret, Date.now(), SESSION_TTL_SECONDS, 0, row.id_hash), a.secure));
    await writeAudit(cfg, row.email, 'login_passkey', { role: cfg.roles[row.email], passkey: row.name });
    return void json(200, { status: 'ok', email: row.email });
  } catch (e) {
    console.error(`passkey login error (${action})`, e instanceof Error ? e.message : e);
    return void json(502, { status: 'error', message: 'Could not check passkeys. Run supabase/admin_passkeys.sql if you have not yet, then try again.' });
  }
}

/** Managing your own passkeys. Runs only for a fully signed-in admin (after the two-step gate). Returns true when it handled the action. */
export async function handlePasskeys(ctx: AdminCtx, action: string, currentHash: string): Promise<boolean> {
  const { req, cfg, json, email } = ctx;
  const method = req.method ?? 'GET';

  if (action === 'passkeys') {
    if (method !== 'GET') return json(405, { status: 'error', message: 'Method not allowed.' }), true;
    const rows = await listPasskeys(cfg.db, email);
    json(200, { status: 'ok', items: rows.map((p) => publicPasskey(p, currentHash)), max: MAX_PASSKEYS_PER_ADMIN });
    return true;
  }

  if (action === 'passkey-register-begin') {
    if (method !== 'POST') return json(405, { status: 'error', message: 'Method not allowed.' }), true;
    const rp = rpContext(req.headers);
    if (!rp) return json(400, { status: 'invalid', message: 'This address cannot be used for passkeys.' }), true;
    const rows = await listPasskeys(cfg.db, email);
    if (rows.length >= MAX_PASSKEYS_PER_ADMIN) return json(409, { status: 'conflict', message: `You can have up to ${MAX_PASSKEYS_PER_ADMIN} passkeys. Remove one first.` }), true;
    const challenge = newChallenge();
    json(200, {
      status: 'ok',
      ticket: signTicket('reg', email, challenge, cfg.secret),
      options: {
        challenge,
        rp: { id: rp.rpId, name: 'Kaayra Herbals Admin' },
        user: { id: userHandle(email), name: email, displayName: email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: TIMEOUT_MS,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: descriptors(rows),
      },
    });
    return true;
  }

  if (action === 'passkey-register-finish') {
    if (method !== 'POST') return json(405, { status: 'error', message: 'Method not allowed.' }), true;
    const rp = rpContext(req.headers);
    const body = bodyOf(req);
    const tk = readTicket(body.ticket, 'reg', cfg.secret);
    const cred = credentialOf(body.credential);
    if (!rp || !tk || tk.email !== email || !cred) return json(400, { status: 'invalid', message: 'That took too long or was not valid. Start again.' }), true;
    const v = verifyRegistration({ clientDataJSON: cred.response.clientDataJSON, attestationObject: cred.response.attestationObject, rawId: cred.rawId, challenge: tk.challenge, rp });
    if (!v.ok) {
      await ctx.audit('passkey_failed', { step: 'register', reason: v.reason });
      return json(400, { status: 'invalid', message: 'This passkey could not be added. Try again, or use a different device.', hint: v.reason }), true;
    }
    if ((await listPasskeys(cfg.db, email)).length >= MAX_PASSKEYS_PER_ADMIN) return json(409, { status: 'conflict', message: `You can have up to ${MAX_PASSKEYS_PER_ADMIN} passkeys. Remove one first.` }), true;
    const transports = Array.isArray(cred.response.transports) ? (cred.response.transports as unknown[]).filter((t): t is string => typeof t === 'string' && /^[a-z-]{2,16}$/.test(t)).slice(0, 6) : [];
    const name = cleanName(body.name);
    const saved = await insertPasskey(cfg.db, { email, credential_id: v.credentialId, id_hash: credentialHash(v.credentialId), public_key: v.publicKey, alg: v.alg, sign_count: v.signCount, transports, name, backed_up: v.backedUp });
    if (saved === 'duplicate') return json(409, { status: 'conflict', message: 'This passkey is already saved.' }), true;
    await ctx.audit('passkey_added', { name });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'passkey') {
    const id = String(req.query.id ?? '');
    if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    if (method === 'PATCH') {
      const name = cleanName(bodyOf(req).name);
      if (!(await renamePasskey(cfg.db, email, id, name))) return json(404, { status: 'error', message: 'Not found.' }), true;
      await ctx.audit('passkey_renamed', { name });
      json(200, { status: 'ok' });
      return true;
    }
    if (method === 'DELETE') {
      const gone = await deletePasskey(cfg.db, email, id);
      if (!gone) return json(404, { status: 'error', message: 'Not found.' }), true;
      await ctx.audit('passkey_removed', { name: gone.name });
      json(200, { status: 'ok' });
      return true;
    }
    return json(405, { status: 'error', message: 'Method not allowed.' }), true;
  }
  return false;
}
