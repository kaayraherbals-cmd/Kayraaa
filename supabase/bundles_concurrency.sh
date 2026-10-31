#!/usr/bin/env bash
# Concurrency check for bundles_wishlists.sql: two members race for the LAST bundle. Exactly one may win, no component may be
# reserved beyond what is on hand, and reservations must equal exactly one bundle's components. Run ONLY in a disposable database
# with every migration applied (it commits real rows; drop the database afterwards).
# Usage: PSQL="psql -h /tmp -p 5544 -U postgres -d kh" ROUNDS=20 ./bundles_concurrency.sh
set -euo pipefail
PSQL=${PSQL:-psql}; ROUNDS=${ROUNDS:-20}
q() { $PSQL -v ON_ERROR_STOP=1 -qtAX "$@"; }
S=$(q -c "select substr(md5(random()::text),1,8)")
q -c "insert into public.shipping_pincodes (pincode, active, rate_paise) values ('221001', true, 5000) on conflict (pincode) do update set active = true;
 insert into public.products (slug,internal_name,form,pack_size,status,public_name,public_description,claims_reviewed,reviewed_by) values ('zz-bc-a-$S','ZZ','Tablet','60 tabs','APPROVED_FOR_SALE','A','Test only.',true,'conc'),('zz-bc-b-$S','ZZ','Syrup','200 ml','APPROVED_FOR_SALE','B','Test only.',true,'conc');
 insert into public.product_variants (product_id,sku,pack_size,price_paise) select id,'ZZBC'||upper(substr(slug,7,1))||upper('$S'),pack_size,50000 from public.products where slug like 'zz-bc-_-$S';"
VA=$(q -c "select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.slug='zz-bc-a-$S'")
VB=$(q -c "select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.slug='zz-bc-b-$S'")
B=$(q -c "select public.bundle_upsert('{\"slug\":\"zz-bc-$S\",\"name\":\"Race\",\"pricing_mode\":\"percent_off\",\"percent_bps\":1000,\"components\":[{\"variant_id\":\"$VA\",\"qty\":2},{\"variant_id\":\"$VB\",\"qty\":1}]}','conc')")
q -c "select public.inventory_receive('$VA','CA$(echo $S | tr a-z A-Z)',null,current_date+400,2,'c','conc'); select public.inventory_receive('$VB','CB'||upper('$S'),null,current_date+400,1,'c','conc'); select public.bundle_set_status('$B','active','conc')" >/dev/null
fail=0
for r in $(seq 1 "$ROUNDS"); do
  M1=$(q -c "insert into public.members (id,email,provider) values (gen_random_uuid(),'zz-bc1-$S-$r@example.org','email') returning id")
  M2=$(q -c "insert into public.members (id,email,provider) values (gen_random_uuid(),'zz-bc2-$S-$r@example.org','email') returning id")
  call() { q -c "select public.checkout_place_with_bundles('$1', gen_random_uuid(), '$2', '{\"customer_name\":\"T\",\"ship_address\":\"Test address 12345\",\"ship_pincode\":\"221001\",\"shipping_paise\":5000,\"items\":[{\"bundle_id\":\"$B\",\"qty\":1}]}'::jsonb, 135000+5000, true, 30, 30, null)"; }
  ( call "$M1" "$(printf '%064d' 1 | tr 0 a)" >/tmp/bc_a.$$ 2>&1 || true ) &
  ( call "$M2" "$(printf '%064d' 2 | tr 0 b)" >/tmp/bc_b.$$ 2>&1 || true ) &
  wait
  ok=$(cat /tmp/bc_a.$$ /tmp/bc_b.$$ | grep -c 'order_id' || true)
  if [ "$ok" != "1" ]; then echo "ROUND $r FAIL: $ok purchases succeeded"; cat /tmp/bc_a.$$ /tmp/bc_b.$$; fail=1; fi
  ra=$(q -c "select coalesce(sum(qty_reserved),0) from public.inventory_batches where variant_id='$VA'"); rb=$(q -c "select coalesce(sum(qty_reserved),0) from public.inventory_batches where variant_id='$VB'")
  [ "$ra" = "2" ] && [ "$rb" = "1" ] || { echo "ROUND $r FAIL: reserved A=$ra B=$rb (expected 2 and 1)"; fail=1; }
  # free the winner's stock through the real cancel path so the next round races for the last bundle again
  W=$(q -c "select o.id from public.orders o where o.member_id in ('$M1','$M2') limit 1")
  q -c "select public.order_set_status('$W','cancelled','conc')" >/dev/null
done
rm -f /tmp/bc_a.$$ /tmp/bc_b.$$
if [ "$fail" = "0" ]; then echo "PASS: $ROUNDS rounds, exactly one winner each time, components never oversold or double-reserved"; else exit 1; fi
