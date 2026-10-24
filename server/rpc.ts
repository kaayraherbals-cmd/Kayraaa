import { parseRpcError, type RpcFailure } from '../shared/inventory.js';
import type { SupabaseConfig } from './supabase.js';
import { rest } from './supabase.js';

export type RpcResult<T> = { ok: true; data: T } | { ok: false; failure: RpcFailure };

/** Calls a database function. Raised "KH:" errors become plain-language failures; a duplicate key becomes a conflict. */
/**
 * What may be logged about a database error: the SQLSTATE code, and the message only when it is one of our own "KH:" codes.
 * PostgREST/Postgres `details`, `hint` and generic messages can quote the failing row (an email address, a street), so they are never logged.
 */
export function safeDbError(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as { code?: unknown; message?: unknown };
  const code = typeof b.code === 'string' ? b.code.slice(0, 10) : '';
  const msg = typeof b.message === 'string' && /^KH:[A-Z_]+/.test(b.message) ? b.message.slice(0, 80) : '';
  return [code && `code=${code}`, msg].filter(Boolean).join(' ');
}

export async function rpc<T = null>(db: SupabaseConfig, fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const r = await rest(db, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const body = (await r.json().catch(() => null)) as unknown;
  if (r.ok) return { ok: true, data: body as T };
  if (typeof body === 'object' && body !== null && (body as { code?: unknown }).code === '23505') {
    return { ok: false, failure: { kind: 'state', message: 'That already exists (for example, the same batch number for this pack size).' } };
  }
  const failure = parseRpcError(body);
  if (failure.kind === 'unknown') console.error(`rpc ${fn} failed`, r.status, safeDbError(body));
  return { ok: false, failure };
}
