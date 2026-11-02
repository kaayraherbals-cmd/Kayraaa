-- Self-test for payment_create and payment_apply_event. Run in the Supabase SQL editor AFTER inventory_orders.sql, refunds.sql and payments.sql.
-- Everything happens in one transaction that is rolled back at the end, so nothing is kept. Expect "PASS" notices, then ALL PASSED.
-- These functions were written but NOT executed when this version was prepared, so run this before trusting them.
begin;
do $$
declare
  v_order uuid := gen_random_uuid();
  v_paid uuid := gen_random_uuid();
  v_cancelled uuid := gen_random_uuid();
  v_pay uuid;
  v_out text;
  msg text;
begin
  insert into public.orders (id, order_no, status, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by)
  values (v_order, 'KH-2026-900101', 'placed', 'Self Test', '1 Test Road, Varanasi', '221001', 50000, 50000, 'selftest'),
         (v_paid, 'KH-2026-900102', 'paid', 'Self Test', '1 Test Road, Varanasi', '221001', 50000, 50000, 'selftest'),
         (v_cancelled, 'KH-2026-900103', 'cancelled', 'Self Test', '1 Test Road, Varanasi', '221001', 50000, 50000, 'selftest');

  -- Only an order still at "placed" can start a payment.
  begin
    perform public.payment_create(v_paid, 'order_SELFTEST_B', 'selftest');
    raise exception 'FAIL: payment on a paid order was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:BAD_TRANSITION%' then raise exception 'FAIL: expected KH:BAD_TRANSITION, got %', msg; end if;
  end;
  raise notice 'PASS: non-placed order refused';

  v_pay := public.payment_create(v_order, 'order_SELFTEST_A', 'selftest');
  if (select amount_paise from public.order_payments where id = v_pay) <> 50000 then raise exception 'FAIL: amount was not taken from the order'; end if;
  raise notice 'PASS: payment created for the order total';

  -- Unknown Razorpay order: recorded, nothing changes.
  if public.payment_apply_event('evt_selftest_00', 'payment.captured', 'order_NOPE000', 'pay_SELFTEST0', null, 50000, 'upi', null, null) <> 'unknown_order' then raise exception 'FAIL: unknown order'; end if;
  raise notice 'PASS: unknown order ignored safely';

  -- A capture for the wrong amount never marks the order paid.
  if public.payment_apply_event('evt_selftest_01', 'payment.captured', 'order_SELFTEST_A', 'pay_SELFTEST1', null, 49900, 'upi', null, null) <> 'amount_mismatch' then raise exception 'FAIL: mismatch'; end if;
  if (select status from public.orders where id = v_order) <> 'placed' then raise exception 'FAIL: order paid on a wrong amount'; end if;
  if (select flagged from public.order_payments where id = v_pay) <> 'amount_mismatch' then raise exception 'FAIL: mismatch not flagged'; end if;
  raise notice 'PASS: wrong amount flagged, order not paid';

  -- The right amount marks the order paid, once.
  if public.payment_apply_event('evt_selftest_02', 'payment.captured', 'order_SELFTEST_A', 'pay_SELFTEST1', null, 50000, 'upi', null, null) <> 'captured' then raise exception 'FAIL: capture'; end if;
  if (select status from public.orders where id = v_order) <> 'paid' then raise exception 'FAIL: order not marked paid'; end if;
  if (select status from public.order_payments where id = v_pay) <> 'captured' then raise exception 'FAIL: payment not captured'; end if;
  raise notice 'PASS: capture marks the order paid';

  -- Redelivery of the same event does nothing; a different event for a captured payment keeps it captured.
  if public.payment_apply_event('evt_selftest_02', 'payment.captured', 'order_SELFTEST_A', 'pay_SELFTEST1', null, 50000, 'upi', null, null) <> 'duplicate' then raise exception 'FAIL: duplicate not detected'; end if;
  if public.payment_apply_event('evt_selftest_03', 'payment.failed', 'order_SELFTEST_A', 'pay_SELFTEST9', null, 50000, 'card', 'BAD_REQUEST_ERROR', 'late retry failed') <> 'failed' then raise exception 'FAIL: failed event'; end if;
  if (select status from public.order_payments where id = v_pay) <> 'captured' then raise exception 'FAIL: a later failure undid a capture'; end if;
  if (select count(*) from public.order_events where order_id = v_order and kind = 'status' and to_status = 'paid') <> 1 then raise exception 'FAIL: order paid more than once'; end if;
  raise notice 'PASS: duplicates and late failures are harmless';

  -- Money arriving for a cancelled order is flagged for a person, never silently kept.
  insert into public.order_payments (order_id, rp_order_id, amount_paise, created_by) values (v_cancelled, 'order_SELFTEST_C', 50000, 'selftest');
  if public.payment_apply_event('evt_selftest_04', 'payment.captured', 'order_SELFTEST_C', 'pay_SELFTEST4', null, 50000, 'upi', null, null) <> 'order_not_open' then raise exception 'FAIL: cancelled order'; end if;
  if (select status from public.orders where id = v_cancelled) <> 'cancelled' then raise exception 'FAIL: cancelled order changed'; end if;
  raise notice 'PASS: payment on a cancelled order flagged';

  raise notice 'ALL PASSED';
end $$;
rollback;
