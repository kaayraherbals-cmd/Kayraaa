import type { VercelRequest, VercelResponse } from '@vercel/node';
import { can, parseAdminRoles, type AdminRole, type Permission } from '../../shared/roles.js';
import { withErrorCode } from '../errors.js';
import { parseMfaMode, type MfaMode } from '../mfa.js';
import { parseAdminEmails, MIN_SECRET_LENGTH } from '../session.js';
import { rest, supabaseConfig, type SupabaseConfig } from '../supabase.js';
import { MIN_MFA_KEY_LENGTH } from '../totp.js';

export interface AdminConfig {
  db: SupabaseConfig;
  anonKey: string;
  secret: string;
  admins: string[];
  roles: Record<string, AdminRole>;
  mfaMode: MfaMode;
  /** Key that encrypts authenticator secrets. Null only when two-step is optional and no key is set (setup is then unavailable). */
  mfaKey: string | null;
}

export type ConfigResult = { ok: true; cfg: AdminConfig } | { ok: false; missing: string[] };

/** Reads and checks the admin settings. Names of missing or invalid variables are returned (never their values). */
export function loadAdminConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const missing: string[] = [];
  const db = supabaseConfig();
  if (!db) missing.push('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = env.SUPABASE_ANON_KEY?.trim() ?? '';
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  const secret = env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) missing.push('ADMIN_SESSION_SECRET (32+ characters)');
  const admins = parseAdminEmails(env.ADMIN_EMAILS);
  if (admins.length === 0) missing.push('ADMIN_EMAILS');
  const roles = parseAdminRoles(env.ADMIN_ROLES, admins);
  if (!roles.ok) {
    missing.push('ADMIN_ROLES (invalid)');
    console.error(`ADMIN_ROLES problems: ${roles.problems.join('; ')}`);
  }
  const mfaMode = parseMfaMode(env.ADMIN_MFA);
  const key = env.ADMIN_MFA_KEY?.trim() ?? '';
  const mfaKey = key.length >= MIN_MFA_KEY_LENGTH ? key : null;
  if (mfaMode === 'required' && !mfaKey) missing.push('ADMIN_MFA_KEY (32+ characters), or set ADMIN_MFA=optional');
  if (missing.length || !db) return { ok: false, missing };
  return { ok: true, cfg: { db, anonKey, secret, admins, roles: roles.roles, mfaMode, mfaKey } };
}

export interface AdminCtx {
  req: VercelRequest;
  res: VercelResponse;
  cfg: AdminConfig;
  email: string;
  role: AdminRole;
  /** Selling switch, passed in so tests can exercise the unlocked path. Production code passes COMMERCE_ENABLED. */
  commerceEnabled: boolean;
  json: (status: number, body: unknown) => VercelResponse;
  audit: (action: string, detail?: Record<string, unknown>) => Promise<void>;
}

export const bodyOf = (req: VercelRequest): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});

export function makeJson(res: VercelResponse) {
  // Error responses gain a catalogue code (errorCode) and a log reference (ref); see shared/errors.ts.
  return (status: number, body: unknown) => res.status(status).json(withErrorCode('ADMIN', status, body));
}

export async function writeAudit(cfg: AdminConfig, actor: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    await rest(cfg.db, 'admin_audit', { method: 'POST', body: JSON.stringify({ actor, action, detail }) });
  } catch {
    /* best effort */
  }
}

/** Sends 403 and records the attempt when the role lacks the permission. Returns true when allowed. */
export async function need(ctx: AdminCtx, permission: Permission): Promise<boolean> {
  if (can(ctx.role, permission)) return true;
  await ctx.audit('permission_denied', { permission, method: ctx.req.method, action: String(ctx.req.query.action ?? '') });
  ctx.json(403, { status: 'forbidden', message: 'Your role does not have permission for this action.', permission });
  return false;
}

export const PAGE_SIZE = 25;
export const pageRange = (page: number) => `limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`;
export function totalOf(res: Response): number {
  const m = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
  return m ? Number(m[1]) : 0;
}
