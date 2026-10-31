-- Self-test for checkout_place. Run in the Supabase SQL editor on STAGING after inventory_orders.sql, carts.sql, payments.sql and checkout.sql.
-- Everything happens in one transaction that is rolled back at the end, so nothing is kept. Expect "PASS" notices, then ALL PASSED.
-- checkout.sql and this file were written but NOT executed when this version was prepared. Run this before trusting them.
begin;
do $$
declare
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_var uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_key1 uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_key3 uuid := gen_random_uuid();
  v_res jsonb;
  v_res2 jsonb;
  v_order jsonb;
  v_reserved integer;
  msg text;
begin
  insert into public.members (id, email, provider) values (v_member, 'zz-selftest-a@example.org', 'email'), (v_other, 'zz-selftest-b@example.org', 'email');
  insert into public.products (id, slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values (v_prod, 'zz-checkout-selftest', 'ZZ CHECKOUT SELFTEST', 'Syrup', '100 ml', 'APPROVED_FOR_SALE', 'Self test', 'A product used only by the self test.', true, 'selftest');
  select id into v_var from public.product_variants where product_id = v_prod;
  if v_var is null then
    insert into public.product_variants (product_id, sku, pack_size, price_paise) values (v_prod, 'ZZ-CHK-SELFTEST', '100 ml', 10000) returning id into v_var;
  end if;
  update public.product_variants set price_paise = 10000, status = 'active' where id = v_var;
  perform public.inventory_receive(v_var, 'ZZ-CHK-A', null, v_today + 400, 5, 'test', 'selftest');
  insert into public.shipping_pincodes (pincode, active, rate_paise) values ('221005', true, 6000), ('221001', false, 6000);

  v_order := jsonb_build_object('customer_name', 'Self Test', 'customer_email', 'zz-selftest-a@example.org', 'customer_phone', '+919876543210',
    'ship_address', '12 Lanka Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221005', 'shipping_paise', 6000,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 2)));

  -- Unknown member
  begin
    perform public.checkout_place(gen_random_uuid(), v_key1, 'hash-selftest-0000000000', v_order, 26000, true);
    raise exception 'FAIL: unknown member accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_FOUND%' then raise exception 'FAIL: expected KH:NOT_FOUND, got %', msg; end if;
  end;
  raise notice 'PASS: unknown member refused';

  -- A PIN code that is switched off, or missing
  begin
    perform public.checkout_place(v_member, v_key1, 'hash-selftest-0000000000', jsonb_set(v_order, '{ship_pincode}', '"221001"'), 26000, true);
    raise exception 'FAIL: inactive PIN accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_SERVICEABLE%' then raise exception 'FAIL: expected KH:NOT_SERVICEABLE, got %', msg; end if;
  end;
  begin
    perform public.checkout_place(v_member, v_key1, 'hash-selftest-0000000000', jsonb_set(v_order, '{ship_pincode}', '"560001"'), 26000, true);
    raise exception 'FAIL: unlisted PIN accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_SERVICEABLE%' then raise exception 'FAIL: expected KH:NOT_SERVICEABLE, got %', msg; end if;
  end;
  raise notice 'PASS: unserved PIN codes refused';

  -- A price that moved: nothing is created and nothing stays reserved
  begin
    perform public.checkout_place(v_member, v_key1, 'hash-selftest-0000000000', v_order, 12345, true);
    raise exception 'FAIL: wrong expected total accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:PRICE_CHANGED%' then raise exception 'FAIL: expected KH:PRICE_CHANGED, got %', msg; end if;
  end;
  if (select count(*) from public.orders where created_by = 'customer:' || v_member::text) <> 0 then raise exception 'FAIL: an order survived a price change'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 0 then raise exception 'FAIL: stock stayed reserved after a price change (%)', v_reserved; end if;
  raise notice 'PASS: price change creates nothing and reserves nothing';

  -- Not enough stock (5 on hand, 6 wanted): nothing is created
  begin
    perform public.checkout_place(v_member, v_key1, 'hash-selftest-0000000000', jsonb_set(v_order, '{items}', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 6))), 66000, true);
    raise exception 'FAIL: oversell accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INSUFFICIENT_STOCK%' then raise exception 'FAIL: expected KH:INSUFFICIENT_STOCK, got %', msg; end if;
  end;
  raise notice 'PASS: oversell refused';

  -- The happy path: order placed, stock reserved, owner and test flag set, hold time set
  v_res := public.checkout_place(v_member, v_key1, 'hash-selftest-aaaaaaaaaa', v_order, 26000, true);
  if (v_res ->> 'replay')::boolean then raise exception 'FAIL: first placement reported as replay'; end if;
  if (select member_id from public.orders where id = (v_res ->> 'order_id')::uuid) is distinct from v_member then raise exception 'FAIL: order owner not set'; end if;
  if not (select is_test and channel = 'online' and status = 'placed' and total_paise = 26000 and pay_by > now() from public.orders where id = (v_res ->> 'order_id')::uuid) then raise exception 'FAIL: order fields wrong'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: expected 2 reserved, got %', v_reserved; end if;
  raise notice 'PASS: order placed and stock reserved';

  -- Same key, same contents: same order, no second reservation
  v_res2 := public.checkout_place(v_member, v_key1, 'hash-selftest-aaaaaaaaaa', v_order, 26000, true);
  if not (v_res2 ->> 'replay')::boolean or v_res2 ->> 'order_id' <> v_res ->> 'order_id' then raise exception 'FAIL: replay did not return the same order'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: replay reserved again (%)', v_reserved; end if;
  raise notice 'PASS: same key is idempotent';

  -- New key, same contents, order still unpaid: returns the open order
  v_res2 := public.checkout_place(v_member, v_key2, 'hash-selftest-aaaaaaaaaa', v_order, 26000, true);
  if not (v_res2 ->> 'replay')::boolean or v_res2 ->> 'order_id' <> v_res ->> 'order_id' then raise exception 'FAIL: open order not reused'; end if;
  if (select count(*) from public.orders where member_id = v_member) <> 1 then raise exception 'FAIL: a second order was created'; end if;
  raise notice 'PASS: same contents reuse the open order';

  -- Same key, different contents
  begin
    perform public.checkout_place(v_member, v_key1, 'hash-selftest-bbbbbbbbbb', v_order, 26000, true);
    raise exception 'FAIL: reused key accepted for different contents';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:IDEMPOTENCY_MISMATCH%' then raise exception 'FAIL: expected KH:IDEMPOTENCY_MISMATCH, got %', msg; end if;
  end;
  raise notice 'PASS: reused key with different contents refused';

  -- Another member cannot reuse this member's key or see this member's open order as theirs
  v_res2 := public.checkout_place(v_other, v_key3, 'hash-selftest-aaaaaaaaaa', jsonb_set(v_order, '{items}', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 1))), 16000, true);
  if v_res2 ->> 'order_id' = v_res ->> 'order_id' then raise exception 'FAIL: another member was handed this member''s order'; end if;
  if (select member_id from public.orders where id = (v_res2 ->> 'order_id')::uuid) is distinct from v_other then raise exception 'FAIL: second member order owner wrong'; end if;
  raise notice 'PASS: orders are per member';

  -- Cancelling releases the held stock (existing function)
  perform public.order_set_status((v_res ->> 'order_id')::uuid, 'cancelled', 'selftest', null, null, 'self test');
  perform public.order_set_status((v_res2 ->> 'order_id')::uuid, 'cancelled', 'selftest', null, null, 'self test');
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 0 then raise exception 'FAIL: stock not released on cancel (%)', v_reserved; end if;
  raise notice 'PASS: cancel releases stock';

  raise notice 'ALL PASSED';
end $$;
rollback;
