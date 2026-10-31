-- Razorpay payments. Run in the Supabase SQL editor after inventory_orders.sql and refunds.sql. Safe to run again.
-- NOTE: payments_checkout.sql REPLACES payment_apply_event (it adds clearing the bag on payment). If you ever re-run this file, run
-- payments_checkout.sql again straight afterwards, or the bag will no longer be cleared when an order is paid.
-- Money is NEVER trusted from the browser: the amount to collect is always the order total stored here, and a payment only
-- marks an order paid when Razorpay's signed webhook reports a capture for exactly that amount.
-- Nothing here is reachable while selling is off: orders cannot be created (COMMERCE_ENABLED = false), so there is nothing to pay.
create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  rp_order_id text not null unique check (char_length(rp_order_id) between 6 and 64),
  rp_payment_id text unique check (rp_payment_id is null or char_length(rp_payment_id) between 6 and 64),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'created' check (status in ('created', 'authorized', 'captured', 'failed')),
  method text check (method is null or char_length(method) <= 30),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_note text check (error_note is null or char_length(error_note) <= 200),
  -- Something a person must look at: the money and the order disagree.
  flagged text check (flagged is null or flagged in ('amount_mismatch', 'order_not_open')),
  created_by text not null,
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists order_payments_order_idx on public.order_payments (order_id);
create index if not exists order_payments_flagged_idx on public.order_payments (flagged) where flagged is not null;

-- Every webhook delivery, once. The primary key is Razorpay's event id, which makes redelivery harmless (idempotent).
create table if not exists public.payment_events (
  rp_event_id text primary key check (char_length(rp_event_id) between 6 and 100),
  event text not null check (char_length(event) <= 60),
  rp_order_id text,
  rp_payment_id text,
  outcome text not null default 'received',
  received_at timestamptz not null default now()
);

-- Gateway refunds: the Razorpay refund id is saved BEFORE the refund is marked done, so a retry never pays twice.
alter table public.order_refunds add column if not exists gateway_refund_id text unique;
alter table public.order_refunds add column if not exists gateway_status text check (gateway_status is null or gateway_status in ('created', 'processed', 'failed'));

-- Start collecting for an order: only for an order still at "placed", for its full total, with no payment already captured.
create or replace function public.payment_create(p_order uuid, p_rp_order text, p_actor text)
returns uuid language plpgsql as $$
declare
  o public.orders%rowtype;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.status <> 'placed' then raise exception 'KH:BAD_TRANSITION:%>paid', o.status; end if;
  if o.total_paise <= 0 then raise exception 'KH:INVALID'; end if;
  if exists (select 1 from public.order_payments where order_id = p_order and status = 'captured') then raise exception 'KH:INVALID'; end if;
  insert into public.order_payments (order_id, rp_order_id, amount_paise, created_by)
  values (p_order, p_rp_order, o.total_paise, p_actor) returning id into v_id;
  insert into public.order_events (order_id, kind, note, actor)
  values (p_order, 'note', left('Payment requested through Razorpay: Rs ' || to_char(o.total_paise / 100.0, 'FM9999990.00'), 1000), p_actor);
  return v_id;
end $$;

-- Apply one verified webhook event. Returns what happened: duplicate, unknown_order, ignored, authorized, failed, captured,
-- amount_mismatch, order_not_open, refund_processed, refund_failed, refund_unknown.
create or replace function public.payment_apply_event(
  p_event_id text, p_event text, p_rp_order text, p_rp_payment text, p_rp_refund text,
  p_amount bigint, p_method text, p_error_code text, p_error_note text
) returns text language plpgsql as $$
declare
  pay public.order_payments%rowtype;
  o public.orders%rowtype;
  v_out text;
begin
  insert into public.payment_events (rp_event_id, event, rp_order_id, rp_payment_id) values (p_event_id, p_event, p_rp_order, p_rp_payment)
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

alter table public.order_payments enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.order_payments, public.payment_events from anon, authenticated;
revoke all on function public.payment_create(uuid, text, text) from public, anon, authenticated;
revoke all on function public.payment_apply_event(text, text, text, text, text, bigint, text, text, text) from public, anon, authenticated;
