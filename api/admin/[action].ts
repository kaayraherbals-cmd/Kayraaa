import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parsePage, sanitiseSearch, toCsv, UUID_RE } from '../../shared/admin.js';
import { clientIp, createLimiter, isLimited, isSecureDeployment, limitDecision, originAllowed } from '../../server/http.js';
import { clearCookie, COOKIE_NAME, isAdminEmail, sessionCookie, signSession, verifySession, SESSION_TTL_SECONDS, type Session } from '../../server/session.js';
import { rest } from '../../server/supabase.js';
import { upsertMember } from '../../server/members.js';
import { createProduct, getInternal, listInternal, updateProduct } from '../../server/products.js';
import { mimeFor, readImage, storeImage } from '../../server/media.js';
import { MAX_IMAGE_BYTES, MEDIA_FILE_RE, publishProblems, validateCreate, validateUpdate } from '../../shared/products.js';
import { clearUserCookie } from '../../server/oauth.js';
import { ISSUE_STATUSES, validateIssueUpdate } from '../../shared/issues.js';
import { COMMERCE_ENABLED } from '../../shared/commerce.js';
import { isProductionEnv, liveSalesApproved } from '../../shared/liveSales.js';

/** Admin order creation follows the same rule as the shop: on everywhere except production without live-sales approval. */
const ordersOpen = (): boolean => (COMMERCE_ENABLED as boolean) && (!isProductionEnv(process.env) || liveSalesApproved(process.env));
import { permissionsOf } from '../../shared/roles.js';
import { makeSku } from '../../shared/variants.js';
import { bodyOf, loadAdminConfig, makeJson, need, pageRange, PAGE_SIZE, totalOf, writeAudit, type AdminConfig, type AdminCtx } from '../../server/admin/ctx.js';
import { handleBackoffice } from '../../server/admin/backoffice.js';
import { beginEnrol, confirmEnrol, getMfa, mfaState, verifyLogin, type MfaState } from '../../server/mfa.js';
import { groupSecret, otpauthUri } from '../../server/totp.js';
import { dbHint } from '../../server/admin/dbHint.js';
import { handlePasskeyLogin, handlePasskeys, type PasskeyLimit } from '../../server/admin/passkeys.js';
import { hasActivePasskey } from '../../server/passkeys.js';

/**
 * Admin API. Authorisation is by allowlist (ADMIN_EMAILS), checked on every request, so being able to sign in to Supabase
 * is never enough on its own. Then three more layers: two-step verification (an authenticator code, once per session),
 * a role (owner, manager or support, from ADMIN_ROLES) checked per action, and an audit entry for what was done.
 * Sessions are signed, HttpOnly, SameSite=Strict cookies.
 */

interface AuthUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
}

const EXPORT_CAP = 20000;
const ipLimiter = createLimiter(15 * 60 * 1000, 8, 'admin_ip', 'closed');
const emailLimiter = createLimiter(15 * 60 * 1000, 5, 'admin_email', 'closed');
const uploadLimiter = createLimiter(15 * 60 * 1000, 60, 'admin_upload');
const mfaEmailLimiter = createLimiter(15 * 60 * 1000, 8, 'admin_mfa_email', 'closed');
const mfaIpLimiter = createLimiter(15 * 60 * 1000, 30, 'admin_mfa_ip', 'closed');
const passkeyIpLimiter = createLimiter(15 * 60 * 1000, 40, 'admin_pk_ip', 'closed');
const passkeyEmailLimiter = createLimiter(15 * 60 * 1000, 20, 'admin_pk_email', 'closed');

function currentSession(req: VercelRequest, cfg: AdminConfig): Session | null {
  const s = verifySession(req.cookies?.[COOKIE_NAME], cfg.secret);
  // Re-check the allowlist every time so removing an address revokes access immediately.
  return s && isAdminEmail(s.email, cfg.admins) ? s : null;
}

/** CSRF defence on top of SameSite=Strict: same-origin header plus a custom header. */
function mutationAllowed(req: VercelRequest): boolean {
  return originAllowed(req) && req.headers['x-kaayra-admin'] === '1';
}

const MFA_ACTIONS = new Set(['mfa-begin', 'mfa-confirm', 'mfa-verify']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const action = String(req.query.action ?? '');
  const method = req.method ?? 'GET';
  const secure = isSecureDeployment();
  const json = makeJson(res);

  const loaded = loadAdminConfig();
  if (!loaded.ok) return json(503, { status: 'unconfigured', message: 'Admin access is not configured on the server.', missing: loaded.missing });
  const cfg = loaded.cfg;

  if (method !== 'GET' && !mutationAllowed(req)) return json(403, { status: 'error', message: 'Request not allowed.' });

  // ---- login --------------------------------------------------------------------------------------------------
  if (action === 'login') {
    if (method !== 'POST') return json(405, { status: 'error', message: 'Method not allowed.' });
    const body = bodyOf(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const generic = { status: 'denied', message: 'Incorrect email or password, or this account has no admin access.' };

    if (!email || !password || email.length > 254 || password.length > 256) return json(400, { status: 'invalid', message: 'Enter your email and password.' });
    // Admin sign-in fails CLOSED: if the shared counter is down, nobody can try passwords until it is back (see server/http.ts for recovery).
    const loginIp = await limitDecision(ipLimiter, clientIp(req));
    const loginEmail = await limitDecision(emailLimiter, email);
    if (loginIp === 'unavailable' || loginEmail === 'unavailable') {
      res.setHeader('Retry-After', '60');
      return json(503, { status: 'unavailable', message: 'Sign-in is temporarily unavailable. Please try again in a few minutes.' });
    }
    if (loginIp === 'limited' || loginEmail === 'limited') {
      res.setHeader('Retry-After', '900');
      return json(429, { status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
    }

    let user: AuthUser | null = null;
    try {
      const r = await fetch(`${cfg.db.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) user = ((await r.json()) as { user?: AuthUser }).user ?? null;
    } catch {
      return json(502, { status: 'error', message: 'Could not reach the sign-in service. Try again.' });
    }

    // Same answer for "wrong password" and "not an admin", so the allowlist cannot be probed.
    if (!user?.email || !user.email_confirmed_at || !isAdminEmail(user.email, cfg.admins)) {
      await writeAudit(cfg, email, 'login_denied');
      return json(401, generic);
    }
    // Record the admin as a member (best effort).
    try {
      await upsertMember(cfg.db, { id: user.id ?? '', email: user.email, name: null, role: 'admin', provider: 'password', hasPassword: true });
    } catch {
      /* the members tables are created by supabase/auth_members.sql; admin login must still work without them */
    }
    // The password alone never unlocks the panel: this session still needs its two-step check (see the gate below).
    res.setHeader('Set-Cookie', sessionCookie(signSession(user.email, cfg.secret), secure));
    await writeAudit(cfg, user.email, 'login', { role: cfg.roles[user.email.toLowerCase()] });
    return json(200, { status: 'ok', email: user.email.toLowerCase() });
  }

  // ---- logout (works even if the session is already gone) ---------------------------------------------------
  if (action === 'logout') {
    if (method !== 'POST') return json(405, { status: 'error', message: 'Method not allowed.' });
    res.setHeader('Set-Cookie', [clearCookie(secure), clearUserCookie(secure)]);
    return json(200, { status: 'ok' });
  }

  // ---- passkey sign-in (no session yet; a passkey with fingerprint or PIN counts as both steps) ------------------------
  if (action === 'passkey-login-begin' || action === 'passkey-login-finish') {
    const limit: PasskeyLimit = async (mail) => {
      const a = await limitDecision(passkeyIpLimiter, clientIp(req));
      const b = mail ? await limitDecision(passkeyEmailLimiter, mail) : 'allow';
      return a === 'unavailable' || b === 'unavailable' ? 'unavailable' : a === 'limited' || b === 'limited' ? 'limited' : 'ok';
    };
    await handlePasskeyLogin({ req, res, cfg, json, secure, limit }, action);
    return;
  }

  // ---- everything below requires an admin session ---------------------------------------------------------------
  const session = currentSession(req, cfg);
  if (!session) {
    if (req.cookies?.[COOKIE_NAME]) res.setHeader('Set-Cookie', clearCookie(secure));
    return json(401, { status: 'unauthorised', message: 'Sign in to continue.' });
  }
  const email = session.email;
  const role = cfg.roles[email];
  const audit = (a: string, detail: Record<string, unknown> = {}) => writeAudit(cfg, email, a, { role, ...detail });
  const ctx: AdminCtx = { req, res, cfg, email, role, commerceEnabled: ordersOpen(), json, audit };

  try {
    // ---- two-step verification state ------------------------------------------------------------------------
    // A session signed in with a passkey stays valid only while that passkey exists.
    // A passkey session carries no password or code proof, so once its passkey is gone it must end outright. Falling through to
    // the two-step check would let it stay signed in whenever two-step is optional and the admin has not enrolled (KH-V5-001).
    let viaPasskey = false;
    if (session.pk) {
      let active: boolean;
      try {
        active = await hasActivePasskey(cfg.db, email, session.pk);
      } catch {
        return json(503, { status: 'unavailable', message: 'Could not check your passkey. Please try again in a moment.' });
      }
      if (!active) {
        res.setHeader('Set-Cookie', clearCookie(secure));
        return json(401, { status: 'unauthorised', message: 'Sign in to continue.' });
      }
      viaPasskey = true;
    }
    let mfaRow = null as Awaited<ReturnType<typeof getMfa>>;
    try {
      mfaRow = await getMfa(cfg.db, email);
    } catch {
      // The admin_mfa table is missing or unreachable. When two-step is required we cannot let anyone through unchecked.
      if (cfg.mfaMode === 'required' && !viaPasskey) return json(503, { status: 'mfa_unavailable', message: 'Two-step verification is not set up on the server.' });
    }
    const state: MfaState = viaPasskey ? 'ok' : mfaState(cfg.mfaMode, mfaRow, session.mfa);

    if (action === 'session') {
      return json(200, {
        status: 'ok',
        email,
        role,
        mfa: state,
        mfaMode: cfg.mfaMode,
        mfaAvailable: Boolean(cfg.mfaKey),
        enrolled: Boolean(mfaRow?.enabled_at),
        viaPasskey,
        permissions: state === 'ok' ? permissionsOf(role) : [],
        commerceEnabled: ordersOpen(),
      });
    }

    if (MFA_ACTIONS.has(action)) {
      if (method !== 'POST') return json(405, { status: 'error', message: 'Method not allowed.' });
      if (!cfg.mfaKey) return json(503, { status: 'mfa_unavailable', message: 'Two-step verification is not set up on the server.' });
      const key = cfg.mfaKey;
      const mfaEm = await limitDecision(mfaEmailLimiter, email);
      const mfaIp = await limitDecision(mfaIpLimiter, clientIp(req));
      if (mfaEm === 'unavailable' || mfaIp === 'unavailable') {
        res.setHeader('Retry-After', '60');
        return json(503, { status: 'unavailable', message: 'Verification is temporarily unavailable. Please try again in a few minutes.' });
      }
      if (mfaEm === 'limited' || mfaIp === 'limited') {
        res.setHeader('Retry-After', '900');
        return json(429, { status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
      }
      const code = typeof bodyOf(req).code === 'string' ? (bodyOf(req).code as string).slice(0, 40) : '';
      const grant = (epoch: number) => res.setHeader('Set-Cookie', sessionCookie(signSession(email, cfg.secret, Date.now(), SESSION_TTL_SECONDS, epoch), secure));

      if (action === 'mfa-begin') {
        const begun = await beginEnrol(cfg.db, email, key);
        if (begun === 'already') return json(409, { status: 'conflict', message: 'Two-step verification is already on for this account. Enter your code, or ask an owner to reset it.' });
        await audit('mfa_enroll_started');
        return json(200, { status: 'ok', secret: groupSecret(begun.secret), uri: otpauthUri(email, begun.secret) });
      }
      if (action === 'mfa-confirm') {
        const done = await confirmEnrol(cfg.db, email, code, key);
        if (done === 'bad_code') {
          await audit('mfa_failed', { step: 'setup' });
          return json(401, { status: 'mfa_denied', message: 'That code is not correct or has expired.' });
        }
        if (done === 'no_setup') return json(409, { status: 'conflict', message: 'Start the setup again to get a new secret.' });
        if (done === 'already') return json(409, { status: 'conflict', message: 'Two-step verification is already on for this account.' });
        grant(done.epoch);
        await audit('mfa_enabled');
        return json(200, { status: 'ok', recoveryCodes: done.recoveryCodes });
      }
      // mfa-verify
      const v = await verifyLogin(cfg.db, email, code, key);
      if (v === 'not_enrolled') return json(409, { status: 'conflict', message: 'Two-step verification is not set up for this account yet.' });
      if (v === 'bad_code') {
        await audit('mfa_failed', { step: 'sign-in' });
        return json(401, { status: 'mfa_denied', message: 'That code is not correct or has expired.' });
      }
      grant(v.epoch);
      await audit(v.method === 'recovery' ? 'mfa_recovery_used' : 'mfa_verified', v.method === 'recovery' ? { recoveryLeft: v.recoveryLeft } : {});
      return json(200, { status: 'ok', recoveryLeft: v.recoveryLeft });
    }

    // ---- the gate: nothing else works until two-step is satisfied -----------------------------------------------
    if (state !== 'ok') return json(401, { status: 'mfa_required', mfa: state, message: 'Two-step verification is needed before you can continue.' });

    if (action === 'passkeys' || action === 'passkey' || action.startsWith('passkey-register-')) {
      if (await handlePasskeys(ctx, action, viaPasskey ? session.pk ?? '' : '')) return;
    }

    if (action === 'subscribers') {
      if (method === 'GET') {
        if (!(await need(ctx, 'subscribers.read'))) return;
        const page = parsePage(req.query.page);
        const q = sanitiseSearch(req.query.q);
        const filter = q ? `&or=(email.ilike.*${q}*,name.ilike.*${q}*)` : '';
        const r = await rest(cfg.db, `launch_subscribers?select=id,email,name,status,optin_method,consented_at,confirmed_at,unsubscribed_at,consent_text_version,created_at&order=created_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
        if (!r.ok) throw new Error(`subscribers ${r.status}`);
        return json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE });
      }
      if (method === 'DELETE') {
        if (!(await need(ctx, 'subscribers.delete'))) return;
        const id = String(req.query.id ?? '');
        if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' });
        const r = await rest(cfg.db, `launch_subscribers?id=eq.${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`delete subscriber ${r.status}`);
        await audit('delete_subscriber', { id });
        return json(200, { status: 'ok' });
      }
    }

    if (action === 'messages') {
      if (method === 'GET') {
        if (!(await need(ctx, 'messages.read'))) return;
        const page = parsePage(req.query.page);
        const st = String(req.query.status ?? '');
        const filter = st === 'new' || st === 'handled' ? `&status=eq.${st}` : '';
        const r = await rest(cfg.db, `contact_messages?select=id,name,email,message,status,created_at&order=created_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
        if (!r.ok) throw new Error(`messages ${r.status}`);
        return json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE });
      }
      const id = String(req.query.id ?? '');
      if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' });
      if (method === 'PATCH') {
        if (!(await need(ctx, 'messages.update'))) return;
        const body = bodyOf(req);
        if (body.status !== 'new' && body.status !== 'handled') return json(400, { status: 'invalid', message: 'Invalid status.' });
        const r = await rest(cfg.db, `contact_messages?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: body.status }) });
        if (!r.ok) throw new Error(`patch message ${r.status}`);
        await audit('update_message', { id, status: body.status });
        return json(200, { status: 'ok' });
      }
      if (method === 'DELETE') {
        if (!(await need(ctx, 'messages.delete'))) return;
        const r = await rest(cfg.db, `contact_messages?id=eq.${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`delete message ${r.status}`);
        await audit('delete_message', { id });
        return json(200, { status: 'ok' });
      }
    }

    if (action === 'issues') {
      if (method === 'GET') {
        if (!(await need(ctx, 'issues.read'))) return;
        const page = parsePage(req.query.page);
        const st = String(req.query.status ?? '');
        const filter = (ISSUE_STATUSES as readonly string[]).includes(st) ? `&status=eq.${st}` : '';
        const q = sanitiseSearch(req.query.q);
        const search = q ? `&or=(summary.ilike.*${q}*,error_code.ilike.*${q}*,ref.ilike.*${q}*,error_ref.ilike.*${q}*)` : '';
        const r = await rest(cfg.db, `issues?select=id,ref,category,summary,details,error_code,error_ref,page,contact_email,user_agent,status,severity,admin_note,created_at,updated_at&order=created_at.desc&${pageRange(page)}${filter}${search}`, { headers: { Prefer: 'count=exact' } });
        if (!r.ok) throw new Error(`issues ${r.status}`);
        return json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE });
      }
      const id = String(req.query.id ?? '');
      if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' });
      if (method === 'PATCH') {
        if (!(await need(ctx, 'issues.update'))) return;
        const v = validateIssueUpdate(req.body);
        if (!v.ok) return json(400, { status: 'invalid', message: v.message });
        const r = await rest(cfg.db, `issues?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ ...v.update, updated_at: new Date().toISOString() }) });
        if (!r.ok) throw new Error(`patch issue ${r.status}`);
        await audit('update_issue', { id, fields: Object.keys(v.update), status: v.update.status });
        return json(200, { status: 'ok' });
      }
      if (method === 'DELETE') {
        if (!(await need(ctx, 'issues.delete'))) return;
        const r = await rest(cfg.db, `issues?id=eq.${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`delete issue ${r.status}`);
        await audit('delete_issue', { id });
        return json(200, { status: 'ok' });
      }
    }

    if (action === 'product-image') {
      if (method === 'GET') {
        if (!(await need(ctx, 'products.read'))) return;
        const file = String(req.query.file ?? '');
        const bytes = MEDIA_FILE_RE.test(file) ? await readImage(cfg.db, file) : null;
        if (!bytes) return json(404, { status: 'error', message: 'Not found.' });
        res.setHeader('Content-Type', mimeFor(file));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.status(200).send(bytes);
      }
      if (method === 'POST') {
        if (!(await need(ctx, 'products.edit'))) return;
        if (await isLimited(uploadLimiter, email)) return json(429, { status: 'error', message: 'Too many uploads. Wait a few minutes.' });
        const body = bodyOf(req);
        const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
        if (!b64 || b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
          return json(400, { status: 'invalid', message: `Image is missing, invalid or larger than ${(MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB.` });
        }
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length > MAX_IMAGE_BYTES) return json(400, { status: 'invalid', message: 'Image is too large.' });
        const stored = await storeImage(cfg.db, bytes);
        if ('error' in stored) return json(400, { status: 'invalid', message: stored.error });
        await audit('product_image_upload', { file: stored.file, bytes: bytes.length });
        return json(200, { status: 'ok', path: stored.path });
      }
    }

    if (action === 'products') {
      if (method === 'GET') {
        if (!(await need(ctx, 'products.read'))) return;
        return json(200, { status: 'ok', items: await listInternal(cfg.db) });
      }
      if (method === 'POST') {
        if (!(await need(ctx, 'products.create'))) return;
        const v = validateCreate(req.body);
        if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors });
        if (v.product.price_paise !== null && !(await need(ctx, 'products.price'))) return;
        const item = await createProduct(cfg.db, v.product);
        if (!item) return json(409, { status: 'duplicate', message: 'A product with this slug already exists. Change the name or slug.' });
        // Every product starts with one pack size (its first variant) and, if a photo was given, a one-photo gallery.
        try {
          await rest(cfg.db, 'product_variants', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ product_id: item.id, sku: makeSku(item.slug, item.pack_size), pack_size: item.pack_size, price_paise: item.price_paise, sort_order: 10 }) });
          if (item.public_image && item.public_image_alt) await rest(cfg.db, 'rpc/replace_product_images', { method: 'POST', body: JSON.stringify({ p_product: item.id, p_images: [{ path: item.public_image, alt: item.public_image_alt }] }) });
        } catch {
          /* the variants/gallery tables come from supabase/variants_gallery.sql; creating the product must still work without them */
        }
        await audit('product_create', { id: item.id, slug: item.slug });
        return json(201, { status: 'ok', item });
      }
      if (method === 'PATCH') {
        if (!(await need(ctx, 'products.edit'))) return;
        const id = String(req.query.id ?? '');
        if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' });
        const v = validateUpdate(req.body);
        if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' ') });
        // Photos, pack sizes and prices have their own screens (gallery and variants) so there is one source of truth.
        for (const f of ['public_image', 'public_image_alt'] as const) if (f in v.update) return json(400, { status: 'invalid', message: 'Photos are managed in the photo gallery.' });
        for (const f of ['pack_size', 'price_paise'] as const) if (f in v.update) return json(400, { status: 'invalid', message: 'Pack sizes and prices are managed as pack-size variants.' });
        const PUBLICATION = ['status', 'ingredients_public', 'composition_verified', 'preservatives_verified', 'claims_reviewed', 'reviewed_by'];
        if (Object.keys(v.update).some((k) => PUBLICATION.includes(k)) && !(await need(ctx, 'products.status'))) return;
        const existing = await getInternal(cfg.db, id);
        if (!existing) return json(404, { status: 'error', message: 'Not found.' });
        const merged = { ...existing, ...v.update };
        const target = v.update.status ?? existing.status;
        const problems = publishProblems(merged, target, {
          screenText: 'public_name' in v.update || 'public_description' in v.update ? true : undefined,
          checkIngredients: v.update.ingredients_public === true ? true : undefined,
        });
        if (problems.length) {
          await audit('product_update_blocked', { id, target, problems });
          return json(409, { status: 'blocked', message: 'This change is not allowed yet.', problems });
        }
        const item = await updateProduct(cfg.db, id, v.update);
        await audit('product_update', { id, slug: existing.slug, from: existing.status, to: item.status, fields: Object.keys(v.update) });
        return json(200, { status: 'ok', item });
      }
    }

    if (action === 'export' && method === 'GET') {
      if (!(await need(ctx, 'subscribers.export'))) return;
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; offset < EXPORT_CAP; offset += 1000) {
        const r = await rest(cfg.db, `launch_subscribers?select=email,name,status,consented_at,confirmed_at,consent_text_version,created_at&status=eq.confirmed&order=created_at.asc&limit=1000&offset=${offset}`);
        if (!r.ok) throw new Error(`export ${r.status}`);
        const batch = (await r.json()) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      await audit('export_subscribers', { count: rows.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="kaayra-launch-list-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send('﻿' + toCsv(['email', 'name', 'status', 'consented_at', 'confirmed_at', 'consent_text_version', 'created_at'], rows));
    }

    // Inventory, orders, audit log, team, variants and photo gallery.
    if (await handleBackoffice(ctx, action)) return;
  } catch (e) {
    console.error(`admin api error (${action})`, e instanceof Error ? e.message : e);
    return json(502, { status: 'error', message: 'The database request failed. Try again.', hint: dbHint(e) });
  }

  return json(404, { status: 'error', message: 'Not found.' });
}

