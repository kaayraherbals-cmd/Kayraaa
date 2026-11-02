import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, createLimiter, isLimited, isSecureDeployment, originAllowed } from '../../server/http.js';
import { auditEvent, deleteMember, findMemberByEmail, upsertMember } from '../../server/members.js';
import {
  ADMIN_TTL_SECONDS,
  MEMBER_TTL_SECONDS,
  OAUTH_COOKIE,
  SETUP_COOKIE,
  USER_COOKIE,
  buildAuthorizeUrl,
  clearOauthCookie,
  clearSetupCookie,
  clearUserCookie,
  decideAccess,
  isProvider,
  makePkce,
  oauthCookie,
  parseProviders,
  safeNext,
  setupCookie,
  signToken,
  userCookie,
  verifyToken,
  type DenyReason,
  type Intent,
  type Provider,
  type Role,
} from '../../server/oauth.js';
import { cleanEmail, cleanName, passwordProblem } from '../../server/password.js';
import { exchangeCode, passwordLogin, recover, setPasswordAndName, signUp, type GoTrueUser } from '../../server/gotrue.js';
import { MIN_SECRET_LENGTH, clearCookie, isAdminEmail, parseAdminEmails, sessionCookie, signSession } from '../../server/session.js';
import { supabaseConfig, type SupabaseConfig } from '../../server/supabase.js';
import { withErrorCode } from '../../server/errors.js';

/**
 * Member sign-in and sign-up.
 *  - Email + password: Supabase Auth stores the password hash; we verify the email by link (PKCE) before the first sign-in.
 *  - Google (and optional GitHub/Microsoft): server-side PKCE. A person who arrives this way is asked for their name and
 *    a password (with confirmation) before they are let in, so they can also sign in manually later.
 *  - Forgot password: emailed link, then the same "set a password" step.
 * Provider tokens never reach the browser. Admin rights come only from ADMIN_EMAILS.
 */

interface AuthConfig {
  db: SupabaseConfig;
  anonKey: string;
  secret: string;
  admins: string[];
  providers: Provider[];
  origin: string;
  signupOpen: boolean;
}

function authConfig(req: VercelRequest): AuthConfig | null {
  const db = supabaseConfig();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  const configured = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? '').trim().replace(/\/$/, '');
  // In production the redirect target must be configured, never taken from the request's Host header.
  const origin = configured || (isSecureDeployment() ? '' : `http://${req.headers.host ?? 'localhost:3000'}`);
  if (!db || !anonKey || secret.length < MIN_SECRET_LENGTH || !origin) {
    // Names only, never values. Shows up in Vercel > Logs so the owner can see exactly what is missing.
    const missing = [
      !process.env.SUPABASE_URL?.trim() && 'SUPABASE_URL',
      !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && 'SUPABASE_SERVICE_ROLE_KEY',
      !anonKey && 'SUPABASE_ANON_KEY',
      secret.length < MIN_SECRET_LENGTH && `ADMIN_SESSION_SECRET (needs ${MIN_SECRET_LENGTH}+ characters)`,
      !origin && 'SITE_URL',
    ].filter(Boolean);
    console.error(`[KH-AUTH-010] Sign-in not configured. Missing or invalid: ${missing.join(', ')}`);
    return null;
  }
  return {
    db,
    anonKey,
    secret,
    admins: parseAdminEmails(process.env.ADMIN_EMAILS),
    providers: parseProviders(process.env.OAUTH_PROVIDERS),
    origin,
    signupOpen: (process.env.MEMBER_SIGNUP ?? 'open').trim().toLowerCase() !== 'closed',
  };
}

const MIN = 60 * 1000;
const startLimiter = createLimiter(15 * MIN, 40, 'auth_start');
const callbackLimiter = createLimiter(15 * MIN, 40, 'auth_callback');
const loginIpLimiter = createLimiter(15 * MIN, 30, 'auth_login_ip');
const loginEmailLimiter = createLimiter(15 * MIN, 8, 'auth_login_email');
const registerLimiter = createLimiter(60 * MIN, 10, 'auth_register');
const forgotLimiter = createLimiter(60 * MIN, 6, 'auth_forgot');
const setupLimiter = createLimiter(15 * MIN, 20, 'auth_setup');

const EMAIL_FLOW_TTL = 24 * 60 * 60;
const RECOVERY_FLOW_TTL = 60 * 60;

function json(res: VercelResponse, status: number, body: unknown) {
  // Error responses gain a catalogue code (errorCode) and a log reference (ref); see shared/errors.ts.
  return res.status(status).json(withErrorCode('AUTH', status, body));
}

const failurePage = (intent: Intent) => (intent === 'admin' ? '/admin' : '/login');

function redirect(res: VercelResponse, to: string, cookies: string[] = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', to);
  return res.status(302).end();
}

function fail(res: VercelResponse, intent: Intent, code: string, secure: boolean) {
  return redirect(res, `${failurePage(intent)}?error=${encodeURIComponent(code)}`, [clearOauthCookie(secure)]);
}

/**
 * Our cookies are SameSite=Strict, and a redirect that began on another site (Google, then Supabase, or an email link) is still
 * treated as cross-site, so the browser would not send them on the very next page. A page on our own origin that navigates
 * onward (meta refresh, allowed by the CSP) starts a same-site navigation and the cookies are sent.
 */
function handoff(res: VercelResponse, to: string, cookies: string[]) {
  res.setHeader('Set-Cookie', cookies);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).send(HANDOFF_HTML.replaceAll('__TO__', to));
}

// Inline CSS is allowed by the site's CSP (style-src 'unsafe-inline'); scripts are not, so this page needs none.
const HANDOFF_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=__TO__"><title>Signing you in | Kaayra Herbals</title>
<style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#f7f5ef;color:#252b27;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
main{text-align:center;display:grid;gap:1.1rem;justify-items:center;animation:in .35s cubic-bezier(.22,.61,.36,1) both}
.brand{font-family:'Cormorant Garamond',Georgia,serif;font-size:2rem;font-weight:600;letter-spacing:.02em;color:#173a2d}
.brand span{color:#7d5b2c}
.ring{width:1.6rem;height:1.6rem;border-radius:50%;border:2px solid rgba(23,58,45,.18);border-top-color:#173a2d;animation:spin .7s linear infinite}
p{margin:0;font-size:.95rem}
a{color:#173a2d}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head>
<body><main role="status"><div class="brand">Kaayra<span> Herbals</span></div><div class="ring" aria-hidden="true"></div><p>Signing you in… <a href="__TO__">Continue</a></p></main></body></html>`;


const asName = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

function readBody(req: VercelRequest): Record<string, unknown> {
  const b = req.body as unknown;
  if (b && typeof b === 'object') return b as Record<string, unknown>;
  if (typeof b === 'string') {
    try {
      const p = JSON.parse(b) as unknown;
      if (p && typeof p === 'object') return p as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

interface Pending {
  id: string;
  email: string;
  name: string | null;
  provider: string;
  mode: 'setup' | 'reset';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const action = String(req.query.action ?? '');
  const method = req.method ?? 'GET';
  const secure = isSecureDeployment();

  const cfg = authConfig(req);
  if (!cfg) {
    if (action === 'start' || action === 'callback') return redirect(res, '/login?error=unconfigured', [clearOauthCookie(secure)]);
    return json(res, 503, { status: 'unconfigured', message: 'Sign-in is not configured on the server.' });
  }

  // Anything that changes state needs a same-origin request plus a custom header.
  if (method !== 'GET' && !(originAllowed(req) && req.headers['x-kaayra-csrf'] === '1')) {
    return json(res, 403, { status: 'error', message: 'Request not allowed.' });
  }

  /** Signs the person in: cookies for the session, plus the admin cookie the /api/admin endpoints understand. */
  const sessionCookies = (email: string, name: string | null, role: Role) => {
    const ttl = role === 'admin' ? ADMIN_TTL_SECONDS : MEMBER_TTL_SECONDS;
    return [
      clearOauthCookie(secure),
      clearSetupCookie(secure),
      userCookie(signToken('user', { email, name, role }, cfg.secret, ttl), ttl, secure),
      ...(role === 'admin' ? [sessionCookie(signSession(email, cfg.secret), secure)] : []),
    ];
  };

  const accessFor = async (email: string, emailConfirmed: boolean, intent: Intent) => {
    const existing = await findMemberByEmail(cfg.db, email);
    const decision = decideAccess({ email, emailConfirmed, intent, adminEmails: cfg.admins, existingMember: Boolean(existing), signupOpen: cfg.signupOpen });
    return { decision, existing };
  };

  try {
    // ---- status: what the sign-in page needs to render ---------------------------------------------
    if (action === 'status' && method === 'GET') {
      return json(res, 200, { status: 'ok', providers: cfg.providers, signupOpen: cfg.signupOpen });
    }

    // ---- register: email + password ----------------------------------------------------------------
    if (action === 'register' && method === 'POST') {
      if (await isLimited(registerLimiter, clientIp(req))) return json(res, 429, { status: 'error', message: 'Too many attempts. Please wait a while and try again.' });
      if (!cfg.signupOpen) return json(res, 403, { status: 'error', message: 'We are not accepting new accounts right now.' });
      const b = readBody(req);
      const name = cleanName(b.name);
      const email = cleanEmail(b.email);
      if (!name) return json(res, 400, { status: 'error', field: 'name', message: 'Please enter your name (2 to 100 characters).' });
      if (!email) return json(res, 400, { status: 'error', field: 'email', message: 'Please enter a valid email address.' });
      const problem = passwordProblem(b.password, b.confirm, email);
      if (problem) return json(res, 400, { status: 'error', field: 'password', message: problem });
      if (b.consent !== true) return json(res, 400, { status: 'error', field: 'consent', message: 'Please agree to the Terms and Privacy Policy to continue.' });

      const { verifier, challenge } = makePkce();
      const r = await signUp(cfg.db, cfg.anonKey, { email, password: b.password as string, name, challenge, redirectTo: `${cfg.origin}/api/auth/callback` });
      if (!r.ok) {
        if (r.code === 'weak_password') return json(res, 400, { status: 'error', field: 'password', message: 'That password is too easy to guess. Please choose a stronger one.' });
        if (r.status === 429 || r.code === 'over_email_send_rate_limit') return json(res, 429, { status: 'error', message: 'We are sending too many emails right now. Please try again in a little while.' });
        console.error('register failed', r.status, r.code);
        return json(res, 502, { status: 'error', message: 'We could not create your account. Please try again.' });
      }
      await auditEvent(cfg.db, email, 'register_requested');
      // Supabase can be set to skip email confirmation; in that case nothing was sent and the person can sign in straight away.
      const verified = Boolean(r.user?.email_confirmed_at) || r.hasSession === true;
      const trip = signToken('oauth', { v: verifier, p: 'email', i: 'member', n: '' }, cfg.secret, EMAIL_FLOW_TTL);
      res.setHeader('Set-Cookie', [oauthCookie(trip, secure, EMAIL_FLOW_TTL)]);
      return json(res, 200, { status: 'ok', verify: !verified });
    }

    // ---- login: email + password -------------------------------------------------------------------
    if (action === 'login' && method === 'POST') {
      const ip = clientIp(req);
      const b = readBody(req);
      const email = cleanEmail(b.email);
      const password = typeof b.password === 'string' ? b.password : '';
      if ((await isLimited(loginIpLimiter, ip)) || (email && (await isLimited(loginEmailLimiter, email)))) {
        return json(res, 429, { status: 'error', message: 'Too many attempts. Please wait a few minutes and try again.' });
      }
      if (!email || !password || password.length > 200) return json(res, 400, { status: 'error', message: 'Enter your email and password.' });

      const r = await passwordLogin(cfg.db, cfg.anonKey, email, password);
      if (!r.ok || !r.user?.id) {
        if (r.code === 'email_not_confirmed') {
          return json(res, 403, { status: 'error', code: 'unverified', message: 'Please verify your email first. We sent you a link when you created the account.' });
        }
        if (r.status >= 500 || r.status === 429) return json(res, 502, { status: 'error', message: 'Sign-in is busy right now. Please try again shortly.' });
        await auditEvent(cfg.db, email, 'password_login_failed');
        return json(res, 401, { status: 'error', message: 'That email and password do not match.' });
      }

      const user = r.user;
      const { decision, existing } = await accessFor(email, Boolean(user.email_confirmed_at), 'member');
      if (!decision.ok) {
        await auditEvent(cfg.db, email, 'password_login_denied', { reason: decision.reason });
        const message = decision.reason === 'signup_closed' ? 'We are not accepting new accounts right now.' : 'Please verify your email first.';
        return json(res, 403, { status: 'error', message });
      }
      const role = decision.role;
      const name = asName(user.user_metadata?.full_name) ?? existing?.name ?? null;
      await upsertMember(cfg.db, { id: user.id!, email, name, role, provider: 'email', hasPassword: true });
      await auditEvent(cfg.db, email, role === 'admin' ? 'password_login_admin' : 'password_login_member');
      res.setHeader('Set-Cookie', sessionCookies(email, name, role));
      return json(res, 200, { status: 'ok', role, redirect: role === 'admin' ? '/admin' : '/account' });
    }

    // ---- forgot: always the same answer, whether or not the email has an account ----------------------
    if (action === 'forgot' && method === 'POST') {
      if (await isLimited(forgotLimiter, clientIp(req))) return json(res, 429, { status: 'error', message: 'Too many requests. Please wait a while and try again.' });
      const email = cleanEmail(readBody(req).email);
      if (!email) return json(res, 400, { status: 'error', message: 'Please enter a valid email address.' });
      const { verifier, challenge } = makePkce();
      const r = await recover(cfg.db, cfg.anonKey, { email, challenge, redirectTo: `${cfg.origin}/api/auth/callback` });
      if (r.status === 429 || r.code === 'over_email_send_rate_limit') {
        return json(res, 429, { status: 'error', message: 'We are sending too many emails right now. Please try again in a little while.' });
      }
      if (r.status >= 500) console.error('recover failed', r.status, r.code);
      const trip = signToken('oauth', { v: verifier, p: 'recovery', i: 'member', n: '' }, cfg.secret, RECOVERY_FLOW_TTL);
      res.setHeader('Set-Cookie', [oauthCookie(trip, secure, RECOVERY_FLOW_TTL)]);
      return json(res, 200, { status: 'ok' });
    }

    // ---- start: send the browser to the provider ------------------------------------------------
    if (action === 'start' && method === 'GET') {
      const intent: Intent = req.query.intent === 'admin' ? 'admin' : 'member';
      if (await isLimited(startLimiter, clientIp(req))) return fail(res, intent, 'rate_limited', secure);
      const provider = req.query.provider;
      if (!isProvider(provider) || !cfg.providers.includes(provider)) return fail(res, intent, 'bad_provider', secure);

      const { verifier, challenge } = makePkce();
      const roundTrip = signToken('oauth', { v: verifier, p: provider, i: intent, n: safeNext(req.query.next, '') }, cfg.secret, 10 * 60);
      return redirect(res, buildAuthorizeUrl(cfg.db.url, provider, `${cfg.origin}/api/auth/callback`, challenge), [oauthCookie(roundTrip, secure)]);
    }

    // ---- callback: Google, the sign-up confirmation link and the reset link all land here ---------------
    if (action === 'callback' && method === 'GET') {
      const trip = verifyToken<{ v: string; p: string; i: Intent; n: string }>('oauth', req.cookies?.[OAUTH_COOKIE], cfg.secret);
      const intent: Intent = trip?.i === 'admin' ? 'admin' : 'member';
      if (await isLimited(callbackLimiter, clientIp(req))) return fail(res, intent, 'rate_limited', secure);
      if (typeof req.query.error === 'string') return fail(res, intent, 'provider_denied', secure);
      const code = req.query.code;
      if (!trip) {
        // Opened the email link in a different browser than the one that asked for it.
        return fail(res, intent, typeof code === 'string' && code ? 'other_browser' : 'expired', secure);
      }
      if (typeof code !== 'string' || !code || code.length > 2048) return fail(res, intent, 'expired', secure);

      const user: GoTrueUser | null = await exchangeCode(cfg.db, cfg.anonKey, code, trip.v);
      if (!user) return fail(res, intent, 'expired', secure);
      const email = user.email?.trim().toLowerCase();
      if (!user.id || !email) return fail(res, intent, 'unverified_email', secure);

      const emailConfirmed = Boolean(user.email_confirmed_at) && user.user_metadata?.email_verified !== false;
      const { decision, existing } = await accessFor(email, emailConfirmed, intent);
      if (!decision.ok) {
        await auditEvent(cfg.db, email, 'oauth_denied', { reason: decision.reason, provider: trip.p });
        return fail(res, intent, decision.reason satisfies DenyReason, secure);
      }
      const role: Role = decision.role;
      const name = asName(user.user_metadata?.full_name) ?? asName(user.user_metadata?.name) ?? existing?.name ?? null;

      // Reset link, or a first Google sign-in (or an older Google-only member): choose a password before getting in.
      const needsPassword = trip.p === 'recovery' || (trip.p !== 'email' && intent === 'member' && !existing?.has_password);
      if (needsPassword) {
        const pending = signToken('setup', { id: user.id, email, name, provider: trip.p === 'recovery' ? 'email' : trip.p, mode: trip.p === 'recovery' ? 'reset' : 'setup' }, cfg.secret, 20 * 60);
        await auditEvent(cfg.db, email, trip.p === 'recovery' ? 'reset_link_used' : 'oauth_needs_password', { provider: trip.p });
        return handoff(res, '/set-password', [clearOauthCookie(secure), setupCookie(pending, secure)]);
      }

      await upsertMember(cfg.db, { id: user.id, email, name, role, provider: trip.p, ...(trip.p === 'email' ? { hasPassword: true } : {}) });
      await auditEvent(cfg.db, email, role === 'admin' ? 'oauth_login_admin' : 'oauth_login_member', { provider: trip.p, new_member: !existing && role === 'member' });
      return handoff(res, safeNext(trip.n, role === 'admin' ? '/admin' : '/account'), sessionCookies(email, name, role));
    }

    // ---- pending / set-password: the "name + password + confirm" step ---------------------------------
    if (action === 'pending' && method === 'GET') {
      const p = verifyToken<Pending & Record<string, unknown>>('setup', req.cookies?.[SETUP_COOKIE], cfg.secret);
      if (!p) return json(res, 401, { status: 'unauthorised', message: 'This step has expired. Please sign in again.' });
      return json(res, 200, { status: 'ok', email: p.email, name: p.name, mode: p.mode });
    }

    if (action === 'set-password' && method === 'POST') {
      if (await isLimited(setupLimiter, clientIp(req))) return json(res, 429, { status: 'error', message: 'Too many attempts. Please wait a few minutes and try again.' });
      const p = verifyToken<Pending & Record<string, unknown>>('setup', req.cookies?.[SETUP_COOKIE], cfg.secret);
      if (!p) return json(res, 401, { status: 'unauthorised', message: 'This step has expired. Please sign in again.' });
      const b = readBody(req);
      const name = cleanName(b.name) ?? (p.mode === 'reset' ? p.name : null);
      if (!name) return json(res, 400, { status: 'error', field: 'name', message: 'Please enter your name (2 to 100 characters).' });
      const problem = passwordProblem(b.password, b.confirm, p.email);
      if (problem) return json(res, 400, { status: 'error', field: 'password', message: problem });

      // Re-check access now (sign-up may have been closed since the link was issued).
      const { decision } = await accessFor(p.email, true, 'member');
      if (!decision.ok) return json(res, 403, { status: 'error', message: 'We are not accepting new accounts right now.' });

      const r = await setPasswordAndName(cfg.db, p.id, b.password as string, name);
      if (!r.ok) {
        if (r.code === 'weak_password') return json(res, 400, { status: 'error', field: 'password', message: 'That password is too easy to guess. Please choose a stronger one.' });
        console.error('set password failed', r.status, r.code);
        return json(res, 502, { status: 'error', message: 'We could not save your password. Please try again.' });
      }
      const role: Role = decision.role;
      await upsertMember(cfg.db, { id: p.id, email: p.email, name, role, provider: p.provider, hasPassword: true });
      await auditEvent(cfg.db, p.email, p.mode === 'reset' ? 'password_reset' : 'password_set', { provider: p.provider });
      res.setHeader('Set-Cookie', sessionCookies(p.email, name, role));
      return json(res, 200, { status: 'ok', redirect: '/account' });
    }

    // ---- everything below needs a signed-in user ---------------------------------------------------
    const clear = () => res.setHeader('Set-Cookie', [clearUserCookie(secure), clearCookie(secure), clearSetupCookie(secure)]);

    if (action === 'logout' && method === 'POST') {
      clear();
      return json(res, 200, { status: 'ok' });
    }

    const raw = verifyToken<{ email: string; name: string | null; role: Role }>('user', req.cookies?.[USER_COOKIE], cfg.secret);
    // Re-check on every request: removing an admin from the allowlist or deleting a member revokes access at once.
    let current: { email: string; name: string | null; role: Role } | null = null;
    if (raw && typeof raw.email === 'string') {
      if (raw.role === 'admin') current = isAdminEmail(raw.email, cfg.admins) ? { email: raw.email, name: raw.name ?? null, role: 'admin' } : null;
      else if (raw.role === 'member' && (await findMemberByEmail(cfg.db, raw.email))) current = { email: raw.email, name: raw.name ?? null, role: 'member' };
    }
    if (!current) {
      if (req.cookies?.[USER_COOKIE]) clear();
      return json(res, 401, { status: 'unauthorised', message: 'Sign in to continue.' });
    }

    if (action === 'session' && method === 'GET') return json(res, 200, { status: 'ok', ...current });

    if (action === 'delete-account' && method === 'POST') {
      if (current.role === 'admin') {
        return json(res, 403, { status: 'error', message: 'Administrator accounts are managed by the site owner and cannot be deleted here.' });
      }
      const member = await findMemberByEmail(cfg.db, current.email);
      if (member) await deleteMember(cfg.db, member.id);
      await auditEvent(cfg.db, current.email, 'member_deleted_self');
      clear();
      return json(res, 200, { status: 'ok' });
    }
  } catch (e) {
    console.error('auth api error', e instanceof Error ? e.message : e);
    if (action === 'start' || action === 'callback') return redirect(res, '/login?error=server', [clearOauthCookie(secure)]);
    return json(res, 502, { status: 'error', message: 'Something went wrong. Please try again.' });
  }

  return json(res, 404, { status: 'error', message: 'Not found.' });
}
