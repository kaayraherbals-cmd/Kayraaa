# Phase 6: verified customer reviews and ratings

Built on `kaayra-herbals-v5-phase3h-verified.zip`. Note: older files in `docs/` use a different "Phase 6/7" numbering (commerce hardening). This file is the reviews phase only.

## 1. Audit before building (what was found)
| Area | Finding |
|---|---|
| Existing reviews | None. The only hits for "review" were product-claims review status and journal text. No testimonials, no ratings. One system was added, nothing duplicated. |
| Orders and eligibility data | `orders.member_id`, `orders.status` (`delivered` is set by the shipment flow when every live shipment is delivered), `orders.is_test`, `order_payments.status = 'captured'` (webhook-set), `order_items.variant_id` to `product_variants.product_id`. All authoritative, server-written. |
| Customer auth | Signed `kaayra_user` cookie, resolved to `members` on the server (same helper pattern as `/api/orders`). |
| Storage | One PRIVATE bucket `product-images`, served only through `/api/media`. A second private bucket `review-images` was added; photos are served only while approved on a published review. |
| Admin | Role matrix in `shared/roles.ts`, admin API dispatch through `server/admin/backoffice.ts`, audit via `admin_audit`. Reused. |
| Vercel limit | 11 functions before, **12 now** (the Hobby limit). `api/reviews/[action].ts` is the 12th, so any further function needs consolidation or a plan change. |
| **Phase 4 owner Gemini AI** | **Not present in this ZIP** (no Gemini code, env or tables). Section 14 (owner AI review insights) was therefore NOT built; there is nothing to extend. Nothing customer-facing AI was added. |
| **Phase 5 Coupons** | **Not present in this ZIP** (no coupon code or tables). Nothing to preserve or regress-test. |

## 2. Eligibility and moderation policy (enforced in `supabase/reviews.sql`)
- A review needs an order that is the customer's own (`member_id`), `delivered`, not a test order, with a **captured** payment, containing the product. Checked inside one database transaction (`review_submit`) after an advisory lock, so concurrent submits cannot both succeed.
- Because only such orders can review, every review is a verified purchase (`verified_purchase` is a constant true, never client-set). A "verified only" filter would be a no-op, so none is offered; the badge is shown on every review.
- One review per purchased line (unique `order_item_id`) and one per customer per product (unique `member_id, product_id`). Withdrawing keeps the slot used (anti review-bombing); documented in the UI.
- Text-only reviews publish at once. Reviews with a **health-claim/contact flag** (`shared/reviews.ts`, narrow patterns; ordinary negative feedback is not matched) wait as `PENDING` for a person. Photos wait for approval individually; the text stays live.
- Customer edit: own review, status PUBLISHED/PENDING/HIDDEN, up to 3 edits, within 30 days. Editing a hidden review sends it back to `PENDING`. This is the redaction path: staff never rewrite text.
- Staff can approve, hide, reject, restore, reply. No action edits stars, title or text; no delete exists. `hide`/`reject` need a recorded reason. Each action writes `admin_audit` and the append-only `review_moderation_events` (update/delete refused by trigger).
- Reports: signed-in customers only, not on their own review, one per customer per review (repeat gives the same reply), 10 a day in the database and 20 an hour at the API. A report never changes a review.
- Public output: first name only (or "Verified customer"), rating, title, text, date, approved photos, brand reply. No email, phone, address, order number or payment data (asserted in the self-test and API tests).

## 3. Roles
`reviews.read` (owner, manager, support), `reviews.reply` (owner, manager, support), `reviews.moderate` (owner, manager).

## 4. Files
Added: `supabase/reviews.sql` (migration 23), `supabase/reviews_selftest.sql`, `shared/reviews.ts`, `server/reviews.ts`, `server/admin/reviews.ts`, `api/reviews/[action].ts`, `src/lib/reviewsApi.ts`, `src/components/reviews/ProductReviews.tsx`, `src/pages/AdminReviews.tsx`, `src/styles/reviews.css`, tests `shared/reviews.test.ts`, `server/api-tests/reviews.test.ts`, `server/admin/reviews.test.ts`.
Edited (additive): `shared/roles.ts` (3 permissions), `server/admin/backoffice.ts` (one dispatch line), `src/pages/Admin.tsx` (a "Reviews" tab under Inbox), `src/pages/ProductDetail.tsx` (one section, shown only for products on sale), `src/main.tsx` (one CSS import), plus two `eslint-disable-next-line no-control-regex` comments (one in `server/admin/passkeys.ts`, a line that already failed lint; no behaviour change).
No checkout, payment, coupon, product-card, homepage, navigation or token changes.

## 5. Photos
Limits: 3 per review, 2 MB each, JPEG/PNG/WebP decided by file signature (never name or declared type), SVG/GIF/other refused, random UUID file names, private bucket, upload only to the caller's own review. **Metadata stripping** is done on the bytes (JPEG APPn/COM segments, PNG non-critical chunks, WebP EXIF/XMP/ICCP) because no image library is installed. It does not re-encode or inspect pixels, so it is not a malware or content scanner; staff approval is the content check.

## 6. Analytics
Deterministic SQL only (`review_analytics`): average and distribution per product, counts by status, submissions per day (India time), open reports, moderation actions. **No AI theme summary** (see Section 1 for why).

## 7. What was run, and what was not
Run for real in this session (Node 22, npm ci succeeded):
- `npx tsc --noEmit`: 0 errors. `npx eslint .`: 0 problems. `npx vitest run`: **56 files, 758 tests passed** (47 of them new: 15 + 23 + 9). `npm run build`: succeeded (typecheck, client, SSR, prerender).
- Disposable PostgreSQL 16 (Supabase roles stubbed): all 23 migrations applied in order; `reviews.sql` applied twice without error; `reviews_selftest.sql` printed PASS (eligibility, duplicates, rating bounds, private-data check, hidden/withdrawn exclusion, stats, cross-customer edit/withdraw, append-only history, no anon/authenticated grants); 8 parallel submissions for one purchase produced exactly 1 review and 7 refusals.

NOT run / not verified:
- `reviews.sql` has **not been applied to the Supabase project `kaayra-herbals`**. Apply it (after the earlier 22) and run `reviews_selftest.sql` on a separate project first; that project holds real rows.
- No real browser test, no screenshots, no real Supabase Storage upload, no real signed-in session end to end, no mobile device check. The review UI was typechecked, linted and built, not looked at.
- The existing self-tests for migrations 1 to 22 and Razorpay/Resend/scheduler were not re-run this session.
- The two-session `rate_limits` shared limiter was exercised only through mocks here. The review write limiters are `closed`: if `rate_limits.sql` is not applied, review writes return 503 by design.
- Requirement 20 (owner AI read-only) and the coupon regression: not applicable, those phases are absent from this ZIP.

## 8. Setup
1. Apply `supabase/reviews.sql` after the existing 22 (needs `touch_updated_at`, members, orders, payments, products). It creates the private `review-images` bucket.
2. Run `supabase/reviews_selftest.sql` on a disposable database (it rolls back).
3. No new environment variables. Deploy; reviews appear on products that are approved for sale.
4. Optional for owners: `ADMIN_ROLES` already controls who sees the new tab.
