# Phase 4.1: changelog

No visual, commerce, auth, payment, Gemini or founder change. Not touched: homepage design, typography, colors, navigation, portraits, Razorpay, Supabase, loyalty, bundles, wishlists, `server/ai/sitePages.ts` and the AI prompts. Instagram stays `@kaayra.herbals`; founder names and roles stay as approved.

## 1. FAQ restored to 11 (`shared/faq.json`)

The original 8 are unchanged and in order. Three were appended (the homepage, FAQPage JSON-LD and AI knowledge all read this one file):

| Question | Built only from |
|---|---|
| What is Kaayra Herbals’ philosophy? | Home page "Our philosophy" copy and the "Ancient Wisdom" pillar |
| What is ingredient transparency? | Home page "Ingredient transparency" section and the Quality and transparency page ("does not yet display any certifications, laboratory results or approvals") |
| What is the difference between traditional Ayurvedic use and clinical evidence? | Journal article "Traditional use and clinical evidence" and its "How we apply this" paragraph |

Answer 11 avoids the word "proven" on purpose: the existing guard in `shared/seo.test.ts` bans it in FAQ answers. The curly apostrophe in "Herbals’" is deliberate, so the visible HTML and the JSON-LD are character-identical.

## 2. Knowledge regenerated

`node scripts/build-site-knowledge.mjs` (unchanged logic). Only the FAQ entry in `server/ai/siteContent.generated.ts` differs from the ZIP (2,457 characters, 11 lines). Output is byte-identical across 4 runs on Node 20.19.0, 22.16.0 and 22.22.2.

## 3. Schema test runtime compatibility

- New `scripts/lib/import-ts.mjs`: loads import-free `.ts` content files with the project's own `typescript` package, so it works on any Node. It refuses a file that has imports, with a clear message.
- `scripts/structured-data.check.mjs` and `scripts/build-site-knowledge.mjs` use it instead of `import('…ts')`. `package.json` is unchanged: `npm run seo:schema` is still `node --test scripts/structured-data.check.mjs`.
- Assertions were not weakened. All 11 original checks remain; 3 were added (below). The header comment no longer claims "needs no npm install": it needs `npm ci` for `typescript`.

## 4. New regression coverage

- `shared/seo.test.ts` (+4): exactly 11, original 8 in order then the 3, approval sentence word for word, restored answers concise and claim-safe, no characters that would desync HTML and JSON-LD.
- `src/components/Faq.test.ts` (+2, new): renders the real component; 11 visible items equal `faq.json`.
- `server/ai/sitePages.test.ts` (+5): all 11 lines present word for word in the generated knowledge; no FAQ line near the 700-character section size; lifting the 3,000 cap changes no FAQ result; approval, philosophy and traditional-vs-clinical retrieve their own answers; the ingredient-transparency question reaches the Quality page.
- `scripts/structured-data.check.mjs` (+3): exactly 11 FAQPage entries in order; disclaimer kept and no certification or health claim; FAQPage on the home page only.
- `scripts/seo-check.mjs`: visible FAQ must equal the FAQPage JSON-LD and `faq.json`, and `faq.json` must not fall below 11.
- Mutation check: with the original 8-question file restored, 5 of the new vitest tests fail; with 11, all pass.

## 5. Stale test fixed

`server/ai/customer.test.ts` now expects `min(1024, CUSTOMER_MAX_TOKENS)` instead of 900. Test-only change.
