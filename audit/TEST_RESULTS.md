# Test Results (all executed in this session unless marked NOT RUN)
Node v22.22.2, npm 10.9.7, Chromium via Playwright.

| Command | Before fixes | After fixes |
|---|---|---|
| npm ci | OK (382 pkgs) | n/a |
| npm run check:lockfile | OK | n/a |
| npm run lint | pass | pass |
| npm run typecheck | pass | pass |
| npm test | 2 failed, 1177 passed, 1 skipped | 1 failed, 1193 passed, 1 skipped (87 files; +15 new wishlist tests) |
| npm run build | pass | pass |
| npm run seo:check | fail, 42 problems (VITE_SITE_URL unset locally) | NOT RE-RUN with a production URL |
| npm audit | 17 vulns (3 critical, 7 high, 7 moderate); prod-only: 2 moderate | unchanged |
| npm run ui:check | crashed (stale stub) | pass: 17 interaction checks, 0 failed; flags only the 20px consent checkbox |
| Custom Playwright run: 17 pages x 7 widths (320-1440) | 35 problem pages (header clip at 320, blank product/wishlist under malformed data) | header fixed (verified at 320); guards verified with malformed responses |
| PostgreSQL self-tests / concurrency scripts | NOT RUN (no PostgreSQL) | NOT RUN |
| Razorpay test mode, Resend, Supabase live | NOT RUN | NOT RUN |
| Lighthouse / Core Web Vitals | NOT RUN | NOT RUN |
| Admin dashboard in a browser | NOT RUN | NOT RUN |

Remaining failing test: server/ai/customer.test.ts:228 (KH-002): expects maxOutputTokens 900, code gives 1024. Awaiting an owner decision on the intended cap; test was not edited.
Bundle sizes (from build): main client chunk 397 KB raw / 119 KB gzip; admin is code-split (Admin 72 KB / 20 KB gzip). One 620 KB source PNG in public/brand (kaayra-k-logo-source.png), check it is not served on pages.
Note: `npm run ui:check` rewrites test-results/results.json and screenshots in the repo.
