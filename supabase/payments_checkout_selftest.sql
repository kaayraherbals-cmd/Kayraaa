-- Self-test for payments_checkout.sql. Run in the Supabase SQL editor on STAGING after inventory_orders.sql, carts.sql, payments.sql,
-- checkout.sql and payments_checkout.sql. Everything happens in one transaction that is rolled back, so nothing is kept.
-- Expect "PASS" notices, then ALL PASSED. Any "FAIL" stops the script with an error.
-- payments_checkout.sql and this file were written but NOT executed when this version was prepared. Run this before trusting them.
-- It cannot test two sessions racing (a transaction is one session). The two-session checks are listed at the bottom as manual steps.
begin;
do $$
declare
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_var uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_oa uuid; v_ob uuid; v_oc uuid; v_od uuid; v_oe uuid; v_of uuid;
  v_res jsonb;
  v_out text;
  v_reserved integer;
  v_cart_items integer;
  v_status text;
  v_flag text;
  v_due jsonb;
  msg text;
  v_order jsonb;
begin
  insert into public.members (id, email, provider) values (v_member, 'zz-paytest-a@example.org', 'email'), (v_other, 'zz-paytest-b@example.org', 'email');
  insert into public.products (id, slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values (v_prod, 'zz-payment-selftest', 'ZZ PAYMENT SELFTEST', 'Syrup', '100 ml', 'APPROVED_FOR_SALE', 'Self test', 'A product used only by the self test.', true, 'selftest');
  select id into v_var from public.product_variants where product_id = v_prod;
  if v_var is null then
    insert into public.product_variants (product_id, sku, pack_size, price_paise) values (v_prod, 'ZZ-PAY-SELFTEST', '100 ml', 10000) returning id into v_var;
  end if;
  update public.product_variants set price_paise = 10000, status = 'active' where id = v_var;
  perform public.inventory_receive(v_var, 'ZZ-PAY-A', null, v_today + 400, 10, 'test', 'selftest');
  insert into public.shipping_pincodes (pincode, active, rate_paise) values ('221005', true, 6000) on conflict (pincode) do update set active = true, rate_paise = 6000;

  v_order := jsonb_build_object('customer_name', 'Self Test', 'customer_email', 'zz-paytest-a@example.org', 'customer_phone', '+919876543210',
    'ship_address', '12 Lanka Road, Varanasi, Uttar Pradesh', 'ship_pincode', '221005', 'shipping_paise', 6000,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'qty', 2)));

  -- Order A: 2 units, total 26000 paise
  v_oa := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-a-000000000', v_order, 26000, true)) ->> 'order_id')::uuid;

  -- ---- payment_prepare -------------------------------------------------------------------------------------------
  begin
    perform public.payment_prepare(v_other, v_oa);
    raise exception 'FAIL: another member prepared payment for this order';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_FOUND%' then raise exception 'FAIL: expected KH:NOT_FOUND for a stranger, got %', msg; end if;
  end;
  raise notice 'PASS: another member cannot prepare payment for my order';

  v_res := public.payment_prepare(v_member, v_oa);
  if (v_res ->> 'amount_paise')::bigint <> 26000 then raise exception 'FAIL: amount is not the stored total (%)', v_res ->> 'amount_paise'; end if;
  if v_res -> 'reuse' <> 'null'::jsonb then raise exception 'FAIL: reuse should be null before any attempt'; end if;
  raise notice 'PASS: prepare returns the stored total and no reusable attempt';

  -- ---- payment_attach --------------------------------------------------------------------------------------------
  begin
    perform public.payment_attach(v_member, v_oa, 'order_ZZPAYTEST0001', 100, 'selftest');
    raise exception 'FAIL: attach accepted an amount different from the order total';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INVALID%' then raise exception 'FAIL: expected KH:INVALID for a wrong amount, got %', msg; end if;
  end;
  begin
    perform public.payment_attach(v_other, v_oa, 'order_ZZPAYTEST0001', 26000, 'selftest');
    raise exception 'FAIL: a stranger attached a payment';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_FOUND%' then raise exception 'FAIL: expected KH:NOT_FOUND for attach by a stranger, got %', msg; end if;
  end;
  raise notice 'PASS: attach refuses a wrong amount and a stranger';

  v_res := public.payment_attach(v_member, v_oa, 'order_ZZPAYTEST0001', 26000, 'selftest');
  if (v_res ->> 'reused')::boolean then raise exception 'FAIL: first attach should not be a reuse'; end if;
  v_res := public.payment_attach(v_member, v_oa, 'order_ZZPAYTEST0002', 26000, 'selftest');
  if not (v_res ->> 'reused')::boolean or v_res ->> 'rp_order_id' <> 'order_ZZPAYTEST0001' then raise exception 'FAIL: second attach must return the first attempt (%)', v_res; end if;
  if (select count(*) from public.order_payments where order_id = v_oa) <> 1 then raise exception 'FAIL: more than one open attempt'; end if;
  raise notice 'PASS: a second attach returns the existing attempt; one open attempt only';

  v_res := public.payment_prepare(v_member, v_oa);
  if v_res #>> '{reuse,rp_order_id}' <> 'order_ZZPAYTEST0001' then raise exception 'FAIL: prepare should offer the open attempt for reuse'; end if;
  raise notice 'PASS: prepare offers the open attempt for reuse';

  -- ---- payment_apply_event: mismatch, then the real capture ------------------------------------------------------------
  perform public.cart_set_item(v_member, v_var, 2);
  v_out := public.payment_apply_event('zz-evt-0001', 'payment.captured', 'order_ZZPAYTEST0001', 'pay_ZZPAYTEST0001', null, 100, 'upi', null, null);
  if v_out <> 'amount_mismatch' then raise exception 'FAIL: wrong amount gave %', v_out; end if;
  select status into v_status from public.orders where id = v_oa;
  if v_status <> 'placed' then raise exception 'FAIL: order changed to % on a mismatched capture', v_status; end if;
  select flagged into v_flag from public.order_payments where rp_order_id = 'order_ZZPAYTEST0001';
  if v_flag <> 'amount_mismatch' then raise exception 'FAIL: mismatch not flagged'; end if;
  select count(*) into v_cart_items from public.cart_items where cart_id in (select id from public.carts where member_id = v_member);
  if v_cart_items <> 1 then raise exception 'FAIL: bag changed on a mismatched capture'; end if;
  raise notice 'PASS: amount mismatch is flagged, order stays unpaid, bag untouched';

  v_out := public.payment_apply_event('zz-evt-0002', 'payment.captured', 'order_ZZPAYTEST0001', 'pay_ZZPAYTEST0001', null, 26000, 'upi', null, null);
  if v_out <> 'captured' then raise exception 'FAIL: correct capture gave %', v_out; end if;
  select status into v_status from public.orders where id = v_oa;
  if v_status <> 'paid' then raise exception 'FAIL: order is % after a correct capture', v_status; end if;
  select count(*) into v_cart_items from public.cart_items where cart_id in (select id from public.carts where member_id = v_member);
  if v_cart_items <> 0 then raise exception 'FAIL: bag not emptied on payment'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: stock should stay reserved until shipping (%)', v_reserved; end if;
  raise notice 'PASS: a correct capture marks the order paid and empties the bag; stock stays reserved';

  if public.payment_apply_event('zz-evt-0002', 'payment.captured', 'order_ZZPAYTEST0001', 'pay_ZZPAYTEST0001', null, 26000, 'upi', null, null) <> 'duplicate' then raise exception 'FAIL: redelivered event not a duplicate'; end if;
  if public.payment_apply_event('zz-evt-0003', 'payment.captured', 'order_ZZPAYTEST0001', 'pay_ZZPAYTEST0001', null, 26000, 'upi', null, null) <> 'captured' then raise exception 'FAIL: second capture event should be a no-op capture'; end if;
  if (select count(*) from public.order_events where order_id = v_oa and to_status = 'paid') <> 1 then raise exception 'FAIL: order moved to paid more than once'; end if;
  if public.payment_apply_event('zz-evt-0004', 'payment.failed', 'order_ZZPAYTEST0001', 'pay_ZZPAYTEST0009', null, 26000, 'upi', 'X', 'late failure') <> 'failed' then raise exception 'FAIL: failed event not acknowledged'; end if;
  if (select status from public.order_payments where rp_order_id = 'order_ZZPAYTEST0001') <> 'captured' then raise exception 'FAIL: a late failure undid a capture'; end if;
  raise notice 'PASS: duplicate and late events change nothing';

  begin
    perform public.payment_prepare(v_member, v_oa);
    raise exception 'FAIL: prepared payment for an order already paid';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:ALREADY_PAID%' then raise exception 'FAIL: expected KH:ALREADY_PAID, got %', msg; end if;
  end;
  begin
    perform public.order_cancel_own(v_member, v_oa);
    raise exception 'FAIL: a paid order was cancelled by the customer';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:BAD_TRANSITION%' then raise exception 'FAIL: expected KH:BAD_TRANSITION for a paid order, got %', msg; end if;
  end;
  raise notice 'PASS: a paid order cannot be paid again or cancelled by the customer';

  -- ---- Order B: customer cancel releases stock; repeating is harmless; blocked while a payment is authorised ---------------
  v_ob := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-b-000000000', jsonb_set(v_order, '{items,0,qty}', '1'), 16000, true)) ->> 'order_id')::uuid;
  perform public.payment_attach(v_member, v_ob, 'order_ZZPAYTEST0010', 16000, 'selftest');
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 3 then raise exception 'FAIL: expected 3 reserved, got %', v_reserved; end if;
  if public.order_cancel_own(v_member, v_ob) <> 'cancelled' then raise exception 'FAIL: cancel did not report cancelled'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: cancel did not release stock (%)', v_reserved; end if;
  if public.order_cancel_own(v_member, v_ob) <> 'cancelled' then raise exception 'FAIL: repeating cancel should be harmless'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: repeating cancel released stock twice (%)', v_reserved; end if;
  raise notice 'PASS: customer cancel releases stock once';

  -- A capture that arrives after the order was cancelled is kept and flagged for a person, never turned into a paid order.
  v_out := public.payment_apply_event('zz-evt-0010', 'payment.captured', 'order_ZZPAYTEST0010', 'pay_ZZPAYTEST0010', null, 16000, 'upi', null, null);
  if v_out <> 'order_not_open' then raise exception 'FAIL: payment after cancellation gave %', v_out; end if;
  select status into v_status from public.orders where id = v_ob;
  if v_status <> 'cancelled' then raise exception 'FAIL: cancelled order became %', v_status; end if;
  raise notice 'PASS: payment after cancellation is flagged, order stays cancelled';

  -- ---- Order C: cannot cancel while a payment is authorised ---------------------------------------------------------------
  v_oc := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-c-000000000', jsonb_set(v_order, '{items,0,qty}', '1'), 16000, true)) ->> 'order_id')::uuid;
  perform public.payment_attach(v_member, v_oc, 'order_ZZPAYTEST0020', 16000, 'selftest');
  perform public.payment_apply_event('zz-evt-0020', 'payment.authorized', 'order_ZZPAYTEST0020', 'pay_ZZPAYTEST0020', null, 16000, 'card', null, null);
  begin
    perform public.order_cancel_own(v_member, v_oc);
    raise exception 'FAIL: cancelled while a payment was authorised';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:PAYMENT_IN_PROGRESS%' then raise exception 'FAIL: expected KH:PAYMENT_IN_PROGRESS, got %', msg; end if;
  end;
  if (public.payment_prepare(v_member, v_oc)) #>> '{reuse,status}' <> 'authorized' then raise exception 'FAIL: an authorised attempt must be reused, not duplicated'; end if;
  raise notice 'PASS: no cancel and no second attempt beside an authorised payment';

  -- ---- Expiry ------------------------------------------------------------------------------------------------------------
  -- Order C is still inside its window: not due, and order_expire refuses it.
  if public.order_expire(v_oc, 'selftest') <> 'skipped' then raise exception 'FAIL: an order inside its window was expired'; end if;
  update public.orders set pay_by = now() - interval '10 minutes' where id = v_oc;
  -- Order C still has the attempt authorised earlier in this test. KH6-012: a FRESH authorised attempt now holds the order (see Order E),
  -- so age it past the 24-hour hold here to keep testing the ordinary expiry path.
  update public.order_payments set updated_at = now() - interval '25 hours' where order_id = v_oc and status = 'authorized';
  v_due := public.orders_due_for_expiry(100, 2);
  if not exists (select 1 from jsonb_array_elements(v_due) e where (e ->> 'order_id')::uuid = v_oc) then raise exception 'FAIL: overdue order not listed as due'; end if;
  -- the paid order and the cancelled order are never due
  if exists (select 1 from jsonb_array_elements(v_due) e where (e ->> 'order_id')::uuid in (v_oa, v_ob)) then raise exception 'FAIL: paid or cancelled order listed as due'; end if;
  if public.order_expire(v_oc, 'selftest') <> 'expired' then raise exception 'FAIL: overdue order not expired'; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 2 then raise exception 'FAIL: expiry did not release stock (%)', v_reserved; end if;
  if public.order_expire(v_oc, 'selftest') <> 'skipped' then raise exception 'FAIL: repeating expiry should be a no-op'; end if;
  raise notice 'PASS: expiry releases stock once and never touches paid or cancelled orders';

  -- Order D: overdue but a capture is already recorded: expiry must say paid, never cancel.
  v_od := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-d-000000000', jsonb_set(v_order, '{items,0,qty}', '1'), 16000, true)) ->> 'order_id')::uuid;
  perform public.payment_attach(v_member, v_od, 'order_ZZPAYTEST0030', 16000, 'selftest');
  update public.order_payments set status = 'captured', captured_at = now() where rp_order_id = 'order_ZZPAYTEST0030'; -- imitates a capture landing while the order is still "placed"
  update public.orders set pay_by = now() - interval '10 minutes' where id = v_od;
  if public.order_expire(v_od, 'selftest') <> 'paid' then raise exception 'FAIL: expiry must not cancel an order with a captured payment'; end if;
  select status into v_status from public.orders where id = v_od;
  if v_status <> 'placed' then raise exception 'FAIL: order changed to % under a captured payment', v_status; end if;
  raise notice 'PASS: expiry never cancels an order that has a captured payment';

  -- Order E (KH6-012): overdue, but an attempt was authorised recently. Money may be moving, so expiry must hold the order and
  -- its stock, and must not even list it as due. After 24 hours of silence it expires like any other (a late capture is then
  -- flagged order_not_open for a person to refund).
  v_oe := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-e-000000000', jsonb_set(v_order, '{items,0,qty}', '1'), 16000, true)) ->> 'order_id')::uuid;
  perform public.payment_attach(v_member, v_oe, 'order_ZZPAYTEST0040', 16000, 'selftest');
  update public.order_payments set status = 'authorized', updated_at = now() where rp_order_id = 'order_ZZPAYTEST0040';
  update public.orders set pay_by = now() - interval '10 minutes' where id = v_oe;
  v_due := public.orders_due_for_expiry(100, 2);
  if exists (select 1 from jsonb_array_elements(v_due) e where (e ->> 'order_id')::uuid = v_oe) then raise exception 'FAIL: an order with a fresh authorised payment was listed as due'; end if;
  if public.order_expire(v_oe, 'selftest') <> 'held' then raise exception 'FAIL: expiry must hold an order with a fresh authorised payment'; end if;
  select status into v_status from public.orders where id = v_oe;
  if v_status <> 'placed' then raise exception 'FAIL: order changed to % under an authorised payment', v_status; end if;
  select coalesce(sum(qty_reserved), 0) into v_reserved from public.inventory_batches where variant_id = v_var;
  if v_reserved <> 4 then raise exception 'FAIL: stock under an authorised payment was released (%)', v_reserved; end if;
  update public.order_payments set updated_at = now() - interval '25 hours' where rp_order_id = 'order_ZZPAYTEST0040';
  v_due := public.orders_due_for_expiry(100, 2);
  if not exists (select 1 from jsonb_array_elements(v_due) e where (e ->> 'order_id')::uuid = v_oe) then raise exception 'FAIL: a stale authorised attempt must become due again'; end if;
  if public.order_expire(v_oe, 'selftest') <> 'expired' then raise exception 'FAIL: a stale authorised attempt must not hold stock for ever'; end if;
  raise notice 'PASS: a fresh authorised payment holds the order and its stock; a stale one does not';

  -- Order F (KH6-013): an ONLINE order can only become paid when a captured payment exists. An admin (any actor) cannot do it by hand.
  v_of := ((public.checkout_place(v_member, gen_random_uuid(), 'hash-paytest-f-000000000', jsonb_set(v_order, '{items,0,qty}', '1'), 16000, true)) ->> 'order_id')::uuid;
  begin
    perform public.order_set_status(v_of, 'paid', 'manager@example.org');
    raise exception 'FAIL: an online order was marked paid with no captured payment';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:PAYMENT_REQUIRED%' then raise exception 'FAIL: expected KH:PAYMENT_REQUIRED, got %', msg; end if;
  end;
  select status into v_status from public.orders where id = v_of;
  if v_status <> 'placed' then raise exception 'FAIL: order moved to % without a payment', v_status; end if;
  -- Order D has a captured payment recorded: moving it to paid is allowed (this is how a capture is applied).
  perform public.order_set_status(v_od, 'paid', 'selftest');
  select status into v_status from public.orders where id = v_od;
  if v_status <> 'paid' then raise exception 'FAIL: an order with a captured payment could not be marked paid (%)', v_status; end if;
  -- A manual order (cash or bank transfer taken by a person) can still be marked paid by an admin.
  update public.orders set channel = 'manual' where id = v_of;
  perform public.order_set_status(v_of, 'paid', 'manager@example.org');
  select status into v_status from public.orders where id = v_of;
  if v_status <> 'paid' then raise exception 'FAIL: a manual order could not be marked paid (%)', v_status; end if;
  raise notice 'PASS: online orders become paid only with a captured payment; manual orders can still be marked paid';

  -- ---- Lock-down: the API roles cannot call these -----------------------------------------------------------------------
  if has_function_privilege('anon', 'public.payment_prepare(uuid, uuid)', 'execute') or has_function_privilege('authenticated', 'public.payment_apply_event(text, text, text, text, text, bigint, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.order_expire(uuid, text, integer)', 'execute') or has_function_privilege('authenticated', 'public.order_cancel_own(uuid, uuid)', 'execute') then
    raise exception 'FAIL: a public role can execute a payment function';
  end if;
  raise notice 'PASS: payment functions are not executable by anon or authenticated';

  raise notice 'ALL PASSED';
end $$;
rollback;

-- Manual checks that need TWO sessions (the Supabase SQL editor cannot do this in one script). On staging:
--   1. Two sessions run payment_attach for the same order with different Razorpay order ids at the same moment.
--      Expect exactly one row in order_payments for the order, and both sessions to receive the same rp_order_id.
--   2. Two sessions run checkout_place for the last unit of a batch. Expect one order and one KH:INSUFFICIENT_STOCK.
--   3. One session runs payment_apply_event (captured) while another runs order_expire for the same overdue order.
--      Expect either "paid" or "expired" but never both: if expired first, the late capture is flagged order_not_open.
