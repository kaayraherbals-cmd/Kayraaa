-- Self-test for refund_create and refund_set_status. Run in the Supabase SQL editor AFTER inventory_orders.sql and refunds.sql.
-- Everything happens in one transaction that is rolled back at the end, so nothing is kept. Expect "PASS" notices and no error.
-- These functions were written but NOT executed when this version was prepared, so run this before trusting them.
begin;
do $$
declare
  v_order uuid := gen_random_uuid();
  v_unpaid uuid := gen_random_uuid();
  v_r1 uuid; v_r2 uuid;
  msg text;
begin
  insert into public.orders (id, order_no, status, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by)
  values (v_order, 'KH-2026-900001', 'paid', 'Self Test', '1 Test Road, Varanasi', '221001', 50000, 50000, 'selftest'),
         (v_unpaid, 'KH-2026-900002', 'placed', 'Self Test', '1 Test Road, Varanasi', '221001', 50000, 50000, 'selftest');
  insert into public.order_events (order_id, kind, from_status, to_status, actor) values (v_order, 'status', 'placed', 'paid', 'selftest');

  -- An order that was never paid cannot be refunded.
  begin
    perform public.refund_create(v_unpaid, 'refund_only', 'damaged', 'test', 1000, 'selftest');
    raise exception 'FAIL: refund on an unpaid order was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:NOT_PAID%' then raise exception 'FAIL: expected KH:NOT_PAID, got %', msg; end if;
  end;
  raise notice 'PASS: unpaid order refused';

  v_r1 := public.refund_create(v_order, 'refund_only', 'damaged', 'Cracked bottle', 30000, 'selftest');
  raise notice 'PASS: refund requested';

  -- Live refunds may never exceed the order total (30000 + 25000 > 50000).
  begin
    perform public.refund_create(v_order, 'refund_only', 'other', 'test', 25000, 'selftest');
    raise exception 'FAIL: over-refund was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:REFUND_EXCEEDS:20000%' then raise exception 'FAIL: expected KH:REFUND_EXCEEDS:20000, got %', msg; end if;
  end;
  raise notice 'PASS: over-refund refused';

  -- Rejecting needs a reason; a rejected request frees its amount.
  begin
    perform public.refund_set_status(v_r1, 'rejected', 'selftest', '', null, false);
    raise exception 'FAIL: rejection without a reason was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INVALID%' then raise exception 'FAIL: expected KH:INVALID, got %', msg; end if;
  end;
  perform public.refund_set_status(v_r1, 'rejected', 'selftest', 'Outside the return window', null, false);
  v_r2 := public.refund_create(v_order, 'return_and_refund', 'wrong_item', 'Sent the wrong syrup', 50000, 'selftest');
  raise notice 'PASS: rejected request freed its amount';

  -- Ladder: requested cannot jump to refunded; approved needs a payout reference to be refunded; finished states stay finished.
  begin
    perform public.refund_set_status(v_r2, 'refunded', 'selftest', null, 'UTR 4098123', true);
    raise exception 'FAIL: requested to refunded was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:REFUND_BAD_TRANSITION%' then raise exception 'FAIL: expected bad transition, got %', msg; end if;
  end;
  perform public.refund_set_status(v_r2, 'approved', 'selftest', null, null, false);
  begin
    perform public.refund_set_status(v_r2, 'refunded', 'selftest', null, '', true);
    raise exception 'FAIL: refunded without a reference was accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INVALID%' then raise exception 'FAIL: expected KH:INVALID, got %', msg; end if;
  end;
  perform public.refund_set_status(v_r2, 'refunded', 'selftest', null, 'UTR 4098123', true);
  if not exists (select 1 from public.order_refunds where id = v_r2 and status = 'refunded' and payment_ref = 'UTR 4098123' and goods_received and refunded_by = 'selftest') then
    raise exception 'FAIL: payout details were not recorded';
  end if;
  begin
    perform public.refund_set_status(v_r2, 'rejected', 'selftest', 'too late', null, false);
    raise exception 'FAIL: a refunded refund was reopened';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:REFUND_BAD_TRANSITION%' then raise exception 'FAIL: expected bad transition, got %', msg; end if;
  end;
  raise notice 'PASS: ladder and payout record';

  if (select count(*) from public.order_events where order_id = v_order and kind = 'note' and note like 'Refund%') < 4 then
    raise exception 'FAIL: refund events were not written to the order timeline';
  end if;
  raise notice 'PASS: order timeline updated';
  raise notice 'ALL PASSED';
end $$;
rollback;
