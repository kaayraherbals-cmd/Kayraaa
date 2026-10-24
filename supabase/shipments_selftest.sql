-- Self-test for supabase/shipments.sql. Run in the SQL editor of an ISOLATED STAGING project (never production) AFTER
-- inventory_orders.sql, checkout.sql, payments_checkout.sql and shipments.sql. One transaction, rolled back at the end.
-- Expect "PASS" notices and no error. NOT YET RUN: written without a database, so the first run may find mistakes in the test or the SQL.
begin;
do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid(); v_var uuid;
  v_o uuid := gen_random_uuid(); v_paid uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid();
  v_i1 uuid := gen_random_uuid(); v_i2 uuid := gen_random_uuid(); v_i3 uuid := gen_random_uuid();
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  msg text; n integer; r jsonb; st text;
begin
  insert into public.members (id, email, provider) values (v_a, 'zz-ship-a@example.org', 'email'), (v_b, 'zz-ship-b@example.org', 'email');
  insert into public.products (id, slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values (v_prod, 'zz-ship-selftest', 'ZZ SHIP SELFTEST', 'Syrup', '100 ml', 'APPROVED_FOR_SALE', 'Self test', 'A product used only by the self test.', true, 'selftest');
  select id into v_var from public.product_variants where product_id = v_prod;
  if v_var is null then insert into public.product_variants (product_id, sku, pack_size, price_paise) values (v_prod, 'ZZ-SHIP-SELFTEST', '100 ml', 10000) returning id into v_var; end if;

  insert into public.orders (id, order_no, status, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
  values (v_o, 'KH-2026-910001', 'packed', 'Self Test', '1 Test Road', '221001', 40000, 40000, 'selftest', v_a),
         (v_paid, 'KH-2026-910002', 'paid', 'Self Test', '1 Test Road', '221001', 10000, 10000, 'selftest', v_a),
         (v_o2, 'KH-2026-910003', 'packed', 'Self Test', '1 Test Road', '221001', 10000, 10000, 'selftest', v_b);
  insert into public.order_items (id, order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise) values
    (v_i1, v_o, v_var, 'Self test', '100 ml', 'ZZ-SHIP-SELFTEST', 3, 10000, 30000),
    (v_i2, v_o, v_var, 'Self test', '100 ml', 'ZZ-SHIP-SELFTEST', 1, 10000, 10000),
    (v_i3, v_o2, v_var, 'Self test', '100 ml', 'ZZ-SHIP-SELFTEST', 1, 10000, 10000);

  -- Creation rules
  begin perform public.shipment_create(v_paid, jsonb_build_array(jsonb_build_object('order_item_id', v_i1, 'qty', 1)), 'selftest'); raise exception 'FAIL: shipment for an unpacked order accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:BAD_STATE%' then raise exception 'FAIL: expected BAD_STATE, got %', msg; end if; end;
  raise notice 'PASS: only a packed order can be shipped';

  begin perform public.shipment_create(v_o, jsonb_build_array(jsonb_build_object('order_item_id', v_i3, 'qty', 1)), 'selftest'); raise exception 'FAIL: item from another order accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID:item is not on this order%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: item must belong to the order';

  begin perform public.shipment_create(v_o, '[]'::jsonb, 'selftest'); raise exception 'FAIL: empty shipment accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: empty shipment refused';

  v_s1 := public.shipment_create(v_o, jsonb_build_array(jsonb_build_object('order_item_id', v_i1, 'qty', 2)), 'selftest');
  select shipment_no, status into msg, st from public.shipments where id = v_s1;
  if msg !~ '^SH-\d{4}-\d{6}$' or st <> 'pending' then raise exception 'FAIL: shipment number or state wrong: %, %', msg, st; end if;
  raise notice 'PASS: partial shipment created pending';

  begin perform public.shipment_create(v_o, jsonb_build_array(jsonb_build_object('order_item_id', v_i1, 'qty', 2)), 'selftest'); raise exception 'FAIL: over-shipping accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID:more than is left%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: cannot ship more than is left';

  -- Legal transitions
  begin perform public.shipment_set_status(v_s1, 'delivered', 'selftest'); raise exception 'FAIL: pending > delivered accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:SHIPMENT_BAD_TRANSITION:pending>delivered%' then raise exception 'FAIL: got %', msg; end if; end;
  begin perform public.shipment_set_status(v_s1, 'dispatched', 'selftest'); raise exception 'FAIL: dispatch without courier accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID%' then raise exception 'FAIL: got %', msg; end if; end;
  begin perform public.shipment_set_status(v_s1, 'dispatched', 'selftest', 'Test Courier', 'TRK1', null, null, null, null, true, now() + interval '1 day'); raise exception 'FAIL: future event time accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: illegal moves, missing tracking and future times refused';

  perform public.shipment_set_status(v_s1, 'dispatched', 'selftest', 'Test Courier', 'TRK1');
  select status into st from public.orders where id = v_o;
  if st <> 'packed' then raise exception 'FAIL: partial dispatch must not ship the order, got %', st; end if;
  raise notice 'PASS: partial dispatch leaves the order packed (stock untouched)';

  v_s2 := public.shipment_create(v_o, jsonb_build_array(jsonb_build_object('order_item_id', v_i1, 'qty', 1), jsonb_build_object('order_item_id', v_i2, 'qty', 1)), 'selftest');
  perform public.shipment_set_status(v_s2, 'dispatched', 'selftest', 'Test Courier', 'TRK2');
  select status into st from public.orders where id = v_o;
  if st <> 'shipped' then raise exception 'FAIL: order should be shipped once all units are dispatched, got %', st; end if;
  raise notice 'PASS: order ships when every unit is dispatched';

  -- Failed delivery, exception, retry, delivery
  perform public.shipment_set_status(v_s1, 'in_transit', 'selftest');
  begin perform public.shipment_set_status(v_s1, 'delivery_failed', 'selftest'); raise exception 'FAIL: failed delivery without a reason accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:INVALID%' then raise exception 'FAIL: got %', msg; end if; end;
  perform public.shipment_set_status(v_s1, 'delivery_failed', 'selftest', null, null, 'Nobody home', null, null, 'recipient_unavailable');
  select count(*) into n from public.delivery_exceptions where shipment_id = v_s1 and resolved_at is null;
  if n <> 1 then raise exception 'FAIL: expected one open exception, got %', n; end if;
  perform public.shipment_set_status(v_s1, 'out_for_delivery', 'selftest');
  select count(*) into n from public.delivery_exceptions where shipment_id = v_s1 and resolved_at is null;
  if n <> 0 then raise exception 'FAIL: retry should close the exception'; end if;
  raise notice 'PASS: failed delivery opens an exception, retry closes it';

  perform public.shipment_set_status(v_s1, 'delivered', 'selftest');
  select status into st from public.orders where id = v_o;
  if st <> 'shipped' then raise exception 'FAIL: order must stay shipped until every shipment is delivered, got %', st; end if;
  perform public.shipment_set_status(v_s2, 'delivered', 'selftest');
  select status into st from public.orders where id = v_o;
  if st <> 'delivered' then raise exception 'FAIL: order should be delivered, got %', st; end if;
  raise notice 'PASS: order delivered only after every shipment is';

  begin perform public.shipment_set_status(v_s1, 'in_transit', 'selftest'); raise exception 'FAIL: left a final state';
  exception when others then get stacked diagnostics msg = message_text; if msg not like 'KH:SHIPMENT_BAD_TRANSITION%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: delivered is final';

  -- Append-only history
  select count(*) into n from public.shipment_events where shipment_id = v_s1;
  if n < 6 then raise exception 'FAIL: expected a status history, got % events', n; end if;
  begin update public.shipment_events set note = 'edited' where shipment_id = v_s1; raise exception 'FAIL: history edit accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like '%append-only%' then raise exception 'FAIL: got %', msg; end if; end;
  begin delete from public.shipment_events where shipment_id = v_s1; raise exception 'FAIL: history delete accepted';
  exception when others then get stacked diagnostics msg = message_text; if msg not like '%append-only%' then raise exception 'FAIL: got %', msg; end if; end;
  raise notice 'PASS: tracking history is append-only';

  -- Customer ownership
  perform public.shipment_add_note(v_s1, 'internal only', 'selftest', null, false);
  r := public.shipments_for_member(v_a, v_o);
  if jsonb_array_length(r) <> 2 then raise exception 'FAIL: owner should see 2 shipments, got %', r; end if;
  if r::text like '%internal only%' then raise exception 'FAIL: hidden note leaked'; end if;
  if jsonb_array_length(public.shipments_for_member(v_b, v_o)) <> 0 then raise exception 'FAIL: another customer saw shipments'; end if;
  if jsonb_array_length(public.shipments_for_member(v_a, v_o2)) <> 0 then raise exception 'FAIL: a customer saw another customer''s order'; end if;
  raise notice 'PASS: customers see only their own shipments and only visible events';

  -- Cancelling an order cancels pending shipments
  v_s3 := public.shipment_create(v_o2, jsonb_build_array(jsonb_build_object('order_item_id', v_i3, 'qty', 1)), 'selftest');
  perform public.order_set_status(v_o2, 'cancelled', 'selftest');
  select status into st from public.shipments where id = v_s3;
  if st <> 'cancelled' then raise exception 'FAIL: pending shipment should be cancelled, got %', st; end if;
  raise notice 'PASS: order cancellation cancels pending shipments';

  -- Row-level security and privileges: the browser roles reach nothing
  select count(*) into n from pg_tables where schemaname = 'public' and tablename in ('shipments', 'shipment_items', 'shipment_events', 'delivery_exceptions') and rowsecurity;
  if n <> 4 then raise exception 'FAIL: RLS not enabled on all four tables (%)', n; end if;
  begin
    execute 'set local role anon';
    perform count(*) from public.shipments;
    execute 'reset role';
    raise exception 'FAIL: anon could read shipments';
  exception when insufficient_privilege then execute 'reset role';
  end;
  begin
    execute 'set local role authenticated';
    perform public.shipments_for_member(v_a, v_o);
    execute 'reset role';
    raise exception 'FAIL: authenticated could call shipments_for_member';
  exception when insufficient_privilege then execute 'reset role';
  end;
  if has_function_privilege('anon', 'public.shipment_create(uuid, jsonb, text)', 'execute') or has_function_privilege('authenticated', 'public.shipment_set_status(uuid, text, text, text, text, text, text, date, text, boolean, timestamptz)', 'execute') then
    raise exception 'FAIL: a browser role can execute a shipment function';
  end if;
  raise notice 'PASS: RLS on, browser roles have no access (admin permissions are enforced by the API, which alone holds the service key)';
  raise notice 'ALL SHIPMENT SELF-TESTS PASSED';
end $$;
rollback;
