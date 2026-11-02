-- Phase 10: product bundles, gift sets, wishlists, related products, frequently bought together, analytics.
-- Run AFTER loyalty.sql (needs inventory_orders, checkout, coupons). Additive and safe to run again: nothing is dropped or rewritten.
-- Server-only: RLS on, no policies, no grants to anon or authenticated. Only the service-role API calls these functions.
--
-- Design decisions (see docs/PHASE10_BUNDLES_WISHLISTS.md):
--  * A bundle is a definition over REAL product variants. It has NO stock of its own. Availability is derived from the same
--    batches order_create reserves from, so a bundle can never oversell a component.
--  * Bundles contain variants only (never other bundles), so a circular bundle relationship is impossible by construction.
--  * At checkout a bundle is EXPANDED into ordinary order lines (one per variant). Existing reservation, cancel, ship, refund and
--    loyalty code therefore runs unchanged and no component is deducted twice. The bundle saving is stored as order_items.discount_paise,
--    which the existing refund basis already uses, so refunds follow what was actually paid.
--  * Price policy 'live': bundle price is recomputed from current component prices at every checkout. Completed orders keep a snapshot.
--  * Conservative stacking: an order containing a bundle cannot also use a coupon (KH:BUNDLE_COUPON_EXCLUDED).

-- ---- Bundle definitions -------------------------------------------------------------------------------------------
create table if not exists public.product_bundles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  name text not null check (char_length(name) between 2 and 120),
  kind text not null default 'bundle' check (kind in ('bundle', 'wellness_kit', 'gift_set', 'promo')),
  description text check (description is null or char_length(description) <= 1000),
  gift_note text check (gift_note is null or char_length(gift_note) <= 300),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  pricing_mode text not null check (pricing_mode in ('fixed_price', 'percent_off', 'amount_off')),
  fixed_price_paise bigint check (fixed_price_paise is null or fixed_price_paise between 100 and 1000000000),
  percent_bps integer check (percent_bps is null or percent_bps between 1 and 9000),
  amount_off_paise bigint check (amount_off_paise is null or amount_off_paise between 100 and 1000000000),
  gift_message_allowed boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bundle_pricing_value check (
    (pricing_mode = 'fixed_price' and fixed_price_paise is not null and percent_bps is null and amount_off_paise is null) or
    (pricing_mode = 'percent_off' and percent_bps is not null and fixed_price_paise is null and amount_off_paise is null) or
    (pricing_mode = 'amount_off' and amount_off_paise is not null and fixed_price_paise is null and percent_bps is null)),
  constraint bundle_gift_only check (gift_message_allowed = false or kind = 'gift_set')
);
create index if not exists product_bundles_status_idx on public.product_bundles (status, kind);

create table if not exists public.bundle_components (
  bundle_id uuid not null references public.product_bundles(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  qty integer not null check (qty between 1 and 10),
  primary key (bundle_id, variant_id)
);
create index if not exists bundle_components_variant_idx on public.bundle_components (variant_id);

-- Immutable purchase snapshot: one row per (order, bundle, component line). Never updated after insert.
create table if not exists public.bundle_order_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  bundle_id uuid references public.product_bundles(id) on delete set null,
  bundle_name text not null,
  bundle_units integer not null check (bundle_units between 1 and 10),
  bundle_unit_price_paise bigint not null check (bundle_unit_price_paise > 0),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  component_qty integer not null check (component_qty > 0),
  list_value_paise bigint not null check (list_value_paise > 0),
  discount_paise bigint not null check (discount_paise >= 0),
  created_at timestamptz not null default now(),
  constraint bundle_alloc_discount_le_value check (discount_paise <= list_value_paise)
);
create index if not exists bundle_order_alloc_order_idx on public.bundle_order_allocations (order_id);
create index if not exists bundle_order_alloc_bundle_idx on public.bundle_order_allocations (bundle_id, created_at);

create or replace function public.bundle_alloc_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.orders where id = old.order_id) then return old; end if;
  raise exception 'KH:IMMUTABLE';
end $$;
drop trigger if exists bundle_alloc_immutable_trg on public.bundle_order_allocations;
create trigger bundle_alloc_immutable_trg before update or delete on public.bundle_order_allocations for each row execute function public.bundle_alloc_immutable();

-- ---- Wishlists (one row per member and product; no variant, no price, no stock held) ----------------------------------
create table if not exists public.wishlist_items (
  member_id uuid not null references public.members(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (member_id, product_id)
);
create index if not exists wishlist_items_product_idx on public.wishlist_items (product_id);

-- Privacy-conscious engagement log: NO member id. Only what happened to which product and when.
create table if not exists public.wishlist_events (
  id bigint generated always as identity primary key,
  product_id uuid references public.products(id) on delete set null,
  kind text not null check (kind in ('add', 'remove', 'to_cart')),
  at timestamptz not null default now()
);
create index if not exists wishlist_events_at_idx on public.wishlist_events (at, kind);

-- ---- Owner-curated product relationships ---------------------------------------------------------------------------
create table if not exists public.product_relationships (
  product_id uuid not null references public.products(id) on delete cascade,
  related_product_id uuid not null references public.products(id) on delete cascade,
  kind text not null default 'complement' check (kind in ('complement', 'similar')),
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  created_by text,
  created_at timestamptz not null default now(),
  primary key (product_id, related_product_id),
  constraint product_relationships_not_self check (product_id <> related_product_id)
);
create index if not exists product_relationships_related_idx on public.product_relationships (related_product_id);

alter table public.product_bundles enable row level security;
alter table public.bundle_components enable row level security;
alter table public.bundle_order_allocations enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.wishlist_events enable row level security;
alter table public.product_relationships enable row level security;
revoke all on public.product_bundles, public.bundle_components, public.bundle_order_allocations, public.wishlist_items, public.wishlist_events, public.product_relationships from public, anon, authenticated;

-- ---- Pricing ---------------------------------------------------------------------------------------------------------
-- Deterministic largest-remainder split of p_amount across weights (ties go to the lower index). Sum of result = p_amount exactly.
create or replace function public.bundle_alloc(p_amount bigint, p_weights bigint[]) returns bigint[]
language plpgsql immutable as $$
declare
  v_total bigint; v_n integer := coalesce(array_length(p_weights, 1), 0);
  v_out bigint[] := '{}'; v_rem bigint[] := '{}'; v_used bigint := 0; v_left bigint; i integer; j integer; v_best integer;
begin
  if p_amount < 0 or v_n = 0 then raise exception 'KH:INVALID'; end if;
  select sum(w) into v_total from unnest(p_weights) as w;
  if v_total is null or v_total <= 0 or exists (select 1 from unnest(p_weights) as w where w <= 0) then raise exception 'KH:INVALID'; end if;
  for i in 1..v_n loop
    v_out[i] := (p_amount * p_weights[i]) / v_total;
    v_rem[i] := (p_amount * p_weights[i]) % v_total;
    v_used := v_used + v_out[i];
  end loop;
  v_left := p_amount - v_used;
  while v_left > 0 loop
    v_best := 1;
    for j in 2..v_n loop if v_rem[j] > v_rem[v_best] then v_best := j; end if; end loop;
    v_out[v_best] := v_out[v_best] + 1; v_rem[v_best] := -1; v_left := v_left - 1;
  end loop;
  return v_out;
end $$;

-- The one bundle price calculation, from the prices the caller gives (variant id -> unit price). Used live and at checkout.
-- Returns {ok, combined_paise, discount_paise, final_paise, savings_paise}. Never negative, never above the combined price (no fake savings).
create or replace function public.bundle_price_from(p_mode text, p_fixed bigint, p_bps integer, p_off bigint, p_combined bigint) returns jsonb
language plpgsql immutable as $$
declare v_final bigint;
begin
  if p_combined is null or p_combined <= 0 then raise exception 'KH:INVALID'; end if;
  v_final := case p_mode
    when 'fixed_price' then p_fixed
    when 'percent_off' then p_combined - (p_combined * p_bps) / 10000   -- discount floors, so the customer never pays less than the percentage promises
    when 'amount_off' then p_combined - p_off
    else null end;
  if v_final is null or v_final <= 0 then raise exception 'KH:BUNDLE_PRICE_INVALID'; end if;
  if v_final > p_combined then raise exception 'KH:BUNDLE_NO_SAVING'; end if;
  return jsonb_build_object('ok', true, 'combined_paise', p_combined, 'discount_paise', p_combined - v_final, 'final_paise', v_final, 'savings_paise', p_combined - v_final);
end $$;

create or replace function public.bundle_price(p_bundle uuid) returns jsonb language plpgsql stable as $$
declare b public.product_bundles%rowtype; v_combined bigint; v_lines jsonb;
begin
  select * into b from public.product_bundles where id = p_bundle;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  select coalesce(sum(v.price_paise::bigint * c.qty), 0),
         jsonb_agg(jsonb_build_object('variant_id', v.id, 'qty', c.qty, 'unit_price_paise', v.price_paise) order by v.id)
    into v_combined, v_lines
    from public.bundle_components c join public.product_variants v on v.id = c.variant_id where c.bundle_id = p_bundle;
  if v_combined = 0 or exists (select 1 from public.bundle_components c join public.product_variants v on v.id = c.variant_id where c.bundle_id = p_bundle and v.price_paise is null) then
    raise exception 'KH:NO_PRICE';
  end if;
  return public.bundle_price_from(b.pricing_mode, b.fixed_price_paise, b.percent_bps, b.amount_off_paise, v_combined) || jsonb_build_object('lines', v_lines);
end $$;

-- A component is sellable if the product is approved for sale and the variant is active with a price.
create or replace function public.bundle_components_sellable(p_bundle uuid) returns boolean language sql stable as $$
  select count(*) >= 2 and bool_and(p.status = 'APPROVED_FOR_SALE' and v.status = 'active' and v.price_paise is not null)
    from public.bundle_components c join public.product_variants v on v.id = c.variant_id join public.products p on p.id = v.product_id
   where c.bundle_id = p_bundle;
$$;

-- ---- Availability: MIN over components of floor(sellable free units / qty per bundle). Same batch rules as order_create. ----
create or replace function public.bundle_availability(p_bundle uuid, p_min_days integer default 30) returns integer language plpgsql stable as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_n integer;
begin
  if (select count(*) from public.bundle_components where bundle_id = p_bundle) < 2 then return 0; end if;
  select coalesce(min(floor(coalesce(s.free, 0) / c.qty)), 0)::integer into v_n
    from public.bundle_components c
    left join (select variant_id, sum(qty_on_hand - qty_reserved) as free from public.inventory_batches
                where status = 'active' and expiry_date >= v_today + p_min_days and qty_on_hand - qty_reserved > 0 group by variant_id) s on s.variant_id = c.variant_id
   where c.bundle_id = p_bundle;
  return v_n;
end $$;

-- ---- Owner management (transactional, audited) ---------------------------------------------------------------------
-- p_bundle: {id?, slug, name, kind, description, gift_note, pricing_mode, fixed_price_paise|percent_bps|amount_off_paise, gift_message_allowed,
--            components:[{variant_id, qty}]}. Components are replaced as a set. Active bundles are revalidated; an edit that would
-- break an active bundle is refused. Order history is untouched (it holds its own snapshot).
create or replace function public.bundle_upsert(p_bundle jsonb, p_actor text) returns uuid language plpgsql as $$
declare
  v_id uuid := nullif(p_bundle ->> 'id', '')::uuid; v_c jsonb; v_status text; v_n integer;
begin
  if p_actor is null or btrim(p_actor) = '' then raise exception 'KH:INVALID'; end if;
  if jsonb_typeof(p_bundle -> 'components') <> 'array' then raise exception 'KH:INVALID'; end if;
  select count(distinct c ->> 'variant_id') into v_n from jsonb_array_elements(p_bundle -> 'components') c;
  if v_n < 2 or v_n <> jsonb_array_length(p_bundle -> 'components') then raise exception 'KH:BUNDLE_COMPONENTS'; end if;
  if v_id is null then
    insert into public.product_bundles (slug, name, kind, description, gift_note, pricing_mode, fixed_price_paise, percent_bps, amount_off_paise, gift_message_allowed, created_by)
    values (p_bundle ->> 'slug', p_bundle ->> 'name', coalesce(p_bundle ->> 'kind', 'bundle'), nullif(p_bundle ->> 'description', ''), nullif(p_bundle ->> 'gift_note', ''),
            p_bundle ->> 'pricing_mode', (p_bundle ->> 'fixed_price_paise')::bigint, (p_bundle ->> 'percent_bps')::integer, (p_bundle ->> 'amount_off_paise')::bigint,
            coalesce((p_bundle ->> 'gift_message_allowed')::boolean, false), p_actor) returning id into v_id;
  else
    select status into v_status from public.product_bundles where id = v_id for update;
    if not found then raise exception 'KH:NOT_FOUND'; end if;
    update public.product_bundles set slug = p_bundle ->> 'slug', name = p_bundle ->> 'name', kind = coalesce(p_bundle ->> 'kind', 'bundle'),
           description = nullif(p_bundle ->> 'description', ''), gift_note = nullif(p_bundle ->> 'gift_note', ''), pricing_mode = p_bundle ->> 'pricing_mode',
           fixed_price_paise = (p_bundle ->> 'fixed_price_paise')::bigint, percent_bps = (p_bundle ->> 'percent_bps')::integer, amount_off_paise = (p_bundle ->> 'amount_off_paise')::bigint,
           gift_message_allowed = coalesce((p_bundle ->> 'gift_message_allowed')::boolean, false), updated_at = now() where id = v_id;
    delete from public.bundle_components where bundle_id = v_id;
  end if;
  for v_c in select e from jsonb_array_elements(p_bundle -> 'components') e order by e ->> 'variant_id' loop
    insert into public.bundle_components (bundle_id, variant_id, qty) values (v_id, (v_c ->> 'variant_id')::uuid, (v_c ->> 'qty')::integer);
  end loop;
  if coalesce(v_status, 'draft') = 'active' then
    if not public.bundle_components_sellable(v_id) then raise exception 'KH:BUNDLE_COMPONENTS'; end if;
    perform public.bundle_price(v_id);
  end if;
  insert into public.admin_audit (actor, action, detail) values (p_actor, 'bundle.upsert', jsonb_build_object('bundle_id', v_id, 'slug', p_bundle ->> 'slug', 'pricing_mode', p_bundle ->> 'pricing_mode'));
  return v_id;
end $$;

create or replace function public.bundle_set_status(p_bundle uuid, p_status text, p_actor text) returns void language plpgsql as $$
begin
  if p_status not in ('draft', 'active', 'inactive') or p_actor is null then raise exception 'KH:INVALID'; end if;
  perform 1 from public.product_bundles where id = p_bundle for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if p_status = 'active' then
    if not public.bundle_components_sellable(p_bundle) then raise exception 'KH:BUNDLE_COMPONENTS'; end if;
    perform public.bundle_price(p_bundle);   -- raises if the price is invalid or shows no saving
  end if;
  update public.product_bundles set status = p_status, updated_at = now() where id = p_bundle;
  insert into public.admin_audit (actor, action, detail) values (p_actor, 'bundle.status', jsonb_build_object('bundle_id', p_bundle, 'status', p_status));
end $$;

-- Public list: active bundles whose components are all sellable, with live price and availability. No costs, no stock numbers beyond "max bundles".
create or replace function public.bundle_public_list(p_limit integer default 20, p_offset integer default 0) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v from (
    select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'description', b.description, 'gift_note', b.gift_note,
             'gift_message_allowed', b.gift_message_allowed, 'price', public.bundle_price(b.id) - 'lines',
             'available', public.bundle_availability(b.id), 'components', (
               select jsonb_agg(jsonb_build_object('variant_id', v2.id, 'product', coalesce(p.public_name, p.internal_name), 'pack_size', v2.pack_size, 'qty', c.qty) order by p.internal_name, v2.pack_size)
                 from public.bundle_components c join public.product_variants v2 on v2.id = c.variant_id join public.products p on p.id = v2.product_id where c.bundle_id = b.id)) as x
      from public.product_bundles b
     where b.status = 'active' and public.bundle_components_sellable(b.id)
     order by b.name limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)) t;
  return v;
end $$;

-- ---- Checkout: expand bundles into ordinary lines, place through checkout_place, then record the saving ---------------
-- p_order.items entries are {variant_id, qty} or {bundle_id, qty}. Everything below runs in ONE transaction (this function), so a failure
-- anywhere leaves no order, no reservation and no allocation. Replays (same idempotency key or request hash) record nothing twice.
create or replace function public.checkout_place_with_bundles(
  p_member uuid, p_key uuid, p_hash text, p_order jsonb, p_expected_total bigint, p_test boolean, p_hold_minutes integer, p_min_days integer, p_coupon text
) returns jsonb language plpgsql as $$
declare
  v_item jsonb; b public.product_bundles%rowtype; v_lines jsonb := '[]'::jsonb; v_units integer; v_has_bundle boolean := false;
  v_bundles jsonb := '[]'::jsonb; v_list_total bigint := 0; v_shipping integer := coalesce((p_order ->> 'shipping_paise')::integer, 0);
  v_expand jsonb; v_res jsonb; v_order uuid; r record; v_combined bigint; v_price jsonb; v_disc bigint[]; v_w bigint[]; v_ids uuid[]; i integer;
  v_total_disc bigint := 0; v_new_total bigint; v_entry jsonb; v_plain_total bigint;
begin
  if jsonb_typeof(p_order -> 'items') <> 'array' or jsonb_array_length(p_order -> 'items') = 0 then raise exception 'KH:INVALID'; end if;
  -- 1. expand, in a fixed order, merging every variant into one line
  for v_item in select e from jsonb_array_elements(p_order -> 'items') e loop
    if v_item ? 'bundle_id' then
      if v_item ? 'variant_id' then raise exception 'KH:INVALID'; end if;
      v_units := (v_item ->> 'qty')::integer;
      if v_units is null or v_units < 1 or v_units > 10 then raise exception 'KH:INVALID'; end if;
      select * into b from public.product_bundles where id = (v_item ->> 'bundle_id')::uuid;
      if not found then raise exception 'KH:NOT_FOUND'; end if;
      if b.status <> 'active' or not public.bundle_components_sellable(b.id) then raise exception 'KH:BUNDLE_UNAVAILABLE:%', b.name; end if;
      if exists (select 1 from jsonb_array_elements(v_bundles) x where x ->> 'bundle_id' = b.id::text) then raise exception 'KH:INVALID'; end if;
      v_has_bundle := true;
      v_bundles := v_bundles || jsonb_build_array(jsonb_build_object('bundle_id', b.id, 'units', v_units));
      for r in select variant_id, qty from public.bundle_components where bundle_id = b.id loop
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('variant_id', r.variant_id, 'qty', r.qty * v_units));
      end loop;
    else
      if (v_item ->> 'variant_id') is null then raise exception 'KH:INVALID'; end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('variant_id', v_item ->> 'variant_id', 'qty', (v_item ->> 'qty')::integer));
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', q) order by variant_id) into v_expand
    from (select (e ->> 'variant_id') as variant_id, sum((e ->> 'qty')::integer) as q from jsonb_array_elements(v_lines) e group by 1) m;
  if exists (select 1 from jsonb_array_elements(v_expand) e where (e ->> 'qty')::integer > 100) then raise exception 'KH:INVALID'; end if;
  if v_has_bundle and p_coupon is not null and btrim(p_coupon) <> '' then raise exception 'KH:BUNDLE_COUPON_EXCLUDED'; end if;

  -- 2. list total at live prices (checkout_place re-reads prices itself and raises KH:PRICE_CHANGED if they moved)
  select coalesce(sum(v.price_paise::bigint * (e ->> 'qty')::integer), 0) into v_list_total
    from jsonb_array_elements(v_expand) e join public.product_variants v on v.id = (e ->> 'variant_id')::uuid;
  v_plain_total := v_list_total + v_shipping;

  -- 3. the saving, from the same live prices; the customer's expected total must match what we are about to charge
  v_total_disc := 0;
  for v_entry in select e from jsonb_array_elements(v_bundles) e loop
    select * into b from public.product_bundles where id = (v_entry ->> 'bundle_id')::uuid;
    v_price := public.bundle_price(b.id);
    v_total_disc := v_total_disc + (v_price ->> 'discount_paise')::bigint * (v_entry ->> 'units')::integer;
  end loop;
  if p_expected_total is distinct from (v_plain_total - v_total_disc) then raise exception 'KH:PRICE_CHANGED'; end if;

  -- 4. place at list prices through the existing, unchanged function
  v_res := public.checkout_place(p_member, p_key, p_hash, jsonb_set(p_order, '{items}', v_expand), v_plain_total, p_test, p_hold_minutes, p_min_days, null);
  if (v_res ->> 'replay')::boolean or not v_has_bundle then return v_res; end if;
  v_order := (v_res ->> 'order_id')::uuid;
  if exists (select 1 from public.bundle_order_allocations where order_id = v_order) then return v_res; end if;

  -- 5. record the saving per component line (deterministic, largest remainder) from the prices the ORDER snapshotted
  v_total_disc := 0;
  for v_entry in select e from jsonb_array_elements(v_bundles) e loop
    select * into b from public.product_bundles where id = (v_entry ->> 'bundle_id')::uuid;
    v_units := (v_entry ->> 'units')::integer;
    select sum(oi.unit_price_paise::bigint * c.qty) into v_combined
      from public.bundle_components c join public.order_items oi on oi.order_id = v_order and oi.variant_id = c.variant_id where c.bundle_id = b.id;
    v_price := public.bundle_price_from(b.pricing_mode, b.fixed_price_paise, b.percent_bps, b.amount_off_paise, v_combined);
    select array_agg(oi.id order by c.variant_id), array_agg(oi.unit_price_paise::bigint * c.qty * v_units order by c.variant_id)
      into v_ids, v_w
      from public.bundle_components c join public.order_items oi on oi.order_id = v_order and oi.variant_id = c.variant_id where c.bundle_id = b.id;
    v_disc := public.bundle_alloc((v_price ->> 'discount_paise')::bigint * v_units, v_w);
    i := 0;
    for r in select c.variant_id, c.qty from public.bundle_components c where c.bundle_id = b.id order by c.variant_id loop
      i := i + 1;
      insert into public.bundle_order_allocations (order_id, order_item_id, bundle_id, bundle_name, bundle_units, bundle_unit_price_paise, variant_id, component_qty, list_value_paise, discount_paise)
      values (v_order, v_ids[i], b.id, b.name, v_units, (v_price ->> 'final_paise')::bigint, r.variant_id, r.qty * v_units, v_w[i], v_disc[i]);
      update public.order_items set discount_paise = discount_paise + v_disc[i] where id = v_ids[i];
      v_total_disc := v_total_disc + v_disc[i];
    end loop;
  end loop;
  update public.orders set discount_paise = discount_paise + v_total_disc, total_paise = subtotal_paise - (discount_paise + v_total_disc) + shipping_paise, updated_at = now() where id = v_order;
  select total_paise into v_new_total from public.orders where id = v_order;
  if v_new_total is distinct from p_expected_total then raise exception 'KH:PRICE_CHANGED'; end if;
  return v_res;
end $$;

-- What a bundle order contains and what was paid per component line (for refunds and support). Reads the snapshot only.
create or replace function public.bundle_order_basis(p_order uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('bundle', a.bundle_name, 'units', a.bundle_units, 'bundle_unit_price_paise', a.bundle_unit_price_paise,
           'order_item_id', a.order_item_id, 'component_qty', a.component_qty, 'list_value_paise', a.list_value_paise, 'discount_paise', a.discount_paise,
           'paid_value_paise', a.list_value_paise - a.discount_paise) order by a.bundle_name, a.order_item_id), '[]'::jsonb)
    from public.bundle_order_allocations a where a.order_id = p_order;
$$;

-- ---- Wishlist --------------------------------------------------------------------------------------------------------
create or replace function public.wishlist_add(p_member uuid, p_product uuid) returns boolean language plpgsql as $$
declare v_n integer;
begin
  if not exists (select 1 from public.members where id = p_member) then raise exception 'KH:NOT_FOUND'; end if;
  if not exists (select 1 from public.products where id = p_product and status = 'APPROVED_FOR_SALE') then raise exception 'KH:NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wishlist:' || p_member::text, 0));
  if (select count(*) from public.wishlist_items where member_id = p_member) >= 100 then raise exception 'KH:WISHLIST_FULL'; end if;
  insert into public.wishlist_items (member_id, product_id) values (p_member, p_product) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into public.wishlist_events (product_id, kind) values (p_product, 'add'); end if;
  return v_n > 0;
end $$;

create or replace function public.wishlist_remove(p_member uuid, p_product uuid) returns boolean language plpgsql as $$
declare v_n integer;
begin
  delete from public.wishlist_items where member_id = p_member and product_id = p_product;
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into public.wishlist_events (product_id, kind) values (p_product, 'remove'); end if;
  return v_n > 0;
end $$;

-- Guest-to-member merge: unknown, unpublished or duplicate products are skipped silently; the cap of 100 is never exceeded.
create or replace function public.wishlist_merge(p_member uuid, p_products uuid[]) returns integer language plpgsql as $$
declare v_p uuid; v_added integer := 0;
begin
  if p_products is null or cardinality(p_products) > 100 then raise exception 'KH:INVALID'; end if;
  for v_p in select distinct x from unnest(p_products) x order by x loop
    begin
      if public.wishlist_add(p_member, v_p) then v_added := v_added + 1; end if;
    exception when others then
      if sqlerrm in ('KH:NOT_FOUND', 'KH:WISHLIST_FULL') then null; else raise; end if;
    end;
  end loop;
  return v_added;
end $$;

create or replace function public.wishlist_track_to_cart(p_member uuid, p_product uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from public.wishlist_items where member_id = p_member and product_id = p_product) then
    insert into public.wishlist_events (product_id, kind) values (p_product, 'to_cart');
  end if;
end $$;

-- The member's own list with CURRENT price (lowest active variant), availability, and a state. Unpublished products show as 'unavailable'
-- without a price. Bounded and paged.
create or replace function public.wishlist_list(p_member uuid, p_limit integer default 50, p_offset integer default 0) returns jsonb language plpgsql stable as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v jsonb;
begin
  select coalesce(jsonb_agg(x order by (x ->> 'added_at') desc), '[]'::jsonb) into v from (
    select jsonb_build_object('product_id', p.id, 'slug', p.slug, 'name', coalesce(p.public_name, p.internal_name), 'added_at', w.added_at,
             'state', case when p.status <> 'APPROVED_FOR_SALE' then 'unavailable' when s.free > 0 then 'in_stock' else 'out_of_stock' end,
             'from_price_paise', case when p.status = 'APPROVED_FOR_SALE' then pr.min_price end) as x
      from public.wishlist_items w join public.products p on p.id = w.product_id
      left join lateral (select min(v2.price_paise) as min_price from public.product_variants v2 where v2.product_id = p.id and v2.status = 'active' and v2.price_paise is not null) pr on true
      left join lateral (select coalesce(sum(b.qty_on_hand - b.qty_reserved), 0) as free from public.inventory_batches b join public.product_variants v3 on v3.id = b.variant_id
                          where v3.product_id = p.id and v3.status = 'active' and b.status = 'active' and b.expiry_date >= v_today + 30) s on true
     where w.member_id = p_member order by w.added_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) t;
  return v;
end $$;

-- ---- Related products (deterministic): owner-curated first, then same form; sellable and in stock only; never the product itself ----
create or replace function public.related_products(p_product uuid, p_limit integer default 4) returns jsonb language plpgsql stable as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v jsonb; v_form text;
begin
  select form into v_form from public.products where id = p_product;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', t.id, 'slug', t.slug, 'name', t.name, 'source', t.source) order by t.rank, t.sort, t.name), '[]'::jsonb) into v from (
    select * from (
      select p.id, p.slug, coalesce(p.public_name, p.internal_name) as name, 'curated'::text as source, 0 as rank, r.sort_order as sort
        from public.product_relationships r join public.products p on p.id = r.related_product_id where r.product_id = p_product
      union all
      select p.id, p.slug, coalesce(p.public_name, p.internal_name), 'same_form', 1, 0
        from public.products p where v_form is not null and p.form = v_form and p.id <> p_product
          and not exists (select 1 from public.product_relationships r where r.product_id = p_product and r.related_product_id = p.id)
    ) c where c.id <> p_product and exists (
        select 1 from public.products pp join public.product_variants vv on vv.product_id = pp.id and vv.status = 'active' and vv.price_paise is not null
          join public.inventory_batches b on b.variant_id = vv.id and b.status = 'active' and b.expiry_date >= v_today + 30 and b.qty_on_hand - b.qty_reserved > 0
         where pp.id = c.id and pp.status = 'APPROVED_FOR_SALE')
    order by rank, sort, name limit least(greatest(p_limit, 1), 12)) t;
  return v;
end $$;

-- ---- Frequently bought together: real orders only. Counts distinct ORDERS containing both products (a duplicate row never double counts).
-- Orders count when they reached 'paid' or later and are not cancelled. Below p_min_orders the result is EMPTY (the caller then shows
-- curated related products under their own label; this is never presented as a purchase statistic).
create or replace function public.frequently_bought_together(p_product uuid, p_min_orders integer default 5, p_limit integer default 3) returns jsonb language plpgsql stable as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('product_id', t.id, 'slug', t.slug, 'name', t.name, 'orders_together', t.n) order by t.n desc, t.name), '[]'::jsonb) into v from (
    select p.id, p.slug, coalesce(p.public_name, p.internal_name) as name, c.n
      from (select v2.product_id as pid, count(distinct oi2.order_id) as n
              from public.order_items oi1 join public.product_variants v1 on v1.id = oi1.variant_id and v1.product_id = p_product
              join public.orders o on o.id = oi1.order_id and o.status in ('paid', 'packed', 'shipped', 'delivered')
              join public.order_items oi2 on oi2.order_id = oi1.order_id
              join public.product_variants v2 on v2.id = oi2.variant_id and v2.product_id <> p_product
             group by v2.product_id) c
      join public.products p on p.id = c.pid and p.status = 'APPROVED_FOR_SALE'
     where c.n >= greatest(p_min_orders, 3)
       and exists (select 1 from public.product_variants vv join public.inventory_batches b on b.variant_id = vv.id and b.status = 'active' and b.expiry_date >= v_today + 30 and b.qty_on_hand - b.qty_reserved > 0
                    where vv.product_id = p.id and vv.status = 'active' and vv.price_paise is not null)
     order by c.n desc, p.internal_name limit least(greatest(p_limit, 1), 6)) t;
  return v;
end $$;

-- ---- Analytics (read-only, bounded). Orders count when paid or later and not cancelled; refunds are shown separately. ----
-- Profit is reported as INCOMPLETE because this schema holds no component cost. Revenue is the allocated amount actually paid for bundle lines.
create or replace function public.bundle_analytics(p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 20) returns jsonb language plpgsql stable as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now());
begin
  return jsonb_build_object('from', v_from, 'to', v_to, 'profit_complete', false, 'profit_note', 'No component cost is recorded, so margin is not calculated.',
    'bundles', coalesce((select jsonb_agg(x order by (x ->> 'units_sold')::bigint desc, x ->> 'name') from (
        select jsonb_build_object('bundle_id', a.bundle_id, 'name', max(a.bundle_name), 'units_sold', sum(a.bundle_units) / max(cnt.n), 'revenue_paise', sum(a.list_value_paise - a.discount_paise),
               'discount_paise', sum(a.discount_paise), 'orders', count(distinct a.order_id)) as x
          from public.bundle_order_allocations a join public.orders o on o.id = a.order_id and o.status in ('paid', 'packed', 'shipped', 'delivered')
          join lateral (select count(*) as n from public.bundle_order_allocations z where z.order_id = a.order_id and z.bundle_id is not distinct from a.bundle_id) cnt on true
         where o.created_at >= v_from and o.created_at < v_to group by a.bundle_id order by 1 desc limit least(greatest(p_limit, 1), 50)) s), '[]'::jsonb));
end $$;

create or replace function public.bundle_inventory_constraints(p_limit integer default 20) returns jsonb language plpgsql stable as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return coalesce((select jsonb_agg(x order by (x ->> 'available')::integer, x ->> 'name') from (
    select jsonb_build_object('bundle_id', b.id, 'name', b.name, 'available', public.bundle_availability(b.id),
      'limiting_variant_id', (select c.variant_id from public.bundle_components c
          left join (select variant_id, sum(qty_on_hand - qty_reserved) as free from public.inventory_batches where status = 'active' and expiry_date >= v_today + 30 and qty_on_hand - qty_reserved > 0 group by variant_id) s on s.variant_id = c.variant_id
         where c.bundle_id = b.id order by floor(coalesce(s.free, 0) / c.qty), c.variant_id limit 1)) as x
      from public.product_bundles b where b.status = 'active' limit least(greatest(p_limit, 1), 50)) t), '[]'::jsonb);
end $$;

-- Wishlist trends: current top wishlisted products, event counts, and wishlist-to-purchase ATTRIBUTION (a member who still has the product
-- wishlisted bought it in a paid order after adding it). Attribution only: it does not prove the wishlist caused the sale.
create or replace function public.wishlist_trends(p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 10) returns jsonb language plpgsql stable as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now());
begin
  return jsonb_build_object('from', v_from, 'to', v_to,
    'events', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from public.wishlist_events where at >= v_from and at < v_to group by kind) e),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product_id', t.product_id, 'name', t.name, 'wishlisted_by', t.n, 'bought_after_wishlisting', t.bought) order by t.n desc, t.name) from (
        select w.product_id, coalesce(p.public_name, p.internal_name) as name, count(*) as n,
               count(*) filter (where exists (select 1 from public.orders o join public.order_items oi on oi.order_id = o.id join public.product_variants v on v.id = oi.variant_id
                                               where o.member_id = w.member_id and v.product_id = w.product_id and o.status in ('paid', 'packed', 'shipped', 'delivered') and o.created_at > w.added_at)) as bought
          from public.wishlist_items w join public.products p on p.id = w.product_id group by w.product_id, p.public_name, p.internal_name
          order by n desc, 2 limit least(greatest(p_limit, 1), 50)) t), '[]'::jsonb),
    'attribution_note', 'Counts members who bought a product after wishlisting it. It does not show that the wishlist caused the purchase.');
end $$;

revoke all on function public.bundle_alloc(bigint, bigint[]), public.bundle_price_from(text, bigint, integer, bigint, bigint), public.bundle_price(uuid),
  public.bundle_components_sellable(uuid), public.bundle_availability(uuid, integer), public.bundle_upsert(jsonb, text), public.bundle_set_status(uuid, text, text),
  public.bundle_public_list(integer, integer),
  public.checkout_place_with_bundles(uuid, uuid, text, jsonb, bigint, boolean, integer, integer, text), public.bundle_order_basis(uuid),
  public.wishlist_add(uuid, uuid), public.wishlist_remove(uuid, uuid), public.wishlist_merge(uuid, uuid[]), public.wishlist_track_to_cart(uuid, uuid),
  public.wishlist_list(uuid, integer, integer), public.related_products(uuid, integer), public.frequently_bought_together(uuid, integer, integer),
  public.bundle_analytics(timestamptz, timestamptz, integer), public.bundle_inventory_constraints(integer), public.wishlist_trends(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
