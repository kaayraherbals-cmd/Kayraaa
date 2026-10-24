-- Run once in the Supabase SQL editor, AFTER variants_gallery.sql. Safe to run again.
-- Adds: stock by batch with expiry, an append-only stock ledger, orders with items and batch allocations, and the database
-- functions that change stock. Every stock change happens inside one of these functions, in one transaction, with the batch
-- rows locked, so two people (or two orders) can never sell the same unit and stock can never go below zero.
-- Server-only: RLS on, no public policies, functions not callable by anon or authenticated.
-- Selling is still switched off in the application (COMMERCE_ENABLED = false). Nothing here makes anything public.

-- ---- Batches -------------------------------------------------------------------------------------------------
create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  batch_no text not null check (batch_no ~ '^[A-Z0-9][A-Z0-9/_.-]{0,39}$'),
  mfg_date date,
  expiry_date date not null,
  qty_received integer not null check (qty_received > 0 and qty_received <= 1000000),
  qty_on_hand integer not null check (qty_on_hand >= 0),
  qty_reserved integer not null default 0 check (qty_reserved >= 0),
  status text not null default 'active' check (status in ('active', 'quarantine', 'recalled', 'closed')),
  note text check (note is null or char_length(note) <= 200),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (variant_id, batch_no),
  constraint batch_reserved_within_on_hand check (qty_reserved <= qty_on_hand),
  constraint batch_dates check (mfg_date is null or mfg_date < expiry_date)
);
create index if not exists inventory_batches_variant_expiry_idx on public.inventory_batches (variant_id, expiry_date);

-- ---- Orders --------------------------------------------------------------------------------------------------
create sequence if not exists public.order_no_seq start 1;

create or replace function public.next_order_no() returns text language sql as $$
  select 'KH-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0')
$$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^KH-\d{4}-\d{6,}$'),
  status text not null default 'placed' check (status in ('placed', 'paid', 'packed', 'shipped', 'delivered', 'cancelled')),
  channel text not null default 'manual' check (channel in ('manual', 'online')),
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  customer_phone text check (customer_phone is null or customer_phone ~ '^\+?\d{7,15}$'),
  ship_address text not null check (char_length(ship_address) between 8 and 400),
  ship_pincode text not null check (ship_pincode ~ '^[1-9]\d{5}$'),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  shipping_paise integer not null default 0 check (shipping_paise between 0 and 1000000),
  total_paise bigint not null check (total_paise >= 0),
  courier text check (courier is null or char_length(courier) <= 60),
  tracking_no text check (tracking_no is null or char_length(tracking_no) <= 60),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  internal_note text check (internal_note is null or char_length(internal_note) <= 500),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);

-- A snapshot of what was sold: names, pack size, SKU, price and tax as they were on the day.
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null,
  pack_size text not null,
  sku text not null,
  qty integer not null check (qty between 1 and 100),
  unit_price_paise integer not null check (unit_price_paise > 0),
  gst_rate numeric(5,2),
  hsn_code text,
  line_total_paise bigint not null check (line_total_paise > 0)
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- Which batch(es) each line was reserved from, with the batch number and expiry as they were.
create table if not exists public.order_allocations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  batch_no text not null,
  expiry_date date not null,
  qty integer not null check (qty > 0)
);
create index if not exists order_allocations_item_idx on public.order_allocations (order_item_id);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('created', 'status', 'note', 'tracking')),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 1000),
  actor text not null,
  at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, at);

-- ---- Stock ledger (append-only) ------------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  kind text not null check (kind in ('receive', 'adjust', 'write_off', 'reserve', 'release', 'ship')),
  delta_on_hand integer not null default 0,
  delta_reserved integer not null default 0,
  reason text check (reason is null or char_length(reason) <= 200),
  order_id uuid references public.orders(id) on delete restrict,
  actor text not null,
  at timestamptz not null default now()
);
create index if not exists inventory_movements_batch_idx on public.inventory_movements (batch_id, at desc);
create index if not exists inventory_movements_variant_idx on public.inventory_movements (variant_id, at desc);

create or replace function public.inventory_movements_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'inventory_movements is append-only';
end $$;
drop trigger if exists inventory_movements_no_change on public.inventory_movements;
create trigger inventory_movements_no_change before update or delete on public.inventory_movements for each row execute function public.inventory_movements_immutable();

-- ---- Stock functions -----------------------------------------------------------------------------------------
-- Errors are raised as 'KH:<CODE>:<detail>'; the application turns them into plain language.

create or replace function public.inventory_receive(p_variant uuid, p_batch_no text, p_mfg date, p_expiry date, p_qty integer, p_note text, p_actor text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.product_variants where id = p_variant) then raise exception 'KH:NOT_FOUND'; end if;
  if p_qty is null or p_qty < 1 or p_expiry is null then raise exception 'KH:INVALID'; end if;
  if p_expiry <= (now() at time zone 'Asia/Kolkata')::date then raise exception 'KH:INVALID'; end if;
  insert into public.inventory_batches (variant_id, batch_no, mfg_date, expiry_date, qty_received, qty_on_hand, note, created_by)
  values (p_variant, p_batch_no, p_mfg, p_expiry, p_qty, p_qty, p_note, p_actor)
  returning id into v_id;
  insert into public.inventory_movements (batch_id, variant_id, kind, delta_on_hand, reason, actor)
  values (v_id, p_variant, 'receive', p_qty, p_note, p_actor);
  return v_id;
end $$;

create or replace function public.inventory_adjust(p_batch uuid, p_delta integer, p_kind text, p_reason text, p_actor text)
returns void language plpgsql as $$
declare b public.inventory_batches%rowtype;
begin
  if p_kind not in ('adjust', 'write_off') or p_delta is null or p_delta = 0 then raise exception 'KH:INVALID'; end if;
  if p_kind = 'write_off' and p_delta > 0 then raise exception 'KH:INVALID'; end if;
  select * into b from public.inventory_batches where id = p_batch for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if b.status = 'closed' then raise exception 'KH:BATCH_CLOSED'; end if;
  -- Stock can never drop below zero or below what open orders have reserved.
  if b.qty_on_hand + p_delta < b.qty_reserved then raise exception 'KH:NEGATIVE_STOCK'; end if;
  update public.inventory_batches set qty_on_hand = qty_on_hand + p_delta, updated_at = now() where id = p_batch;
  insert into public.inventory_movements (batch_id, variant_id, kind, delta_on_hand, reason, actor)
  values (p_batch, b.variant_id, p_kind, p_delta, p_reason, p_actor);
end $$;

create or replace function public.inventory_set_status(p_batch uuid, p_status text, p_actor text)
returns void language plpgsql as $$
declare b public.inventory_batches%rowtype;
begin
  if p_status not in ('active', 'quarantine', 'recalled', 'closed') then raise exception 'KH:INVALID'; end if;
  select * into b from public.inventory_batches where id = p_batch for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  -- Taking a batch out of use while open orders still hold units from it would ship from the wrong batch.
  if p_status <> 'active' and b.qty_reserved > 0 then raise exception 'KH:RESERVED_STOCK'; end if;
  update public.inventory_batches set status = p_status, updated_at = now() where id = p_batch;
end $$;

-- Creates an order and reserves stock first-expiry-first-out from active, in-date batches, all or nothing.
-- p_order: {customer_name, customer_email, customer_phone, ship_address, ship_pincode, shipping_paise, note, items:[{variant_id, qty}]}
-- Prices come from the variant row, never from the caller.
create or replace function public.order_create(p_order jsonb, p_actor text, p_min_days integer default 30)
returns uuid language plpgsql as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_shipping integer := coalesce((p_order ->> 'shipping_paise')::integer, 0);
  v_item jsonb;
  v_var record;
  v_item_id uuid;
  v_need integer;
  v_take integer;
  v_batch record;
  v_subtotal bigint := 0;
  v_label text;
begin
  if jsonb_typeof(p_order -> 'items') <> 'array' or jsonb_array_length(p_order -> 'items') = 0 then raise exception 'KH:INVALID'; end if;

  insert into public.orders (id, order_no, customer_name, customer_email, customer_phone, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, internal_note, created_by)
  values (v_order_id, public.next_order_no(), p_order ->> 'customer_name', nullif(p_order ->> 'customer_email', ''), nullif(p_order ->> 'customer_phone', ''),
          p_order ->> 'ship_address', p_order ->> 'ship_pincode', 0, v_shipping, v_shipping, nullif(p_order ->> 'note', ''), p_actor);

  -- Process lines in a fixed order so two orders touching the same products lock rows in the same order (no deadlocks).
  for v_item in select e.value from jsonb_array_elements(p_order -> 'items') as e order by e.value ->> 'variant_id' loop
    select v.id, v.sku, v.pack_size, v.price_paise, v.gst_rate, v.hsn_code, v.status as variant_status,
           p.status as product_status, coalesce(p.public_name, p.internal_name) as product_name
      into v_var
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (v_item ->> 'variant_id')::uuid;
    if not found then raise exception 'KH:NOT_FOUND'; end if;
    v_label := v_var.product_name || ' ' || v_var.pack_size;
    if v_var.product_status <> 'APPROVED_FOR_SALE' then raise exception 'KH:NOT_FOR_SALE:%', v_var.product_name; end if;
    if v_var.variant_status <> 'active' then raise exception 'KH:VARIANT_INACTIVE:%', v_label; end if;
    if v_var.price_paise is null then raise exception 'KH:NO_PRICE:%', v_label; end if;

    v_need := (v_item ->> 'qty')::integer;
    if v_need is null or v_need < 1 or v_need > 100 then raise exception 'KH:INVALID'; end if;

    v_item_id := gen_random_uuid();
    insert into public.order_items (id, order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, gst_rate, hsn_code, line_total_paise)
    values (v_item_id, v_order_id, v_var.id, v_var.product_name, v_var.pack_size, v_var.sku, v_need, v_var.price_paise, v_var.gst_rate, v_var.hsn_code, v_var.price_paise::bigint * v_need);
    v_subtotal := v_subtotal + v_var.price_paise::bigint * v_need;

    for v_batch in
      select id, batch_no, expiry_date, qty_on_hand - qty_reserved as free
        from public.inventory_batches
       where variant_id = v_var.id and status = 'active'
         and expiry_date >= v_today + p_min_days
         and qty_on_hand - qty_reserved > 0
       order by expiry_date asc, created_at asc
       for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_batch.free);
      update public.inventory_batches set qty_reserved = qty_reserved + v_take, updated_at = now() where id = v_batch.id;
      insert into public.order_allocations (order_item_id, batch_id, batch_no, expiry_date, qty)
      values (v_item_id, v_batch.id, v_batch.batch_no, v_batch.expiry_date, v_take);
      insert into public.inventory_movements (batch_id, variant_id, kind, delta_reserved, order_id, actor)
      values (v_batch.id, v_var.id, 'reserve', v_take, v_order_id, p_actor);
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception 'KH:INSUFFICIENT_STOCK:%|%', v_label, (v_item ->> 'qty')::integer - v_need;
    end if;
  end loop;

  update public.orders set subtotal_paise = v_subtotal, total_paise = v_subtotal + v_shipping where id = v_order_id;
  insert into public.order_events (order_id, kind, to_status, note, actor) values (v_order_id, 'created', 'placed', nullif(p_order ->> 'note', ''), p_actor);
  return v_order_id;
end $$;

-- Moves an order along placed > paid > packed > shipped > delivered, or cancels it before it ships.
-- Cancelling releases the reserved units; shipping takes them off the shelf.
create or replace function public.order_set_status(p_order uuid, p_to text, p_actor text, p_courier text default null, p_tracking text default null, p_reason text default null)
returns void language plpgsql as $$
declare
  o public.orders%rowtype;
  a record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_note text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if not (
    (o.status = 'placed' and p_to in ('paid', 'cancelled')) or
    (o.status = 'paid' and p_to in ('packed', 'cancelled')) or
    (o.status = 'packed' and p_to in ('shipped', 'cancelled')) or
    (o.status = 'shipped' and p_to = 'delivered')
  ) then
    raise exception 'KH:BAD_TRANSITION:%>%', o.status, p_to;
  end if;

  if p_to = 'shipped' then
    -- Never ship a unit from a batch that has expired, or been recalled or quarantined, since it was reserved.
    select b.batch_no into a
      from public.order_allocations al
      join public.order_items oi on oi.id = al.order_item_id
      join public.inventory_batches b on b.id = al.batch_id
     where oi.order_id = p_order and (b.expiry_date < v_today or b.status <> 'active')
     limit 1;
    if found then raise exception 'KH:EXPIRED_ALLOCATION:%', a.batch_no; end if;
  end if;

  if p_to in ('cancelled', 'shipped') then
    for a in
      select al.batch_id, al.qty, b.variant_id
        from public.order_allocations al
        join public.order_items oi on oi.id = al.order_item_id
        join public.inventory_batches b on b.id = al.batch_id
       where oi.order_id = p_order
       order by al.batch_id
         for update of b
    loop
      if p_to = 'cancelled' then
        update public.inventory_batches set qty_reserved = qty_reserved - a.qty, updated_at = now() where id = a.batch_id;
        insert into public.inventory_movements (batch_id, variant_id, kind, delta_reserved, reason, order_id, actor)
        values (a.batch_id, a.variant_id, 'release', -a.qty, left(p_reason, 200), p_order, p_actor);
      else
        update public.inventory_batches set qty_on_hand = qty_on_hand - a.qty, qty_reserved = qty_reserved - a.qty, updated_at = now() where id = a.batch_id;
        insert into public.inventory_movements (batch_id, variant_id, kind, delta_on_hand, delta_reserved, order_id, actor)
        values (a.batch_id, a.variant_id, 'ship', -a.qty, -a.qty, p_order, p_actor);
      end if;
    end loop;
  end if;

  v_note := case when p_to = 'shipped' then left(trim(coalesce(p_courier, '') || ' ' || coalesce(p_tracking, '')), 1000)
                 when p_to = 'cancelled' then left(p_reason, 1000) end;
  update public.orders set
    status = p_to,
    courier = case when p_to = 'shipped' then p_courier else courier end,
    tracking_no = case when p_to = 'shipped' then p_tracking else tracking_no end,
    cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end,
    updated_at = now()
   where id = p_order;
  insert into public.order_events (order_id, kind, from_status, to_status, note, actor) values (p_order, 'status', o.status, p_to, v_note, p_actor);
end $$;

-- ---- Lock everything down ------------------------------------------------------------------------------------
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_allocations enable row level security;
alter table public.order_events enable row level security;
revoke all on public.inventory_batches, public.inventory_movements, public.orders, public.order_items, public.order_allocations, public.order_events from anon, authenticated;
revoke all on function public.inventory_receive(uuid, text, date, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.inventory_adjust(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.inventory_set_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.order_create(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.order_set_status(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.next_order_no() from public, anon, authenticated;
