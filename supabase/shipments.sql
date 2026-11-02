-- Phase 7 Step 2: shipments. ADDITIVE and safe to run again. Needs inventory_orders.sql (12), checkout.sql (16) and
-- payments_checkout.sql (17). NOT YET RUN on any database (no database was available when this was written).
--
-- Provider-independent: courier is free text and every tracking event records its source ('manual' now, a courier adapter later).
-- No courier API is connected. Nothing here invents tracking events: an event exists only because an admin (or later a verified
-- provider callback) recorded it.
--
-- Stock rule (unchanged): stock leaves the shelf once, when the ORDER moves to 'shipped' (order_set_status). That happens
-- automatically when the dispatched shipments cover every unit of the order. Partial shipments therefore do not touch stock
-- until the last unit is dispatched. A return to origin does NOT restock automatically: restocking is a manual inventory
-- adjustment after the goods are inspected.

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  shipment_no text not null unique,
  status text not null default 'pending' check (status in (
    'pending', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'return_to_origin', 'returned', 'cancelled')),
  courier text check (courier is null or char_length(courier) between 1 and 60),
  tracking_no text check (tracking_no is null or char_length(tracking_no) between 1 and 60),
  provider text not null default 'manual' check (provider in ('manual')),
  estimated_delivery date,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_order_idx on public.shipments (order_id);
create index if not exists shipments_status_idx on public.shipments (status, updated_at desc);

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  qty integer not null check (qty between 1 and 100),
  unique (shipment_id, order_item_id)
);
create index if not exists shipment_items_item_idx on public.shipment_items (order_item_id);

-- Append-only status history and tracking events. `visible` controls whether the customer may see the note.
create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  kind text not null check (kind in ('created', 'status', 'note')),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 500),
  location text check (location is null or char_length(location) <= 120),
  source text not null default 'manual' check (source in ('manual')),
  visible boolean not null default true,
  occurred_at timestamptz not null default now(),
  actor text not null,
  recorded_at timestamptz not null default now()
);
create index if not exists shipment_events_ship_idx on public.shipment_events (shipment_id, occurred_at);

create table if not exists public.delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  kind text not null check (kind in ('address_issue', 'recipient_unavailable', 'refused', 'damaged', 'lost', 'other')),
  note text check (note is null or char_length(note) <= 500),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  check ((resolved_at is null) = (resolved_by is null))
);
create index if not exists delivery_exceptions_open_idx on public.delivery_exceptions (opened_at desc) where resolved_at is null;

create sequence if not exists public.shipment_no_seq;

-- History can never be edited or removed.
create or replace function public.shipment_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'shipment_events is append-only';
end $$;
drop trigger if exists shipment_events_no_change on public.shipment_events;
create trigger shipment_events_no_change before update or delete on public.shipment_events
  for each row execute function public.shipment_events_append_only();

-- The only legal moves. delivered, returned and cancelled are final.
create or replace function public.shipment_transition_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('pending', 'dispatched'), ('pending', 'cancelled'),
    ('dispatched', 'in_transit'), ('dispatched', 'out_for_delivery'), ('dispatched', 'delivered'), ('dispatched', 'delivery_failed'),
    ('in_transit', 'out_for_delivery'), ('in_transit', 'delivered'), ('in_transit', 'delivery_failed'), ('in_transit', 'return_to_origin'),
    ('out_for_delivery', 'delivered'), ('out_for_delivery', 'delivery_failed'),
    ('delivery_failed', 'out_for_delivery'), ('delivery_failed', 'return_to_origin'),
    ('return_to_origin', 'returned')
  );
$$;

-- Creates a pending shipment for a PACKED order. p_items: [{"order_item_id": uuid, "qty": n}, ...]. Quantity already placed in a
-- live (not cancelled) shipment cannot be shipped twice.
create or replace function public.shipment_create(p_order uuid, p_items jsonb, p_actor text)
returns uuid language plpgsql as $$
declare
  o public.orders%rowtype;
  v_id uuid;
  it record;
  v_left integer;
  v_no text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.status <> 'packed' then raise exception 'KH:BAD_STATE:order must be packed to create a shipment'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'KH:INVALID:no items'; end if;

  v_no := 'SH-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.shipment_no_seq')::text, 6, '0');
  insert into public.shipments (order_id, shipment_no, created_by) values (p_order, v_no, left(p_actor, 120)) returning id into v_id;

  for it in select (e ->> 'order_item_id')::uuid as item_id, (e ->> 'qty')::integer as qty from jsonb_array_elements(p_items) e loop
    if it.qty is null or it.qty < 1 then raise exception 'KH:INVALID:bad quantity'; end if;
    select oi.qty - coalesce((select sum(si.qty) from public.shipment_items si join public.shipments s on s.id = si.shipment_id
                               where si.order_item_id = oi.id and s.status <> 'cancelled' and s.id <> v_id), 0)
      into v_left from public.order_items oi where oi.id = it.item_id and oi.order_id = p_order;
    if v_left is null then raise exception 'KH:INVALID:item is not on this order'; end if;
    if it.qty > v_left then raise exception 'KH:INVALID:more than is left to ship'; end if;
    insert into public.shipment_items (shipment_id, order_item_id, qty) values (v_id, it.item_id, it.qty);
  end loop;

  insert into public.shipment_events (shipment_id, kind, to_status, actor) values (v_id, 'created', 'pending', left(p_actor, 120));
  return v_id;
end $$;

-- Moves a shipment along its legal path. Dispatch needs a courier and a tracking number. delivery_failed opens an exception.
-- When dispatched shipments cover every unit, the order moves packed > shipped (this is where stock leaves the shelf).
-- When every live shipment is delivered, the order moves shipped > delivered.
create or replace function public.shipment_set_status(
  p_shipment uuid, p_to text, p_actor text,
  p_courier text default null, p_tracking text default null, p_note text default null, p_location text default null,
  p_estimated date default null, p_exception text default null, p_visible boolean default true, p_at timestamptz default now())
returns void language plpgsql as $$
declare
  s public.shipments%rowtype;
  o public.orders%rowtype;
  v_unshipped integer;
  v_live integer;
  v_open integer;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if not public.shipment_transition_ok(s.status, p_to) then raise exception 'KH:SHIPMENT_BAD_TRANSITION:%>%', s.status, p_to; end if;
  if p_at > now() + interval '5 minutes' then raise exception 'KH:INVALID:event time is in the future'; end if;

  select * into o from public.orders where id = s.order_id for update;

  if p_to = 'dispatched' then
    if o.status <> 'packed' and o.status <> 'shipped' then raise exception 'KH:BAD_STATE:order is not packed'; end if;
    if coalesce(trim(p_courier), '') = '' or coalesce(trim(p_tracking), '') = '' then raise exception 'KH:INVALID:courier and tracking number are required'; end if;
  end if;
  if p_to = 'delivery_failed' and (p_exception is null or p_exception not in ('address_issue', 'recipient_unavailable', 'refused', 'damaged', 'lost', 'other')) then
    raise exception 'KH:INVALID:a failed delivery needs a reason';
  end if;

  update public.shipments set
    status = p_to,
    courier = case when p_to = 'dispatched' then left(trim(p_courier), 60) else courier end,
    tracking_no = case when p_to = 'dispatched' then left(trim(p_tracking), 60) else tracking_no end,
    estimated_delivery = coalesce(p_estimated, estimated_delivery),
    dispatched_at = case when p_to = 'dispatched' then p_at else dispatched_at end,
    delivered_at = case when p_to = 'delivered' then p_at else delivered_at end,
    updated_at = now()
   where id = p_shipment;

  insert into public.shipment_events (shipment_id, kind, from_status, to_status, note, location, visible, occurred_at, actor)
  values (p_shipment, 'status', s.status, p_to, left(p_note, 500), left(p_location, 120), coalesce(p_visible, true), p_at, left(p_actor, 120));

  if p_to = 'delivery_failed' then
    insert into public.delivery_exceptions (shipment_id, kind, note, opened_by) values (p_shipment, p_exception, left(p_note, 500), left(p_actor, 120));
  end if;
  -- A successful delivery or a return closes any open exception on this shipment.
  if p_to in ('delivered', 'returned', 'out_for_delivery') then
    update public.delivery_exceptions set resolved_at = now(), resolved_by = left(p_actor, 120) where shipment_id = p_shipment and resolved_at is null;
  end if;

  if p_to = 'dispatched' and o.status = 'packed' then
    select coalesce(sum(oi.qty - coalesce((select sum(si.qty) from public.shipment_items si join public.shipments x on x.id = si.shipment_id
                                           where si.order_item_id = oi.id and x.status not in ('pending', 'cancelled')), 0)), 0)
      into v_unshipped from public.order_items oi where oi.order_id = o.id;
    if v_unshipped = 0 then
      perform public.order_set_status(o.id, 'shipped', p_actor, left(trim(p_courier), 60), left(trim(p_tracking), 60), null);
    end if;
  end if;

  if p_to = 'delivered' then
    select count(*) filter (where status <> 'cancelled'), count(*) filter (where status not in ('cancelled', 'delivered'))
      into v_live, v_open from public.shipments where order_id = o.id;
    select status into o.status from public.orders where id = o.id;
    if o.status = 'shipped' and v_live > 0 and v_open = 0 then
      perform public.order_set_status(o.id, 'delivered', p_actor);
    end if;
  end if;
end $$;

create or replace function public.shipment_add_note(p_shipment uuid, p_note text, p_actor text, p_location text default null, p_visible boolean default true)
returns void language plpgsql as $$
begin
  perform 1 from public.shipments where id = p_shipment;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'KH:INVALID:empty note'; end if;
  insert into public.shipment_events (shipment_id, kind, note, location, visible, actor) values (p_shipment, 'note', left(p_note, 500), left(p_location, 120), coalesce(p_visible, true), left(p_actor, 120));
end $$;

create or replace function public.delivery_exception_resolve(p_exception uuid, p_actor text) returns void language plpgsql as $$
begin
  update public.delivery_exceptions set resolved_at = now(), resolved_by = left(p_actor, 120) where id = p_exception and resolved_at is null;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
end $$;

-- Cancelling an order cancels its shipments that have not left yet. A dispatched shipment is never silently cancelled.
create or replace function public.orders_cancel_pending_shipments() returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    insert into public.shipment_events (shipment_id, kind, from_status, to_status, note, actor)
      select id, 'status', 'pending', 'cancelled', 'Order cancelled', 'system' from public.shipments where order_id = new.id and status = 'pending';
    update public.shipments set status = 'cancelled', updated_at = now() where order_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists orders_cancel_shipments on public.orders;
create trigger orders_cancel_shipments after update of status on public.orders
  for each row execute function public.orders_cancel_pending_shipments();

-- Ownership: a customer sees shipments only for an order whose member_id is theirs, and only events marked visible.
-- Called by the server with the signed-in member's id; the order id is never trusted on its own.
create or replace function public.shipments_for_member(p_member uuid, p_order uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'shipment_no', s.shipment_no, 'status', s.status, 'courier', s.courier, 'tracking_no', s.tracking_no,
    'estimated_delivery', s.estimated_delivery, 'dispatched_at', s.dispatched_at, 'delivered_at', s.delivered_at,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.to_status, 'note', e.note, 'location', e.location, 'at', e.occurred_at) order by e.occurred_at, e.id), '[]'::jsonb)
                 from public.shipment_events e where e.shipment_id = s.id and e.visible and e.kind = 'status')
  ) order by s.created_at), '[]'::jsonb)
  from public.shipments s join public.orders o on o.id = s.order_id
  where o.id = p_order and o.member_id = p_member and s.status <> 'cancelled';
$$;

alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_events enable row level security;
alter table public.delivery_exceptions enable row level security;
revoke all on public.shipments, public.shipment_items, public.shipment_events, public.delivery_exceptions from anon, authenticated;
revoke all on sequence public.shipment_no_seq from anon, authenticated;
revoke all on function public.shipment_create(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.shipment_set_status(uuid, text, text, text, text, text, text, date, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.shipment_add_note(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.delivery_exception_resolve(uuid, text) from public, anon, authenticated;
revoke all on function public.shipments_for_member(uuid, uuid) from public, anon, authenticated;
