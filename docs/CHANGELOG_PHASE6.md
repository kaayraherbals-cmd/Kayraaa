# Changelog: Phase 6 verified reviews (2026-10-22)
- Added: migration 23 `supabase/reviews.sql` and `reviews_selftest.sql`; verified-purchase review submit/edit/withdraw; 1-5 star ratings with database-computed average and distribution; public review list (bounded pages, star filter, sort); review photos (private bucket, signature checks, metadata stripping, approval); reports; brand replies; admin Reviews tab (reviews, reports, analytics, history); permissions `reviews.read|moderate|reply`; health-claim holding flags; rate limits; tests (+47).
- Changed: `ProductDetail` shows a reviews section for products on sale; Admin Inbox group gains Reviews; `api/` is now at 12 functions.
- Fixed: one pre-existing ESLint `no-control-regex` error in `server/admin/passkeys.ts` (comment only).
- Not built: owner Gemini review insights and coupon checks (those phases are not in this ZIP); AI theme analytics; a "verified only" filter (every review is verified).
