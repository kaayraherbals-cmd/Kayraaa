-- Customer payments (Phase 5, Section 4). Run in the Supabase SQL editor AFTER checkout.sql. Safe to run again.
-- This file has NOT been run on a database. Run supabase/payments_checkout_selftest.sql after it, on staging, before trusting it.
-- Nothing here opens selling: the API refuses every payment request unless checkout is open AND FEATURE_PAYMENT_TEST_MODE is on
-- with a Razorpay TEST key (or COMMERCE_ENABLED is true in code). Flags are forced off in production.
--
-- What it adds
--   payment_prepare      : an order's owner asks to pay; checks ownership, state and the payment window; reuses an open attempt.
--   payment_attach       : saves the Razorpay order id for that attempt (or returns the one a racing request already saved).
--   payment_apply_event  : REPLACED. Same rules as payments.sql, plus: the customer's bag is cleared when payment is captured.
--   order_cancel_own     : a customer cancels their own UNPAID order; the held stock is released.
--   orders_require_capture : (Phase 6, KH6-013) trigger: an online order cannot become paid without a captured payment.
--   orders_due_for_expiry / order_expire : release stock held by unpaid orders whose payment window has ended.

-- ---- Index for the expiry sweep and for the admin "pending payments" view (Section 8) -----------------------------
create index if not exists order_payments_status_idx on public.order_payments (status, created_at desc);

-- ---- Prepare: may this member pay this order right now? ---------------------------------------------------------
-- Returns {order_no, amount_paise, is_test, pay_by, customer_name, customer_email, customer_phone, reuse}
-- reuse is null, or {payment_id, rp_order_id, status} for an attempt that is still open (created or authorized).
-- A payment that is only "created" (nothing paid yet) can be reused. An "authorized" one MUST be reused or waited out: a
-- second attempt could take the money twice.
create or replace function public.payment_prepare(p_member uuid, p_order uuid)
returns jsonb language plpgsql as $$
declare
  o public.orders%rowtype;
  op public.order_payments%rowtype;
  v_reuse jsonb := null;
begin
  if p_member is null or p_order is null then raise exception 'KH:INVALID'; end if;
  -- Ownership is part of the lookup: another member's order looks exactly like a missing one.
  select * into o from public.orders where id = p_order and member_id = p_member for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if exists (select 1 from public.order_payments where order_id = o.id and status = 'captured') or o.status in ('paid', 'packed', 'shipped', 'delivered') then raise exception 'KH:ALREADY_PAID'; end if;
  if o.status <> 'placed' then raise exception 'KH:BAD_TRANSITION:%>paid', o.status; end if;
  if o.pay_by is null or o.pay_by <= now() then raise exception 'KH:PAY_WINDOW_ENDED'; end if;
  if o.total_paise <= 0 then raise exception 'KH:INVALID'; end if;

  select * into op from public.order_payments where order_id = o.id and status in ('authorized', 'created') order by (status = 'authorized') desc, created_at desc limit 1;
  if found then v_reuse := jsonb_build_object('payment_id', op.id, 'rp_order_id', op.rp_order_id, 'status', op.status); end if;

  return jsonb_build_object('order_no', o.order_no, 'amount_paise', o.total_paise, 'is_test', o.is_test, 'pay_by', o.pay_by,
    'customer_name', o.customer_name, 'customer_email', o.customer_email, 'customer_phone', o.customer_phone, 'reuse', v_reuse);
end $$;

-- ---- Attach: record the Razorpay order we just created --------------------------------------------------------------
-- Two requests can race (a double tap). Both may have created a Razorpay order; the first to arrive here wins and the
-- second gets the winner back, so exactly one attempt is open. The spare Razorpay order is never shown to the customer
-- and is never paid, so it expires unused.
create or replace function public.payment_attach(p_member uuid, p_order uuid, p_rp_order text, p_amount bigint, p_actor text)
returns jsonb language plpgsql as $$
declare
  o public.orders%rowtype;
  op public.order_payments%rowtype;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order and member_id = p_member for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.status <> 'placed' then raise exception 'KH:BAD_TRANSITION:%>paid', o.status; end if;
  if o.pay_by is null or o.pay_by <= now() then raise exception 'KH:PAY_WINDOW_ENDED'; end if;
  -- The amount Razorpay holds must be exactly the order total stored here.
  if p_amount is distinct from o.total_paise then raise exception 'KH:INVALID'; end if;
  if exists (select 1 from public.order_payments where order_id = o.id and status = 'captured') then raise exception 'KH:ALREADY_PAID'; end if;

  select * into op from public.order_payments where order_id = o.id and status in ('authorized', 'created') order by (status = 'authorized') desc, created_at desc limit 1;
  if found then return jsonb_build_object('payment_id', op.id, 'rp_order_id', op.rp_order_id, 'reused', true); end if;

  insert into public.order_payments (order_id, rp_order_id, amount_paise, created_by)
  values (o.id, p_rp_order, o.total_paise, left(p_actor, 120)) returning id into v_id;
  insert into public.order_events (order_id, kind, note, actor)
  values (o.id, 'note', left('Payment requested through Razorpay: Rs ' || to_char(o.total_paise / 100.0, 'FM9999990.00'), 1000), left(p_actor, 120));
  return jsonb_build_object('payment_id', v_id, 'rp_order_id', p_rp_order, 'reused', false);
end $$;

-- ---- Apply one verified provider event (webhook, browser callback confirmed with Razorpay, or reconciliation) --------
-- Same behaviour as payments.sql. The only change: when an order moves to paid, the customer's saved bag is emptied.
-- (It is cleared only here, never at checkout, so a failed payment never costs a customer their bag.)
create or replace function public.payment_apply_event(
  p_event_id text, p_event text, p_rp_order text, p_rp_payment text, p_rp_refund text,
  p_amount bigint, p_method text, p_error_code text, p_error_note text
) returns text language plpgsql as $$
declare
  pay public.order_payments%rowtype;
  o public.orders%rowtype;
  v_out text;
begin
  insert into public.payment_events (rp_event_id, event, rp_order_id, rp_payment_id, outcome) values (p_event_id, p_event, p_rp_order, p_rp_payment, 'received')
  on conflict (rp_event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_event in ('refund.processed', 'refund.failed') then
    update public.order_refunds set gateway_status = case when p_event = 'refund.processed' then 'processed' else 'failed' end, updated_at = now()
     where gateway_refund_id = p_rp_refund;
    v_out := case when not found then 'refund_unknown' when p_event = 'refund.processed' then 'refund_processed' else 'refund_failed' end;
    update public.payment_events set outcome = v_out where rp_event_id = p_event_id;
    return v_out;
  end if;

  select * into pay from public.order_payments where rp_order_id = p_rp_order for update;
  if not found then
    update public.payment_events set outcome = 'unknown_order' where rp_event_id = p_event_id;
    return 'unknown_order';
  end if;

  if p_event = 'payment.authorized' then
    if pay.status = 'created' then update public.order_payments set status = 'authorized', rp_payment_id = coalesce(rp_payment_id, p_rp_payment), method = p_method, updated_at = now() where id = pay.id; end if;
    v_out := 'authorized';
  elsif p_event = 'payment.failed' then
    -- A later failed attempt never undoes a capture.
    if pay.status <> 'captured' then update public.order_payments set status = 'failed', method = p_method, error_code = left(p_error_code, 80), error_note = left(p_error_note, 200), updated_at = now() where id = pay.id; end if;
    v_out := 'failed';
  elsif p_event in ('payment.captured', 'order.paid') then
    if pay.status = 'captured' then
      v_out := 'captured';
    elsif p_amount is distinct from pay.amount_paise then
      update public.order_payments set flagged = 'amount_mismatch', rp_payment_id = coalesce(rp_payment_id, p_rp_payment), updated_at = now() where id = pay.id;
      v_out := 'amount_mismatch';
    else
      update public.order_payments set status = 'captured', rp_payment_id = coalesce(p_rp_payment, rp_payment_id), method = coalesce(p_method, method), captured_at = now(), error_code = null, error_note = null, updated_at = now() where id = pay.id;
      select * into o from public.orders where id = pay.order_id for update;
      if o.status = 'placed' then
        perform public.order_set_status(o.id, 'paid', 'razorpay');
        if o.member_id is not null then perform public.cart_clear(o.member_id); end if;
        v_out := 'captured';
      elsif o.status = 'paid' then
        v_out := 'captured';
      else
        -- Paid for an order that was cancelled (or has moved on): keep the money record and raise a flag for a person to refund.
        update public.order_payments set flagged = 'order_not_open' where id = pay.id;
        insert into public.order_events (order_id, kind, note, actor) values (o.id, 'note', 'Payment received through Razorpay after the order was ' || o.status || '. Needs a refund or a decision.', 'razorpay');
        v_out := 'order_not_open';
      end if;
    end if;
  else
    v_out := 'ignored';
  end if;
  update public.payment_events set outcome = v_out where rp_event_id = p_event_id;
  return v_out;
end $$;

-- ---- A customer cancels their own unpaid order ------------------------------------------------------------------------
-- Only while nothing has been paid or authorised. The held stock goes back on the shelf (order_set_status does the release).
create or replace function public.order_cancel_own(p_member uuid, p_order uuid)
returns text language plpgsql as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and member_id = p_member for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.status = 'cancelled' then return 'cancelled'; end if; -- repeating the request is harmless
  if o.status <> 'placed' then raise exception 'KH:BAD_TRANSITION:%>cancelled', o.status; end if;
  -- An authorised or captured payment means money may be moving: do not release the stock under it.
  if exists (select 1 from public.order_payments where order_id = o.id and status in ('authorized', 'captured')) then raise exception 'KH:PAYMENT_IN_PROGRESS'; end if;
  update public.order_payments set status = 'failed', error_code = 'cancelled', error_note = 'Order cancelled by the customer', updated_at = now() where order_id = o.id and status = 'created';
  perform public.order_set_status(o.id, 'cancelled', 'customer:' || p_member::text, null, null, 'Cancelled by the customer before payment');
  return 'cancelled';
end $$;

-- ---- Expiry: unpaid orders whose payment window has ended ---------------------------------------------------------------
-- Due = still "placed", pay_by passed more than p_grace_minutes ago. The grace lets a slow UPI approval finish.
-- Returns the order ids and any Razorpay order ids on them, so the server can ask Razorpay about each BEFORE releasing stock.
create or replace function public.orders_due_for_expiry(p_limit integer default 25, p_grace_minutes integer default 2)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select o.id as order_id, o.order_no,
           coalesce((select jsonb_agg(p.rp_order_id) from public.order_payments p where p.order_id = o.id and p.status <> 'captured'), '[]'::jsonb) as rp_orders
      from public.orders o
     where o.status = 'placed' and o.pay_by is not null and o.pay_by < now() - make_interval(mins => greatest(p_grace_minutes, 0))
       -- KH6-012: money may be moving under a recently authorised attempt, so the order is not due while it is fresh (24 hours).
       and not exists (select 1 from public.order_payments h where h.order_id = o.id and h.status = 'authorized' and h.updated_at > now() - interval '24 hours')
     order by o.pay_by asc
     limit least(greatest(p_limit, 1), 100)
  ) x;
$$;

-- Cancel one expired unpaid order and release its stock. Re-checks everything under the order lock, so a capture that landed
-- a moment ago wins. Returns 'expired', 'skipped' (no longer due), 'paid' (a capture exists) or 'held' (an attempt was authorised in
-- the last 24 hours, so money may be moving).
create or replace function public.order_expire(p_order uuid, p_actor text, p_grace_minutes integer default 2)
returns text language plpgsql as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.status <> 'placed' then return case when o.status = 'cancelled' then 'skipped' else 'paid' end; end if;
  if exists (select 1 from public.order_payments where order_id = o.id and status = 'captured') then return 'paid'; end if;
  if o.pay_by is null or o.pay_by >= now() - make_interval(mins => greatest(p_grace_minutes, 0)) then return 'skipped'; end if;
  -- KH6-012: a recently authorised attempt may still be captured. Hold the order and its stock; after 24 hours of silence it expires.
  if exists (select 1 from public.order_payments where order_id = o.id and status = 'authorized' and updated_at > now() - interval '24 hours') then return 'held'; end if;
  update public.order_payments set status = 'failed', error_code = 'expired', error_note = 'Payment window ended', updated_at = now() where order_id = o.id and status in ('created', 'authorized');
  perform public.order_set_status(o.id, 'cancelled', left(p_actor, 120), null, null, 'Payment window ended');
  return 'expired';
end $$;

-- ---- An ONLINE order becomes paid only when a captured payment exists (KH6-013) --------------------------------------------
-- Before this, any admin with the orders.write permission could move a customer's unpaid online order to "paid" by hand, and
-- it would then be packed and shipped with no money received. This guard sits on the table, so it covers every path.
-- payment_apply_event records the capture BEFORE it moves the order, so the normal route is unaffected. Manual orders (cash or
-- bank transfer taken by a person) are not online and can still be marked paid by an admin.
create or replace function public.orders_require_capture()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.channel = 'online'
     and not exists (select 1 from public.order_payments where order_id = new.id and status = 'captured') then
    raise exception 'KH:PAYMENT_REQUIRED';
  end if;
  return new;
end $$;
drop trigger if exists orders_require_capture on public.orders;
create trigger orders_require_capture before update of status on public.orders for each row execute function public.orders_require_capture();
revoke all on function public.orders_require_capture() from public, anon, authenticated;

-- ---- Lock everything down: only the server (service role) may call these ------------------------------------------------
revoke all on function public.payment_prepare(uuid, uuid) from public, anon, authenticated;
revoke all on function public.payment_attach(uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.payment_apply_event(text, text, text, text, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.order_cancel_own(uuid, uuid) from public, anon, authenticated;
revoke all on function public.orders_due_for_expiry(integer, integer) from public, anon, authenticated;
revoke all on function public.order_expire(uuid, text, integer) from public, anon, authenticated;
