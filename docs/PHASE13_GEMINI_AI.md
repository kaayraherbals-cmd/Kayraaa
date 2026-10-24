# Phase 13: Gemini AI (Kaayra AI and Kaayra Intelligence)

Built on `kaayra-herbals-v5-phase8-business-intelligence.zip`. The website design is untouched: no existing colour, font, layout or component was changed. AI ships **OFF** and spends nothing until you switch it on.

## What it is

| Part | Who | Where |
|---|---|---|
| **Kaayra AI** | Customers | A small "Ask Kaayra AI" button (bottom right) that opens a chat panel. Recommendations use your existing `ProductCard`. |
| **Kaayra Intelligence** | Owner, and admins the owner names | Admin > **Kaayra Intelligence**: daily briefing, ask-a-question, usage, and the Content Studio. |

## How the numbers stay true

1. **Gemini never calculates a figure.** Revenue, profit, refunds, order and stock figures come from code that already existed: `server/financeService.ts` (owner only, the Business Intelligence numbers) and `shared/analytics.ts` (the Analytics numbers; the loader was moved to `server/analyticsService.ts` and the Analytics screen now calls it too). Intelligence cannot disagree with your own screens.
2. The model only sees the formatted result. It has no SQL, no tools, no database key and no way to change anything.
3. Every number in an answer is checked against the figures that were supplied. An answer containing a number the server did not give is **withheld** ("unverified") and not shown.
4. Profit is only stated when the Business Intelligence screen would state it (complete cost data). A forecast with too little history says "not enough data".
5. A section your role may not read (or that failed to load) is listed as not shown, never guessed.
6. The dashboard figures are always shown from the real data **without AI**. The written summary is optional and made only when you press the button (no scheduler, so it costs nothing until used).

## Customer assistant safety

- Retrieval first: the server picks the relevant public products (name, form, **verified public ingredients**, approved description, real price and stock). The model may only choose among those; any product id it invents is dropped.
- Prices appear only when the shop itself shows prices (the `cart_preview` flag, as `api/cart` does). A reply that states a price that is not a real price is replaced.
- Health: replies that diagnose, give dosage, suggest stopping medication, or claim a treatment or benefit are replaced (reuses the repo's `claimProblems`); health-related questions always get the "not a medical professional" note.
- Orders: only for a signed-in customer, selected by `member_id` in the query itself, status-level facts only (no name, address, phone or email is ever sent). Not signed in: it asks them to sign in. It cannot change orders, refund, or alter payment status.
- Prompt injection: obvious override attempts are answered without calling the model; everything else (messages, history, product text, order text) is passed as JSON data with `<` escaped so it cannot close the data block; history roles are forced to user/assistant and trimmed to 6 turns; the system prompt states that data is never instructions. These are mitigations, not a guarantee. Authorisation never depends on the model.
- Nothing about the conversation is stored. Visitors are limited to 20 questions per 10 minutes.

## Where the code is (and why the customer endpoint is under /api/orders)

`api/` already holds **12 functions, the Vercel Hobby limit**, so no function was added.
- Customer endpoints `GET /api/orders/ai-config`, `POST /api/orders/ai-chat` are dispatched from `api/orders/[action].ts` to `server/ai/customer.ts`.
- Admin endpoints (`ai-status`, `ai-snapshot`, `ai-ask`, `ai-briefing`, `ai-content`, `ai-drafts`, `ai-draft-edit`, `ai-draft-decide`, `ai-draft-delete`) are in `server/admin/ai.ts`, called from `handleBackoffice`, so they inherit the existing session, two-step sign-in, CSRF and role checks.
- `vercel.json` gives those two functions `maxDuration: 30` (Gemini can be slow). On a Pro plan you may split them out.

Server modules: `server/ai/{config,gemini,usage,data,catalog,customer,prompts,knowledge}.ts`, `shared/{ai,aiCatalog,aiAnalytics}.ts`. UI: `src/components/KaayraAI.tsx`, `src/pages/AdminIntelligence.tsx`, `src/lib/aiApi.ts`, `src/styles/ai.css` (existing tokens only).

## Permissions

New: `ai.intelligence` (owner) and `ai.content` (owner, manager). Revenue and profit stay owner-only (`finance.read`). To let another admin use Intelligence list their email in `AI_INTELLIGENCE_EMAILS` (must already be an admin); they still only see sections their own role can read. Approving a draft needs `products.status` (owner). The Intelligence tab is visible to every admin and says "not available" to those without access (enforcement is on the server).

## Model and the Google AI Pro question

- Official SDK `@google/genai` (^2.31.0, added to `package.json` and the lockfile). It is loaded only on first use, server side.
- Default model **`gemini-3.1-flash-lite`** (cheapest current-generation stable text model with structured output). Override with `GEMINI_MODEL`. Gemini 1.x, 2.0 and 2.5 are refused: Google's deprecation notices put their shutdown dates in 2026.
- **Google AI Pro is a consumer subscription. It is not a Gemini API key and does not pay for API calls.** Create a key in Google AI Studio and start on the free tier. Enabling paid API billing is your decision; nothing here enables it.
- **Privacy:** on the free tier Google may use prompts to improve its products. Intelligence sends only totals and product names, and the customer assistant sends the customer's message, public product data and (when signed in and asking about orders) their own order status. No names, emails, phones or addresses are sent. If you want that excluded from training, use a paid API key.
- I could not reach the Gemini API from my environment and had no key, so **the model name, free-tier limits and pricing are from Google's published notices and third-party summaries, not verified live.** Check them in AI Studio. The cost shown in Intelligence is an estimate from token counts and the (editable) `AI_PRICE_*` values.

## Setup

1. Run `supabase/ai.sql` (file #30) then `ai_selftest.sql` on the Supabase project (see `docs/DATABASE_MIGRATIONS.md`). Until then AI refuses every request.
2. In Vercel set `GEMINI_API_KEY` (you said you saved it under this name; keep it a normal variable, never `VITE_`), `AI_ENABLED=on`, and optionally `GEMINI_MODEL`, `AI_DAILY_REQUEST_LIMIT`, `AI_MAX_OUTPUT_TOKENS`. Redeploy.
3. Open Admin > Kaayra Intelligence: the status card should say **On**. Try "Write summary" and one question.
4. Visit the shop: the "Ask Kaayra AI" button appears about 1.5 seconds after load only when AI is on.
5. Owner action: publish your real shipping and refund policy wording and add it, word for word, to `server/ai/knowledge.ts`. Until then the assistant says that information is not published and points to Contact. It will not invent policy.

## Cost and abuse controls

Daily request allowance in the database (atomic; visitors 80%, owner tools the rest, min 20), per-visitor and per-admin rate limits (fail closed if the shared limiter is down), output token cap, 20 s timeout, 500-character messages, 6-turn history, at most 6 products in context, one-minute catalogue cache. Usage (requests, tokens, estimated cost) is shown in Intelligence. If the counter cannot be read, AI pauses.

## Retention

No questions or answers are stored. Stored: usage counts, the day's briefing text, and content drafts. `select ai_purge(30);` clears rejected drafts and briefings older than 30 days. Delete any draft from the Content Studio.

## Content Studio

Product description, summary, SEO title, meta description, FAQ draft, journal article, social captions, promotional email, campaign ideas. Always saved as a **draft**. It uses only verified facts (ingredients are given to the model only when the product's composition is verified; internal notes are never read). Drafts with unsupported claims (cures, guaranteed, certifications, prices, dosage) are flagged and cannot be approved until edited and re-checked; approval is owner-only and is re-checked at approval time. **Nothing is published or written into a product automatically**: copy approved text into the existing product or journal editor yourself.

## What was run

Real: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (78 files passed, 1 skipped as before; 1108 tests passed), `npm run build`, `npm run check:lockfile`. `supabase/ai.sql` and its self-test on a disposable PostgreSQL 16 (twice, 5/5 PASS, RLS and grants checked, 40-way concurrency test: exactly 7 of 40 granted against a limit of 7). New tests cover: admin authorisation, owner-only finance, financial accuracy against the real finance and analytics code, unverified-number withholding, product retrieval and recommendation accuracy (invented ids and prices dropped), customer data isolation, prompt injection, invalid/blocked/truncated model replies, timeouts, quota errors, missing key, retired model, daily limit, rate limits, limiter and usage-counter failure (fail closed), content approval rules, and that no key or prompt reaches the logs. Gemini is mocked.

## NOT run (blocked)

- **Any real Gemini call.** No key in my environment and the API host is unreachable from it. The request shape was checked only against the SDK's type definitions. `AI_THINKING_LEVEL` is untested against a live model.
- A browser: the chat widget and Intelligence tab were type-checked, built and prerender-checked, but not seen or used. Layout, mobile fit, focus handling and screen-reader behaviour are unverified. The existing `ProductCard` inside the narrow chat panel has not been visually checked.
- The Supabase project, PostgREST behaviour of the new count queries (`content-range`), live Razorpay or email.

## Known limitations

- Phase 5 (daily briefing) is on demand, not scheduled. No cron was added.
- Stock intelligence reuses the existing "rough days of cover" and the finance revenue forecast (which needs enough history). There is **no per-product demand forecast or stock-out prediction**, and no automatic reorder suggestions; the model may only describe the existing figures. It changes no stock, price or purchase order.
- Smart search is keyword ranking over verified public product text (no pgvector, no semantic search). Product comparison is by the model from the retrieved approved facts.
- Two revenue definitions already existed in the product (Analytics: orders not cancelled; Finance: net collected). Intelligence shows both, labelled, rather than choosing one.
- Slow-moving stock and expiry come from the existing finance valuation (owner) and stock-health figures.
- Customer chat is anonymous-friendly and limited per IP; heavy shared-network use may hit the limit sooner.
- Prompt-injection and claim filters are heuristics; the hard guarantees are structural (no tools, authorisation outside the model, numbers and product ids validated by the server).

## Production readiness

Ready to deploy **behind the off switch**. Before switching on: run `ai.sql`, set the key, check model name and quotas in AI Studio, add your real policy text to `knowledge.ts`, and click through both assistants in a browser on a preview deployment. Do not claim live Gemini behaviour until that has been done.

## Changelog

New: `shared/ai.ts`, `shared/aiCatalog.ts`, `shared/aiAnalytics.ts`, `server/ai/*`, `server/admin/ai.ts`, `server/analyticsService.ts`, `src/components/KaayraAI.tsx`, `src/pages/AdminIntelligence.tsx`, `src/lib/aiApi.ts`, `src/styles/ai.css`, `supabase/ai.sql`, `supabase/ai_selftest.sql`, tests (`shared/ai*.test.ts`, `server/ai/*.test.ts`, `server/admin/ai.test.ts`), this document.
Changed (small): `shared/roles.ts` (two permissions), `api/orders/[action].ts` (dispatch of `ai-*`), `server/admin/backoffice.ts` (one line), `server/admin/extras.ts` (analytics loader moved into `server/analyticsService.ts`, behaviour unchanged), `src/pages/Admin.tsx` (tab), `src/components/Layout.tsx` (mount), `src/main.tsx` (CSS import), `vercel.json` (durations), `.env.example`, `docs/DATABASE_MIGRATIONS.md`, `package.json` and lockfile (`@google/genai`).
