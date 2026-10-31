#!/usr/bin/env bash
# Concurrency check for loyalty.sql: two checkouts race for the SAME 100 points. Exactly one may succeed, the balance must never go negative,
# and ledger must equal lots. Run ONLY in a disposable database that has every migration applied (it commits real rows, then deletes what it made
# except ledger rows, which are append-only: the throwaway database should be dropped afterwards).
# Usage: PSQL="psql -h /tmp -p 5544 -U postgres -d kh" ROUNDS=20 ./loyalty_concurrency.sh
set -euo pipefail
PSQL=${PSQL:-psql}; ROUNDS=${ROUNDS:-20}
q() { $PSQL -v ON_ERROR_STOP=1 -qtAX "$@"; }
M=$(q -c "select gen_random_uuid()")
q -c "insert into public.members (id,email,provider) values ('$M','zz-conc-$M@example.org','email');
      update public.loyalty_settings set enabled=true, stacking='exclusive', max_redeem_bps=10000, expiry_months=12;
      insert into public.loyalty_accounts (member_id) values ('$M');
      insert into public.products (slug,internal_name,form,pack_size,status,public_name,public_description,claims_reviewed,reviewed_by) values ('zz-conc-$M','ZZ','Syrup','200 ml','APPROVED_FOR_SALE','Conc','Test only.',true,'conc');
      insert into public.product_variants (product_id,sku,pack_size,price_paise) select id,'ZZ-C-'||upper(substr('$M',1,8)),'200 ml',100000 from public.products where slug='zz-conc-$M';"
V=$(q -c "select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.slug='zz-conc-$M'")
mk() { q -c "with o as (insert into public.orders (order_no,status,channel,customer_name,ship_address,ship_pincode,subtotal_paise,total_paise,created_by,member_id)
   values (public.next_order_no(),'placed','online','T','Test address 12345','221001',100000,100000,'conc','$M') returning id),
   i as (insert into public.order_items (order_id,variant_id,product_name,pack_size,sku,qty,unit_price_paise,line_total_paise) select id,'$V','B','200 ml','ZZ',1,100000,100000 from o) select id from o"; }
fail=0
for r in $(seq 1 "$ROUNDS"); do
  # Normalise to exactly 100 available points (a release in the previous round returns points, so the balance would otherwise accumulate).
  av=$(q -c "select coalesce(sum(delta_available),0) from public.loyalty_ledger where member_id='$M'")
  if [ "$av" != "100" ]; then q -c "select public.loyalty_adjust('$M', 100 - $av, 'Concurrency test normalise', 'conc', 'norm-$r-$RANDOM')" >/dev/null; fi
  A=$(mk); Bo=$(mk)
  ( q -c "select public.loyalty_reserve('$M','$A',100,'ka-$M-$r')" >/tmp/lc_a.$$ 2>&1 || true ) &
  ( q -c "select public.loyalty_reserve('$M','$Bo',100,'kb-$M-$r')" >/tmp/lc_b.$$ 2>&1 || true ) &
  wait
  ok=$(cat /tmp/lc_a.$$ /tmp/lc_b.$$ | grep -c 'discount_paise' || true)
  if [ "$ok" != "1" ]; then echo "ROUND $r FAIL: $ok reservations succeeded"; cat /tmp/lc_a.$$ /tmp/lc_b.$$; fail=1; fi
  # settle: release the winner so the next round starts from 100 available
  q -c "select public.loyalty_release('$A'); select public.loyalty_release('$Bo');" >/dev/null
  neg=$(q -c "select count(*) from public.loyalty_lots where member_id='$M' and remaining<0")
  [ "$neg" = "0" ] || { echo "negative lot"; fail=1; }
  q -c "update public.orders set status='cancelled' where id in ('$A','$Bo')" >/dev/null
done
drift=$(q -c "select (select coalesce(sum(delta_available+delta_reserved),0) from public.loyalty_ledger where member_id='$M') - (select coalesce(sum(remaining),0) from public.loyalty_lots where member_id='$M')")
[ "$drift" = "0" ] || { echo "ledger/lots drift: $drift"; fail=1; }
rm -f /tmp/lc_a.$$ /tmp/lc_b.$$
if [ "$fail" = "0" ]; then echo "PASS: $ROUNDS rounds, never more than one winner, no negative balance, no drift"; else exit 1; fi
