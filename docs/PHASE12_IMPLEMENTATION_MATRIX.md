# Phase 12 implementation matrix (Stage 1 draft)

Classification is by call-site inspection plus the commands in `PHASE12_INITIAL_AUDIT.md` section 2. "Verified" means a command was run and passed; database objects have NOT been executed anywhere yet, so nothing database-dependent is marked verified.

| Feature | Database | API | UI | Security | Tests | Status |
|---|---|---|---|---|---|---|
| Customer / admin auth, MFA, passkeys | SQL present | present | present | not yet reviewed | unit tests pass | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Products, variants, inventory | SQL present (not run) | present | present | not yet reviewed | unit pass | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Cart, checkout, Razorpay, webhook | SQL present (not run) | present | present | webhook tests exist | unit pass; no live Razorpay test | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Orders, shipping, tracking | SQL present | present | present | n/r | unit pass | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Coupons | SQL present | present | present | n/r | unit pass; parity test skipped | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Verified reviews | SQL present | present | present | n/r | unit pass | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Abandoned-cart recovery (ships OFF) | applies twice on disposable PG16; self-test passes after a fixture fix (see Changelog) | present | admin screen | n/r | unit pass + DB self-test pass | IMPLEMENTED BUT NOT FULLY VERIFIED (no email send, no staging run) |
| Email outbox / Resend | SQL present | present | n/a | n/r | unit pass | IMPLEMENTED BUT NOT FULLY VERIFIED |
| Existing analytics (V8 Reports/Sales/Stock) | none (reads tables) | present | present | permission-gated | 15 unit | PARTIALLY IMPLEMENTED against Phase 8 (gross, JS-side, 10k cap) |
| Phase 8 financial metrics (revenue, GST, refunds, fees, margin, cash, forecast, KPIs, inventory value, customers) | `finance.sql` applies twice on disposable PG16, 43-check self-test passes | 14 actions in `server/admin/finance.ts`, owner-only, 403 + audit for other roles (unit tests) | 6 admin tabs, NOT seen in a browser | CSV formula injection neutralised (unit tested) | 58 new unit tests pass | IMPLEMENTED BUT NOT FULLY VERIFIED (no staging run, no browser check, no screen for entering payment fees or carrier costs) |
| Product cost / COGS snapshots | `product_cost_history` append-only, cost in force at paid time | `finance-cost` | 'Product costs' tab | owner only, audited | unit + self-test | IMPLEMENTED BUT NOT FULLY VERIFIED. No costs are entered yet, so profit shows unavailable |
| Phase 9 loyalty core | SQL present (not run) | none | none | n/a | `shared/loyalty` unit pass | DATABASE ONLY |
| Loyalty wallet / checkout / refunds / owner / cron / email | none | none | none | n/a | none | MISSING |
| Phase 10 bundles core | SQL present (not run) | none | none | n/a | `shared/bundles` unit pass | DATABASE ONLY |
| Bundle pages, cart/checkout, owner screen, coupon policy | none | none | none | n/a | none | MISSING |
| Wishlists | SQL present (not run) | none | none | n/a | unit (pure) | DATABASE ONLY |
| Related / frequently bought together | SQL present | none | none | n/a | none | DATABASE ONLY |
| Phase 11 SEO | n/a | n/a | present | noindex on private | `seo:check` OK with production URL; FAILS without it | COMPLETE for the build; production not verified |
| Owner-only Gemini AI | none | none | none | n/a | none | BLOCKED BY EXTERNAL DEPENDENCY (separate workstream; no code in ZIP) |
| WhatsApp | not in scope | | | | | NOT STARTED, excluded by the brief |

Update after Stage 2 and the Phase 8 merge: database rows say 'applies' only for the disposable plain PostgreSQL 16 run in this session (stand-in Supabase roles, no PostgREST, no JWT RLS). Nothing here was run on Supabase by this session.

## Update after Stage 7B (database layer, nothing run)
| Feature | Status |
|---|---|
| Separate bundle / loyalty money columns, invariant, line allocation, snapshot, shipping check, `checkout_place_full` | WRITTEN (`stage7_commerce.sql`), NEVER RUN |
| Loyalty activation blockers (tax, refund policy) enforced by a database check | WRITTEN, NEVER RUN |
| Money maths in TypeScript (`shared/money.ts`) | 12 tests pass under a temporary shim only |
| Loyalty / bundle / wishlist API, cart, UI, owner screens, finance, direct-refund reconciliation | STILL MISSING (7C to 7G) |
| Wishlist API, page, save button (7D) | WRITTEN, helper tests only under a shim; API and UI NEVER RUN |
| Owner bundle management (7E part 1) | WRITTEN, owner-only, NEVER RUN |
| Public bundles page, read only (7E part 1) | WRITTEN, NEVER RUN. Customers cannot order bundles yet |
| Bundle lines in cart, quote, checkout screen | NOT STARTED |
