# Phase 12 changelog

## Stage 1
- Added `docs/PHASE12_INITIAL_AUDIT.md` and a draft `docs/PHASE12_IMPLEMENTATION_MATRIX.md`.

## Stage 2
- Added `scripts/db-verify.sh`: applies all 29 migrations in documented order twice, then runs 15 self-tests, on a DISPOSABLE plain PostgreSQL only (refuses unless `PGDATABASE` starts with `kh_verify`). Creates stand-in roles and `storage.buckets`.
- Fixed `supabase/cart_recovery_selftest.sql` (fixture only; `cart_recovery.sql` is unchanged). The test clicked a reminder that the minimum-gap deferral had left `scheduled`, and attribution counts only clicks on `sent` mail; the order also shared the click's frozen transaction timestamp (`now()` is constant inside a transaction) while attribution needs the order strictly after the click. Both were proved with experiments: neither change alone made the test pass, both together did. The test now marks that message sent and dates the order one minute later.
- Merged the Phase 8 archive (additive, no conflicts): `supabase/finance.sql`, `finance_selftest.sql`, `shared/finance.ts`, `server/financeService.ts`, `server/admin/finance.ts`, `src/pages/AdminFinance.tsx`, tests and docs; small edits to `backoffice.ts`, `roles.ts`, `Admin.tsx`.

## Stage 3
- Read-only analysis; no code changed. Added `docs/PHASE12_CHECKOUT_ANALYSIS.md`.
