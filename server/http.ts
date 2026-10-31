import { createHash } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { isProductionEnv } from '../shared/flags.js';
import { rest, supabaseConfig } from './supabase.js';

export function clientIp(req: VercelRequest): string {
  // Vercel sets x-vercel-forwarded-for itself; a client cannot choose it. Fall back to x-forwarded-for (also overwritten by Vercel) and the socket.
  const h = req.headers;
  const v = h['x-vercel-forwarded-for'] ?? h['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown';
  return String(Array.isArray(v) ? v[0] : v).split(',')[0].trim() || 'unknown';
}

/** Same-origin (or explicitly allowed origin) check for state-changing requests. */
export function originAllowed(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const o = new URL(origin);
    return o.host === req.headers.host || allowed.includes(o.origin);
  } catch {
    return false;
  }
}

/**
 * A limiter has two layers.
 *  1. In memory, per serverless instance: instant, free, catches a burst on one instance. Not shared.
 *  2. Shared: a counter in the database (supabase/rate_limits.sql, function rate_limit_hit) that every instance sees.
 * Only a salted SHA-256 of the key is stored, never an IP address or email.
 *
 * What happens when the shared counter cannot be reached is a per-limiter POLICY (the 4th argument):
 *  - 'open' (default; public forms, customer sign-in, reads, verify and status of a payment): the in-memory limit still applies and the
 *    request goes ahead. A database outage must not lock customers out, and must never stop a payment from being recorded.
 *  - 'closed' (admin sign-in and two-step codes; placing an order; starting a payment): the request is refused with "unavailable".
 *    Nothing is charged or created when that happens, so retrying later is safe. Placing an order and starting a payment are also
 *    idempotent in the database, so a refusal cannot cause a double charge.
 * Recovery for a closed limiter: fix the database (run supabase/rate_limits.sql, restore the connection), or, if an owner must sign
 * in during an outage, set RATE_LIMIT_BREAKGLASS_UNTIL to an ISO time at most 60 minutes ahead and redeploy. It switches the closed
 * limiters to in-memory-only until that time, expires by itself, and writes one log line per instance per minute. RATE_LIMIT_SHARED=off
 * is honoured by closed limiters only outside production.
 */
export type LimiterPolicy = 'open' | 'closed';
export type SharedResult = 'ok' | 'limited' | 'unavailable' | 'off';
export interface Limiter {
  (key: string): boolean;
  readonly policy: LimiterPolicy;
  /** Count one hit in the shared store. 'off' means this limiter has no shared layer (no name, switched off, or no database configured). */
  sharedCheck(key: string): Promise<SharedResult>;
  /** Same, as a boolean: true only when over the limit. */
  shared(key: string): Promise<boolean>;
}
export type LimitDecision = 'allow' | 'limited' | 'unavailable';

export const sharedKeyHash = (bucket: string, key: string, salt: string): string => createHash('sha256').update(`${salt}|${bucket}|${key}`).digest('hex');

export const BREAKGLASS_MAX_MINUTES = 60;
/** True while a valid, short, owner-set break-glass window is open. */
export function breakGlassActive(env: Record<string, string | undefined> = process.env, now: number = Date.now()): boolean {
  const raw = (env.RATE_LIMIT_BREAKGLASS_UNTIL ?? '').trim();
  if (!raw) return false;
  const until = Date.parse(raw);
  if (Number.isNaN(until)) return false;
  // A window more than an hour away is refused outright: a forgotten far-future value must not become a permanent bypass.
  return until > now && until - now <= BREAKGLASS_MAX_MINUTES * 60_000;
}

const warned = new Map<string, number>();
function warnOnce(tag: string, message: string) {
  const t = Date.now();
  if (t - (warned.get(tag) ?? 0) > 60_000) {
    warned.set(tag, t);
    console.error(message);
  }
}

export function createLimiter(windowMs: number, max: number, name?: string, policy: LimiterPolicy = 'open'): Limiter {
  const hits = new Map<string, number[]>();
  const limited = function limited(key: string): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return recent.length > max;
  } as { (key: string): boolean; policy: LimiterPolicy; sharedCheck: Limiter['sharedCheck']; shared: Limiter['shared'] };
  (limited as { policy: LimiterPolicy }).policy = policy;
  limited.sharedCheck = async (key: string): Promise<SharedResult> => {
    const disabled = (process.env.RATE_LIMIT_SHARED ?? '').trim().toLowerCase() === 'off';
    // A closed limiter ignores the switch-off in production: it must not be turned off by one variable.
    if (!name || (disabled && !(policy === 'closed' && isProductionEnv(process.env)))) return 'off';
    const db = supabaseConfig();
    if (!db) return policy === 'closed' ? 'unavailable' : 'off';
    const salt = process.env.RATE_LIMIT_SALT?.trim() || process.env.ADMIN_SESSION_SECRET?.trim() || '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      const r = await rest(db, 'rpc/rate_limit_hit', {
        method: 'POST',
        signal: ctl.signal,
        body: JSON.stringify({ p_bucket: name, p_key_hash: sharedKeyHash(name, key, salt), p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)), p_max: max }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const v = await r.json();
      if (typeof v !== 'boolean') throw new Error('unexpected reply');
      return v ? 'limited' : 'ok';
    } catch {
      // Never log the key. At most one line a minute per limiter.
      warnOnce(name, `rate limit store unavailable for ${name} (policy ${policy})`);
      return 'unavailable';
    } finally {
      clearTimeout(timer);
    }
  };
  limited.shared = async (key: string): Promise<boolean> => (await limited.sharedCheck(key)) === 'limited';
  return limited as Limiter;
}

/**
 * The full decision. In-memory first (it spares the database when it already says no), then the shared counter. When the shared
 * counter is unavailable, the limiter's policy decides; a valid break-glass window turns a closed limiter into in-memory-only.
 */
export async function limitDecision(limiter: Limiter, key: string): Promise<LimitDecision> {
  if (limiter(key)) return 'limited';
  const r = await limiter.sharedCheck(key);
  if (r === 'limited') return 'limited';
  if (r === 'unavailable' && limiter.policy === 'closed') {
    if (breakGlassActive()) {
      warnOnce('breakglass', 'rate limit break-glass window is active: closed limiters are using in-memory limits only');
      return 'allow';
    }
    return 'unavailable';
  }
  return 'allow';
}

/** True when the caller is over the limit on either layer. Does not refuse on 'unavailable': use limitDecision for closed limiters. */
export async function isLimited(limiter: Limiter, key: string): Promise<boolean> {
  return (await limitDecision(limiter, key)) === 'limited';
}

export function isSecureDeployment(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}
