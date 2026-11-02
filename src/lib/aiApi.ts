/** Browser side of Kaayra AI. Same-origin calls to /api/orders/ai-* (the customer assistant shares that function). No key or model name is ever in the browser. */
import { setHint } from './siteHints';
export interface AiTurn { role: 'user' | 'assistant'; text: string }
/** One of the signed-in customer's own orders, status-level facts only, read from the database by the server. */
export interface AiOrder { order_no: string; status: string; placed_on: string; total: string; shipments: { status: string; courier: string | null; tracking_no: string | null; estimated_delivery: string | null }[]; refunds: { status: string; amount: string }[] }
export type AiReply =
  | { ok: true; reply: string; products: string[]; orders: AiOrder[]; needsSignIn: boolean; handoff: boolean; followUps: string[] }
  | { ok: false; message: string; /** Why it failed: the widget shows its own translated wording for every kind except 'server' (a message the server wrote on purpose). */ kind?: 'timeout' | 'network' | 'limited' | 'invalid' | 'generic' | 'server'; /** The visitor stopped the question themselves: show nothing. */ stopped?: boolean };

/** The server gives Gemini 15 seconds; this is a little longer so its own friendly message arrives first. */
const CLIENT_TIMEOUT_MS = 22_000;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** Keeps only well-formed orders (the page never trusts the shape of a response). */
function orderList(v: unknown): AiOrder[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 3).flatMap((o): AiOrder[] => {
    if (typeof o !== 'object' || o === null) return [];
    const r = o as Record<string, unknown>;
    if (!str(r.order_no)) return [];
    const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null) : []);
    return [{
      order_no: str(r.order_no), status: str(r.status), placed_on: str(r.placed_on), total: str(r.total),
      shipments: list(r.shipments).map((s) => ({ status: str(s.status), courier: strOrNull(s.courier), tracking_no: strOrNull(s.tracking_no), estimated_delivery: strOrNull(s.estimated_delivery) })),
      refunds: list(r.refunds).map((x) => ({ status: str(x.status), amount: str(x.amount) })),
    }];
  });
}

let aiConfig: { at: number; promise: Promise<boolean | null> } | null = null;

/**
 * Whether Kaayra AI is on. One small request, shared by everything that asks within 20 s, and remembered for the next visit.
 * A network failure answers `false` but is neither remembered nor cached, so a blip never hides the button for a returning visitor.
 */
export function aiEnabled(): Promise<boolean> {
  if (!aiConfig || Date.now() - aiConfig.at > 20_000) {
    const promise = (async (): Promise<boolean | null> => {
      try {
        const r = await fetch('/api/orders/ai-config', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!r.ok) return null;
        const d = (await r.json()) as { enabled?: unknown };
        const on = d.enabled === true;
        setHint('aiOn', on);
        return on;
      } catch {
        return null;
      }
    })();
    aiConfig = { at: Date.now(), promise };
    void promise.then((v) => {
      if (v === null && aiConfig?.promise === promise) aiConfig = null;
    });
  }
  return aiConfig.promise.then((v) => v === true);
}

/** Fire and forget: asks the server to have the product information ready, so the first question is quicker. */
export function aiWarm(): void {
  void fetch('/api/orders/ai-warm', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).catch(() => undefined);
}

export async function aiChat(message: string, history: AiTurn[], signal?: AbortSignal, language?: string): Promise<AiReply> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; ctl.abort(); }, CLIENT_TIMEOUT_MS);
  const onStop = () => ctl.abort();
  signal?.addEventListener('abort', onStop, { once: true });
  try {
    const r = await fetch('/api/orders/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Kaayra-CSRF': '1' },
      credentials: 'same-origin',
      signal: ctl.signal,
      body: JSON.stringify({ message, history: history.slice(-6), language }),
    });
    const d = (await r.json().catch(() => null)) as { status?: string; reply?: string; products?: unknown; orders?: unknown; needsSignIn?: unknown; handoff?: unknown; followUps?: unknown; message?: string } | null;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
    if (r.ok && d?.status === 'ok' && typeof d.reply === 'string') return { ok: true, reply: d.reply, products: strings(d.products), orders: orderList(d.orders), needsSignIn: d.needsSignIn === true, handoff: d.handoff === true, followUps: strings(d.followUps).slice(0, 3) };
    return { ok: false, message: d?.message ?? 'Kaayra AI is not available right now.', kind: r.status === 429 || d?.status === 'limited' ? 'limited' : d?.status === 'invalid' ? 'invalid' : d?.message ? 'server' : 'generic' };
  } catch {
    if (signal?.aborted && !timedOut) return { ok: false, message: '', stopped: true };
    return { ok: false, message: timedOut ? 'That took too long. Please try again.' : 'Could not reach Kaayra AI. Check your connection and try again.', kind: timedOut ? 'timeout' : 'network' };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onStop);
  }
}
