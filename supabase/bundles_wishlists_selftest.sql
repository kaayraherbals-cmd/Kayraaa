-- Self-test for bundles_wishlists.sql. Run on a DISPOSABLE or STAGING database after bundles_wishlists.sql.
-- One transaction that ROLLS BACK: leaves nothing behind, prints PASS notices, raises on the first failure.
begin;
create function pg_temp.expect(p_label text, p_sql text, p_err text) returns void language plpgsql as $f$
declare e text := null;
begin
  begin execute p_sql; exception when others then e := sqlerrm; end;
  if e is null or e not like p_err then raise exception 'FAIL %: expected error like %, got %', p_label, p_err, coalesce(e, '(no error)'); end if;
  raise notice 'PASS %', p_label;
end $f$;
create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $f$
begin if p_cond is not true then raise exception 'FAIL %', p_label; end if; raise notice 'PASS %', p_label; end $f$;

do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  pa uuid; pb uuid; pc uuid; pd uuid; va uuid; vb uuid; vc uuid; vd uuid;
  b1 uuid; b2 uuid; b3 uuid; v jsonb; n integer; res jsonb; o uuid; o2 uuid; rsv integer; tot bigint; disc bigint; arr bigint[];
  base jsonb;
begin
  insert into public.members (id, email, provider) values (m1, 'zz-b1@example.org', 'email'), (m2, 'zz-b2@example.org', 'email');
  insert into public.shipping_pincodes (pincode, active, rate_paise) values ('221001', true, 5000) on conflict (pincode) do update set active = true;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-bw-a', 'ZZ BW A', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Bundle test A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-bw-b', 'ZZ BW B', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Bundle test B', 'Test only.', true, 'selftest') returning id into pb;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-bw-c', 'ZZ BW C', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'Bundle test C', 'Test only.', true, 'selftest') returning id into pc;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-bw-d', 'ZZ BW D', 'Tablet', '60 tabs', 'DRAFT', 'Bundle test D', 'Test only.', false, null) returning id into pd;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pa, 'ZZ-BW-A', '60 tabs', 50000) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pb, 'ZZ-BW-B', '60 tabs', 30000) returning id into vb;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pc, 'ZZ-BW-C', '200 ml', 33333) returning id into vc;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pd, 'ZZ-BW-D', '60 tabs', 10000) returning id into vd;
  perform public.inventory_receive(va, 'ZZBWA1', null, current_date + 400, 10, 'test', 'selftest');
  perform public.inventory_receive(vb, 'ZZBWB1', null, current_date + 400, 3, 'test', 'selftest');
  perform public.inventory_receive(vc, 'ZZBWC1', null, current_date + 400, 50, 'test', 'selftest');
  perform public.inventory_receive(vc, 'ZZBWC0', null, current_date + 5, 40, 'test', 'selftest');  -- too close to expiry: must not count

  -- 1. creation and component rules
  perform pg_temp.expect('one component refused', format($q$select public.bundle_upsert('{"slug":"zz-one","name":"One","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":1}]}', 'owner')$q$, va), 'KH:BUNDLE_COMPONENTS');
  perform pg_temp.expect('duplicate component refused', format($q$select public.bundle_upsert('{"slug":"zz-dup","name":"Dup","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":1},{"variant_id":"%s","qty":2}]}', 'owner')$q$, va, va), 'KH:BUNDLE_COMPONENTS');
  perform pg_temp.expect('unknown variant refused', format($q$select public.bundle_upsert('{"slug":"zz-unk","name":"Unk","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":1},{"variant_id":"%s","qty":2}]}', 'owner')$q$, va, gen_random_uuid()), '%violates foreign key%');
  perform pg_temp.expect('qty 0 refused', format($q$select public.bundle_upsert('{"slug":"zz-q0","name":"Q0","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":0},{"variant_id":"%s","qty":2}]}', 'owner')$q$, va, vb), '%check constraint%');
  perform pg_temp.expect('two pricing values refused', format($q$select public.bundle_upsert('{"slug":"zz-two","name":"Two","pricing_mode":"percent_off","percent_bps":1000,"fixed_price_paise":100000,"components":[{"variant_id":"%s","qty":1},{"variant_id":"%s","qty":2}]}', 'owner')$q$, va, vb), '%bundle_pricing_value%');

  -- 2. pricing: percent (floored discount), fixed discount, fixed price; never fake savings, never negative
  b1 := public.bundle_upsert(format('{"slug":"zz-kit","name":"ZZ Kit","kind":"wellness_kit","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":2},{"variant_id":"%s","qty":1}]}', va, vb)::jsonb, 'owner');
  v := public.bundle_price(b1);
  perform pg_temp.ok('combined 130000', (v ->> 'combined_paise')::bigint = 130000);
  perform pg_temp.ok('10 percent -> final 117000', (v ->> 'final_paise')::bigint = 117000 and (v ->> 'savings_paise')::bigint = 13000);
  b2 := public.bundle_upsert(format('{"slug":"zz-off","name":"ZZ Off","pricing_mode":"amount_off","amount_off_paise":20000,"components":[{"variant_id":"%s","qty":1},{"variant_id":"%s","qty":1}]}', va, vb)::jsonb, 'owner');
  perform pg_temp.ok('amount off 20000 -> final 60000', (public.bundle_price(b2) ->> 'final_paise')::bigint = 60000);
  perform pg_temp.expect('fixed price above combined refused (no fake saving)', 'select public.bundle_price_from(''fixed_price'', 90000, null, null, 80000)', 'KH:BUNDLE_NO_SAVING');
  perform pg_temp.expect('amount off >= combined refused', 'select public.bundle_price_from(''amount_off'', null, null, 80000, 80000)', 'KH:BUNDLE_PRICE_INVALID');
  perform pg_temp.ok('odd percent floors the discount', (public.bundle_price_from('percent_off', null, 3333, null, 100001) ->> 'discount_paise')::bigint = 33330);
  perform pg_temp.ok('alloc sums exactly', (select sum(x) from unnest(public.bundle_alloc(100, array[1, 1, 1]::bigint[])) x) = 100);
  perform pg_temp.ok('alloc is deterministic', public.bundle_alloc(100, array[1, 1, 1]::bigint[]) = array[34, 33, 33]::bigint[]);
  perform pg_temp.expect('alloc rejects zero weight', 'select public.bundle_alloc(10, array[0, 1]::bigint[])', 'KH:INVALID');

  -- 3. activation rules, availability (A 10/2=5, B 3/1=3 -> 3), unsellable component
  perform pg_temp.ok('draft not in public list', not exists (select 1 from jsonb_array_elements(public.bundle_public_list()) e where e ->> 'slug' = 'zz-kit'));
  perform public.bundle_set_status(b1, 'active', 'owner');
  perform pg_temp.ok('availability is MIN of component floors', public.bundle_availability(b1) = 3);
  perform pg_temp.ok('active bundle in public list with price', exists (select 1 from jsonb_array_elements(public.bundle_public_list()) e where e ->> 'slug' = 'zz-kit' and (e -> 'price' ->> 'final_paise')::bigint = 117000));
  b3 := public.bundle_upsert(format('{"slug":"zz-draftc","name":"ZZ Draft comp","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":1},{"variant_id":"%s","qty":1}]}', va, vd)::jsonb, 'owner');
  perform pg_temp.expect('unapproved component cannot activate', format($q$select public.bundle_set_status('%s', 'active', 'owner')$q$, b3), 'KH:BUNDLE_COMPONENTS');
  perform pg_temp.expect('missing actor refused', format($q$select public.bundle_set_status('%s', 'active', null)$q$, b1), 'KH:INVALID');
  perform pg_temp.ok('audit rows written', (select count(*) from public.admin_audit where action in ('bundle.upsert', 'bundle.status') and actor = 'owner') >= 4);

  -- 4. checkout: bundle expands to ordinary lines, stock reserved once, total exact, saving stored as line discounts
  base := '{"customer_name":"Test","ship_address":"Test address 12345","ship_pincode":"221001","shipping_paise":5000,"customer_phone":"9999999999"}'::jsonb;
  res := public.checkout_place_with_bundles(m1, gen_random_uuid(), '1111111111111111111111111111111111111111111111111111111111111111', base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 2))), 2 * 117000 + 5000, true, 30, 30, null);
  o := (res ->> 'order_id')::uuid;
  select total_paise, bundle_discount_paise into tot, disc from public.orders where id = o;
  perform pg_temp.ok('order total = 2 x 117000 + shipping', tot = 239000 and disc = 26000);
  perform pg_temp.ok('A reserved 4, B reserved 2 (no duplicate deduction)',
    (select sum(qty_reserved) from public.inventory_batches where variant_id = va) = 4 and (select sum(qty_reserved) from public.inventory_batches where variant_id = vb) = 2);
  perform pg_temp.ok('line bundle discounts sum to bundle discount, coupon column untouched', (select sum(bundle_discount_paise) from public.order_items where order_id = o) = 26000 and (select sum(discount_paise) from public.order_items where order_id = o) = 0 and (select discount_paise from public.orders where id = o) = 0);
  perform pg_temp.ok('allocation rows match', (select sum(discount_paise) from public.bundle_order_allocations where order_id = o) = 26000 and (select count(*) from public.bundle_order_allocations where order_id = o) = 2);
  perform pg_temp.ok('refund basis net equals amount paid minus shipping', ((public.order_refund_basis(o) -> 'paid_paise')::text)::bigint = 239000
    and (select sum((l ->> 'net_paise')::bigint) from jsonb_array_elements(public.order_refund_basis(o) -> 'lines') l) = 234000);
  perform pg_temp.ok('bundle_order_basis lists paid value per component', (select sum((e ->> 'paid_value_paise')::bigint) from jsonb_array_elements(public.bundle_order_basis(o)) e) = 234000);
  perform pg_temp.ok('availability falls with reservations (A 6 free -> 3, B 1 free -> 1)', public.bundle_availability(b1) = 1);
  perform pg_temp.expect('allocations are immutable', format($q$update public.bundle_order_allocations set discount_paise = 0 where order_id = '%s'$q$, o), 'KH:IMMUTABLE');

  -- 5. replay with the same key records nothing twice
  res := public.checkout_place_with_bundles(m1, (select idempotency_key from public.checkout_attempts where order_id = o limit 1), '1111111111111111111111111111111111111111111111111111111111111111', base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 2))), 239000, true, 30, 30, null);
  perform pg_temp.ok('replay flagged and no duplicate rows', (res ->> 'replay')::boolean and (select count(*) from public.bundle_order_allocations where order_id = o) = 2
    and (select sum(qty_reserved) from public.inventory_batches where variant_id = va) = 4);

  -- 6. refusals leave no trace: forged total, over-stock, coupon, inactive bundle
  select count(*) into n from public.orders;
  perform pg_temp.expect('forged total refused', format($q$select public.checkout_place_with_bundles('%s', gen_random_uuid(), '2222222222222222222222222222222222222222222222222222222222222222', '%s'::jsonb, 1000, true, 30, 30, null)$q$, m2, (base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 1))))::text), 'KH:PRICE_CHANGED');
  perform pg_temp.expect('over stock refused', format($q$select public.checkout_place_with_bundles('%s', gen_random_uuid(), '3333333333333333333333333333333333333333333333333333333333333333', '%s'::jsonb, 2 * 117000 + 5000, true, 30, 30, null)$q$, m2, (base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 2))))::text), 'KH:INSUFFICIENT_STOCK%');
  perform pg_temp.expect('coupon with bundle refused', format($q$select public.checkout_place_with_bundles('%s', gen_random_uuid(), '4444444444444444444444444444444444444444444444444444444444444444', '%s'::jsonb, 122000, true, 30, 30, 'SAVE10')$q$, m2, (base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 1))))::text), 'KH:BUNDLE_COUPON_EXCLUDED');
  perform pg_temp.expect('inactive bundle refused', format($q$select public.checkout_place_with_bundles('%s', gen_random_uuid(), '5555555555555555555555555555555555555555555555555555555555555555', '%s'::jsonb, 80000, true, 30, 30, null)$q$, m2, (base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b2, 'qty', 1))))::text), 'KH:BUNDLE_UNAVAILABLE%');
  perform pg_temp.ok('no orders created by refusals', (select count(*) from public.orders) = n);
  perform pg_temp.ok('stock unchanged by refusals', (select sum(qty_reserved) from public.inventory_batches where variant_id = va) = 4);

  -- 7. bundle plus a loose copy of a component merge into one line per variant; price edit after purchase does not touch the order
  perform public.bundle_set_status(b2, 'active', 'owner');
  res := public.checkout_place_with_bundles(m2, gen_random_uuid(), '6666666666666666666666666666666666666666666666666666666666666666', base || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('bundle_id', b2, 'qty', 1), jsonb_build_object('variant_id', va, 'qty', 1))), 60000 + 50000 + 5000, true, 30, 30, null);
  o2 := (res ->> 'order_id')::uuid;
  perform pg_temp.ok('one line per variant, A qty 2', (select count(*) from public.order_items where order_id = o2) = 2 and (select qty from public.order_items where order_id = o2 and variant_id = va) = 2);
  perform pg_temp.ok('only the bundle share is discounted', (select sum(bundle_discount_paise) from public.order_items where order_id = o2) = 20000);
  update public.product_bundles set name = 'Renamed', pricing_mode = 'percent_off', amount_off_paise = null, percent_bps = 5000 where id = b2;
  update public.product_variants set price_paise = 99999 where id = va;
  perform pg_temp.ok('history unchanged after bundle and price edits', (select bundle_name from public.bundle_order_allocations where order_id = o2 limit 1) = 'ZZ Off'
    and (select total_paise from public.orders where id = o2) = 115000 and (select unit_price_paise from public.order_items where order_id = o2 and variant_id = va) = 50000);
  update public.product_variants set price_paise = 50000 where id = va;

  -- 8. cancelling releases every component unit once
  perform public.order_set_status(o, 'cancelled', 'selftest');
  perform pg_temp.ok('cancel releases bundle components', (select sum(qty_reserved) from public.inventory_batches where variant_id = vb) = 1 and (select sum(qty_reserved) from public.inventory_batches where variant_id = va) = 2);

  -- 9. wishlist: own list, no duplicates, unpublished refused, merge skips bad ids, cap, no cross-member leakage
  perform pg_temp.ok('add returns true then false', public.wishlist_add(m1, pa) and not public.wishlist_add(m1, pa));
  perform pg_temp.expect('unpublished product refused', format($q$select public.wishlist_add('%s', '%s')$q$, m1, pd), 'KH:NOT_FOUND');
  perform pg_temp.ok('merge adds only valid new products', public.wishlist_merge(m1, array[pa, pb, pb, pd, gen_random_uuid()]) = 1);
  perform pg_temp.ok('lists are private', jsonb_array_length(public.wishlist_list(m1)) = 2 and jsonb_array_length(public.wishlist_list(m2)) = 0);
  perform pg_temp.ok('current price shown, in stock', (select (e ->> 'from_price_paise')::bigint = 50000 and e ->> 'state' = 'in_stock' from jsonb_array_elements(public.wishlist_list(m1)) e where e ->> 'slug' = 'zz-bw-a'));
  update public.products set status = 'DRAFT' where id = pb;
  perform pg_temp.ok('unpublished item shows unavailable, no price', (select e ->> 'state' = 'unavailable' and e -> 'from_price_paise' = 'null'::jsonb from jsonb_array_elements(public.wishlist_list(m1)) e where e ->> 'slug' = 'zz-bw-b'));
  update public.products set status = 'APPROVED_FOR_SALE' where id = pb;
  perform pg_temp.ok('remove works once', public.wishlist_remove(m1, pb) and not public.wishlist_remove(m1, pb));
  perform public.wishlist_track_to_cart(m1, pa); perform public.wishlist_track_to_cart(m2, pa);
  perform pg_temp.ok('events have no member and to_cart only for owner', (select count(*) from public.wishlist_events where kind = 'to_cart' and product_id = pa) = 1);
  perform pg_temp.ok('wishlist_trends bounded and attribution labelled', (public.wishlist_trends() ->> 'attribution_note') like '%does not show%');
  perform pg_temp.ok('wishlist_events has no member column', not exists (select 1 from information_schema.columns where table_name = 'wishlist_events' and column_name like '%member%'));

  -- 10. related products: curated first, same form next, never self, in stock only
  insert into public.product_relationships (product_id, related_product_id, kind) values (pa, pc, 'complement');
  v := public.related_products(pa, 4);
  perform pg_temp.ok('curated first, then same form, never self', v -> 0 ->> 'source' = 'curated' and (v -> 0 ->> 'product_id')::uuid = pc and v::text not like '%' || pa::text || '%');
  perform pg_temp.ok('draft product never recommended', v::text not like '%' || pd::text || '%');
  perform pg_temp.expect('self relationship refused', format($q$insert into public.product_relationships (product_id, related_product_id) values ('%s', '%s')$q$, pa, pa), '%not_self%');

  -- 11. frequently bought together: threshold, distinct orders, paid-or-later only
  perform pg_temp.ok('below threshold returns empty (A with C: only 1 paid order so far)', public.frequently_bought_together(pa, 5, 3) = '[]'::jsonb);
  perform pg_temp.ok('analytics ignore unpaid orders', jsonb_array_length(public.bundle_analytics() -> 'bundles') = 0);
  perform pg_temp.ok('profit marked incomplete', (public.bundle_analytics() ->> 'profit_complete')::boolean = false);
  perform pg_temp.ok('inventory constraints name limiting variant', (select e ->> 'limiting_variant_id' is not null from jsonb_array_elements(public.bundle_inventory_constraints()) e where e ->> 'name' = 'ZZ Kit'));
  raise notice 'ALL PHASE 10 SELF-TESTS PASSED';
end $$;
rollback;
