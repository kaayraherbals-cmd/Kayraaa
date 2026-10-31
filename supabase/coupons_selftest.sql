-- Self-test for coupons.sql. Run on a DISPOSABLE or STAGING database after coupons.sql. Everything happens in one transaction that
-- ROLLS BACK, so it leaves nothing behind. It prints "PASS: ..." notices and raises an exception on the first failure.
-- Do not run on production: it inserts and then rolls back real rows and takes row locks.
begin;
do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
  pa uuid; pb uuid; va uuid; vb uuid;
  c public.coupons%rowtype;
  v jsonb; r jsonb; o1 uuid; o2 uuid; o3 uuid; o4 uuid;
  k int := 0;
  lines jsonb;
  tot bigint; disc bigint;
  err text;
  rp int := 0;

begin
  -- ---- fixtures ----
  insert into public.members (id, email, provider) values (m1, 'zz-c1@example.org', 'email'), (m2, 'zz-c2@example.org', 'email'), (m3, 'zz-c3@example.org', 'email');
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-cp-a', 'ZZ CP A', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Coupon test A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-cp-b', 'ZZ CP B', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'Coupon test B', 'Test only.', true, 'selftest') returning id into pb;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pa, 'ZZ-CP-A', '60 tabs', 49900) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pb, 'ZZ-CP-B', '200 ml', 30001) returning id into vb;
  perform public.inventory_receive(va, 'ZZ-A1', current_date - 30, current_date + 400, 200, 'selftest', 'selftest');
  perform public.inventory_receive(vb, 'ZZ-B1', current_date - 30, current_date + 400, 200, 'selftest', 'selftest');
  insert into public.shipping_pincodes (pincode, rate_paise, free_above_paise) values ('221001', 6000, 99900) on conflict (pincode) do update set active = true, rate_paise = 6000, free_above_paise = 99900;
  insert into public.carts (member_id) values (m1), (m2), (m3);

  lines := jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 149700), jsonb_build_object('ref', 'b', 'variant_id', vb, 'line_total_paise', 30001));

  -- ---- 1. percentage maths, floor rounding, cap ----
  insert into public.coupons (code, discount_type, percent_bps, min_order_paise, max_discount_paise, active, created_by) values ('PCT10', 'percent', 1000, 99900, 30000, true, 't') returning * into c;
  v := public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 99999)), 0, null);
  if (v ->> 'discount_paise')::bigint <> 9999 then raise exception 'FAIL 1a: 10%% of 99999 should floor to 9999, got %', v; end if;
  v := public.coupon_compute(c, m1, lines, 0, null);
  if (v ->> 'discount_paise')::bigint <> 17970 then raise exception 'FAIL 1b: 10%% of 179701 should be 17970, got %', v; end if;
  update public.coupons set percent_bps = 5000 where id = c.id returning * into c;
  v := public.coupon_compute(c, m1, lines, 0, null);
  if (v ->> 'discount_paise')::bigint <> 30000 then raise exception 'FAIL 1c: cap of 30000 should apply, got %', v; end if;
  raise notice 'PASS: percentage maths, rounding down, cap';

  -- ---- 2. minimum order, fixed amount clamps ----
  v := public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 49900)), 0, null);
  if v ->> 'reason' <> 'MIN_ORDER' then raise exception 'FAIL 2a: %', v; end if;
  insert into public.coupons (code, discount_type, fixed_paise, active, created_by) values ('FIX500', 'fixed', 50000, true, 't') returning * into c;
  v := public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 30000)), 6000, null);
  if (v ->> 'discount_paise')::bigint <> 30000 then raise exception 'FAIL 2b: fixed discount must not exceed the eligible subtotal, got %', v; end if;
  raise notice 'PASS: minimum order and fixed-amount clamp';

  -- ---- 3. payable floor: 100%% coupon leaves at least Rs 1 ----
  insert into public.coupons (code, discount_type, percent_bps, active, created_by) values ('FULL100', 'percent', 10000, true, 't') returning * into c;
  v := public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 49900)), 0, null);
  if (v ->> 'discount_paise')::bigint <> 49800 then raise exception 'FAIL 3: payable floor of 100 paise, got %', v; end if;
  raise notice 'PASS: payable floor (never zero)';

  -- ---- 4. state: inactive, not started, expired ----
  insert into public.coupons (code, discount_type, percent_bps, active, created_by) values ('OFF1', 'percent', 1000, false, 't') returning * into c;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'reason' <> 'INACTIVE' then raise exception 'FAIL 4a'; end if;
  insert into public.coupons (code, discount_type, percent_bps, active, starts_at, created_by) values ('LATER1', 'percent', 1000, true, now() + interval '1 day', 't') returning * into c;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'reason' <> 'NOT_STARTED' then raise exception 'FAIL 4b'; end if;
  insert into public.coupons (code, discount_type, percent_bps, active, starts_at, expires_at, created_by) values ('GONE1', 'percent', 1000, true, now() - interval '2 days', now() - interval '1 day', 't') returning * into c;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'reason' <> 'EXPIRED' then raise exception 'FAIL 4c'; end if;
  if public.coupon_quote(m1, 'nosuchcode', lines, 0) ->> 'reason' <> 'NOT_FOUND' then raise exception 'FAIL 4d'; end if;
  raise notice 'PASS: inactive, scheduled, expired, unknown';

  -- ---- 5. product and form restrictions, intersection, exact allocation ----
  insert into public.coupons (code, discount_type, percent_bps, product_ids, active, created_by) values ('ONLYA', 'percent', 2000, array[pa], true, 't') returning * into c;
  v := public.coupon_compute(c, m1, lines, 0, null);
  if (v ->> 'discount_paise')::bigint <> 29940 or (v ->> 'eligible_paise')::bigint <> 149700 then raise exception 'FAIL 5a: only product A is discounted, got %', v; end if;
  insert into public.coupons (code, discount_type, percent_bps, product_forms, active, created_by) values ('SYRUPS', 'percent', 1000, array['Syrup'], true, 't') returning * into c;
  v := public.coupon_compute(c, m1, lines, 0, null);
  if (v ->> 'eligible_paise')::bigint <> 30001 or (v ->> 'discount_paise')::bigint <> 3000 then raise exception 'FAIL 5b: form restriction, got %', v; end if;
  insert into public.coupons (code, discount_type, percent_bps, product_ids, product_forms, active, created_by) values ('BOTH1', 'percent', 1000, array[pa], array['Syrup'], true, 't') returning * into c;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'reason' <> 'NOT_ELIGIBLE_ITEMS' then raise exception 'FAIL 5c: product AND form must both match'; end if;
  insert into public.coupons (code, discount_type, percent_bps, product_ids, active, created_by) values ('ONLYB', 'percent', 1000, array[pb], true, 't') returning * into c;
  if public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 49900)), 0, null) ->> 'reason' <> 'NOT_ELIGIBLE_ITEMS' then raise exception 'FAIL 5d'; end if;
  -- three odd lines: parts must add up exactly
  insert into public.coupons (code, discount_type, fixed_paise, active, created_by) values ('SPLIT1', 'fixed', 10000, true, 't') returning * into c;
  v := public.coupon_compute(c, m1, jsonb_build_array(jsonb_build_object('ref', 'x', 'variant_id', va, 'line_total_paise', 33333), jsonb_build_object('ref', 'y', 'variant_id', va, 'line_total_paise', 33334), jsonb_build_object('ref', 'z', 'variant_id', vb, 'line_total_paise', 33335)), 0, null);
  if (select sum((e.value ->> 'discount_paise')::bigint) from jsonb_array_elements(v -> 'allocations') e) <> 10000 then raise exception 'FAIL 5e: allocation must sum to the discount, got %', v; end if;
  raise notice 'PASS: product/form restrictions and exact allocation';

  -- ---- 6. place an order with a coupon: totals, lines, reservation ----
  insert into public.coupons (code, discount_type, percent_bps, min_order_paise, max_discount_paise, usage_limit, per_customer_limit, active, created_by)
  values ('KAAYRA10', 'percent', 1000, 99900, 30000, 1, 1, true, 't') returning * into c;
  -- 3 x 49900 = 149700 ; 10% = 14970 ; shipping free above 99900 -> 0 ; total 134730
  r := public.checkout_place(m1, gen_random_uuid(), 'selftest-hash-0000001', jsonb_build_object('customer_name', 'T One', 'customer_email', 'zz-c1@example.org', 'customer_phone', '+919876543210',
        'ship_address', '1 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001', 'shipping_paise', 0, 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 3))),
        134730, true, 30, 30, 'kaayra10');
  o1 := (r ->> 'order_id')::uuid;
  select subtotal_paise, discount_paise into tot, disc from public.orders where id = o1;
  if tot <> 149700 or disc <> 14970 then raise exception 'FAIL 6a: subtotal %, discount %', tot, disc; end if;
  if (select total_paise from public.orders where id = o1) <> 134730 then raise exception 'FAIL 6b: total'; end if;
  if (select sum(discount_paise) from public.order_items where order_id = o1) <> 14970 then raise exception 'FAIL 6c: line discounts'; end if;
  if (select status from public.coupon_redemptions where order_id = o1) <> 'reserved' then raise exception 'FAIL 6d'; end if;
  raise notice 'PASS: order placed with coupon, totals and reservation correct';

  -- ---- 7. wrong expected total refuses and leaves nothing behind (stock, redemption) ----
  select qty_reserved into tot from public.inventory_batches where variant_id = vb;
  begin
    perform public.checkout_place(m2, gen_random_uuid(), 'selftest-hash-0000002', jsonb_build_object('customer_name', 'T Two', 'customer_phone', '+919876543211', 'ship_address', '2 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
            'shipping_paise', 6000, 'items', jsonb_build_array(jsonb_build_object('variant_id', vb, 'qty', 1))), 36001, true, 30, 30, 'ONLYB');
    raise exception 'FAIL 7: expected a refusal';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%PRICE_CHANGED%' then raise exception 'FAIL 7: wrong error %', sqlerrm; end if;
  end;
  if (select count(*) from public.coupon_redemptions where code = 'ONLYB') <> 0 then raise exception 'FAIL 7: redemption leaked'; end if;
  begin
    perform 1;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select qty_reserved from public.inventory_batches where variant_id = vb) <> tot then raise exception 'FAIL 7: stock reservation leaked'; end if;
  raise notice 'PASS: refused checkout leaves no stock or redemption behind';

  -- ---- 8. usage limit 1 is held by the reservation; a second member is refused; cancel releases it ----
  begin
    perform public.checkout_place(m2, gen_random_uuid(), 'selftest-hash-0000003', jsonb_build_object('customer_name', 'T Two', 'customer_phone', '+919876543211', 'ship_address', '2 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
            'shipping_paise', 0, 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 3))), 134730, true, 30, 30, 'KAAYRA10');
    raise exception 'FAIL 8a: usage limit not enforced';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%KH:COUPON:USAGE_LIMIT%' then raise exception 'FAIL 8a: wrong error %', sqlerrm; end if;
  end;
  perform public.order_cancel_own(m1, o1);
  if (select status || ':' || release_reason from public.coupon_redemptions where order_id = o1) <> 'released:unpaid_order_cancelled' then raise exception 'FAIL 8b: not released'; end if;
  r := public.checkout_place(m2, gen_random_uuid(), 'selftest-hash-0000004', jsonb_build_object('customer_name', 'T Two', 'customer_phone', '+919876543211', 'ship_address', '2 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
          'shipping_paise', 0, 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 3))), 134730, true, 30, 30, 'KAAYRA10');
  o2 := (r ->> 'order_id')::uuid;
  raise notice 'PASS: usage limit holds, cancel releases, next customer can use it';

  -- ---- 9. replay with the same key does not reserve twice ----
  declare k9 uuid := gen_random_uuid(); n int; begin
    perform public.checkout_place(m3, k9, 'selftest-hash-0000005', jsonb_build_object('customer_name', 'T Three', 'customer_phone', '+919876543212', 'ship_address', '3 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
            'shipping_paise', 6000, 'items', jsonb_build_array(jsonb_build_object('variant_id', vb, 'qty', 1))), 36001, true, 30, 30, null);
    r := public.checkout_place(m3, k9, 'selftest-hash-0000005', '{}'::jsonb, 1, true, 30, 30, 'KAAYRA10');
    if (r ->> 'replay')::boolean is not true then raise exception 'FAIL 9: expected replay'; end if;
    select count(*) into n from public.orders where member_id = m3; if n <> 1 then raise exception 'FAIL 9: duplicate order'; end if;
  end;
  raise notice 'PASS: duplicate checkout request is a replay';

  -- ---- 10. payment: amount recorded is the discounted total; paid commits once; duplicate event harmless ----
  begin
    perform public.payment_attach(m2, o2, 'order_zz1', 149700 + 0, 'selftest');
    raise exception 'FAIL 10a: attach accepted the undiscounted amount';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.payment_attach(m2, o2, 'order_zz1', 134730, 'selftest');
  if (select amount_paise from public.order_payments where rp_order_id = 'order_zz1') <> 134730 then raise exception 'FAIL 10b'; end if;
  if public.payment_apply_event('evt_zz_1', 'payment.captured', 'order_zz1', 'pay_zz1', null, 149700, 'upi', null, null) <> 'amount_mismatch' then raise exception 'FAIL 10c: wrong captured amount must be flagged, not paid'; end if;
  if (select status from public.orders where id = o2) <> 'placed' then raise exception 'FAIL 10c: order moved on a wrong amount'; end if;
  if public.payment_apply_event('evt_zz_2', 'payment.captured', 'order_zz1', 'pay_zz1', null, 134730, 'upi', null, null) <> 'captured' then raise exception 'FAIL 10d'; end if;
  if (select status from public.coupon_redemptions where order_id = o2) <> 'committed' then raise exception 'FAIL 10e: not committed'; end if;
  perform public.payment_apply_event('evt_zz_3', 'order.paid', 'order_zz1', 'pay_zz1', null, 134730, 'upi', null, null);
  if (select count(*) from public.coupon_redemptions where coupon_id = c.id and status = 'committed') <> 1 then raise exception 'FAIL 10f: double commit'; end if;
  raise notice 'PASS: payment amount equals discounted total, one commit, duplicates harmless';

  -- ---- 11. refund basis and cap ----
  r := public.order_refund_basis(o2);
  if (r ->> 'paid_paise')::bigint <> 134730 or (r ->> 'discount_paise')::bigint <> 14970 or (r -> 'lines' -> 0 ->> 'net_paise')::bigint <> 134730 then raise exception 'FAIL 11a: %', r; end if;
  if (r -> 'lines' -> 0 ->> 'unit_net_paise')::bigint <> 44910 then raise exception 'FAIL 11a: unit net (134730/3) %', r; end if;
  begin perform public.refund_create(o2, 'refund_only', 'other', 'selftest over-refund', 134731, 'selftest'); raise exception 'FAIL 11b: refund above paid accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.refund_create(o2, 'refund_only', 'other', 'selftest partial', 44910, 'selftest');
  if (public.order_refund_basis(o2) ->> 'remaining_paise')::bigint <> 89820 then raise exception 'FAIL 11c: remaining'; end if;
  if (select status from public.coupon_redemptions where order_id = o2) <> 'committed' then raise exception 'FAIL 11d: a partial refund must not release the use'; end if;
  raise notice 'PASS: refund basis uses discounted values, cap holds, partial refund keeps the use';

  -- ---- 12. a PAID order cancelled before shipping releases the use, once ----
  perform public.order_set_status(o2, 'cancelled', 'selftest', null, null, 'selftest cancel');
  if (select status || ':' || release_reason from public.coupon_redemptions where order_id = o2) <> 'released:paid_order_cancelled' then raise exception 'FAIL 12a'; end if;
  if (select count(*) from public.coupon_redemptions where status = 'released' and order_id = o2) <> 1 then raise exception 'FAIL 12b'; end if;
  raise notice 'PASS: cancelling a paid order releases the use exactly once';

  -- ---- 13. expiry releases an abandoned checkout ----
  r := public.checkout_place(m1, gen_random_uuid(), 'selftest-hash-0000006', jsonb_build_object('customer_name', 'T One', 'customer_phone', '+919876543210', 'ship_address', '1 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
          'shipping_paise', 0, 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 3))), 134730, true, 30, 30, 'KAAYRA10');
  o3 := (r ->> 'order_id')::uuid;
  update public.orders set pay_by = now() - interval '10 minutes' where id = o3;
  if public.order_expire(o3, 'selftest', 2) <> 'expired' then raise exception 'FAIL 13a'; end if;
  if (select status || ':' || release_reason from public.coupon_redemptions where order_id = o3) <> 'released:unpaid_order_cancelled' then raise exception 'FAIL 13b'; end if;
  raise notice 'PASS: expired checkout releases the coupon';

  -- ---- 14. stacking is impossible ----
  r := public.checkout_place(m1, gen_random_uuid(), 'selftest-hash-0000007', jsonb_build_object('customer_name', 'T One', 'customer_phone', '+919876543210', 'ship_address', '1 Test Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221001',
          'shipping_paise', 6000, 'items', jsonb_build_array(jsonb_build_object('variant_id', vb, 'qty', 2))), 66002 - 0, true, 30, 30, null);
  o4 := (r ->> 'order_id')::uuid;
  perform public.coupon_reserve_for_order(m1, o4, 'ONLYB');
  begin perform public.coupon_reserve_for_order(m1, o4, 'FIX500'); raise exception 'FAIL 14: second coupon accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; if sqlerrm not like '%STACKING%' then raise exception 'FAIL 14: wrong error %', sqlerrm; end if; end;
  begin insert into public.coupon_redemptions (coupon_id, order_id, code, discount_paise, eligible_subtotal_paise, order_subtotal_paise) values ((select id from public.coupons where code = 'FIX500'), o4, 'FIX500', 100, 100, 100);
    raise exception 'FAIL 14: unique index missing'; exception when unique_violation then null; end;
  raise notice 'PASS: no stacking (function and unique index)';

  -- ---- 15. per-customer limit and first-order only ----
  insert into public.coupons (code, discount_type, percent_bps, per_customer_limit, active, created_by) values ('ONCE1', 'percent', 1000, 1, true, 't') returning * into c;
  select id into o3 from public.orders where member_id = m3 limit 1; -- an order with no redemption of its own
  insert into public.coupon_redemptions (coupon_id, order_id, member_id, code, status, discount_paise, eligible_subtotal_paise, order_subtotal_paise, committed_at)
    values (c.id, o3, m3, 'ONCE1', 'committed', 100, 1000, 1000, now());
  if public.coupon_compute(c, m3, lines, 0, null) ->> 'reason' <> 'CUSTOMER_LIMIT' then raise exception 'FAIL 15a'; end if;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'ok' <> 'true' then raise exception 'FAIL 15a: other member unaffected'; end if;
  delete from public.coupon_redemptions where coupon_id = c.id;
  insert into public.coupons (code, discount_type, percent_bps, first_order_only, active, created_by) values ('FIRST1', 'percent', 1000, true, true, 't') returning * into c;
  if public.coupon_compute(c, m1, lines, 0, null) ->> 'reason' <> 'FIRST_ORDER' then raise exception 'FAIL 15b: m1 has an open order (o4)'; end if;
  if public.coupon_compute(c, gen_random_uuid(), lines, 0, null) ->> 'ok' <> 'true' then raise exception 'FAIL 15c: a brand-new member is eligible'; end if;
  raise notice 'PASS: per-customer limit and first-order rule';

  -- ---- 16. cart apply: stored on the bag, cleared with it; guessing is throttled ----
  r := public.coupon_cart_apply(m3, 'pct10', jsonb_build_array(jsonb_build_object('ref', 'a', 'variant_id', va, 'line_total_paise', 149700)));
  if (r ->> 'ok')::boolean is not true or (select coupon_code from public.carts where member_id = m3) <> 'PCT10' then raise exception 'FAIL 16a: %', r; end if;
  perform public.cart_clear(m3);
  if (select coupon_code from public.carts where member_id = m3) is not null then raise exception 'FAIL 16b: cart_clear must drop the coupon'; end if;
  for rp in 1..10 loop perform public.coupon_cart_apply(m2, 'GUESS' || rp, lines); end loop;
  if public.coupon_cart_apply(m2, 'GUESS99', lines) ->> 'reason' <> 'TOO_MANY' then raise exception 'FAIL 16c: throttle'; end if;
  raise notice 'PASS: cart apply/clear and guess throttle';

  -- ---- 17. code is immutable; check constraints reject bad coupons ----
  begin update public.coupons set code = 'CHANGED' where code = 'PCT10'; raise exception 'FAIL 17a'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin insert into public.coupons (code, discount_type, percent_bps, fixed_paise, created_by) values ('BAD1', 'percent', 1000, 500, 't'); raise exception 'FAIL 17b'; exception when check_violation then null; end;
  begin insert into public.coupons (code, discount_type, percent_bps, created_by) values ('lower', 'percent', 1000, 't'); raise exception 'FAIL 17c'; exception when check_violation then null; end;
  begin insert into public.coupons (code, discount_type, percent_bps, starts_at, expires_at, created_by) values ('BAD2', 'percent', 1000, now(), now() - interval '1 day', 't'); raise exception 'FAIL 17d'; exception when check_violation then null; end;
  raise notice 'PASS: code immutable, constraints reject bad coupons';

  -- ---- 18. analytics come from real rows ----
  r := public.coupon_analytics(now() - interval '1 day', now() + interval '1 day');
  if jsonb_typeof(r -> 'totals') <> 'object' or (r -> 'totals' ->> 'redemptions')::int < 0 then raise exception 'FAIL 18'; end if;
  r := public.coupon_admin_list('kaayra', 'all', 25, 0);
  if (r ->> 'total')::int <> 1 or (r -> 'items' -> 0 ->> 'code') <> 'KAAYRA10' then raise exception 'FAIL 18b: %', r; end if;
  raise notice 'PASS: admin list and analytics';
end $$;

-- ---- 19. privileges: the public roles cannot read or call anything here ----
do $$
declare t text;
begin
  foreach t in array array['coupons', 'coupon_redemptions', 'coupon_applications'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then raise exception 'FAIL 19: % readable by a public role', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL 19: RLS off on %', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.coupon_compute(public.coupons, uuid, jsonb, bigint, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.coupon_reserve_for_order(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.checkout_place(uuid, uuid, text, jsonb, bigint, boolean, integer, integer, text)', 'execute')
     or has_function_privilege('anon', 'public.coupon_admin_list(text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.coupon_analytics(timestamptz, timestamptz)', 'execute') then raise exception 'FAIL 19: a public role can execute a coupon function'; end if;
  raise notice 'PASS: no public access (RLS on, no grants, functions revoked)';
  raise notice 'ALL COUPON SELF-TESTS PASSED';
end $$;
rollback;
