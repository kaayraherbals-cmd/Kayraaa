import { CONTENT_KINDS, CONTENT_LABELS, cleanText, replyProblems, unsupportedNumbers, type ContentKind } from '../../shared/ai.js';
import { isUuid } from '../../shared/cart.js';
import { todayIST } from '../../shared/inventory.js';
import { can } from '../../shared/roles.js';
import { loadAiConfig, adminDailyLimit, customerDailyLimit, type AiConfig } from '../ai/config.js';
import { loadSnapshot, snapshotIsEmpty, type Snapshot } from '../ai/data.js';
import { buildPanels } from '../ai/panels.js';
import { FAILURE_MESSAGE, type Transport } from '../ai/gemini.js';
import { generateWithFallback, providerSummary } from '../ai/providers.js';
import { PROVIDER_LABELS } from '../ai/config.js';
import { BRIEFING_QUESTION, CONTENT_SCHEMA, INTELLIGENCE_SCHEMA, INTELLIGENCE_SYSTEM, contentSystem } from '../ai/prompts.js';
import { estimateUsd, readUsage, recordTokens, reserveRequest } from '../ai/usage.js';
import { safeJson } from '../ai/customer.js';
import { createLimiter, limitDecision } from '../http.js';
import { rest } from '../supabase.js';
import { bodyOf, need, type AdminCtx } from './ctx.js';

/**
 * Kaayra Intelligence (owner assistant), the daily briefing, usage monitoring and the AI Content Studio, inside the existing admin API.
 * It runs behind the same session, two-step sign-in, CSRF and role checks as every other admin action (api/admin/[action].ts).
 * The model gets pre-calculated, permission-filtered aggregates only; it has no tools, no database access and no way to change anything.
 */
const adminLimiter = createLimiter(5 * 60 * 1000, 20, 'ai_admin', 'closed');
const DRAFT_COLUMNS = 'id,kind,product_id,topic,body,status,flags,model,created_by,created_at,decided_by,decided_at';
const NEEDS_PRODUCT: ReadonlySet<ContentKind> = new Set(['product_description', 'product_summary', 'seo_title', 'meta_description', 'product_faq']);

export interface AiDeps { cfg?: AiConfig; transport?: Transport; now?: number }

/** Owners, plus admins named in AI_INTELLIGENCE_EMAILS. Enforced here on the server, never by the model or the browser. */
export const mayUseIntelligence = (ctx: AdminCtx, ai: AiConfig): boolean => can(ctx.role, 'ai.intelligence') || ai.intelligenceEmails.includes(ctx.email.toLowerCase());

async function denyIntelligence(ctx: AdminCtx): Promise<false> {
  await ctx.audit('permission_denied', { permission: 'ai.intelligence', method: ctx.req.method, action: String(ctx.req.query.action ?? '') });
  ctx.json(403, { status: 'forbidden', message: 'Kaayra Intelligence is only available to the owner and admins the owner has authorised.', permission: 'ai.intelligence' });
  return false;
}

type Gate = { ok: true } | { ok: false };
/** Shared checks before any model call: configured, per-person limit, daily budget. Sends the response itself when it says no. */
async function gate(ctx: AdminCtx, ai: AiConfig): Promise<Gate> {
  if (!ai.ready) { ctx.json(503, { status: 'unavailable', message: ai.enabled ? 'AI is not configured correctly.' : 'AI is switched off. Set AI_ENABLED=on and at least one AI key (GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY) in Vercel.', problems: ai.problems }); return { ok: false }; }
  const d = await limitDecision(adminLimiter, ctx.email);
  if (d === 'unavailable') { ctx.json(503, { status: 'unavailable', message: 'The rate limiter is unavailable, so AI requests are paused.' }); return { ok: false }; }
  if (d === 'limited') { ctx.json(429, { status: 'limited', message: 'Too many AI requests. Wait a few minutes.' }); return { ok: false }; }
  const b = await reserveRequest(ctx.cfg.db, 'admin', adminDailyLimit(ai));
  if (b === 'unavailable') { ctx.json(503, { status: 'unavailable', message: 'The AI usage counter is unavailable, so AI is paused.', hint: 'Run supabase/ai.sql (order in docs/DATABASE_MIGRATIONS.md).' }); return { ok: false }; }
  if (b === 'limit') { ctx.json(429, { status: 'limit', message: 'The daily AI allowance is used up. It resets tomorrow (India time), or raise AI_DAILY_REQUEST_LIMIT.' }); return { ok: false }; }
  return { ok: true };
}

/** Asks Gemini to explain the verified figures. A reply containing a number that is not in the figures is withheld. */
async function explain(ctx: AdminCtx, ai: AiConfig, snap: Snapshot, question: string, transport?: Transport): Promise<{ answer: string; provider?: string } | { error: string; status: 'error' | 'unverified' }> {
  const figures = safeJson(snap);
  // Thinking tokens count toward the output cap, so the cap is generous and thinking is minimal: a cut-off answer helps nobody.
  const ask = (maxOutputTokens: number) => generateWithFallback({ ...ai, timeoutMs: ai.timeoutMs }, { system: INTELLIGENCE_SYSTEM, user: `<data>${safeJson({ verified_figures: snap, owner_question: question })}</data>`, schema: INTELLIGENCE_SCHEMA as unknown as Record<string, unknown>, temperature: 0.2, thinkingLevel: 'MINIMAL', maxOutputTokens, timeoutMs: 30_000 }, transport);
  let r = await ask(Math.max(ai.maxOutputTokens, 3072));
  await recordTokens(ctx.cfg.db, 'admin', r.inputTokens, r.outputTokens);
  if (!r.ok && r.reason === 'truncated') { r = await ask(8192); await recordTokens(ctx.cfg.db, 'admin', r.inputTokens, r.outputTokens); }
  if (!r.ok) return { status: 'error', error: FAILURE_MESSAGE[r.reason] };
  const answer = typeof r.json.answer === 'string' ? r.json.answer.trim().slice(0, 3000) : '';
  if (!answer) return { status: 'error', error: FAILURE_MESSAGE.invalid };
  const bad = unsupportedNumbers(answer, figures);
  if (bad.length > 0) return { status: 'unverified', error: 'The assistant wrote a figure that is not in your verified data, so the answer was withheld. The verified figures are shown below.' };
  return { answer, provider: r.provider ? PROVIDER_LABELS[r.provider] : undefined };
}

async function productFacts(ctx: AdminCtx, id: string): Promise<Record<string, unknown> | null> {
  const r = await rest(ctx.cfg.db, `products?select=internal_name,public_name,form,pack_size,ingredients,composition_verified,public_description&id=eq.${id}`);
  if (!r.ok) return null;
  const p = ((await r.json()) as { internal_name: string; public_name: string | null; form: string; pack_size: string; ingredients: string[]; composition_verified: boolean; public_description: string | null }[])[0];
  if (!p) return null;
  // Internal notes are never selected. Ingredients are offered only once the composition has been verified.
  return { name: p.public_name ?? p.internal_name, form: p.form, pack_size: p.pack_size, ...(p.composition_verified ? { verified_ingredients: p.ingredients } : { ingredients: 'not verified: do not mention ingredients' }), ...(p.public_description ? { approved_description: p.public_description } : {}) };
}

export const draftFlags = (text: string): string[] => replyProblems(text, []);

export async function handleAi(ctx: AdminCtx, action: string, deps: AiDeps = {}): Promise<boolean> {
  if (!action.startsWith('ai-')) return false;
  const { req, cfg, json, audit } = ctx;
  const method = req.method ?? 'GET';
  const ai = deps.cfg ?? loadAiConfig();
  const nowMs = deps.now ?? Date.now();
  const intel = mayUseIntelligence(ctx, ai);

  if (action === 'ai-status' && method === 'GET') {
    if (!intel && !can(ctx.role, 'ai.content')) return await denyIntelligence(ctx), true;
    const rows = await readUsage(cfg.db, nowMs);
    const today = todayIST(nowMs);
    const pick = (scope: 'customer' | 'admin') => rows?.find((r) => r.day === today && r.scope === scope);
    json(200, {
      status: 'ok', enabled: ai.enabled, ready: ai.ready, model: ai.model, providers: providerSummary(ai), problems: ai.problems, canIntelligence: intel, canContent: can(ctx.role, 'ai.content'),
      usage: rows === null ? null : {
        today: { customer: { requests: pick('customer')?.requests ?? 0, limit: customerDailyLimit(ai) }, admin: { requests: pick('admin')?.requests ?? 0, limit: adminDailyLimit(ai) } },
        last7Days: { requests: rows.reduce((s, r) => s + r.requests, 0), inputTokens: rows.reduce((s, r) => s + Number(r.input_tokens), 0), outputTokens: rows.reduce((s, r) => s + Number(r.output_tokens), 0), estimatedUsd: estimateUsd(rows, ai) },
      },
      privacy: 'Kaayra Intelligence sends only totals and product names (no customer names, emails, phones or addresses) to whichever provider answers: Gemini, then Groq, then Claude, in the order set in AI_PROVIDER_ORDER. On free tiers a provider may use prompts to improve its products (Google does for Gemini\'s free tier); check each provider\'s terms, or use paid keys if you want data excluded from training.',
    });
    return true;
  }

  // ---- Kaayra Intelligence --------------------------------------------------------------------------------------
  if (action === 'ai-snapshot' && method === 'GET') {
    if (!intel) return await denyIntelligence(ctx), true;
    const snap = await loadSnapshot(cfg.db, ctx.role, nowMs);
    json(200, { status: 'ok', snapshot: snap, empty: snapshotIsEmpty(snap) });
    return true;
  }

  if (action === 'ai-ask' && method === 'POST') {
    if (!intel) return await denyIntelligence(ctx), true;
    const question = cleanText(bodyOf(req).question, 300);
    if (question.length < 3) return json(400, { status: 'invalid', message: 'Type a question first.' }), true;
    // The figures are read while the limit checks run (they used to run one after the other). Read-only, so nothing is lost if a check says no.
    const snapPromise = loadSnapshot(cfg.db, ctx.role, nowMs);
    snapPromise.catch(() => undefined);
    if (!(await gate(ctx, ai)).ok) return true;
    const snap = await snapPromise;
    const out = await explain(ctx, ai, snap, question, deps.transport);
    await audit('ai_ask', { chars: question.length, ok: 'answer' in out });
    // The panels are copied from the verified figures, not written by the model, so they are shown whatever the AI did, including when every provider failed.
    const panels = buildPanels(snap, question);
    if ('answer' in out) json(200, { status: 'ok', answer: out.answer, provider: out.provider, panels });
    else json(out.status === 'unverified' ? 200 : 502, { status: out.status, message: out.error, panels });
    return true;
  }

  if (action === 'ai-briefing' && method === 'GET') {
    if (!intel) return await denyIntelligence(ctx), true;
    const r = await rest(cfg.db, `ai_briefings?select=narrative,model,generated_by,generated_at&day=eq.${todayIST(nowMs)}`);
    const row = r.ok ? ((await r.json()) as { narrative: string; model: string; generated_by: string; generated_at: string }[])[0] ?? null : null;
    json(200, { status: 'ok', briefing: row });
    return true;
  }

  if (action === 'ai-briefing' && method === 'POST') {
    if (!intel) return await denyIntelligence(ctx), true;
    const day = todayIST(nowMs);
    const existing = await rest(cfg.db, `ai_briefings?select=day&day=eq.${day}`);
    const has = existing.ok && ((await existing.json()) as unknown[]).length > 0;
    if (has && bodyOf(req).regenerate !== true) return json(409, { status: 'conflict', message: 'Today\'s briefing already exists. Choose regenerate to replace it.' }), true;
    const snapPromise = loadSnapshot(cfg.db, ctx.role, nowMs);
    snapPromise.catch(() => undefined);
    if (!(await gate(ctx, ai)).ok) return true;
    const snap = await snapPromise;
    if (snapshotIsEmpty(snap)) return json(200, { status: 'empty', message: 'Not enough data available yet.' }), true;
    const out = await explain(ctx, ai, snap, BRIEFING_QUESTION, deps.transport);
    if (!('answer' in out)) { await audit('ai_briefing', { ok: false }); return json(out.status === 'unverified' ? 200 : 502, { status: out.status, message: out.error }), true; }
    const save = await rest(cfg.db, 'ai_briefings?on_conflict=day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ day, narrative: out.answer, model: ai.model, generated_by: ctx.email, generated_at: new Date(nowMs).toISOString() }) });
    await audit('ai_briefing', { ok: save.ok, regenerated: has });
    if (!save.ok) return json(502, { status: 'error', message: 'The briefing was written but could not be saved. Run supabase/ai.sql.' }), true;
    json(200, { status: 'ok', briefing: { narrative: out.answer, model: ai.model, generated_by: ctx.email, generated_at: new Date(nowMs).toISOString() } });
    return true;
  }

  // ---- AI Content Studio (drafts only; nothing is published or written to a product) ---------------------------------
  if (action === 'ai-drafts' && method === 'GET') {
    if (!(await need(ctx, 'ai.content'))) return true;
    const r = await rest(cfg.db, `ai_drafts?select=${DRAFT_COLUMNS}&order=created_at.desc&limit=40`);
    if (!r.ok) return json(502, { status: 'error', message: 'Could not load drafts.', hint: 'Run supabase/ai.sql.' }), true;
    json(200, { status: 'ok', items: await r.json() });
    return true;
  }

  if (action === 'ai-content' && method === 'POST') {
    if (!(await need(ctx, 'ai.content'))) return true;
    const b = bodyOf(req);
    const kind = typeof b.kind === 'string' && (CONTENT_KINDS as readonly string[]).includes(b.kind) ? (b.kind as ContentKind) : null;
    if (!kind) return json(400, { status: 'invalid', message: 'Choose what to write.' }), true;
    const productId = typeof b.product_id === 'string' && isUuid(b.product_id) ? b.product_id.toLowerCase() : null;
    const topic = cleanText(b.topic, 200) || null;
    if (NEEDS_PRODUCT.has(kind) && !productId) return json(400, { status: 'invalid', message: 'Choose a product for this kind of content.' }), true;
    let facts: Record<string, unknown> | null = null;
    if (productId) {
      if (!(await need(ctx, 'products.read'))) return true;
      facts = await productFacts(ctx, productId);
      if (!facts) return json(404, { status: 'error', message: 'Product not found.' }), true;
    }
    if (!(await gate(ctx, ai)).ok) return true;
    const r = await generateWithFallback(ai, { system: contentSystem(kind), user: `<data>${safeJson({ product: facts, topic })}</data>`, schema: CONTENT_SCHEMA as unknown as Record<string, unknown>, temperature: 0.6, thinkingLevel: 'LOW', maxOutputTokens: Math.max(ai.maxOutputTokens, 3072), timeoutMs: 30_000 }, deps.transport);
    await recordTokens(cfg.db, 'admin', r.inputTokens, r.outputTokens);
    if (!r.ok) return json(502, { status: 'error', message: FAILURE_MESSAGE[r.reason] }), true;
    const text = typeof r.json.text === 'string' ? r.json.text.trim().slice(0, 6000) : '';
    if (!text) return json(502, { status: 'error', message: FAILURE_MESSAGE.invalid }), true;
    const flags = draftFlags(text);
    const ins = await rest(cfg.db, 'ai_drafts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ kind, product_id: productId, topic, body: text, flags, model: ai.model, created_by: ctx.email }) });
    if (!ins.ok) return json(502, { status: 'error', message: 'The draft could not be saved.', hint: 'Run supabase/ai.sql.' }), true;
    const row = ((await ins.json()) as Record<string, unknown>[])[0];
    await audit('ai_draft_created', { kind: CONTENT_LABELS[kind], flagged: flags.length > 0 });
    json(200, { status: 'ok', draft: row });
    return true;
  }

  if (action === 'ai-draft-edit' && method === 'POST') {
    if (!(await need(ctx, 'ai.content'))) return true;
    const b = bodyOf(req);
    const id = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;
    const text = cleanText(b.body, 6000);
    if (!id || !text) return json(400, { status: 'invalid', message: 'Missing draft or text.' }), true;
    const flags = draftFlags(text);
    // Any edit sends the draft back to "draft" and re-runs the claim check: an approved draft cannot be changed behind the approver's back.
    const r = await rest(cfg.db, `ai_drafts?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body: text, flags, status: 'draft', decided_by: null, decided_at: null }) });
    const row = r.ok ? ((await r.json()) as Record<string, unknown>[])[0] : undefined;
    if (!row) return json(404, { status: 'error', message: 'Draft not found.' }), true;
    await audit('ai_draft_edited', { id, flagged: flags.length > 0 });
    json(200, { status: 'ok', draft: row });
    return true;
  }

  if (action === 'ai-draft-decide' && method === 'POST') {
    if (!(await need(ctx, 'ai.content'))) return true;
    const b = bodyOf(req);
    const id = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;
    const decision = b.decision === 'approved' || b.decision === 'rejected' ? b.decision : null;
    if (!id || !decision) return json(400, { status: 'invalid', message: 'Missing draft or decision.' }), true;
    // Approval is a publishing decision: only roles that may change product status (the owner) can approve.
    if (decision === 'approved' && !(await need(ctx, 'products.status'))) return true;
    const cur = await rest(cfg.db, `ai_drafts?select=flags,body&id=eq.${id}`);
    const row = cur.ok ? ((await cur.json()) as { flags: string[]; body: string }[])[0] : undefined;
    if (!row) return json(404, { status: 'error', message: 'Draft not found.' }), true;
    // Re-check at approval time, so the stored flags cannot be stale.
    if (decision === 'approved' && draftFlags(row.body).length > 0) return json(409, { status: 'conflict', message: 'This draft makes a claim that cannot be supported. Edit it first.' }), true;
    const r = await rest(cfg.db, `ai_drafts?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: decision, decided_by: ctx.email, decided_at: new Date(nowMs).toISOString() }) });
    await audit('ai_draft_decided', { id, decision });
    json(r.ok ? 200 : 502, r.ok ? { status: 'ok', draft: ((await r.json()) as unknown[])[0] } : { status: 'error', message: 'Could not save the decision.' });
    return true;
  }

  if (action === 'ai-draft-delete' && method === 'POST') {
    if (!(await need(ctx, 'ai.content'))) return true;
    const id = typeof bodyOf(req).id === 'string' && isUuid(bodyOf(req).id as string) ? (bodyOf(req).id as string) : null;
    if (!id) return json(400, { status: 'invalid', message: 'Missing draft.' }), true;
    const r = await rest(cfg.db, `ai_drafts?id=eq.${id}`, { method: 'DELETE' });
    await audit('ai_draft_deleted', { id });
    json(r.ok ? 200 : 502, r.ok ? { status: 'ok' } : { status: 'error', message: 'Could not delete the draft.' });
    return true;
  }

  json(404, { status: 'error', message: 'Not found.' });
  return true;
}
