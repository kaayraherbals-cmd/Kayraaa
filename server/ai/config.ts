import { AI_DEFAULT_MODEL, modelProblem } from '../../shared/ai.js';

/**
 * Gemini settings, read from the environment on every call (so a redeploy with new values takes effect and tests can pass their own).
 * The key is server only. It must never be given a VITE_ name: anything with that prefix is copied into the public bundle.
 */
export type ProviderId = 'gemini' | 'groq' | 'anthropic';
export const PROVIDER_IDS: readonly ProviderId[] = ['gemini', 'groq', 'anthropic'];
export const PROVIDER_LABELS: Record<ProviderId, string> = { gemini: 'Gemini', groq: 'Groq', anthropic: 'Claude (Anthropic)' };
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-5-5';

export interface AiConfig {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  /** Requests per day for the whole site. The customer assistant may use 80% of it, owner tools get the rest (at least 20). */
  dailyLimit: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Optional Gemini "thinking" level (minimal, low, medium, high). Unset means the model's default. */
  thinkingLevel: string | null;
  /** Admin emails (already in ADMIN_EMAILS) that may use Kaayra Intelligence in addition to owners. */
  intelligenceEmails: string[];
  /** Indicative prices in US dollars per million tokens, used only for the cost estimate shown to the owner. */
  priceInPerM: number;
  priceOutPerM: number;
  /** Backup providers, used in AI_PROVIDER_ORDER when the one before them is out of allowance or down. Keys are server only. */
  groqKey: string | null;
  groqModel: string;
  anthropicKey: string | null;
  anthropicModel: string;
  providerOrder: ProviderId[];
  /** Names of settings that are wrong or missing (never values). */
  problems: string[];
  ready: boolean;
}

const num = (v: string | undefined, def: number, min: number, max: number): number => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && v !== undefined && v.trim() !== '' ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};
const price = (v: string | undefined, def: number): number => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n >= 0 && (v ?? '').trim() !== '' ? n : def;
};

export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const enabled = ['on', 'true', '1'].includes((env.AI_ENABLED ?? '').trim().toLowerCase());
  const key = (env.GEMINI_API_KEY ?? '').trim();
  const model = (env.GEMINI_MODEL ?? '').trim() || AI_DEFAULT_MODEL;
  const problems: string[] = [];
  const groqKey = (env.GROQ_API_KEY ?? '').trim();
  const anthropicKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  const groqModel = (env.GROQ_MODEL ?? '').trim() || GROQ_DEFAULT_MODEL;
  const anthropicModel = (env.ANTHROPIC_MODEL ?? '').trim() || ANTHROPIC_DEFAULT_MODEL;
  if (enabled && !key && !groqKey && !anthropicKey) problems.push('No AI key is set: add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY');
  const mp = key ? modelProblem(model) : null;
  if (mp) problems.push(mp);
  for (const [name, m] of [['GROQ_MODEL', groqModel], ['ANTHROPIC_MODEL', anthropicModel]] as const) if (!/^[a-z0-9][a-z0-9._:/-]{2,79}$/i.test(m)) problems.push(`${name} is not a valid model name`);
  const asked = (env.AI_PROVIDER_ORDER ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const unknown = asked.filter((x) => !(PROVIDER_IDS as readonly string[]).includes(x));
  if (unknown.length > 0) problems.push('AI_PROVIDER_ORDER can only list gemini, groq and anthropic');
  const providerOrder = [...new Set([...(asked.filter((x) => (PROVIDER_IDS as readonly string[]).includes(x)) as ProviderId[]), ...PROVIDER_IDS])];
  const level = (env.AI_THINKING_LEVEL ?? '').trim().toUpperCase();
  const thinkingLevel = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(level) ? level : null;
  if (level && !thinkingLevel) problems.push('AI_THINKING_LEVEL must be minimal, low, medium or high');
  const extra = (env.AI_INTELLIGENCE_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    enabled,
    apiKey: key || null,
    model,
    groqKey: groqKey || null,
    groqModel,
    anthropicKey: anthropicKey || null,
    anthropicModel,
    providerOrder,
    dailyLimit: num(env.AI_DAILY_REQUEST_LIMIT, 200, 10, 100000),
    maxOutputTokens: num(env.AI_MAX_OUTPUT_TOKENS, 1024, 128, 4096),
    timeoutMs: num(env.AI_TIMEOUT_MS, 20000, 3000, 55000),
    thinkingLevel,
    intelligenceEmails: extra,
    priceInPerM: price(env.AI_PRICE_INPUT_PER_M, 0.25),
    priceOutPerM: price(env.AI_PRICE_OUTPUT_PER_M, 1.5),
    problems,
    ready: enabled && Boolean(key || groqKey || anthropicKey) && problems.length === 0,
  };
}

export const customerDailyLimit = (c: AiConfig): number => Math.max(10, Math.floor(c.dailyLimit * 0.8));
export const adminDailyLimit = (c: AiConfig): number => Math.max(20, c.dailyLimit - customerDailyLimit(c));

/** Providers that have a key, in the order they are tried. */
export const configuredProviders = (c: AiConfig): ProviderId[] => c.providerOrder.filter((p) => (p === 'gemini' ? c.apiKey : p === 'groq' ? c.groqKey : c.anthropicKey) !== null);
export const modelOf = (c: AiConfig, p: ProviderId): string => (p === 'gemini' ? c.model : p === 'groq' ? c.groqModel : c.anthropicModel);
