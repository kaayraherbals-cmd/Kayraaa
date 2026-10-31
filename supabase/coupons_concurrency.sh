#!/usr/bin/env bash
# Concurrency tests for coupons that one SQL transaction cannot show. ISOLATED DATABASE ONLY (CI Postgres or a STAGING Supabase project).
# Needs psql and DATABASE_URL, after coupons.sql. It COMMITS rows (members, a product, coupons, orders) and cannot clean up
# everything afterwards (orders are kept by design): never run it on production.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the isolated database}"
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }
SUF=$(( (RANDOM % 9000) + 1000 ))$RANDOM

echo "== fixtures"
VAR=$(q -c "
with p as (insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
           values ('zz-cc-$SUF', 'ZZ CC $SUF', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Coupon conc', 'Test only.', true, 'conctest') returning id),
v as (insert into public.product_variants (product_id, sku, pack_size, price_paise) select id, 'ZZ-CC-$SUF', '60 tabs', 50000 from p returning id)
select id from v;")
q -c "select public.inventory_receive('$VAR', 'ZZ-CC-$SUF', current_date - 30, current_date + 400, 5000, 'conctest', 'conctest');" >/dev/null
q -c "insert into public.shipping_pincodes (pincode, rate_paise, free_above_paise) values ('221001', 6000, 99900) on conflict (pincode) do update set active = true;" >/dev/null
for i in $(seq 1 20); do q -c "insert into public.members (id, email, provider) values ('00000000-0000-4000-8000-$(printf '%012d' $((SUF * 100 + i)))', 'zz-cc-$SUF-$i@example.org', 'email');" >/dev/null; done
q -c "insert into public.coupons (code, discount_type, percent_bps, usage_limit, per_customer_limit, active, created_by) values ('ZZLIM$SUF', 'percent', 1000, 3, 1, true, 'conctest'), ('ZZONE$SUF', 'percent', 1000, null, 1, true, 'conctest');" >/dev/null

place() { # member-number coupon qty
  local m="00000000-0000-4000-8000-$(printf '%012d' $((SUF * 100 + $1)))"
  q -c "select public.checkout_place('$m', gen_random_uuid(), 'conc-hash-' || gen_random_uuid()::text,
        jsonb_build_object('customer_name','Conc Test','customer_phone','+919876543210','ship_address','1 Test Road, Varanasi, UP','ship_pincode','221001','shipping_paise',0,
        'items', jsonb_build_array(jsonb_build_object('variant_id','$VAR','qty',$3))), $(( $3 * 50000 - $3 * 5000 )), true, 30, 30, '$2');" >/dev/null 2>"/tmp/zz_cc_${SUF}_$1_$3.err" && echo ok || echo fail
}

echo "== 1. usage limit 3: 20 members racing for one coupon get exactly 3 redemptions"
for i in $(seq 1 20); do ( place $i ZZLIM$SUF 3 >/dev/null ) & done
wait
N=$(q -c "select count(*) from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id where c.code = 'ZZLIM$SUF' and r.status in ('reserved','committed');")
[ "$N" = "3" ] || { echo "FAIL: expected 3 reservations, got $N"; exit 1; }
echo "PASS: exactly 3 of 20 concurrent checkouts got the coupon"

echo "== 2. per-customer limit 1: one member sending 8 different orders at once gets exactly 1"
for qty in $(seq 2 9); do ( place 20 ZZONE$SUF $qty >/dev/null ) & done
wait
N=$(q -c "select count(*) from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id where c.code = 'ZZONE$SUF' and r.status in ('reserved','committed');")
[ "$N" = "1" ] || { echo "FAIL: expected 1 reservation for one member, got $N"; exit 1; }
echo "PASS: one member cannot exceed the per-customer limit by racing"

echo "== 3. totals: every discounted order has total = subtotal - discount + shipping and line discounts add up"
BAD=$(q -c "select count(*) from public.orders o where o.coupon_code like 'ZZ%$SUF' and (o.total_paise <> o.subtotal_paise - o.discount_paise + o.shipping_paise or o.discount_paise <> (select coalesce(sum(discount_paise),0) from public.order_items i where i.order_id = o.id));")
[ "$BAD" = "0" ] || { echo "FAIL: $BAD inconsistent orders"; exit 1; }
echo "PASS: order totals consistent"

echo "== 4. release under load: cancel the 3 winners at once; each use is released exactly once"
for oid in $(q -c "select o.id from public.orders o where o.coupon_code = 'ZZLIM$SUF'"); do
  for k in 1 2; do ( q -c "select public.order_set_status('$oid', 'cancelled', 'conctest', null, null, 'conc') ;" >/dev/null 2>&1 || true ) & done
done
wait
REL=$(q -c "select count(*) from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id where c.code = 'ZZLIM$SUF' and r.status = 'released';")
OPEN=$(q -c "select count(*) from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id where c.code = 'ZZLIM$SUF' and r.status <> 'released';")
[ "$REL" = "3" ] && [ "$OPEN" = "0" ] || { echo "FAIL: released=$REL open=$OPEN"; exit 1; }
echo "PASS: all 3 released once"
echo "All coupon concurrency checks passed."
