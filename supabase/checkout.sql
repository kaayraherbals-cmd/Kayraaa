-- Checkout. Run in the Supabase SQL editor AFTER inventory_orders.sql, carts.sql and payments.sql. Safe to run again.
-- Nothing here opens selling: the API refuses every checkout request unless FEATURE_CHECKOUT_TESTING is on (never in production)
-- or COMMERCE_ENABLED is true in code. Orders made while commerce is off are marked is_test.
-- This file has NOT been run on a database. Run supabase/checkout_selftest.sql after it, on staging, before trusting it.

-- ---- Orders: who owns it, whether it is a test, how long unpaid stock is held ------------------------------------
alter table public.orders add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.orders add column if not exists is_test boolean not null default false;
alter table public.orders add column if not exists pay_by timestamptz;
create index if not exists orders_member_created_idx on public.orders (member_id, created_at desc) where member_id is not null;
create index if not exists orders_unpaid_hold_idx on public.orders (pay_by) where status = 'placed' and pay_by is not null;

-- ---- Where we can deliver, and what it costs. Empty by default: no PIN code is serviceable until someone adds it. ----
-- Section 6 puts a courier provider behind the same shape. Rates are in paise and include any tax (see shared/checkout.ts).
create table if not exists public.shipping_pincodes (
  pincode text primary key check (pincode ~ '^[1-9]\d{5}$'),
  active boolean not null default true,
  rate_paise integer not null check (rate_paise between 0 and 1000000),
  free_above_paise bigint check (free_above_paise is null or free_above_paise > 0),
  updated_at timestamptz not null default now()
);

-- ---- One row per checkout submission. The unique key is what makes a double-click or a retry harmless. ------------
create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (char_length(request_hash) between 16 and 128),
  order_id uuid not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (member_id, idempotency_key)
);
create index if not exists checkout_attempts_hash_idx on public.checkout_attempts (member_id, request_hash, created_at desc);

-- ---- Place an order for a signed-in member, all or nothing ----------------------------------------------------------
-- p_order is the same shape order_create takes (names, address, shipping_paise, items). Prices come from the variant rows
-- inside order_create. p_expected_total is the total the customer was shown: if the price moved since, nothing is created.
-- Returns {order_id, replay}. replay is true when this submission (or the same contents, still unpaid) already has an order.
create or replace function public.checkout_place(
  p_member uuid, p_key uuid, p_hash text, p_order jsonb, p_expected_total bigint, p_test boolean, p_hold_minutes integer default 30, p_min_days integer default 30
) returns jsonb language plpgsql as $$
declare
  a public.checkout_attempts%rowtype;
  v_order uuid;
  v_total bigint;
  v_open integer;
begin
  if p_member is null or p_key is null or p_hash is null then raise exception 'KH:INVALID'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'KH:NOT_FOUND'; end if;

  -- One checkout at a time per member. Two tabs or a double tap queue here instead of racing.
  perform pg_advisory_xact_lock(hashtextextended('checkout:' || p_member::text, 0));

  select * into a from public.checkout_attempts where member_id = p_member and idempotency_key = p_key;
  if found then
    if a.request_hash <> p_hash then raise exception 'KH:IDEMPOTENCY_MISMATCH'; end if;
    return jsonb_build_object('order_id', a.order_id, 'replay', true);
  end if;

  -- Same contents, and an unpaid order for them is still holding stock: return it rather than reserving twice.
  select ca.* into a
    from public.checkout_attempts ca join public.orders o on o.id = ca.order_id
   where ca.member_id = p_member and ca.request_hash = p_hash and o.status = 'placed' and o.pay_by is not null and o.pay_by > now()
   order by ca.created_at desc limit 1;
  if found then
    insert into public.checkout_attempts (member_id, idempotency_key, request_hash, order_id) values (p_member, p_key, p_hash, a.order_id);
    return jsonb_build_object('order_id', a.order_id, 'replay', true);
  end if;

  -- A member cannot hold the shelf with a pile of unpaid orders.
  select count(*) into v_open from public.orders where member_id = p_member and status = 'placed' and pay_by > now();
  if v_open >= 3 then raise exception 'KH:TOO_MANY_OPEN'; end if;

  if not exists (select 1 from public.shipping_pincodes where pincode = p_order ->> 'ship_pincode' and active) then raise exception 'KH:NOT_SERVICEABLE'; end if;

  v_order := public.order_create(p_order, 'customer:' || p_member::text, p_min_days);

  select total_paise into v_total from public.orders where id = v_order;
  if v_total is distinct from p_expected_total then raise exception 'KH:PRICE_CHANGED'; end if;

  update public.orders set member_id = p_member, channel = 'online', is_test = p_test, pay_by = now() + make_interval(mins => p_hold_minutes) where id = v_order;
  insert into public.checkout_attempts (member_id, idempotency_key, request_hash, order_id) values (p_member, p_key, p_hash, v_order);
  return jsonb_build_object('order_id', v_order, 'replay', false);
end $$;

-- ---- Lock everything down: only the server (service role) touches these -------------------------------------------
alter table public.shipping_pincodes enable row level security;
alter table public.checkout_attempts enable row level security;
revoke all on public.shipping_pincodes, public.checkout_attempts from anon, authenticated;
revoke all on function public.checkout_place(uuid, uuid, text, jsonb, bigint, boolean, integer, integer) from public, anon, authenticated;
