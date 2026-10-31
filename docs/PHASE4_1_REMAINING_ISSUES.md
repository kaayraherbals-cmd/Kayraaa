# Phase 4.1: remaining issues and production verification

## Open decisions for the owner

1. **Wording of the three restored answers.** The Phase 3 originals were not in the ZIP. The answers are reconstructed from published site text. If you have the Phase 3 source, send it; swap the three `a` values in `shared/faq.json`, run `npm run ai:site`, and the tests will tell you if anything drifts.
2. **AI retrieval ranking (not changed; brief forbids altering Gemini behavior).** For the exact question text, the assistant is sent the FAQ section for 7 of the 11 questions, and not for these 4: "How will I know when something launches?", "Does Kaayra give medical advice?", "How can I contact Kaayra Herbals?" and "What is ingredient transparency?". Dedicated pages outrank the FAQ section for the first three (Launch list, Medical disclaimer, Contact), which is reasonable. For the fourth, ingredient-library sections win through a title-match bonus, so the assistant gets the Quality and transparency page but not the FAQ wording. A small fix is possible (for example, always include the FAQ section whose question closely matches the user's), but it changes retriever behavior, so it needs your approval.

## Production verification still to do

- Run the Schema.org validator and Google Rich Results Test on the deployed home, founders and one article page.
- Build and deploy with the real `VITE_SITE_URL` in Vercel; confirm canonical, sitemap and `robots.txt` on the live domain.
- Run `shared/coupons.parity.test.ts` against a throw-away Postgres (`DATABASE_URL`).
- Confirm in Google Search Console and Bing Webmaster that the sitemap is read and private pages are not indexed; submit via `npm run indexnow` once live.
- Try Kaayra AI with a real Gemini key on the 11 FAQ questions and read the answers.
- Run the GitHub CI workflow once (it has never run on GitHub).

## Known, unchanged

- `npm ci` reports 17 audited vulnerabilities (3 critical). Not investigated; outside this stage.
- Pre-launch statements are unchanged; update "Is anything for sale yet?" only when you confirm live sales.
- Portraits looking AI-generated (Phase 4 note) is untouched.
- Two of 14 private shells are parameterised and have no static file to inspect.

## Status

Every command in the brief was run with real results and passed, so the stage is **complete for the verifiable scope**. It is **not production-ready**: the external schema validators, the live-domain checks and a real-Gemini check above are outstanding.
