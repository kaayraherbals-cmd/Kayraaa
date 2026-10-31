-- Self-test for the stock and order functions. Run it in the Supabase SQL editor on a staging project (or any project:
-- everything happens inside one transaction that is rolled back at the end, so nothing is kept).
-- Expected result: a series of "PASS" notices and no error. Any "FAIL" raises an error and stops the test.
-- Run it AFTER inventory_orders.sql. These functions were written but NOT executed when this version was prepared, so run this first.

begin;

do $$
declare
  v_prod uuid := gen_random_uuid();
  v_var uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_order uuid; v_order2 uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  n integer;
  msg text;
begin
  -- A sellable product with one pack size. (APPROVED_FOR_SALE is allowed by the database; the app blocks it while selling is off.)
  insert into public.products (id, slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values (v_prod, 'zz-selftest', 'ZZ SELFTEST', 'Syrup', '100 ml', 'APPROVED_FOR_SALE', 'Self test', 'A product used only by the self test.', true, 'selftest');
  select id into v_var from public.product_variants where product_id = v_prod;
  if v_var is null then
    insert into public.product_variants (product_id, sku, pack_size, price_paise) values (v_prod, 'ZZ-SELFTEST-100ML', '100 ml', 10000) returning id into v_var;
  end if;
  update public.product_variants set price_paise = 10000, status = 'active' where id = v_var;

  -- Receive: A (400 days, 10 units), B (100 days, 5 units), C (10 days, 50 units: too short-dated), D (already expired, 20 units, inserted directly).
  v_a := public.inventory_receive(v_var, 'ZZ-A', null, v_today + 400, 10, 'test', 'selftest');
  v_b := public.inventory_receive(v_var, 'ZZ-B', null, v_today + 100, 5, 'test', 'selftest');
  v_c := public.inventory_receive(v_var, 'ZZ-C', null, v_today + 10, 50, 'test', 'selftest');
  insert into public.inventory_batches (variant_id, batch_no, expiry_date, qty_received, qty_on_hand) values (v_var, 'ZZ-D', v_today - 5, 20, 20) returning id into v_d;
  raise notice 'PASS receive';

  begin
    perform public.inventory_receive(v_var, 'ZZ-OLD', null, v_today - 1, 5, 'test', 'selftest');
    raise exception 'FAIL expired batch was accepted';
  exception when others then
    if sqlerrm not like 'KH:INVALID%' then raise exception 'FAIL expired receive gave: %', sqlerrm; end if;
  end;
  begin
    perform public.inventory_receive(v_var, 'ZZ-A', null, v_today + 50, 5, 'test', 'selftest');
    raise exception 'FAIL duplicate batch number was accepted';
  exception when unique_violation then null;
  end;
  raise notice 'PASS expired and duplicate batches refused';

  -- First-expiry-first-out: 12 units come from B (5) then A (7); C (short-dated) and D (expired) are never touched.
  v_order := public.order_create(jsonb_build_object('customer_name', 'Test', 'ship_address', '12 Test Road, Varanasi', 'ship_pincode', '221005', 'shipping_paise', 5000,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 12))), 'selftest', 30);
  select qty_reserved into n from public.inventory_batches where id = v_b; if n <> 5 then raise exception 'FAIL B reserved % (want 5)', n; end if;
  select qty_reserved into n from public.inventory_batches where id = v_a; if n <> 7 then raise exception 'FAIL A reserved % (want 7)', n; end if;
  select qty_reserved into n from public.inventory_batches where id = v_c; if n <> 0 then raise exception 'FAIL short-dated C was reserved'; end if;
  select qty_reserved into n from public.inventory_batches where id = v_d; if n <> 0 then raise exception 'FAIL expired D was reserved'; end if;
  select total_paise into n from public.orders where id = v_order; if n <> 125000 then raise exception 'FAIL total % (want 125000)', n; end if;
  raise notice 'PASS FEFO allocation and totals';

  -- Only 3 sellable units remain: asking for 4 must fail and reserve nothing.
  begin
    perform public.order_create(jsonb_build_object('customer_name', 'Test', 'ship_address', '12 Test Road, Varanasi', 'ship_pincode', '221005',
      'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 4))), 'selftest', 30);
    raise exception 'FAIL oversell was allowed';
  exception when others then
    if sqlerrm not like 'KH:INSUFFICIENT_STOCK%' then raise exception 'FAIL oversell gave: %', sqlerrm; end if;
  end;
  select qty_reserved into n from public.inventory_batches where id = v_a; if n <> 7 then raise exception 'FAIL failed order changed reservations (A=%)', n; end if;
  select count(*) into n from public.orders where customer_name = 'Test' and id <> v_order; if n <> 0 then raise exception 'FAIL failed order left a row behind'; end if;
  raise notice 'PASS oversell refused and rolled back';

  -- Cannot adjust below what is reserved, or take a reserved batch out of use.
  begin
    perform public.inventory_adjust(v_a, -4, 'write_off', 'test', 'selftest');
    raise exception 'FAIL adjusted below reserved';
  exception when others then if sqlerrm not like 'KH:NEGATIVE_STOCK%' then raise exception 'FAIL adjust gave: %', sqlerrm; end if; end;
  begin
    perform public.inventory_set_status(v_a, 'quarantine', 'selftest');
    raise exception 'FAIL quarantined a reserved batch';
  exception when others then if sqlerrm not like 'KH:RESERVED_STOCK%' then raise exception 'FAIL status gave: %', sqlerrm; end if; end;
  raise notice 'PASS stock protected from going below reservations';

  -- Order ladder: cannot skip steps; shipping takes stock off the shelf.
  begin
    perform public.order_set_status(v_order, 'shipped', 'selftest', 'DTDC', 'D1234567', null);
    raise exception 'FAIL skipped from placed to shipped';
  exception when others then if sqlerrm not like 'KH:BAD_TRANSITION%' then raise exception 'FAIL ladder gave: %', sqlerrm; end if; end;
  perform public.order_set_status(v_order, 'paid', 'selftest');
  perform public.order_set_status(v_order, 'packed', 'selftest');
  perform public.order_set_status(v_order, 'shipped', 'selftest', 'DTDC', 'D1234567', null);
  select qty_on_hand into n from public.inventory_batches where id = v_b; if n <> 0 then raise exception 'FAIL B on hand % after ship (want 0)', n; end if;
  select qty_on_hand into n from public.inventory_batches where id = v_a; if n <> 3 then raise exception 'FAIL A on hand % after ship (want 3)', n; end if;
  select qty_reserved into n from public.inventory_batches where id = v_a; if n <> 0 then raise exception 'FAIL A still reserved after ship'; end if;
  raise notice 'PASS shipping takes stock off the shelf';

  -- Cancelling releases the reservation; a shipped order cannot be cancelled.
  v_order2 := public.order_create(jsonb_build_object('customer_name', 'Test2', 'ship_address', '12 Test Road, Varanasi', 'ship_pincode', '221005',
    'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 3))), 'selftest', 30);
  select qty_reserved into n from public.inventory_batches where id = v_a; if n <> 3 then raise exception 'FAIL second order reserved % (want 3)', n; end if;
  perform public.order_set_status(v_order2, 'cancelled', 'selftest', null, null, 'Customer changed mind');
  select qty_reserved into n from public.inventory_batches where id = v_a; if n <> 0 then raise exception 'FAIL cancel did not release (reserved %)', n; end if;
  begin
    perform public.order_set_status(v_order, 'cancelled', 'selftest', null, null, 'too late');
    raise exception 'FAIL cancelled a shipped order';
  exception when others then if sqlerrm not like 'KH:BAD_TRANSITION%' then raise exception 'FAIL cancel gave: %', sqlerrm; end if; end;
  raise notice 'PASS cancel releases stock';

  -- The ledger adds up: on hand = received + adjustments - shipped, per batch.
  select sum(delta_on_hand) into n from public.inventory_movements where batch_id = v_a; if n <> 10 - 7 then raise exception 'FAIL ledger for A is % (want 3)', n; end if;
  begin
    update public.inventory_movements set reason = 'tampered' where batch_id = v_a;
    raise exception 'FAIL ledger was editable';
  exception when others then if sqlerrm not like '%append-only%' then raise exception 'FAIL ledger gave: %', sqlerrm; end if; end;
  raise notice 'PASS ledger adds up and is append-only';

  -- A product that is not approved for sale cannot be ordered.
  update public.products set status = 'DRAFT' where id = v_prod;
  begin
    perform public.order_create(jsonb_build_object('customer_name', 'Test3', 'ship_address', '12 Test Road, Varanasi', 'ship_pincode', '221005',
      'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 1))), 'selftest', 30);
    raise exception 'FAIL ordered a product that is not approved for sale';
  exception when others then if sqlerrm not like 'KH:NOT_FOR_SALE%' then raise exception 'FAIL not-for-sale gave: %', sqlerrm; end if; end;
  raise notice 'PASS products not approved for sale cannot be ordered';

  raise notice 'ALL PASSED';
end $$;

rollback;
