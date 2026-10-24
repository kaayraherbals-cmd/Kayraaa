# Phase 12 Stage 7: database deployment (7B)

1. Use a disposable PostgreSQL 16 first: `PGDATABASE=kh_verify_s7 bash scripts/db-verify.sh` (applies every migration twice, then every self-test, including `stage7_selftest.sql`). Fix any failure before going further; the Stage 7B files have never been run.
2. Staging Supabase: apply the order in `docs/DATABASE_MIGRATIONS.md`, with `stage7_commerce.sql` last (row 30), then `stage7_selftest.sql`.
3. `stage7_commerce.sql` replaces five functions. If `loyalty.sql`, `coupons.sql`, `bundles_wishlists.sql` or `finance.sql` is re-run later, run `stage7_commerce.sql` again afterwards.
4. Nothing in the application calls the new functions yet (7C). Applying the migration alone changes no customer behaviour, except that the old `orders_total_matches` is replaced by an equivalent one with two extra zero terms.
5. Never apply to production before the staging run, a Razorpay test-mode order, and the owner decisions in `PHASE12_STAGE7_REMAINING_ISSUES.md`.
