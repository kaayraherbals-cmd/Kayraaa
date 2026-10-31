-- Stage 7B: commerce integration, database layer (Phase 12 Stage 7). ADDITIVE. Safe to run again.
-- Note: order_shipping_paise is integer in finance_lines to match the live database (finance.sql in this repo says bigint; PostgreSQL cannot change a function return type with CREATE OR REPLACE).
-- Run AFTER finance.sql (last file in docs/DATABASE_MIGRATIONS.md order) and BEFORE the self-tests.
-- It replaces five functions defined earlier (loyalty_reserve, loyalty_net_eligible, checkout_place_with_bundles, finance_lines,
-- order_refund_basis). If loyalty.sql, bundles_wishlists.sql, coupons.sql or finance.sql is ever re-run, run this file again after it.
--
-- WHAT CHANGES
--  1. Separate money columns. orders and order_items get bundle_discount_paise and loyalty_discount_paise. Coupon savings stay in
--     discount_paise. Bundle savings that checkout_place_with_bundles used to add to discount_paise now go to bundle_discount_paise
--     (existing rows, if any, are moved once). Invariant, enforced by a constraint:
--       total = subtotal - discount - bundle_discount - loyalty_discount + shipping
--  2. Loyalty redemption is applied INSIDE the checkout transaction, before payment_prepare reads orders.total_paise, so the Razorpay
--     amount is the database total. The saving is allocated across the eligible lines in exact integer paise (largest remainder,
--     bundle_alloc) and snapshotted in loyalty_order_snapshots (immutable).
--  3. Shipping is re-derived from shipping_pincodes inside the transaction (it used to be trusted from the caller).
--  4. One entry point for the application: checkout_place_full (plain lines, bundles, coupon, loyalty points).
--  5. ACTIVATION BLOCKERS are in the database, not only in docs: loyalty_settings.enabled cannot be true unless the owner has confirmed
--     the GST treatment of redemption (redemption_tax_confirmed) and the refund/debt policy (refund_policy_confirmed). Both default false.
--
-- NOT DONE HERE: the Phase 8 loyalty lines (finance_lines excludes loyalty on purpose; see docs/PHASE12_STAGE7_REMAINING_ISSUES.md).

-- ---- 1. Columns and constraints ------------------------------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_total_matches;

alter table public.orders add column if not exists bundle_discount_paise bigint not null default 0 check (bundle_discount_paise >= 0);
alter table public.orders add column if not exists loyalty_discount_paise bigint not null default 0 check (loyalty_discount_paise >= 0);
alter table public.order_items add column if not exists bundle_discount_paise bigint not null default 0 check (bundle_discount_paise >= 0);
alter table public.order_items add column if not exists loyalty_discount_paise bigint not null default 0 check (loyalty_discount_paise >= 0);

-- Move bundle savings recorded by the old wrapper out of the coupon columns, once (guard: bundle column still 0).
update public.order_items i set discount_paise = i.discount_paise - a.d, bundle_discount_paise = i.bundle_discount_paise + a.d
  from (select order_item_id, sum(discount_paise) as d from public.bundle_order_allocations group by order_item_id) a
 where a.order_item_id = i.id and i.bundle_discount_paise = 0 and a.d > 0 and i.discount_paise >= a.d;
update public.orders o set discount_paise = o.discount_paise - a.d, bundle_discount_paise = o.bundle_discount_paise + a.d
  from (select order_id, sum(discount_paise) as d from public.bundle_order_allocations group by order_id) a
 where a.order_id = o.id and o.bundle_discount_paise = 0 and a.d > 0 and o.discount_paise >= a.d;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_discounts_le_line') then
    alter table public.order_items add constraint order_items_discounts_le_line check (discount_paise + bundle_discount_paise + loyalty_discount_paise <= line_total_paise);
  end if;
  if exists (select 1 from public.orders where total_paise <> subtotal_paise - discount_paise - bundle_discount_paise - loyalty_discount_paise + shipping_paise) then
    raise notice 'orders_total_matches NOT added: some existing orders do not satisfy the new invariant. Inspect them first.';
  else
    alter table public.orders add constraint orders_total_matches check (total_paise = subtotal_paise - discount_paise - bundle_discount_paise - loyalty_discount_paise + shipping_paise);
  end if;
end $$;

-- ---- 2. Loyalty activation blockers and snapshot ------------------------------------------------------------------------------
alter table public.loyalty_settings add column if not exists redemption_tax_confirmed boolean not null default false;
alter table public.loyalty_settings add column if not exists refund_policy_confirmed boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'loyalty_enabled_needs_policy') then
    alter table public.loyalty_settings add constraint loyalty_enabled_needs_policy
      check (not enabled or (redemption_tax_confirmed and refund_policy_confirmed));
  end if;
end $$;

-- What was applied to one order, frozen at checkout: the settings in force and the exact per-line split. Later settings changes never touch it.
create table if not exists public.loyalty_order_snapshots (
  order_id uuid primary key references public.orders(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  points integer not null check (points > 0),
  value_paise bigint not null check (value_paise > 0),
  redeem_block_points integer not null,
  redeem_block_paise integer not null,
  max_redeem_bps integer not null,
  lines jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.loyalty_order_snapshots enable row level security;
revoke all on public.loyalty_order_snapshots from public, anon, authenticated;
create or replace function public.loyalty_snapshot_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.orders where id = old.order_id) then return old; end if;
  raise exception 'KH:IMMUTABLE';
end $$;
drop trigger if exists loyalty_snapshot_immutable_trg on public.loyalty_order_snapshots;
create trigger loyalty_snapshot_immutable_trg before update or delete on public.loyalty_order_snapshots for each row execute function public.loyalty_snapshot_immutable();

-- ---- 3. Replaced functions (patched copies of the earlier definitions) --------------------------------------------------------
-- Earning basis = what the customer paid for eligible merchandise: line total less coupon, bundle and loyalty savings, GST and shipping excluded.
-- (Excluding the loyalty saving from the earning basis is a policy choice to be confirmed by the owner with refund_policy_confirmed.)
create or replace function public.loyalty_net_eligible(p_order uuid) returns bigint language sql stable as $$
  select coalesce(sum(i.line_total_paise - i.discount_paise - i.bundle_discount_paise - i.loyalty_discount_paise), 0)::bigint
    from public.order_items i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    cross join public.loyalty_settings s
   where i.order_id = p_order
     and not (p.id = any (s.excluded_product_ids))
     and (cardinality(s.eligible_forms) = 0 or p.form = any (s.eligible_forms))
$$;

create or replace function public.loyalty_reserve(p_member uuid, p_order uuid, p_points integer, p_key text) returns jsonb language plpgsql as $$
declare
  s public.loyalty_settings%rowtype; o public.orders%rowtype; a public.loyalty_accounts%rowtype; res public.loyalty_reservations%rowtype;
  v_value bigint; v_net bigint; v_avail bigint; v_need integer; v_take integer; r record;
begin
  select * into s from public.loyalty_settings;
  if not s.enabled then raise exception 'KH:DISABLED'; end if;
  if not (s.redemption_tax_confirmed and s.refund_policy_confirmed) then raise exception 'KH:LOYALTY_POLICY_PENDING'; end if;
  a := public.loyalty_lock(p_member);
  select * into res from public.loyalty_reservations where order_id = p_order;
  if found then
    if res.idem_key = p_key and res.member_id = p_member then return jsonb_build_object('points', res.points, 'discount_paise', res.value_paise, 'replayed', true); end if;
    raise exception 'KH:CONFLICT';
  end if;
  select * into o from public.orders where id = p_order for update;
  if not found or o.member_id is distinct from p_member then raise exception 'KH:NOT_FOUND'; end if;
  if o.status <> 'placed' then raise exception 'KH:INVALID'; end if;
  if o.coupon_id is not null and s.stacking = 'exclusive' then raise exception 'KH:STACKING'; end if;
  if p_points is null or p_points < s.min_redeem_points or p_points % s.redeem_block_points <> 0 then raise exception 'KH:LIMIT'; end if;
  v_value := (p_points / s.redeem_block_points)::bigint * s.redeem_block_paise;
  v_net := public.loyalty_net_eligible(p_order);
  if v_value > (v_net * s.max_redeem_bps) / 10000 then raise exception 'KH:LIMIT'; end if;
  if v_value > o.subtotal_paise - o.discount_paise - o.bundle_discount_paise - 100 then raise exception 'KH:LIMIT'; end if;  -- goods never below Rs 1 payable
  select coalesce(sum(remaining), 0) into v_avail from public.loyalty_lots where member_id = p_member and remaining > 0 and (expires_at is null or expires_at > now());
  if v_avail < p_points then raise exception 'KH:INSUFFICIENT'; end if;
  insert into public.loyalty_reservations (member_id, order_id, points, value_paise, idem_key) values (p_member, p_order, p_points, v_value, p_key) returning * into res;
  v_need := p_points;
  for r in select id, remaining from public.loyalty_lots where member_id = p_member and remaining > 0 and (expires_at is null or expires_at > now())
           order by expires_at nulls last, created_at, id for update loop
    exit when v_need = 0;
    v_take := least(v_need, r.remaining);
    update public.loyalty_lots set remaining = remaining - v_take where id = r.id;
    insert into public.loyalty_reservation_lots (reservation_id, lot_id, points) values (res.id, r.id, v_take);
    v_need := v_need - v_take;
  end loop;
  insert into public.loyalty_ledger (member_id, order_id, kind, delta_available, delta_reserved, idem_key, actor)
  values (p_member, p_order, 'reserve', -p_points, p_points, 'reserve:' || res.id, 'customer');
  return jsonb_build_object('points', p_points, 'discount_paise', v_value, 'replayed', false);
end $$;

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
      update public.order_items set bundle_discount_paise = bundle_discount_paise + v_disc[i] where id = v_ids[i];
      v_total_disc := v_total_disc + v_disc[i];
    end loop;
  end loop;
  update public.orders set bundle_discount_paise = bundle_discount_paise + v_total_disc, total_paise = subtotal_paise - discount_paise - (bundle_discount_paise + v_total_disc) - loyalty_discount_paise + shipping_paise, updated_at = now() where id = v_order;
  select total_paise into v_new_total from public.orders where id = v_order;
  if v_new_total is distinct from p_expected_total then raise exception 'KH:PRICE_CHANGED'; end if;
  return v_res;
end $$;

create or replace function public.finance_lines(p_from date, p_to date)
returns table (order_id uuid, order_item_id uuid, variant_id uuid, product_name text, pack_size text, paid_at timestamptz,
  qty integer, gross_paise bigint, discount_paise bigint, net_incl_paise bigint, gst_paise bigint, unit_cost_paise integer,
  goods_net_paise bigint, order_shipping_paise integer, refund_goods_paise bigint)
language sql stable as $$
  with b as (select * from public.finance_ist_bounds(p_from, p_to)),
  ro as (
    select o.id, o.shipping_paise, o.subtotal_paise - o.discount_paise - o.bundle_discount_paise as goods_net, pe.paid_at
    from public.orders o
    join lateral (select min(e.at) as paid_at from public.order_events e where e.order_id = o.id and e.kind = 'status' and e.to_status = 'paid') pe on pe.paid_at is not null
    where not o.is_test and pe.paid_at >= (select ts_from from b) and pe.paid_at < (select ts_to from b)
  ),
  rf as (
    -- Refunds that were paid out, per order; goods part first, the rest is shipping.
    select r.order_id, sum(r.amount_paise) as refunded from public.order_refunds r where r.status = 'refunded' group by r.order_id
  )
  select ro.id, i.id, i.variant_id, i.product_name, i.pack_size, ro.paid_at, i.qty, i.line_total_paise, i.discount_paise + i.bundle_discount_paise,
    i.line_total_paise - i.discount_paise - i.bundle_discount_paise as net_incl,
    case when i.gst_rate is null then 0 else round((i.line_total_paise - i.discount_paise - i.bundle_discount_paise) * i.gst_rate / (100 + i.gst_rate))::bigint end as gst,
    public.finance_unit_cost(i.variant_id, ro.paid_at),
    ro.goods_net, ro.shipping_paise,
    case when ro.goods_net <= 0 then 0
         else round(least(coalesce(rf.refunded, 0), ro.goods_net)::numeric * (i.line_total_paise - i.discount_paise - i.bundle_discount_paise) / ro.goods_net)::bigint end
  from ro join public.order_items i on i.order_id = ro.id left join rf on rf.order_id = ro.id
$$;

create or replace function public.order_refund_basis(p_order uuid) returns jsonb language plpgsql stable as $$
declare
  o public.orders%rowtype;
  v_refunded bigint;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  select coalesce(sum(amount_paise), 0) into v_refunded from public.order_refunds where order_id = p_order and status in ('requested', 'approved', 'refunded');
  return jsonb_build_object(
    'order_id', o.id, 'coupon_code', o.coupon_code, 'subtotal_paise', o.subtotal_paise, 'discount_paise', o.discount_paise, 'bundle_discount_paise', o.bundle_discount_paise, 'loyalty_discount_paise', o.loyalty_discount_paise,
    'shipping_paise', o.shipping_paise, 'paid_paise', o.total_paise, 'refund_committed_paise', v_refunded, 'remaining_paise', greatest(o.total_paise - v_refunded, 0),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'product', i.product_name, 'pack_size', i.pack_size, 'qty', i.qty,
        'line_total_paise', i.line_total_paise, 'discount_paise', i.discount_paise, 'bundle_discount_paise', i.bundle_discount_paise, 'loyalty_discount_paise', i.loyalty_discount_paise, 'net_paise', i.line_total_paise - i.discount_paise - i.bundle_discount_paise - i.loyalty_discount_paise,
        'unit_net_paise', (i.line_total_paise - i.discount_paise - i.bundle_discount_paise - i.loyalty_discount_paise) / i.qty) order by i.product_name, i.pack_size) from public.order_items i where i.order_id = o.id), '[]'::jsonb));
end $$;

-- ---- 4. Allocation of a redemption across lines -------------------------------------------------------------------------------
-- Eligible lines in a fixed order (order_items.id), weighted by what is still payable on the line. Same eligibility filter as loyalty_net_eligible.
create or replace function public.loyalty_eligible_lines(p_order uuid) returns table (order_item_id uuid, net_paise bigint) language sql stable as $$
  select i.id, (i.line_total_paise - i.discount_paise - i.bundle_discount_paise - i.loyalty_discount_paise)::bigint
    from public.order_items i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    cross join public.loyalty_settings s
   where i.order_id = p_order
     and not (p.id = any (s.excluded_product_ids))
     and (cardinality(s.eligible_forms) = 0 or p.form = any (s.eligible_forms))
     and (i.line_total_paise - i.discount_paise - i.bundle_discount_paise - i.loyalty_discount_paise) > 0
   order by i.id
$$;

-- Reserve points (loyalty_reserve does every check and takes the points) and apply the value to the order and its lines. Idempotent per order.
create or replace function public.loyalty_apply_to_order(p_member uuid, p_order uuid, p_points integer, p_key text) returns jsonb language plpgsql as $$
declare
  v_res jsonb; v_value bigint; v_ids uuid[]; v_w bigint[]; v_alloc bigint[]; i integer; s public.loyalty_settings%rowtype; v_lines jsonb := '[]'::jsonb; v_total bigint;
begin
  v_res := public.loyalty_reserve(p_member, p_order, p_points, p_key);
  if (v_res ->> 'replayed')::boolean then return v_res; end if;
  v_value := (v_res ->> 'discount_paise')::bigint;
  select array_agg(order_item_id order by order_item_id), array_agg(net_paise order by order_item_id) into v_ids, v_w from public.loyalty_eligible_lines(p_order);
  if v_ids is null then raise exception 'KH:LIMIT'; end if;
  v_alloc := public.bundle_alloc(v_value, v_w);
  for i in 1..array_length(v_ids, 1) loop
    if v_alloc[i] > v_w[i] then raise exception 'KH:LIMIT'; end if;
    update public.order_items set loyalty_discount_paise = loyalty_discount_paise + v_alloc[i] where id = v_ids[i];
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('order_item_id', v_ids[i], 'weight_paise', v_w[i], 'loyalty_paise', v_alloc[i]));
  end loop;
  update public.orders set loyalty_discount_paise = v_value,
         total_paise = subtotal_paise - discount_paise - bundle_discount_paise - v_value + shipping_paise, updated_at = now()
   where id = p_order returning total_paise into v_total;
  select * into s from public.loyalty_settings;
  insert into public.loyalty_order_snapshots (order_id, member_id, points, value_paise, redeem_block_points, redeem_block_paise, max_redeem_bps, lines)
  values (p_order, p_member, p_points, v_value, s.redeem_block_points, s.redeem_block_paise, s.max_redeem_bps, v_lines);
  insert into public.order_events (order_id, kind, note, actor)
  values (p_order, 'note', left('Loyalty points redeemed: ' || p_points || ' points, Rs ' || to_char(v_value / 100.0, 'FM9999990.00') || ' off', 1000), 'loyalty');
  return v_res || jsonb_build_object('total_paise', v_total);
end $$;

-- ---- 5. Shipping, re-derived from the database --------------------------------------------------------------------------------
-- Same rule as shared/checkout.ts quoteShipping: free when free_above_paise is set and the LIST subtotal reaches it, otherwise the PIN rate.
create or replace function public.shipping_expected(p_pincode text, p_list_subtotal bigint) returns integer language plpgsql stable as $$
declare r public.shipping_pincodes%rowtype;
begin
  select * into r from public.shipping_pincodes where pincode = p_pincode and active;
  if not found then raise exception 'KH:NOT_SERVICEABLE'; end if;
  if r.free_above_paise is not null and p_list_subtotal >= r.free_above_paise then return 0; end if;
  return r.rate_paise;
end $$;

-- ---- 6. The single checkout entry point -----------------------------------------------------------------------------------------
-- p_order.items entries: {variant_id, qty} or {bundle_id, qty}. p_expected_total is what the customer was shown (after every saving).
-- p_loyalty_points: 0 for none. Everything happens in this one transaction: any failure rolls back the order, stock, coupon and points together.
create or replace function public.checkout_place_full(
  p_member uuid, p_key uuid, p_hash text, p_order jsonb, p_expected_total bigint, p_test boolean, p_hold_minutes integer, p_min_days integer,
  p_coupon text, p_loyalty_points integer default 0
) returns jsonb language plpgsql as $$
declare
  s public.loyalty_settings%rowtype; v_pts integer := coalesce(p_loyalty_points, 0); v_value bigint := 0; v_has_bundle boolean; v_res jsonb; v_order uuid;
  o public.orders%rowtype; v_apply jsonb;
begin
  if v_pts < 0 then raise exception 'KH:INVALID'; end if;
  if v_pts > 0 then
    select * into s from public.loyalty_settings;
    if not s.enabled then raise exception 'KH:DISABLED'; end if;
    if not (s.redemption_tax_confirmed and s.refund_policy_confirmed) then raise exception 'KH:LOYALTY_POLICY_PENDING'; end if;
    if p_coupon is not null and btrim(p_coupon) <> '' and s.stacking = 'exclusive' then raise exception 'KH:STACKING'; end if;
    if v_pts < s.min_redeem_points or v_pts % s.redeem_block_points <> 0 then raise exception 'KH:LIMIT'; end if;
    v_value := (v_pts / s.redeem_block_points)::bigint * s.redeem_block_paise;   -- from settings, never from the caller
  end if;
  v_has_bundle := exists (select 1 from jsonb_array_elements(p_order -> 'items') e where e ? 'bundle_id');

  -- Place (the inner functions compare the total BEFORE points with p_expected_total + value).
  if v_has_bundle then
    v_res := public.checkout_place_with_bundles(p_member, p_key, p_hash, p_order, p_expected_total + v_value, p_test, p_hold_minutes, p_min_days, p_coupon);
  else
    v_res := public.checkout_place(p_member, p_key, p_hash, p_order, p_expected_total + v_value, p_test, p_hold_minutes, p_min_days, p_coupon);
  end if;
  v_order := (v_res ->> 'order_id')::uuid;
  if (v_res ->> 'replay')::boolean then
    select * into o from public.orders where id = v_order;
    return v_res || jsonb_build_object('total_paise', o.total_paise);
  end if;

  -- Shipping must equal what the database would charge for this PIN and list subtotal.
  select * into o from public.orders where id = v_order;
  if o.shipping_paise is distinct from public.shipping_expected(o.ship_pincode, o.subtotal_paise) then raise exception 'KH:PRICE_CHANGED'; end if;

  if v_pts > 0 then
    v_apply := public.loyalty_apply_to_order(p_member, v_order, v_pts, 'checkout:' || p_key::text);
    if (v_apply ->> 'discount_paise')::bigint is distinct from v_value then raise exception 'KH:PRICE_CHANGED'; end if;
  end if;

  select * into o from public.orders where id = v_order;
  if o.total_paise is distinct from p_expected_total then raise exception 'KH:PRICE_CHANGED'; end if;
  return v_res || jsonb_build_object('total_paise', o.total_paise);
end $$;

revoke all on function public.loyalty_eligible_lines(uuid), public.loyalty_apply_to_order(uuid, uuid, integer, text), public.shipping_expected(text, bigint),
  public.checkout_place_full(uuid, uuid, text, jsonb, bigint, boolean, integer, integer, text, integer),
  public.loyalty_reserve(uuid, uuid, integer, text), public.loyalty_net_eligible(uuid), public.checkout_place_with_bundles(uuid, uuid, text, jsonb, bigint, boolean, integer, integer, text),
  public.finance_lines(date, date), public.order_refund_basis(uuid)
  from public, anon, authenticated;

-- ---- 7. Owner bundle screen: a list that never raises ---------------------------------------------------------------------------
-- bundle_price raises for a draft with a bad price or a missing component price; the owner still needs to SEE those bundles.
create or replace function public.bundle_price_safe(p_bundle uuid) returns jsonb language plpgsql stable as $$
begin
  return public.bundle_price(p_bundle) - 'lines';
exception when others then
  return jsonb_build_object('ok', false, 'error', left(sqlerrm, 80));
end $$;

create or replace function public.bundle_admin_list(p_limit integer default 50, p_offset integer default 0) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'description', b.description, 'gift_note', b.gift_note, 'status', b.status,
             'pricing_mode', b.pricing_mode, 'fixed_price_paise', b.fixed_price_paise, 'percent_bps', b.percent_bps, 'amount_off_paise', b.amount_off_paise,
             'gift_message_allowed', b.gift_message_allowed, 'updated_at', b.updated_at,
             'price', public.bundle_price_safe(b.id), 'sellable', coalesce(public.bundle_components_sellable(b.id), false), 'available', public.bundle_availability(b.id),
             'components', coalesce((select jsonb_agg(jsonb_build_object('variant_id', c.variant_id, 'qty', c.qty, 'product', coalesce(p.public_name, p.internal_name), 'pack_size', v.pack_size, 'price_paise', v.price_paise)
                                      order by p.internal_name, v.pack_size)
                                from public.bundle_components c join public.product_variants v on v.id = c.variant_id join public.products p on p.id = v.product_id
                               where c.bundle_id = b.id), '[]'::jsonb)) as x
      from public.product_bundles b order by b.name limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) t
$$;

revoke all on function public.bundle_price_safe(uuid), public.bundle_admin_list(integer, integer) from public, anon, authenticated;
