-- Self-test for stage7_commerce.sql. Run on a DISPOSABLE or STAGING database after stage7_commerce.sql (and every earlier migration).
-- One transaction that ROLLS BACK. Prints PASS notices, raises on the first failure.
-- STATUS: written in a sandbox with no PostgreSQL. NEVER RUN. Expect to fix fixture mistakes on the first run; do not read a pass or a fail
-- of an unrun file as evidence about the migration until you have run it.
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
-- Place through the single entry point with a fresh key and hash. Shipping 5000 unless overridden.
create function pg_temp.full(p_member uuid, p_items jsonb, p_expected bigint, p_points integer, p_coupon text, p_ship integer default 5000) returns jsonb language plpgsql as $f$
begin
  return public.checkout_place_full(p_member, gen_random_uuid(), md5(random()::text) || md5(random()::text),
    jsonb_build_object('customer_name', 'Test', 'ship_address', 'Test address 12345', 'ship_pincode', '221001', 'shipping_paise', p_ship, 'customer_phone', '9999999999', 'items', p_items),
    p_expected, true, 30, 30, p_coupon, p_points);
end $f$;

do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); pa uuid; pb uuid; pc uuid; va uuid; vb uuid; vc uuid; b1 uuid;
  res jsonb; o uuid; o2 uuid; k uuid := gen_random_uuid(); avail bigint; n integer; err text;
begin
  insert into public.members (id, email, provider) values (m1, 'zz-s7a@example.org', 'email'), (m2, 'zz-s7b@example.org', 'email');
  insert into public.shipping_pincodes (pincode, active, rate_paise, free_above_paise) values ('221001', true, 5000, null)
    on conflict (pincode) do update set active = true, rate_paise = 5000, free_above_paise = null;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-s7-a', 'ZZ S7 A', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'S7 test A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-s7-b', 'ZZ S7 B', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'S7 test B', 'Test only.', true, 'selftest') returning id into pb;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-s7-c', 'ZZ S7 C', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'S7 test C', 'Test only.', true, 'selftest') returning id into pc;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pa, 'ZZ-S7-A', '60 tabs', 50000) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pb, 'ZZ-S7-B', '60 tabs', 30000) returning id into vb;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pc, 'ZZ-S7-C', '200 ml', 33333) returning id into vc;
  perform public.inventory_receive(va, 'ZZS7A1', null, current_date + 400, 10, 'test', 'selftest');
  perform public.inventory_receive(vb, 'ZZS7B1', null, current_date + 400, 3, 'test', 'selftest');
  perform public.inventory_receive(vc, 'ZZS7C1', null, current_date + 400, 50, 'test', 'selftest');
  b1 := public.bundle_upsert(format('{"slug":"zz-s7-kit","name":"ZZ S7 Kit","kind":"wellness_kit","pricing_mode":"percent_off","percent_bps":1000,"components":[{"variant_id":"%s","qty":2},{"variant_id":"%s","qty":1}]}', va, vb)::jsonb, 'owner');
  perform public.bundle_set_status(b1, 'active', 'owner');

  -- 1. activation blockers live in the database
  perform pg_temp.ok('program ships off and policy flags ship false', (select not enabled and not redemption_tax_confirmed and not refund_policy_confirmed from public.loyalty_settings));
  perform pg_temp.expect('cannot enable without policy confirmations', 'update public.loyalty_settings set enabled = true', '%loyalty_enabled_needs_policy%');

  -- 2. program disabled: ordinary checkout is unchanged, points are refused, no hidden discount
  res := pg_temp.full(m1, jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 2)), 105000, 0, null);
  o := (res ->> 'order_id')::uuid;
  perform pg_temp.ok('plain order total = subtotal + shipping, all savings 0',
    (select total_paise = 105000 and discount_paise = 0 and bundle_discount_paise = 0 and loyalty_discount_paise = 0 from public.orders where id = o) and (res ->> 'total_paise')::bigint = 105000);
  perform pg_temp.expect('points refused while disabled', format($q$select pg_temp.full('%s', '[{"variant_id":"%s","qty":1}]'::jsonb, 52000, 100, null)$q$, m1, va), 'KH:DISABLED');
  perform pg_temp.expect('forged shipping refused', format($q$select pg_temp.full('%s', '[{"variant_id":"%s","qty":1}]'::jsonb, 50001, 0, null, 1)$q$, m2, va), 'KH:PRICE_CHANGED');
  perform pg_temp.expect('forged total refused', format($q$select pg_temp.full('%s', '[{"variant_id":"%s","qty":1}]'::jsonb, 1000, 0, null)$q$, m2, va), 'KH:PRICE_CHANGED');
  perform pg_temp.expect('invariant constraint rejects a hand-made total', format($q$update public.orders set total_paise = total_paise + 1 where id = '%s'$q$, o), '%orders_total_matches%');

  -- 3. enable (the owner confirmations are set here only to test the mechanics; they are NOT approvals of any policy)
  update public.loyalty_settings set redemption_tax_confirmed = true, refund_policy_confirmed = true, enabled = true, activation_days = 0, expiry_months = 12;
  perform public.loyalty_enrol(m1);
  perform public.loyalty_adjust(m1, 1000, 'selftest grant', 'selftest', 's7-grant-1');
  select coalesce(sum(remaining), 0) into avail from public.loyalty_lots where member_id = m1;
  perform pg_temp.ok('1000 points available', avail = 1000);

  -- 4. redemption on a plain order: 200 points = Rs 20 = 2000 paise (defaults 100 points = Rs 10); Razorpay amount comes from orders.total_paise
  res := pg_temp.full(m1, jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 2)), 103000, 200, null);
  o2 := (res ->> 'order_id')::uuid;
  perform pg_temp.ok('total after loyalty = 103000 and matches response', (select total_paise from public.orders where id = o2) = 103000 and (res ->> 'total_paise')::bigint = 103000);
  perform pg_temp.ok('invariant holds', (select total_paise = subtotal_paise - discount_paise - bundle_discount_paise - loyalty_discount_paise + shipping_paise from public.orders where id = o2));
  perform pg_temp.ok('loyalty kept out of the coupon and bundle columns', (select discount_paise = 0 and bundle_discount_paise = 0 and loyalty_discount_paise = 2000 from public.orders where id = o2));
  perform pg_temp.ok('line allocation sums to the redemption', (select sum(loyalty_discount_paise) from public.order_items where order_id = o2) = 2000);
  perform pg_temp.ok('snapshot stored with frozen settings', (select points = 200 and value_paise = 2000 and redeem_block_points = 100 and redeem_block_paise = 1000 from public.loyalty_order_snapshots where order_id = o2));
  perform pg_temp.ok('payment_prepare amount equals the database total', ((public.payment_prepare(m1, o2) ->> 'amount_paise')::bigint) = 103000);
  select coalesce(sum(remaining), 0) into avail from public.loyalty_lots where member_id = m1;
  perform pg_temp.ok('800 points left, 200 reserved once', avail = 800 and (select count(*) from public.loyalty_reservations where order_id = o2 and status = 'reserved') = 1);
  perform pg_temp.expect('snapshot is immutable', format($q$update public.loyalty_order_snapshots set points = 1 where order_id = '%s'$q$, o2), 'KH:IMMUTABLE');

  -- 5. limits
  perform pg_temp.expect('over the percentage cap refused', format($q$select pg_temp.full('%s', '[{"variant_id":"%s","qty":1}]'::jsonb, 44000, 1100, null)$q$, m1, va), 'KH:LIMIT');
  perform pg_temp.expect('not enrolled refused', format($q$select pg_temp.full('%s', '[{"variant_id":"%s","qty":1}]'::jsonb, 54000, 100, null)$q$, m2, va), 'KH:NOT_ENROLLED');

  -- 6. replay: same key, same order, nothing applied twice
  k := (select idempotency_key from public.checkout_attempts where order_id = o2 limit 1);
  res := public.checkout_place_full(m1, k, (select request_hash from public.checkout_attempts where order_id = o2 limit 1),
    jsonb_build_object('customer_name', 'Test', 'ship_address', 'Test address 12345', 'ship_pincode', '221001', 'shipping_paise', 5000, 'customer_phone', '9999999999', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 2))),
    103000, true, 30, 30, null, 200);
  perform pg_temp.ok('replay returns the same order and total, one reservation', (res ->> 'replay')::boolean and (res ->> 'order_id')::uuid = o2
    and (select count(*) from public.loyalty_reservations where order_id = o2) = 1 and (select loyalty_discount_paise from public.orders where id = o2) = 2000);

  -- 7. bundle + loose item + loyalty (mixed cart). list subtotal 130000 + 33333, bundle saving 13000, shipping 5000, loyalty 3000
  res := pg_temp.full(m1, jsonb_build_array(jsonb_build_object('bundle_id', b1, 'qty', 1), jsonb_build_object('variant_id', vc, 'qty', 1)), 163333 - 13000 + 5000 - 3000, 300, null);
  o := (res ->> 'order_id')::uuid;
  perform pg_temp.ok('mixed order invariant', (select total_paise = 152333 and bundle_discount_paise = 13000 and loyalty_discount_paise = 3000 and discount_paise = 0 from public.orders where id = o));
  perform pg_temp.ok('line columns reconcile to the order', (select sum(bundle_discount_paise) = 13000 and sum(loyalty_discount_paise) = 3000 and sum(discount_paise) = 0 from public.order_items where order_id = o));
  perform pg_temp.ok('no line goes negative', not exists (select 1 from public.order_items where order_id = o and line_total_paise - discount_paise - bundle_discount_paise - loyalty_discount_paise < 0));
  perform pg_temp.ok('bundle allocation snapshot intact', (select sum(discount_paise) from public.bundle_order_allocations where order_id = o) = 13000);
  perform pg_temp.ok('refund basis shows separate columns and sums to paid minus shipping',
    (select sum((l ->> 'net_paise')::bigint) from jsonb_array_elements(public.order_refund_basis(o) -> 'lines') l) = 152333 - 5000);

  -- 8. bundle with coupon refused (no silent removal)
  perform pg_temp.expect('coupon with bundle refused', format($q$select pg_temp.full('%s', jsonb_build_array(jsonb_build_object('bundle_id', '%s', 'qty', 1)), 122000, 0, 'SAVE10')$q$, m2, b1), 'KH:BUNDLE_COUPON_EXCLUDED');

  -- 9. cancelling an unpaid order releases the reserved points and restores the stock (existing triggers)
  perform public.order_set_status(o2, 'cancelled', 'selftest');
  select coalesce(sum(remaining), 0) into avail from public.loyalty_lots where member_id = m1;
  perform pg_temp.ok('points back after cancelling order 2 (300 still reserved by the mixed order)', avail = 700 and (select status from public.loyalty_reservations where order_id = o2) = 'released');
  perform pg_temp.ok('release recorded once in the ledger', (select count(*) from public.loyalty_ledger where order_id = o2 and kind = 'release') = 1);

  raise notice 'STAGE7 SELFTEST: all checks passed (see header: unrun until you run it)';
end $$;
rollback;
