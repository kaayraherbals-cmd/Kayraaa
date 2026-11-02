#!/usr/bin/env bash
# Concurrency tests that one SQL transaction cannot show. ISOLATED DATABASE ONLY (CI Postgres or a STAGING Supabase project).
# Run on a disposable PostgreSQL 16 (Phase 7 Step 3.1): all four checks pass. NOT yet run on a Supabase project. Needs psql and DATABASE_URL, after the migrations. Leaves zz_* rows behind in what it creates: do not run on production.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the isolated database}"
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }

echo "== 1. rate limiter: 50 sessions x 20 hits must be counted exactly (no lost updates)"
q -c "delete from public.rate_limits where bucket = 'zz_conc';"
for i in $(seq 1 50); do
  q -c "select count(public.rate_limit_hit('zz_conc', repeat('c',64), 3600, 1000000)) from generate_series(1,20);" >/dev/null &
done
wait
HITS=$(q -c "select coalesce(sum(hits),0) from public.rate_limits where bucket = 'zz_conc';")
[ "$HITS" = "1000" ] || { echo "FAIL: expected 1000 hits, got $HITS (a window boundary may have split the count; re-run once)"; exit 1; }
echo "PASS: 1000 hits counted"

echo "== 2. email outbox: 10 workers claiming 100 due mails must never share a row"
q -c "create table if not exists public.zz_claims (id uuid primary key); truncate public.zz_claims;"
q -c "delete from public.email_outbox where dedupe_key like 'zz-conc-%';"
q -c "select count(public.email_enqueue('delivered', 'zz@example.org', 'zz-conc-' || g, '{}'::jsonb)) from generate_series(1,100) g;" >/dev/null
for w in $(seq 1 10); do
  ( while :; do
      N=$(q -c "with c as (select id from public.email_claim_due(7)) insert into public.zz_claims select id from c returning 1;" | wc -l)
      [ "$N" -gt 0 ] || break
    done ) &
done
wait
CLAIMED=$(q -c "select count(*) from public.zz_claims;")
SENDING=$(q -c "select count(*) from public.email_outbox where dedupe_key like 'zz-conc-%' and status = 'sending' and attempts = 1;")
[ "$CLAIMED" = "100" ] && [ "$SENDING" = "100" ] || { echo "FAIL: claimed=$CLAIMED sending-with-one-attempt=$SENDING (want 100 and 100); a duplicate claim would have raised a unique violation"; exit 1; }
echo "PASS: 100 mails claimed exactly once across 10 workers"

echo "== 3. enqueue race: 20 sessions enqueueing the same key create one row"
q -c "delete from public.email_outbox where dedupe_key = 'zz-conc-same';"
for i in $(seq 1 20); do q -c "select public.email_enqueue('delivered', 'zz@example.org', 'zz-conc-same', '{}'::jsonb);" >/dev/null & done
wait
ROWS=$(q -c "select count(*) from public.email_outbox where dedupe_key = 'zz-conc-same';")
[ "$ROWS" = "1" ] || { echo "FAIL: $ROWS rows for one dedupe key"; exit 1; }
echo "PASS: one row for one key"
echo "== 4. shipments: 10 sessions racing for 3 units; then 12 sessions racing to dispatch the 3 shipments"
# Rows are committed and cannot be deleted afterwards (shipment history is append-only): unique names per run, isolated database only.
SUF=$(( (RANDOM % 9000) + 1000 ))$RANDOM
FIX=$(q -c "
with m as (insert into public.members (id, email, provider) values (gen_random_uuid(), 'zz-conc-ship-$SUF@example.org', 'email') returning id),
p as (insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
      values ('zz-conc-ship-$SUF', 'ZZ CONC SHIP $SUF', 'Syrup', '100 ml', 'APPROVED_FOR_SALE', 'Conc test', 'Used only by the concurrency test.', true, 'conctest') returning id),
v as (insert into public.product_variants (product_id, sku, pack_size, price_paise) select id, 'ZZ-CONC-$SUF', '100 ml', 10000 from p returning id),
o as (insert into public.orders (order_no, status, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
      select 'KH-2026-' || (800000 + (random() * 99999)::int), 'packed', 'Conc Test', '1 Test Road', '221001', 30000, 30000, 'conctest', m.id from m returning id),
i as (insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise)
      select o.id, v.id, 'Conc test', '100 ml', 'ZZ-CONC-$SUF', 3, 10000, 30000 from o, v returning id)
select o.id || ' ' || i.id from o, i;")
ORD=${FIX% *}; ITEM=${FIX#* }
for i in $(seq 1 10); do
  q -c "select public.shipment_create('$ORD', jsonb_build_array(jsonb_build_object('order_item_id', '$ITEM', 'qty', 1)), 'conctest');" >/dev/null 2>&1 &
done
wait
SHIPS=$(q -c "select count(*) from public.shipments where order_id = '$ORD';")
UNITS=$(q -c "select coalesce(sum(si.qty),0) from public.shipment_items si join public.shipments s on s.id = si.shipment_id where s.order_id = '$ORD';")
[ "$SHIPS" = "3" ] && [ "$UNITS" = "3" ] || { echo "FAIL: shipments=$SHIPS units=$UNITS (want 3 and 3: the order line has 3 units)"; exit 1; }
echo "PASS: exactly 3 of 10 racing creates succeeded, no over-shipping"
IDS=$(q -c "select id from public.shipments where order_id = '$ORD';")
for id in $IDS; do
  for k in 1 2 3 4; do
    q -c "select public.shipment_set_status('$id', 'dispatched', 'conctest', 'Courier', 'TRK$k');" >/dev/null 2>&1 &
  done
done
wait
DISP=$(q -c "select count(*) from public.shipments where order_id = '$ORD' and status = 'dispatched';")
EVS=$(q -c "select count(*) from public.shipment_events e join public.shipments s on s.id = e.shipment_id where s.order_id = '$ORD' and e.kind = 'status' and e.to_status = 'dispatched';")
OST=$(q -c "select status from public.orders where id = '$ORD';")
[ "$DISP" = "3" ] && [ "$EVS" = "3" ] && [ "$OST" = "shipped" ] || { echo "FAIL: dispatched=$DISP dispatch-events=$EVS order=$OST (want 3, 3, shipped)"; exit 1; }
echo "PASS: each shipment dispatched exactly once under 4 racing sessions each; order shipped"

q -c "delete from public.email_outbox where dedupe_key like 'zz-conc-%'; delete from public.rate_limits where bucket = 'zz_conc'; drop table if exists public.zz_claims;"
echo "ALL CONCURRENCY TESTS PASSED"
