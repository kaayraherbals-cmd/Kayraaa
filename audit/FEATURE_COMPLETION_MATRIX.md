# Feature Completion Matrix (initial)
Classes: V = implemented and verified (executed here), U = implemented but unverified, P = partial, M = missing, D = disabled by config, B = blocked by external dependency.

| Feature | Class | Notes |
|---|---|---|
| React/TS build, lint, typecheck | V | Executed and passing |
| Unit/API tests (mocked) | V | 1177 pass, 2 fail (KH-001, KH-002) |
| Customer auth, OAuth, MFA, passkeys | U | Code and mocked tests exist; no live Supabase here |
| Admin RBAC, audit log | U | Code present; no permission test file |
| Product catalogue, variants, gallery | U | SQL and UI exist; DB not run |
| Cart | U | API tests exist |
| Checkout and order placement | U | Mocked tests; DB RPCs not run |
| Razorpay create/verify/webhook | U | Signature checks verified in source; no test-mode run (B) |
| Stock reservation expiry | P | Daily cron only (KH-003) |
| Orders, shipments, tracking | U | Tests exist; DB not run |
| Coupons, refunds | U | Tests exist; DB not run |
| External (dashboard) refunds reconcile | M/P | No `refund.*` webhook handling seen (to confirm) |
| Reviews | U | Tests exist |
| Wishlist | P | UI and API exist; no API tests (KH-005) |
| Bundles | P | Admin screen, public listing; not purchasable (KH-004) |
| Loyalty | D/P | DB core and optional checkout path; no wallet UI, no scheduler; must stay off |
| Finance/BI | P | Admin BI exists; fee/carrier cost screens missing |
| Email outbox, cart recovery | U/B | Code present; DNS/Resend verification pending |
| Background jobs | P | 2 daily crons; recovery piggybacks on outbox |
| Kaayra AI (customer) and Intelligence (admin) | D/U | Ships OFF; needs ai.sql, AI_ENABLED, GEMINI_API_KEY |
| SEO/AEO/GEO/Bing | P | Code and prerender work; production URL not set locally (KH-009) |
| Backups and recovery | M | No evidence in repo |
