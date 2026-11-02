import { PROVIDER_LABELS, configuredProviders, modelOf, type AiConfig, type ProviderId } from './config.js';
import { generateJson, sdkTransport, type GeminiRequest, type GeminiResult, type RawReply, type Transport } from './gemini.js';

/**
 * Several AI providers behind one call. generateWithFallback() tries the configured providers in AI_PROVIDER_ORDER (default: Gemini, then
 * Groq, then Claude) and moves to the next one when a provider is out of allowance (HTTP 429), too slow, down, or gives an unusable reply.
 * A provider that just ran out of allowance is skipped for a couple of minutes so visitors do not wait for it. Same rules for every provider:
 * the prompt, the reply checks and the daily budget are unchanged, and no key, prompt or reply is ever logged.
 * The providers are plain HTTPS calls (no extra packages). Gemini keeps its official SDK.
 */
const FALL_BACK_ON = new Set(['quota', 'timeout', 'error', 'invalid']);
const COOLDOWN_MS: Record<string, number> = { quota: 120_000, error: 30_000, timeout: 20_000 };
const cooldown = new Map<ProviderId, number>();
export const clearProviderCooldowns = (): void => cooldown.clear();

const fail = (status: number): never => { throw Object.assign(new Error(`http ${status}`), { status, name: 'ApiError' }); };

/** The provider's own error type and message (for example "model not found" or "credit balance is too low"). Never the request, so no key or prompt can appear. */
async function reason(r: Response): Promise<string> {
  try {
    const d = (await r.json()) as { error?: { type?: unknown; message?: unknown; code?: unknown } };
    const e = d.error ?? {};
    const text = [e.type, e.code, e.message].filter((x) => typeof x === 'string' && x).join(': ');
    return text.replace(/\s+/g, ' ').slice(0, 200);
  } catch { return ''; }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  if (!r.ok) {
    const why = await reason(r);
    console.error(`ai provider http ${r.status}${why ? ` (${why})` : ''} from ${new URL(url).hostname}`);
    return fail(r.status);
  }
  return (await r.json()) as Record<string, unknown>;
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Groq (OpenAI-compatible chat API) in JSON mode. The schema is given in the prompt, and the reply is checked by the caller as usual. */
export const groqTransport: Transport = async (cfg, req, signal) => {
  const d = await postJson('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${cfg.groqKey ?? ''}` }, {
    model: cfg.groqModel,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${req.system}\nReturn only one JSON object that follows this JSON Schema: ${JSON.stringify(req.schema)}` },
      { role: 'user', content: req.user },
    ],
  }, signal);
  const choice = (Array.isArray(d.choices) ? d.choices[0] : undefined) as { message?: { content?: unknown }; finish_reason?: string } | undefined;
  const u = (d.usage ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown };
  return { text: typeof choice?.message?.content === 'string' ? choice.message.content : null, finishReason: choice?.finish_reason === 'length' ? 'MAX_TOKENS' : choice?.finish_reason, inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens) };
};

/** Claude (Anthropic Messages API). A forced tool call returns the reply as a structured object that matches the schema. */
export const anthropicTransport: Transport = async (cfg, req, signal) => {
  const d = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': cfg.anthropicKey ?? '', 'anthropic-version': '2023-06-01' }, {
    model: cfg.anthropicModel,
    max_tokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
    temperature: req.temperature ?? 0.3,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    tools: [{ name: 'reply', description: 'Give the reply in this exact structure.', input_schema: req.schema }],
    tool_choice: { type: 'tool', name: 'reply' },
  }, signal);
  const blocks = (Array.isArray(d.content) ? d.content : []) as { type?: string; input?: unknown }[];
  const tool = blocks.find((b) => b.type === 'tool_use');
  const u = (d.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
  return { text: tool?.input !== undefined ? JSON.stringify(tool.input) : null, finishReason: d.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : String(d.stop_reason ?? ''), inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) };
};

const TRANSPORTS: Record<ProviderId, Transport> = { gemini: sdkTransport, groq: groqTransport, anthropic: anthropicTransport };

/**
 * Tries each configured provider in order. `transport` is for tests: when given it replaces every provider's network call.
 * Returns the first usable result, tagged with the provider that gave it; if all fail, the last failure.
 */
export async function generateWithFallback(cfg: AiConfig, req: GeminiRequest, transport?: Transport): Promise<GeminiResult> {
  const all = configuredProviders(cfg);
  const now = Date.now();
  const awake = all.filter((p) => (cooldown.get(p) ?? 0) <= now);
  const order = awake.length > 0 ? awake : all; // if every provider is resting, try them anyway
  const total = Math.min(req.timeoutMs ?? cfg.timeoutMs, cfg.timeoutMs);
  const started = now;
  let last: GeminiResult = { ok: false, reason: 'error', inputTokens: 0, outputTokens: 0 };
  let inTokens = 0;
  let outTokens = 0;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i] as ProviderId;
    const left = total - (Date.now() - started);
    if (i > 0 && left < 2500) break;
    // While a backup is still waiting, a provider gets about 60% of the time left, so a slow one cannot use up the whole deadline.
    const slice = i < order.length - 1 ? Math.max(2500, Math.floor(left * 0.6)) : left;
    const res = await generateJson({ ...cfg, timeoutMs: Math.max(1000, slice) }, { ...req, timeoutMs: Math.max(1000, slice), ...(id === 'gemini' ? {} : { thinkingLevel: undefined }) }, transport ?? TRANSPORTS[id]);
    inTokens += res.inputTokens;
    outTokens += res.outputTokens;
    if (res.ok) return { ...res, inputTokens: inTokens, outputTokens: outTokens, provider: id };
    last = { ...res, inputTokens: inTokens, outputTokens: outTokens, provider: id };
    const rest = COOLDOWN_MS[res.reason];
    if (rest && order.length > 1) cooldown.set(id, Date.now() + rest);
    if (!FALL_BACK_ON.has(res.reason)) break;
    if (i < order.length - 1) console.error(`ai provider ${id} failed (${res.reason}); trying ${order[i + 1]}`);
  }
  return last;
}

/** For the owner screen: which providers are set up, in the order they are tried (never the keys). */
export const providerSummary = (cfg: AiConfig): { id: ProviderId; label: string; model: string; configured: boolean }[] => {
  const on = new Set(configuredProviders(cfg));
  return cfg.providerOrder.map((id) => ({ id, label: PROVIDER_LABELS[id], model: modelOf(cfg, id), configured: on.has(id) }));
};

export type { RawReply };
