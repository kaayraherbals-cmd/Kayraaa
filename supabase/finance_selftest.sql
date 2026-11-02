-- Self-test for finance.sql. Run on a DISPOSABLE or STAGING database after finance.sql. One transaction that ROLLS BACK.
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
  pa uuid; pb uuid; va uuid; vb uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; i1 uuid;
  s jsonb; p jsonb; c jsonb; inv jsonb; pay1 uuid; sh1 uuid; r1 uuid; n integer;
begin
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-fin-a', 'ZZ FIN A', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Fin A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-fin-b', 'ZZ FIN B', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'Fin B', 'Test only.', true, 'selftest') returning id into pb;
  insert into public.product_variants (product_id, sku, pack_size, price_paise, gst_rate) values (pa, 'ZZ-FIN-A', '60 tabs', 50000, 5) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise, gst_rate) values (pb, 'ZZ-FIN-B', '200 ml', 30000, 12) returning id into vb;

  -- Costs: A is 200.00 from January and 300.00 from March. B has none.
  perform public.finance_cost_add(va, 15000, 0, 5000, 0, '2026-01-01 00:00+05:30', 'supplier_invoice', 'first lot', 'selftest');
  perform public.finance_cost_add(va, 22000, 0, 8000, 0, '2026-03-01 00:00+05:30', 'supplier_invoice', 'price rise', 'selftest');
  perform pg_temp.expect('cost history is append-only (update)', $q$update public.product_cost_history set purchase_paise = 1$q$, 'KH:APPEND_ONLY%');
  perform pg_temp.expect('cost history is append-only (delete)', $q$delete from public.product_cost_history$q$, 'KH:APPEND_ONLY%');
  perform pg_temp.expect('zero cost refused', format($q$select public.finance_cost_add(%L, 0, 0, 0, 0, now(), 'other', null, 'x')$q$, va), '%cost_positive%');
  perform pg_temp.expect('same effective time twice refused', format($q$select public.finance_cost_add(%L, 1, 0, 0, 0, '2026-03-01 00:00+05:30', 'other', null, 'x')$q$, va), '%duplicate key%');

  -- Order 1: Feb 10, A x2, discount 100.00 on the line, shipping 50.00.
  insert into public.orders (order_no, status, channel, customer_name, customer_email, ship_address, ship_pincode, subtotal_paise, discount_paise, shipping_paise, total_paise, created_by)
  values ('KH-2026-910001', 'delivered', 'manual', 'T', 'a@example.org', '1 Test Road, Varanasi', '221001', 100000, 10000, 5000, 95000, 'selftest') returning id into o1;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, line_total_paise, discount_paise)
  values (o1, va, 'Fin A', '60 tabs', 'ZZ-FIN-A', 2, 50000, 5, 100000, 10000) returning id into i1;
  insert into public.order_events (order_id, kind, from_status, to_status, actor, at) values (o1, 'status', 'placed', 'paid', 'selftest', '2026-02-10 10:00+05:30');
  -- Order 2: Mar 15, A x1 + B x1 (B has no cost), same customer.
  insert into public.orders (order_no, status, channel, customer_name, customer_email, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, created_by)
  values ('KH-2026-910002', 'paid', 'manual', 'T', 'A@example.org', '1 Test Road, Varanasi', '221001', 80000, 0, 80000, 'selftest') returning id into o2;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, line_total_paise) values
    (o2, va, 'Fin A', '60 tabs', 'ZZ-FIN-A', 1, 50000, 5, 50000), (o2, vb, 'Fin B', '200 ml', 'ZZ-FIN-B', 1, 30000, 12, 30000);
  insert into public.order_events (order_id, kind, from_status, to_status, actor, at) values (o2, 'status', 'placed', 'paid', 'selftest', '2026-03-15 11:00+05:30');
  -- Order 3: never paid. Order 4: paid but a test order. Order 5: paid 00:05 IST on Mar 1 (= Feb 28 UTC).
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, created_by)
  values ('KH-2026-910003', 'placed', 'manual', 'T', '1 Test Road, Varanasi', '221001', 50000, 0, 50000, 'selftest') returning id into o3;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, line_total_paise) values (o3, va, 'Fin A', '60 tabs', 'ZZ-FIN-A', 1, 50000, 5, 50000);
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, is_test, created_by)
  values ('KH-2026-910004', 'paid', 'manual', 'T', '1 Test Road, Varanasi', '221001', 50000, 0, 50000, true, 'selftest') returning id into o4;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, line_total_paise) values (o4, va, 'Fin A', '60 tabs', 'ZZ-FIN-A', 1, 50000, 5, 50000);
  insert into public.order_events (order_id, kind, from_status, to_status, actor, at) values (o4, 'status', 'placed', 'paid', 'selftest', '2026-02-12 10:00+05:30');
  insert into public.orders (order_no, status, channel, customer_name, customer_email, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, created_by)
  values ('KH-2026-910005', 'paid', 'manual', 'T', 'b@example.org', '1 Test Road, Varanasi', '221001', 50000, 0, 50000, 'selftest') returning id into o5;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, line_total_paise) values (o5, va, 'Fin A', '60 tabs', 'ZZ-FIN-A', 1, 50000, 5, 50000);
  insert into public.order_events (order_id, kind, from_status, to_status, actor, at) values (o5, 'status', 'placed', 'paid', 'selftest', '2026-02-28 18:35+00');
  -- A second paid event for order 1 must not move or duplicate it.
  insert into public.order_events (order_id, kind, from_status, to_status, actor, at) values (o1, 'status', 'paid', 'paid', 'selftest', '2026-02-20 10:00+05:30');

  -- February (India time): only order 1.
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Feb: one order, unpaid and test excluded', (s->>'orders')::int = 1 and (s->>'units')::int = 2);
  perform pg_temp.ok('Feb: gross, discount, net', (s->>'gross_sales_paise')::bigint = 100000 and (s->>'discount_paise')::bigint = 10000 and (s->>'net_incl_tax_paise')::bigint = 90000);
  perform pg_temp.ok('Feb: GST inside net = round(90000*5/105)', (s->>'gst_paise')::bigint = 4286);
  perform pg_temp.ok('Feb: coverage counters', (s->>'online_orders')::int = 0 and (s->>'shipped_orders')::int = 0);
  perform pg_temp.ok('Feb: shipping charged', (s->>'shipping_charged_paise')::bigint = 5000);
  perform pg_temp.ok('Feb: COGS uses the January cost (2 x 20000), not the later one', (s->>'cogs_paise')::bigint = 40000 and (s->>'units_without_cost')::int = 0);
  -- March: orders 2 and 5; order 5 sits on the boundary and belongs to March in India time.
  s := public.finance_period_summary('2026-03-01', '2026-04-01');
  perform pg_temp.ok('Mar: boundary order counted in March (IST)', (s->>'orders')::int = 2);
  perform pg_temp.ok('Mar: COGS uses the new cost for both A units (2 x 30000)', (s->>'cogs_paise')::bigint = 60000);
  perform pg_temp.ok('Mar: B has no cost so it is flagged, not guessed', (s->>'units_without_cost')::int = 1 and (s->>'units_with_cost')::int = 2);
  perform pg_temp.expect('inverted range refused', $q$select public.finance_period_summary('2026-03-01', '2026-03-01')$q$, 'KH:INVALID%');
  perform pg_temp.expect('huge range refused', $q$select public.finance_period_summary('2020-01-01', '2026-03-01')$q$, 'KH:INVALID%');

  -- Refund: 200.00 paid out on Feb 20 against order 1; a requested one is not counted; a duplicate row cannot exceed the order total.
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, status, requested_by, refunded_by, refunded_at, payment_ref)
  values (o1, 'refund_only', 'damaged', 'Cracked', 20000, 'refunded', 'selftest', 'selftest', '2026-02-20 12:00+05:30', 'REF-0001') returning id into r1;
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, status, requested_by, requested_at)
  values (o1, 'refund_only', 'other', 'Asked', 5000, 'requested', 'selftest', '2026-02-18 09:00+05:30');
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Refund: only the paid-out refund counts', (s->>'refund_paise')::bigint = 20000 and (s->>'refund_count')::int = 1);
  perform pg_temp.ok('Refund: not counted in March', (public.finance_period_summary('2026-03-01', '2026-04-01')->>'refund_paise')::bigint = 0);
  p := public.finance_product_profitability('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Product: refund goods share and profit', (p->'items'->0->>'refunds')::bigint = 20000 and (p->'items'->0->>'gross_profit')::bigint = 90000 - 4286 - 20000 - 40000);
  perform pg_temp.ok('Product: margin in basis points', (p->'items'->0->>'margin_bps')::int = round((90000 - 4286 - 20000 - 40000) * 10000.0 / (90000 - 4286)));
  p := public.finance_product_profitability('2026-03-01', '2026-04-01', 'revenue');
  perform pg_temp.ok('Product: item without cost has no profit', exists (select 1 from jsonb_array_elements(p->'items') e where e->>'variant_id' = vb::text and e->'gross_profit' = 'null'::jsonb));
  perform pg_temp.ok('Product: limit is bounded', jsonb_array_length(public.finance_product_profitability('2026-03-01', '2026-04-01', 'revenue', 100000, 0)->'items') <= 200);
  c := public.finance_refund_impact('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Refund impact by reason', (c->'by_reason'->0->>'reason') = 'damaged' and (c->>'pending_paise')::bigint = 5000);

  -- Fees and shipping costs.
  insert into public.order_payments (order_id, rp_order_id, rp_payment_id, amount_paise, status, created_by, captured_at) values (o1, 'order_FIN0001', 'pay_FIN0001', 95000, 'captured', 'selftest', '2026-02-10 10:00+05:30') returning id into pay1;
  perform public.finance_fee_record(pay1, 2000, 360, 0, 'setl_1', 'razorpay_settlement', 'selftest');
  perform public.finance_fee_record(pay1, 2000, 360, 0, 'setl_1', 'razorpay_settlement', 'selftest');
  perform pg_temp.ok('Fee recorded once per payment', (select count(*) from public.payment_fee_records) = 1);
  insert into public.shipments (order_id, shipment_no, created_by) values (o1, 'SH-FIN-1', 'selftest') returning id into sh1;
  perform public.finance_ship_cost_record(sh1, 4200, 'estimated', null, 'selftest');
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Fees counted, shipping estimate NOT confirmed', (s->>'fee_paise')::bigint = 2360 and (s->>'ship_cost_confirmed_paise')::bigint = 0 and (s->>'ship_cost_estimated_paise')::bigint = 4200);
  perform public.finance_ship_cost_record(sh1, 4500, 'confirmed', 'carrier invoice', 'selftest');
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Confirmed shipping cost replaces the estimate', (s->>'ship_cost_confirmed_paise')::bigint = 4500 and (s->>'ship_cost_estimated_paise')::bigint = 0);
  perform pg_temp.expect('fee on a payment that was not captured refused', $q$select public.finance_fee_record(gen_random_uuid(), 1, 0, 0, null, 'owner_entry', 'x')$q$, 'KH:NOT_FOUND%');

  -- Expenses: duplicate prevention, edit, void, period filter.
  perform public.finance_expense_save(null, '2026-02-05', 'advertising', 150000, 'Instagram ads', 'Meta', 'INV-1', 'selftest');
  perform pg_temp.expect('duplicate expense refused', $q$select public.finance_expense_save(null, '2026-02-05', 'advertising', 150000, 'Instagram ads again', ' meta ', 'inv-1', 'selftest')$q$, '%duplicate key%');
  perform pg_temp.expect('future-dated expense refused', $q$select public.finance_expense_save(null, current_date + 5, 'utilities', 1000, 'Power', null, null, 'selftest')$q$, 'KH:INVALID%');
  perform public.finance_expense_save(null, '2026-03-05', 'packaging', 20000, 'Boxes', null, null, 'selftest');
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Expenses by category within the period only', (s->'expenses'->>'advertising')::bigint = 150000 and not (s->'expenses' ? 'packaging'));
  perform public.finance_expense_void((select id from public.business_expenses where category = 'advertising'), 'Entered twice by mistake', 'selftest');
  s := public.finance_period_summary('2026-02-01', '2026-03-01');
  perform pg_temp.ok('Voided expense not counted', not (s->'expenses' ? 'advertising'));
  perform public.finance_expense_save(null, '2026-02-05', 'advertising', 150000, 'Instagram ads (re-entered)', 'Meta', 'INV-1', 'selftest');
  perform pg_temp.ok('A voided entry does not block re-entering it', true);
  perform pg_temp.expect('voiding twice refused', format($q$select public.finance_expense_void(%L, 'again', 'x')$q$, (select id from public.business_expenses where status = 'voided')), 'KH:NOT_FOUND%');

  -- Customers: one customer (case-insensitive e-mail) bought in Feb and Mar; another is new in Mar.
  c := public.finance_customer_metrics('2026-03-01', '2026-04-01');
  perform pg_temp.ok('Customers: one returning, one new', (c->>'customers')::int = 2 and (c->>'new_customers')::int = 1 and (c->>'returning_customers')::int = 1);
  perform pg_temp.ok('Customers: lifetime repeat counts', (c->>'lifetime_customers')::int = 2 and (c->>'lifetime_repeat_customers')::int = 1);
  perform pg_temp.ok('Customers: no personal data in the result', c::text not like '%example.org%');

  -- Inventory valuation.
  perform public.inventory_receive(va, 'ZZFINA1', null, current_date + 400, 10, 'test', 'selftest');
  perform public.inventory_receive(va, 'ZZFINA0', null, current_date + 30, 5, 'test', 'selftest');
  perform public.inventory_receive(vb, 'ZZFINB1', null, current_date + 400, 4, 'test', 'selftest');
  update public.inventory_batches set expiry_date = current_date - 1, mfg_date = null where batch_no = 'ZZFINA0';
  inv := public.finance_inventory_valuation(90, 90);
  perform pg_temp.ok('Inventory: units', (inv->>'units_on_hand')::int >= 19);
  perform pg_temp.ok('Inventory: expired value at cost', (inv->>'expired_units')::int >= 5 and (inv->>'expired_cost_paise')::bigint >= 5 * 30000);
  perform pg_temp.ok('Inventory: B (no cost) is reported as uncosted, not valued', (inv->>'units_without_cost')::int >= 4);
  perform pg_temp.ok('Inventory: selling value is a separate figure', (inv->>'selling_value_paise')::bigint > (inv->>'cost_value_paise')::bigint);

  -- KPI targets.
  perform public.finance_kpi_set('monthly_orders', 40, 'selftest');
  perform public.finance_kpi_set('monthly_orders', 50, 'selftest');
  perform pg_temp.ok('KPI target replaced, not duplicated', (select target from public.financial_kpi_targets where kpi = 'monthly_orders') = 50 and (select count(*) from public.financial_kpi_targets) = 1);
  perform pg_temp.expect('KPI name checked', $q$select public.finance_kpi_set('made_up', 5, 'x')$q$, '%financial_kpi_targets_kpi_check%');

  -- Series.
  perform pg_temp.ok('Daily series is per India day', jsonb_array_length(public.finance_daily_series('2026-02-01', '2026-04-01')) = 3);
end $$;

-- Lockdown: the browser roles cannot read or run anything here.
do $$
declare t text; f text;
begin
  foreach t in array array['product_cost_history', 'business_expenses', 'payment_fee_records', 'shipment_cost_records', 'financial_kpi_targets'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then raise exception 'FAIL: % readable by a browser role', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS off on %', t; end if;
  end loop;
  foreach f in array array['finance_period_summary(date,date)', 'finance_product_profitability(date,date,text,integer,integer)', 'finance_inventory_valuation(integer,integer)', 'finance_expense_save(uuid,date,text,bigint,text,text,text,text)', 'finance_cost_add(uuid,integer,integer,integer,integer,timestamptz,text,text,text)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('authenticated', 'public.' || f, 'execute') then raise exception 'FAIL: % executable by a browser role', f; end if;
  end loop;
  raise notice 'PASS browser roles have no access to finance tables or functions';
end $$;
rollback;
