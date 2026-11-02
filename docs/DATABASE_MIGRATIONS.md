# Database migrations: order and verification

Derived by reading every `create table`, `references` and `alter table` in `supabase/*.sql` (Phase 4). **Not yet executed against any database.** Use a separate staging Supabase project, never production, and never put the service-role key in the browser or in this repository.

## Order

| # | File | Needs | Notes |
|---|---|---|---|
| 1 | `launch_subscribers.sql` | nothing | Creates `launch_subscribers`, `contact_messages`, `admin_audit` |
| 2 | `email_outbox.sql` | nothing | |
| 3 | `launch_optin.sql` | 1, 2 | Double opt-in columns, `launch_consent_log`; existing rows become `single_legacy`, unconfirmed |
| 4 | `auth_members.sql` | 1 | `members`, `site_state` |
| 5 | `issues.sql` | nothing | |
| 6 | `roles_mfa_audit.sql` | 1 | `admin_mfa`, audit immutability |
| 7 | `products.sql` | 1 | `products`, `public_products` view |
| 8 | `products_seed.sql` | 7 | Draft records only, nothing public |
| 9 | `products_catalog.sql` | 7 | Extra product columns, storage |
| 10 | `variants_gallery.sql` | 7, 9 | `product_variants`, `product_images`, public views |
| 11 | `hsn_3004.sql` | 10 | Sets HSN on pack sizes; sets no GST rate |
| 12 | `inventory_orders.sql` | 10 | Batches, orders, allocations, movements, functions |
| 13 | `refunds.sql` | 12 | `order_refunds` |
| 14 | `payments.sql` | 12, **13** | Alters `order_refunds`, so refunds must come first |
| 15 | `carts.sql` | 4, 10, 12 | Phase 5: `carts`, `cart_items`, `cart_set_item`, `cart_merge`, `cart_clear`. RLS on, no grants to anon or authenticated. **Not yet run on any database; no self-test written yet** |
| 16 | `checkout.sql` | 4, 12, 14, 15 | Phase 5: adds `orders.member_id`, `is_test`, `pay_by`; `shipping_pincodes` (empty: no PIN code is deliverable until rows are added); `checkout_attempts`; `checkout_place`. RLS on, no grants to anon or authenticated. **Not yet run on any database** |
| 17 | `payments_checkout.sql` | 14, 16 | Phase 5 Section 4: `payment_prepare`, `payment_attach`, `order_cancel_own`, `orders_due_for_expiry`, `order_expire`; **replaces** `payment_apply_event` (adds: empty the bag when an order is paid). If `payments.sql` is ever re-run, run this file again after it. **Not yet run on any database** |
| 18 | `shipments.sql` | 12, 16, 17 | Phase 7 Step 2: `shipments`, `shipment_items`, `shipment_events` (append-only), `delivery_exceptions`, `shipment_create`, `shipment_set_status`, `shipments_for_member`. Additive. **Never run on any database** |
| 19 | `email_outbox_v2.sql` | 2, **3** | Phase 7 Step 2: durable outbox columns, ten new mail kinds, `email_enqueue` / `email_claim_due` / `email_mark_*`. Replaces the kind check, so **run it after `launch_optin.sql` and again after it if `launch_optin.sql` is ever re-run**. **Never run on any database** |
| 20 | `rate_limits.sql` | nothing | Phase 7 Step 2: `rate_limits`, `rate_limit_hit`. Until it is run, set `RATE_LIMIT_SHARED=off` or the limiter falls back (fails open) to per-instance memory with one log line a minute. **Never run on any database** |
| 21 | `delivery_areas.sql` | 16 | Delivery areas admin: adds `city` and `state` to `shipping_pincodes`; `delivery_areas_upsert` (bulk add or update in one transaction). Checkout unchanged. Run `delivery_areas_selftest.sql` after it. **Never run on any database** |
| 22 | `admin_passkeys.sql` | 6 | Admin passkeys (WebAuthn): `admin_passkeys` (public keys only; RLS on, no grants to anon or authenticated). Needed for passkey sign-in and the Security tab card. **Never run on any database** |
| 23 | `reviews.sql` | 4, 10, 12, 14, 18 | Phase 6 reviews: `product_reviews`, `review_images`, `review_reports`, `review_replies`, `review_moderation_events` (append-only), eligibility/submit/moderation functions, private `review-images` bucket. RLS on, no grants to anon or authenticated. Run `reviews_selftest.sql` after it. Applied and self-tested on a disposable PostgreSQL 16 only; **never run on the Supabase project** |
| 24 | `coupons.sql` | 4, 10, 12, 14, 15, 16, 17, 21, 23 | Phase 5 coupons: `coupons`, `coupon_redemptions`, `coupon_applications`, discount columns on `carts`/`orders`/`order_items`, `coupon_compute` (the one discount calculation), 9-argument `checkout_place`, status trigger, refund basis, admin list, analytics. Replaces `cart_clear`. RLS on, no grants to anon or authenticated. Run `coupons_selftest.sql`; run `coupons_concurrency.sh` only in its own disposable database. Applied and self-tested on a disposable PostgreSQL 16 only; **never run on the Supabase project** |
| 25 | `cart_recovery.sql` | 4, 12, 14, 15, 16, 19, 24 | Phase 7 cart recovery: `marketing_preferences`, `marketing_suppressions`, `cart_recovery_settings` (ships OFF), `_cycles`, `_cycle_items`, `_messages`, `_tokens`, `_attribution`; consent, sync, detect, claim, preflight, finish, token and stats functions; adds three kinds to the `email_outbox` kind check (so run it after 19 and again after it if 19 is re-run). RLS on, no grants to anon or authenticated. Run `cart_recovery_selftest.sql` after it. **Written without a PostgreSQL available: never run on any database, self-test never run** |
| 26 | `loyalty.sql` | 4, 12, 13, 16, 24 | Phase 9 Kaayra Rewards (database core): `loyalty_settings` (ships OFF), `_tiers`, `_accounts`, `_lots`, `_ledger` (append-only), `_reservations`, `_tier_history`, `_milestones`; enrol/earn/activate/reserve/release/commit/reverse/expire/adjust/birthday/wallet/overview functions; order-status and refund triggers. RLS on, no grants to anon or authenticated. Run `loyalty_selftest.sql`; run `loyalty_concurrency.sh` only in a disposable database. Applied, self-tested (28 groups) and race-tested on a disposable PostgreSQL 16 only; **never run on the Supabase project**. No checkout, API or UI wiring yet |
| 27 | `bundles_wishlists.sql` | 4, 10, 12, 16, 24, 26 | Phase 10 (database core): `product_bundles`, `bundle_components`, `bundle_order_allocations` (immutable), `wishlist_items`, `wishlist_events` (no member id), `product_relationships`; bundle price/availability/upsert/status/public list, `checkout_place_with_bundles` (wraps `checkout_place`), wishlist, related, frequently-bought-together and analytics functions. RLS on, no grants to anon or authenticated. Run `bundles_wishlists_selftest.sql`; run `bundles_concurrency.sh` only in a disposable database. Applied, self-tested (56 checks) and race-tested on a disposable PostgreSQL 16 only; **never run on the Supabase project**. No API, cart or UI wiring yet |
| 28 | `launch_optin_member.sql` | 3 | Launch list: allows `optin_method = 'member'` so a signed-in customer joins in one click (email already verified at sign-in). Constraint change only. Applied on a disposable PostgreSQL 16 only; **never run on the Supabase project** |
| 29 | `finance.sql` | see Phase 8 notes | Phase 8 finance (already in `db-verify.sh` order) |
| 31 | `stage7_commerce.sql` (file 30 is `ai.sql`, independent) | 24, 26, 27, 29 | **Phase 12 Stage 7B**: `orders` and `order_items` get `bundle_discount_paise` and `loyalty_discount_paise`; invariant `total = subtotal - discount - bundle - loyalty + shipping`; bundle savings move out of the coupon columns; `loyalty_order_snapshots` (immutable); `loyalty_settings.redemption_tax_confirmed` and `refund_policy_confirmed` plus a check that blocks `enabled = true` until both are true; `shipping_expected`; `loyalty_apply_to_order`; `checkout_place_full`. **Replaces** `loyalty_reserve`, `loyalty_net_eligible`, `checkout_place_with_bundles`, `finance_lines`, `order_refund_basis`: run it AFTER 24, 26, 27 and 29 and again after any of them is re-run. Run `stage7_selftest.sql` after it. **Written without PostgreSQL: never run on any database** |

Self-tests (each runs in a transaction that rolls back; expect PASS notices and no error):

| After | File |
|---|---|
| 29 | `finance_selftest.sql` (passes on disposable PG 16; 43 checks) |
| 31 | `stage7_selftest.sql` (written, **never run**) |
| 26 | `loyalty_selftest.sql` (passes on disposable PG 16) and `loyalty_concurrency.sh` |
| 27 | `bundles_wishlists_selftest.sql` and `bundles_concurrency.sh` (pass on disposable PG 16) |
| 25 | `cart_recovery_selftest.sql` (written, never run) |
| 12 | `phase3_selftest.sql` |
| 13 | `refunds_selftest.sql` |
| 14 | `payments_selftest.sql` |
| 16 | `checkout_selftest.sql` (written, never run) |
| 21 | `delivery_areas_selftest.sql` (written, never run) |
| 17 | `payments_checkout_selftest.sql` (written, never run; two-session checks are listed at its end and must be done by hand) |

Correction to older docs: some partial orders in `README.md` and `docs/VERCEL_SETUP.md` omit `email_outbox.sql` and `launch_optin.sql` or do not say that `refunds.sql` precedes `payments.sql`. Use this table.

## Checks to run on staging, and record the output

1. Every file applies twice without error (they claim to be re-runnable).
2. `select * from public_products;` returns no rows while nothing is approved.
3. With the anon key, `select` on every table except the public views returns nothing or is denied (row-level security).
4. The three self-tests print their PASS notices.
5. A launch sign-up creates a `pending` row and a `requested` entry in `launch_consent_log`; confirm and unsubscribe change status and log an event.
6. `admin_audit` rejects update and delete.

Until these are run, treat RLS, stock reservation, duplicate payment protection, refunds and audit logging as **unverified**.

## Phase 6 note
`payments_checkout.sql` changed in Phase 6: KH6-012 (`orders_due_for_expiry` and `order_expire` now hold an order for 24 hours after a payment is authorised) and KH6-013 (a trigger, `orders_require_capture`, refuses to mark an online order paid unless a captured payment exists). If it was already run on staging, run it again, then `payments_checkout_selftest.sql`. Files 1 to 17 and all five self-tests were run on plain PostgreSQL 16 during the Phase 6 audit; see `docs/PHASE6_ISSUE_REGISTER.md` for what that does and does not prove.

Phase 7 Step 2.5 additions (all **not run**): `shipments_selftest.sql`, `email_outbox_selftest.sql`, `rate_limits_selftest.sql` (transaction, rolled back), `concurrency_test.sh` (isolated database only), `scheduler_pg_cron.sql.example` (example, not a migration). See `docs/PHASE7_STEP25_DATABASE.md`.


## Executed (Phase 7 Step 3.1)
Applied twice and self-tested on a disposable PostgreSQL 16 with stubbed Supabase roles and `storage.buckets`. Results in `docs/PHASE7_STEP31_TESTING.md`. Still not run on a Supabase project.


## Applied to Supabase project `kaayra-herbals` (ref mbmkeiihfeysxqnvzcda, ap-south-1), 2026-10-22
- Files 1 to 19 were already applied there (split into named migrations, 20261016 to 20261020). Not recorded here earlier.
- Applied now: `delivery_areas` (21) and `admin_passkeys` (22), both via the Supabase MCP `apply_migration`.
- Checked after: `shipping_pincodes.city` and `.state` exist; `admin_passkeys` has RLS on and no grants to anon or authenticated; `delivery_areas_upsert` is not executable by anon.
- NOT run: any self-test (`delivery_areas_selftest.sql`, `shipments_selftest.sql`, `email_outbox_selftest.sql`, `rate_limits_selftest.sql`, `payments_checkout_selftest.sql`, `checkout_selftest.sql`) on this project. `shipping_pincodes` is still empty, so no PIN code is deliverable.
- Advisors: RLS-enabled-no-policy INFO on all tables (intended: server-only access), `function_search_path_mutable` WARN on 45 functions (existing, not yet fixed), leaked-password protection off (Auth setting, owner to enable).
- Remaining migration work: none from files 1 to 22. Next: run self-tests inside rolled-back transactions, then set search_path on the functions.


## Phase 8
`finance.sql` is file **#29**, run last (after `bundles_wishlists.sql` and `launch_optin_member.sql`). Needs `orders`, `order_items`, `order_events`, `order_refunds`, `order_payments`, `shipments`, `inventory_batches`, `product_variants`. Safe to run twice (done). Not run on Supabase.

## Phase 12 Stage 2 verification (disposable PostgreSQL 16, not Supabase)
`bash scripts/db-verify.sh` (database name must start `kh_verify`): all 29 files applied twice without error; 15 self-tests passed. Files 1 to 19 and 21 to 22 are recorded above as already on the Supabase project; this session did not touch it. Files 20 and 23 to 29 have NOT been applied to Supabase according to this document.
