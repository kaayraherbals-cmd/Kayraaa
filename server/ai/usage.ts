import { todayIST } from '../../shared/inventory.js';
import { rpc } from '../rpc.js';
import { rest, type SupabaseConfig } from '../supabase.js';
import type { AiConfig } from './config.js';

/**
 * Budget protection. Every Gemini call first reserves one request in a per-day, per-scope counter kept in the database (so it holds across
 * serverless instances). If the counter is unavailable (the SQL has not been run, or the database is down) the answer is "unavailable":
 * spending fails closed. Only counts are stored, never questions or answers.
 */
export type Scope = 'customer' | 'admin';
export type Reserve = 'ok' | 'limit' | 'unavailable';

export async function reserveRequest(db: SupabaseConfig, scope: Scope, limit: number, nowMs = Date.now()): Promise<Reserve> {
  const r = await rpc<boolean>(db, 'ai_usage_reserve', { p_day: todayIST(nowMs), p_scope: scope, p_limit: limit });
  if (!r.ok) return 'unavailable';
  return r.data === true ? 'ok' : 'limit';
}

export async function recordTokens(db: SupabaseConfig, scope: Scope, inputTokens: number, outputTokens: number, nowMs = Date.now()): Promise<void> {
  if (inputTokens <= 0 && outputTokens <= 0) return;
  await rpc(db, 'ai_usage_add_tokens', { p_day: todayIST(nowMs), p_scope: scope, p_in: Math.max(0, Math.floor(inputTokens)), p_out: Math.max(0, Math.floor(outputTokens)) }).catch(() => undefined);
}

export interface UsageDay { day: string; scope: Scope; requests: number; input_tokens: number; output_tokens: number }

export async function readUsage(db: SupabaseConfig, nowMs = Date.now()): Promise<UsageDay[] | null> {
  const since = todayIST(nowMs - 6 * 86_400_000);
  try {
    const r = await rest(db, `ai_usage_daily?select=day,scope,requests,input_tokens,output_tokens&day=gte.${since}&order=day.desc`);
    return r.ok ? ((await r.json()) as UsageDay[]) : null;
  } catch {
    return null;
  }
}

/** Indicative cost in US dollars from token counts and the configured per-million prices. An estimate, not a bill. */
export const estimateUsd = (rows: readonly UsageDay[], cfg: Pick<AiConfig, 'priceInPerM' | 'priceOutPerM'>): number => {
  const i = rows.reduce((s, r) => s + Number(r.input_tokens), 0);
  const o = rows.reduce((s, r) => s + Number(r.output_tokens), 0);
  return Math.round(((i * cfg.priceInPerM + o * cfg.priceOutPerM) / 1_000_000) * 10000) / 10000;
};
