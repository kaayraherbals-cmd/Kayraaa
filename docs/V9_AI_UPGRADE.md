# V9 AI upgrade: faster answers, better chat panel

Scope: Kaayra AI (customer chat) and the owner tools in Admin > Intelligence. No database, permission, price or claim rule changed.

## Why it was slow
1. Gemini "thinking" ran at the model default on every message, and thinking tokens are slow and billed as output.
2. Before the model was even called, the server read the catalogue with one database request per product, one after another, then reserved the daily budget, then loaded orders, all in sequence.
3. Output allowance was 1,024 tokens for answers that are at most a few sentences.
4. The panel showed only "Thinking…" with no way to stop, retry or continue.

## What changed (server)
- `server/ai/gemini.ts`: per-call `thinkingLevel` and `timeoutMs`; one quick retry on HTTP 500/502/503/504 only when 3+ seconds remain; if Gemini rejects an explicit level (HTTP 400) the call is repeated with the model default instead of failing. `AI_THINKING_LEVEL` still overrides.
- `server/ai/customer.ts`: customer chat uses level MINIMAL, 700 token cap, 15 s deadline. Catalogue and member lookup run together; orders and budget reservation run together. New `ai-warm` action (GET) fills the catalogue cache when the panel opens. Identical first questions with the same products and prices are answered from a 3 minute in-memory cache (no model call, no budget use); follow-up turns, order questions and health questions are never cached.
- `server/ai/catalog.ts`: all products looked up at once, all packs priced in one request, simultaneous visitors share one read.
- `server/ai/prompts.ts`: clearer style (answer first, reply in the customer's language, **bold** product names only, short "- " lists) and `follow_ups` (up to 3 suggested next questions). Suggested questions are filtered: no health topics, no invented prices, no injection phrases.
- `server/admin/ai.ts`: owner Ask, briefing and content use level LOW with 25-30 s deadlines; the figures are read while the limit checks run.
- No new Vercel function: `ai-warm` lives in `api/orders/[action].ts` like the other `ai-*` actions (12-function limit unchanged).

## What changed (screens)
- Customer panel (`src/components/KaayraAI.tsx`, `src/styles/ai.css`, `src/lib/aiApi.ts`): Kaayra monogram header, new-conversation and close buttons, page-aware starter questions (product page, order pages), live waiting status with Stop, Try again on errors, suggested next questions, product cards in a swipe row, bold and list formatting built as React nodes (never HTML), auto-growing input with send arrow, character counter, phone bottom-sheet, reduced-motion respected, conversation kept for the browser session only.
- Owner Ask (`src/pages/AdminIntelligence.tsx`): a thread of questions and answers (newest first), live seconds counter, Enter to send, Copy answer.

## Honest limits
- Replies are still shown whole, not word by word. Every reply must pass the price, claim and dosage checks before anyone sees it, which streaming would bypass.
- Real response time depends on Gemini and the Vercel region; the numbers were not measured against the live service from this sandbox.
- If answers are still slow, set `AI_THINKING_LEVEL` empty (it overrides the fast defaults), and check that the Vercel function region is near the Supabase project.

## Follow-up fix: "The answer was too long to complete" in owner Ask
Cause: Gemini's thinking tokens count toward the output cap (1,024 by default), so a low-thinking answer could still be cut off. Fix: owner Ask and briefing now use minimal thinking and a cap of at least 3,072 tokens, retry once at 8,192 if it is still cut off, and the prompt asks for under 150 words. Customer chat cap raised to 900. The retry path has no automated test yet. Admin status header redesigned (usage meters, collapsible privacy note).

## Multi-provider fallback (Gemini, then Groq, then Claude)
- `server/ai/providers.ts` (new): `generateWithFallback()` tries the providers that have a key, in `AI_PROVIDER_ORDER` (default gemini, groq, anthropic). It moves on after HTTP 429 (out of allowance), a timeout, a server error or an unusable reply; it does not move on after a safety block or a cut-off reply. While a backup is still waiting, a provider gets about 60% of the time left. A provider that hit its allowance is skipped for 2 minutes (30 s after an error, 20 s after a timeout) so visitors are not made to wait for it; if all are resting they are tried anyway.
- Groq: OpenAI-compatible chat API in JSON mode. Claude: Messages API with a forced tool call so the reply matches the schema. Both are plain HTTPS calls, so no package or lockfile change. Gemini keeps its SDK.
- Everything else is unchanged: same prompts, same price/claim/dosage checks, same daily budget (one request counts once however many providers were tried), tokens from every attempt are added to the usage counters. The cost estimate still uses the Gemini prices from `AI_PRICE_*`.
- New env: `GROQ_API_KEY`, `GROQ_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_PROVIDER_ORDER`. AI is "ready" with any one key.
- Owner screen: shows the providers in order (greyed if not set up) and "Answered by ..." under each answer.
- Not verified from this sandbox: real calls to Groq or Claude, and whether the default Groq model name is still offered. The Claude API is, as far as I know, paid (no free tier).
- Privacy: customer questions and owner figures can now reach any configured provider; free tiers may use prompts for training.

## Real information, not only text (customer and admin)

- **Customer chat:** product cards are unchanged (real price and stock). A signed-in customer asking about an order now also gets an order card
  (status, total, courier, tracking number, expected date, refunds) read from the database by the server; the model does not write it. Order details
  are shown but not kept in the browser's session storage. A visitor who is not signed in gets a "Sign in" link. If no AI provider can answer,
  the chat still shows the matching products and the customer's own orders instead of an error; it only says "unavailable" when there is nothing real to show.
- **Admin, Ask a question:** every answer comes with tables built from the verified figures (`server/ai/panels.ts`): sales, top products, out-of-stock
  and low stock, days of cover, shipments and refund queue, and (owner only) money. The topics follow the question; a broad question shows all of them.
  The tables are shown even when every provider fails or an answer is withheld for an unverified number.
- Provider errors are now logged with the provider's own reason (type and message only, never keys or prompts) in Vercel's runtime logs.

## Answers, not redirects

The customer assistant used to receive only a few keyword-matched products, so for "ingredients of each product" it had nothing to list and sent the customer to the shop page. Now:

- A question about the whole range (each, all, list, range, what do you sell) or about a product fact with no product named (ingredients, price, pack size, stock) gets the whole catalogue in a compact view (up to 30 products: name, form, verified ingredients, packs, prices, stock).
- The text of the public pages (story, founders, approach, ingredient library, quality, product development, medical disclaimer, subscription, journal, privacy, legal, home) is generated into `server/ai/siteContent.generated.ts`. The pages that match the question (at most two) are sent as `website_pages`. **After you change page copy, run `npm run ai:site` and commit the regenerated file.**
- The prompt now says: state the actual details from the data, never answer only "visit the page", and say "not published" for products without verified ingredients. Reply limit raised to 1,800 characters and 1,400 tokens so a list of products fits.
- Anything that is not in the products, the page text or the customer's own orders is still answered with "not available, please contact the team". The assistant never uses outside knowledge.

## Proper answers about Kaayra Herbals

- **Sections, not whole pages.** `server/ai/sitePages.ts` cuts every page into short sections and sends only the best matches (at most 4, about 3,000 characters). It stems words ("delivered" matches "delivery"), maps customer words to the site's words (refund/return, pay/payment, certified/approved, who started/founders) and weights rare words higher. If the site says nothing about the question it sends nothing, so the assistant says honestly that it is not published; a question with nothing specific ("What is Kaayra Herbals?") gets the overview.
- **More of the site is known.** `npm run ai:site` now also includes the FAQ (`shared/faq.json`), company details (`src/config/site.ts`: legal name, incorporation date, CIN, location, tagline), the shop, track-order and report-a-problem pages.
- **Live facts** (`server/ai/liveFacts.ts`): a 6-digit PIN code typed in the chat is checked against the same delivery table checkout uses (delivers or not, and the charge once prices are on); a database problem is reported as "could not check", never as "we deliver". The email, phone and address set in `VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE` and `VITE_CONTACT_ADDRESS` are shared when asked (they must also exist as server environment variables in Vercel).
- **Prompt rules:** answer company questions with the specific facts, use `delivery_check` and `contact_details`, and when the answer is not in the data say so in one sentence and offer the contact form. No invented policies, timelines, certifications or health claims.
- Not on the site yet, so the assistant says "not published": return and refund windows, delivery times, accepted payment methods beyond "paid online at checkout". Send the approved wording and it will be added to `server/ai/knowledge.ts`.
