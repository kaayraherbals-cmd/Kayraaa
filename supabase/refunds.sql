-- Refunds and returns record. Run in the Supabase SQL editor after inventory_orders.sql. Safe to run again.
-- This RECORDS who asked for a refund, why, how much, who decided it and the bank or gateway reference once it was paid.
-- It does not move money and is not connected to a payment gateway. Returned goods are NOT put back into stock automatically:
-- herbal products need a person to check the seal, batch and expiry first (use Inventory > receive or adjust afterwards).
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('refund_only', 'return_and_refund')),
  reason_code text not null check (reason_code in ('damaged', 'wrong_item', 'not_delivered', 'expired_on_arrival', 'quality_concern', 'health_concern', 'duplicate_payment', 'changed_mind', 'other')),
  reason_note text not null check (char_length(reason_note) between 3 and 500),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'refunded')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  refunded_by text,
  refunded_at timestamptz,
  payment_ref text check (payment_ref is null or char_length(payment_ref) between 4 and 80),
  goods_received boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on public.order_refunds (order_id);
create index if not exists order_refunds_status_idx on public.order_refunds (status, requested_at desc);

-- Request: only for an order that was paid at some point, and never more than the order total across all live refunds.
create or replace function public.refund_create(p_order uuid, p_kind text, p_reason text, p_note text, p_amount bigint, p_actor text)
returns uuid language plpgsql as $$
declare
  o public.orders%rowtype;
  v_committed bigint;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'KH:INVALID'; end if;
  if not exists (select 1 from public.order_events where order_id = p_order and kind = 'status' and to_status = 'paid') then
    raise exception 'KH:NOT_PAID';
  end if;
  select coalesce(sum(amount_paise), 0) into v_committed from public.order_refunds where order_id = p_order and status in ('requested', 'approved', 'refunded');
  if v_committed + p_amount > o.total_paise then
    raise exception 'KH:REFUND_EXCEEDS:%', o.total_paise - v_committed;
  end if;
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, requested_by)
  values (p_order, p_kind, p_reason, p_note, p_amount, p_actor) returning id into v_id;
  insert into public.order_events (order_id, kind, note, actor)
  values (p_order, 'note', left('Refund requested: Rs ' || to_char(p_amount / 100.0, 'FM9999990.00') || ' (' || p_reason || ')', 1000), p_actor);
  return v_id;
end $$;

-- Decide and pay: requested -> approved or rejected; approved -> refunded or rejected. Rejecting needs a reason; refunding needs the payment reference.
create or replace function public.refund_set_status(p_refund uuid, p_to text, p_actor text, p_note text, p_payment_ref text, p_goods boolean)
returns void language plpgsql as $$
declare
  r public.order_refunds%rowtype;
begin
  select * into r from public.order_refunds where id = p_refund for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if not (
    (r.status = 'requested' and p_to in ('approved', 'rejected')) or
    (r.status = 'approved' and p_to in ('refunded', 'rejected'))
  ) then
    raise exception 'KH:REFUND_BAD_TRANSITION:%>%', r.status, p_to;
  end if;
  if p_to = 'rejected' and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'KH:INVALID'; end if;
  if p_to = 'refunded' and char_length(trim(coalesce(p_payment_ref, ''))) < 4 then raise exception 'KH:INVALID'; end if;
  update public.order_refunds set
    status = p_to,
    decided_by = case when p_to in ('approved', 'rejected') then p_actor else decided_by end,
    decided_at = case when p_to in ('approved', 'rejected') then now() else decided_at end,
    decision_note = case when p_to in ('approved', 'rejected') then nullif(left(trim(coalesce(p_note, '')), 500), '') else decision_note end,
    refunded_by = case when p_to = 'refunded' then p_actor else refunded_by end,
    refunded_at = case when p_to = 'refunded' then now() else refunded_at end,
    payment_ref = case when p_to = 'refunded' then trim(p_payment_ref) else payment_ref end,
    goods_received = case when p_to = 'refunded' and r.kind = 'return_and_refund' then coalesce(p_goods, false) else goods_received end,
    updated_at = now()
   where id = p_refund;
  insert into public.order_events (order_id, kind, note, actor)
  values (r.order_id, 'note', left('Refund of Rs ' || to_char(r.amount_paise / 100.0, 'FM9999990.00') || ' ' || p_to, 1000), p_actor);
end $$;

alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from anon, authenticated;
revoke all on function public.refund_create(uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.refund_set_status(uuid, text, text, text, text, boolean) from public, anon, authenticated;
