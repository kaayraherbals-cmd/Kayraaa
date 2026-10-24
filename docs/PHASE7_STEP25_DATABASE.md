# Phase 7 Step 2.5: database report

**No SQL has been executed.** There is no network, no staging Supabase project access and no local Postgres in the sandbox. Everything below marked PASS is a static check I could actually run; everything else is NOT TESTED or BLOCKED.

## Migration order and dependency check (PASS, static)

A script read every `create table/function/sequence/view` and `alter table ... add column` in `supabase/*.sql`, then listed each `public.<name>` the three new files use:

```
== shipments.sql        needs order_items, order_set_status, orders  <- inventory_orders.sql   (orders.member_id <- checkout.sql)
== email_outbox_v2.sql  needs email_outbox                           <- email_outbox.sql
== rate_limits.sql      needs nothing
```
No unresolved reference. Column names the TypeScript queries assume were checked against the SQL by reading: `order_payments.{rp_order_id,captured_at,status}`, `order_refunds.{updated_at,gateway_refund_id,gateway_status,amount_paise}`, `orders.{updated_at,channel,customer_email,member_id}` all exist.

Order (also in `docs/DATABASE_MIGRATIONS.md`): 1 `launch_subscribers`, 2 `email_outbox`, 3 `launch_optin`, 4 `auth_members`, 5 `issues`, 6 `roles_mfa_audit`, 7 `products`, 8 `products_seed`, 9 `products_catalog`, 10 `variants_gallery`, 11 `hsn_3004`, 12 `inventory_orders`, 13 `refunds`, 14 `payments`, 15 `carts`, 16 `checkout`, 17 `payments_checkout`, **18 `shipments`, 19 `email_outbox_v2` (after 3), 20 `rate_limits`**.

Known ordering trap (S2-019): `launch_optin.sql` redefines `email_outbox_kind_check` without the ten order kinds. Re-running it after step 19 breaks order mail until `email_outbox_v2.sql` is run again.

## Self-tests written this step (all NOT TESTED)

Each runs in one transaction that rolls back, prints `PASS:` notices, and raises on any failure. Run on an **isolated staging project only**, after the migrations.

| File | What it asserts |
|---|---|
| `supabase/shipments_selftest.sql` | Only a **packed** order can be shipped; item must belong to the order; empty shipment refused; shipment number format; cannot ship more than is left; illegal moves, missing courier/tracking, and future event times refused; partial dispatch leaves the order packed; order becomes shipped only when every unit is dispatched; failed delivery needs a reason and opens an exception, retry closes it; order is delivered only after every shipment is; delivered is final; history cannot be updated or deleted; customer sees only own shipments and only visible events (another member sees none; wrong order sees none); cancelling an order cancels pending shipments; RLS enabled on all four tables; `anon` cannot read, `authenticated` cannot call the ownership function, neither can execute any shipment function |
| `supabase/email_outbox_selftest.sql` | Legacy rows still insert; dedupe returns the same row, address lower-cased; bad kind and oversize payload rejected; claim marks sending and a locked row is not handed out twice; retry delays 1, 5, 30, 120, 720 minutes then dead (each checked within a minute); no claim before due; permanent error is dead at once; success clears the payload; a sent mail is never reclaimed or overwritten; defer does not use an attempt; expired lock is reclaimed; skip clears payload; purge removes old finished rows and keeps recent dead ones; `anon` and `authenticated` reach nothing |
| `supabase/rate_limits_selftest.sql` | Count per bucket and per key; limit applies on the hit after the maximum; only a 64-hex hash can be stored; bad limits refused; browser roles reach nothing |
| `supabase/concurrency_test.sh` | 50 sessions x 20 hits counted exactly (1000); 10 workers claiming 100 mails never share a row; 20 sessions enqueueing one key create one row |
| `.github/workflows/ci.yml` | Throw-away Postgres 16: stand-in `anon`/`authenticated`/`service_role` roles and the one `storage.buckets` table, all 20 migrations in order, all 8 self-test files, the concurrency script, plus the npm baseline |

Things most likely to need correcting on the first run (I wrote the SQL without being able to run it):
- `shipment_set_status` does `select status into o.status` into a field of a `%rowtype` variable.
- `email_enqueue` uses `on conflict (dedupe_key) where dedupe_key is not null` to match the partial unique index.
- `email_claim_due` uses `return query update ... returning m.*` with a `for update skip locked` subquery.
- The existing self-tests (`phase3`, `refunds`, `payments`, `checkout`, `payments_checkout`) have not been run since they were written either.

## "Admin permissions" in the database

The database does not know about admin roles. All shipment, outbox and rate-limit functions are `revoke`d from `public`, `anon` and `authenticated`, so only the API's service-role key can call them; the owner/manager/support rules live in the API (`shared/roles.ts`, `server/admin/shipments.ts`). The SQL self-tests check the revokes. The role rules are tested at API level: PASS (stand-in), `server/admin/shipments.test.ts` (support can read, cannot create, change status, add a note or resolve an exception; manager and owner can).

## Row-level security

All four shipment tables and the rate-limit table have RLS enabled and no policies, with all table privileges revoked from the browser roles; `email_outbox` was already RLS-on with no grants. No browser-facing path reads these tables. Customer shipment access goes only through `shipments_for_member(member, order)`, which the API calls with the signed-in member's id (there is no customer endpoint for it yet). Verified by: reading (done); self-tests (not run).

## Not covered
Real Supabase differences from plain Postgres (the CI stand-ins are approximations); a restore or rollback procedure for the three migrations (they are additive, so rollback means dropping the new objects, but that has not been written or tested); load behaviour.
