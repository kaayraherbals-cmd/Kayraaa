-- Coupons, discounts and promotions (V5 Phase 5). Run AFTER payments_checkout.sql, refunds.sql, delivery_areas.sql and carts.sql.
-- Additive and safe to run again: it creates new tables and columns and replaces functions; it deletes no business data.
-- Server-only: RLS on, no grants to anon or authenticated, every function revoked from them. Only our API (service role) calls it.
-- Nothing here inserts a coupon. There are no sample promotions.
--
-- One authority: every discount is calculated here, in coupon_compute(), from the order's own stored lines. The browser sends a
-- coupon CODE and nothing else about money. Amounts are integer paise.
--
-- Rules (also in docs/COUPONS.md):
--  * One coupon per order (unique index on coupon_redemptions.order_id). No stacking.
--  * Discount applies to ITEMS only, never to shipping. Shipping eligibility for free delivery is still decided on the pre-discount subtotal.
--  * The minimum order amount is compared with the subtotal of the ELIGIBLE items (all items when the coupon has no restrictions).
--  * Percentage: floor(eligible subtotal x basis points / 10000), i.e. rounded DOWN to the paisa. Then the maximum-discount cap, then the
--    eligible subtotal, then the floor below.
--  * Payable floor: an order can never be discounted below 100 paise (Rs 1) in total, because Razorpay cannot take a zero amount.
--  * Product and form lists: when both are set an item must match BOTH. ("Category" in this catalogue is products.form.)
--  * The discount is split across the eligible lines in proportion to their value (largest remainder), so the parts add up exactly.
--  * Usage counts reserved + committed redemptions. A redemption is reserved when the order is placed, committed when it is paid, and
--    released when the order is cancelled or its payment window expires (the existing expiry sweep cancels it).

-- ---- Coupons --------------------------------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  description text check (description is null or char_length(description) <= 200),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  percent_bps integer check (percent_bps is null or percent_bps between 1 and 10000),
  fixed_paise integer check (fixed_paise is null or fixed_paise between 100 and 100000000),
  min_order_paise bigint not null default 0 check (min_order_paise between 0 and 1000000000),
  max_discount_paise bigint check (max_discount_paise is null or max_discount_paise between 100 and 1000000000),
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit between 1 and 10000000),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit between 1 and 1000),
  first_order_only boolean not null default false,
  product_ids uuid[] not null default '{}',
  product_forms text[] not null default '{}',
  active boolean not null default false,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_type_value check (
    (discount_type = 'percent' and percent_bps is not null and fixed_paise is null) or
    (discount_type = 'fixed' and fixed_paise is not null and percent_bps is null)),
  constraint coupons_cap_percent_only check (discount_type = 'percent' or max_discount_paise is null),
  constraint coupons_window check (starts_at is null or expires_at is null or expires_at > starts_at),
  constraint coupons_lists_small check (cardinality(product_ids) <= 100 and cardinality(product_forms) <= 30)
);
create unique index if not exists coupons_code_uidx on public.coupons (code);
create index if not exists coupons_active_idx on public.coupons (active, expires_at);

-- The code never changes after creation: redemptions, orders and reports refer to it.
create or replace function public.coupons_guard() returns trigger language plpgsql as $$
begin
  if new.code is distinct from old.code then raise exception 'KH:INVALID'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists coupons_guard_trg on public.coupons;
create trigger coupons_guard_trg before update on public.coupons for each row execute function public.coupons_guard();

-- ---- Redemptions: who used which coupon on which order, and in what state -------------------------------------
create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  member_id uuid references public.members(id) on delete set null,
  code text not null,
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  discount_paise bigint not null check (discount_paise > 0),
  eligible_subtotal_paise bigint not null check (eligible_subtotal_paise > 0),
  order_subtotal_paise bigint not null check (order_subtotal_paise > 0),
  terms jsonb not null default '{}'::jsonb,
  release_reason text check (release_reason is null or char_length(release_reason) <= 80),
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  constraint coupon_redemptions_state check (
    (status = 'reserved' and committed_at is null and released_at is null) or
    (status = 'committed' and committed_at is not null and released_at is null) or
    (status = 'released' and released_at is not null))
);
-- One coupon per order, ever: this is what makes stacking and double redemption impossible at the table level.
create unique index if not exists coupon_redemptions_order_uidx on public.coupon_redemptions (order_id);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id, status);
create index if not exists coupon_redemptions_member_idx on public.coupon_redemptions (coupon_id, member_id) where status in ('reserved', 'committed');
create index if not exists coupon_redemptions_time_idx on public.coupon_redemptions (reserved_at desc);

-- ---- Applications: every attempt to put a code on a bag (for abuse limits and for support) --------------------
create table if not exists public.coupon_applications (
  id bigint generated always as identity primary key,
  member_id uuid references public.members(id) on delete cascade,
  code_input text not null check (char_length(code_input) <= 40),
  coupon_id uuid references public.coupons(id) on delete set null,
  outcome text not null check (char_length(outcome) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists coupon_applications_member_idx on public.coupon_applications (member_id, created_at desc);

-- ---- Where the order records its discount ---------------------------------------------------------------------
alter table public.carts add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.carts add column if not exists coupon_code text;
alter table public.orders add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0);
alter table public.orders add column if not exists coupon_id uuid references public.coupons(id) on delete restrict;
alter table public.orders add column if not exists coupon_code text;
alter table public.order_items add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_discount_le_line') then
    alter table public.order_items add constraint order_items_discount_le_line check (discount_paise <= line_total_paise);
  end if;
  -- total = subtotal - discount + shipping. Added only when every existing order already satisfies it (they do while discount is 0).
  if not exists (select 1 from pg_constraint where conname = 'orders_total_matches') then
    if exists (select 1 from public.orders where total_paise <> subtotal_paise - discount_paise + shipping_paise) then
      raise notice 'orders_total_matches NOT added: some existing orders have total <> subtotal + shipping. Inspect them first.';
    else
      alter table public.orders add constraint orders_total_matches check (total_paise = subtotal_paise - discount_paise + shipping_paise);
    end if;
  end if;
end $$;
create index if not exists orders_coupon_idx on public.orders (coupon_id) where coupon_id is not null;

-- ---- Helpers ----------------------------------------------------------------------------------------------------
create or replace function public.coupon_normalise_code(p text) returns text language sql immutable as $$
  select upper(btrim(coalesce(p, '')))
$$;

-- The lines of a bag or order, with whether the coupon covers each. p_lines: [{ref, variant_id, line_total_paise}].
create or replace function public.coupon_lines(c public.coupons, p_lines jsonb)
returns table (ref text, amt bigint, eligible boolean) language sql stable as $$
  select l.ref, l.line_total_paise,
         (cardinality(c.product_ids) = 0 or p.id = any(c.product_ids)) and (cardinality(c.product_forms) = 0 or p.form = any(c.product_forms))
    from jsonb_to_recordset(p_lines) as l(ref text, variant_id uuid, line_total_paise bigint)
    join public.product_variants v on v.id = l.variant_id
    join public.products p on p.id = v.product_id
   where l.line_total_paise > 0
$$;

-- The one discount calculation. Returns {ok:true, discount_paise, eligible_paise, subtotal_paise, allocations:[{ref, discount_paise}]}
-- or {ok:false, reason, ...}. Reasons: INACTIVE NOT_STARTED EXPIRED NOT_ELIGIBLE_ITEMS MIN_ORDER USAGE_LIMIT CUSTOMER_LIMIT FIRST_ORDER NO_DISCOUNT.
-- Read-only; callers that must be exact under concurrency lock the coupon row first (coupon_reserve_for_order does).
create or replace function public.coupon_compute(c public.coupons, p_member uuid, p_lines jsonb, p_shipping bigint, p_exclude_order uuid)
returns jsonb language plpgsql stable as $$
declare
  v_total bigint;
  v_elig bigint;
  v_raw bigint;
  v_d bigint;
  v_alloc jsonb;
begin
  if not c.active then return jsonb_build_object('ok', false, 'reason', 'INACTIVE'); end if;
  if c.starts_at is not null and now() < c.starts_at then return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED'); end if;
  if c.expires_at is not null and now() >= c.expires_at then return jsonb_build_object('ok', false, 'reason', 'EXPIRED'); end if;

  select coalesce(sum(amt), 0), coalesce(sum(amt) filter (where eligible), 0) into v_total, v_elig from public.coupon_lines(c, p_lines);
  if v_elig <= 0 then return jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE_ITEMS'); end if;
  if v_elig < c.min_order_paise then return jsonb_build_object('ok', false, 'reason', 'MIN_ORDER', 'min_order_paise', c.min_order_paise); end if;

  if c.usage_limit is not null and (
    select count(*) from public.coupon_redemptions r where r.coupon_id = c.id and r.status in ('reserved', 'committed') and r.order_id is distinct from p_exclude_order
  ) >= c.usage_limit then return jsonb_build_object('ok', false, 'reason', 'USAGE_LIMIT'); end if;

  if p_member is not null and c.per_customer_limit is not null and (
    select count(*) from public.coupon_redemptions r where r.coupon_id = c.id and r.member_id = p_member and r.status in ('reserved', 'committed') and r.order_id is distinct from p_exclude_order
  ) >= c.per_customer_limit then return jsonb_build_object('ok', false, 'reason', 'CUSTOMER_LIMIT'); end if;

  if c.first_order_only then
    if p_member is null or exists (
      select 1 from public.orders o
       where o.member_id = p_member and o.id is distinct from p_exclude_order
         and (o.status in ('paid', 'packed', 'shipped', 'delivered') or (o.status = 'placed' and o.pay_by is not null and o.pay_by > now()))
    ) then return jsonb_build_object('ok', false, 'reason', 'FIRST_ORDER'); end if;
  end if;

  if c.discount_type = 'percent' then v_raw := (v_elig * c.percent_bps) / 10000; else v_raw := c.fixed_paise; end if;
  v_d := v_raw;
  if c.max_discount_paise is not null then v_d := least(v_d, c.max_discount_paise); end if;
  v_d := least(v_d, v_elig);
  -- Payable floor: items + shipping - discount must stay at least 100 paise.
  v_d := least(v_d, v_total + coalesce(p_shipping, 0) - 100);
  if v_d <= 0 then return jsonb_build_object('ok', false, 'reason', 'NO_DISCOUNT'); end if;

  -- Split across eligible lines in proportion to value; the leftover paise go to the largest fractional remainders (ties by ref).
  with e as (select ref, amt from public.coupon_lines(c, p_lines) where eligible),
       b as (select ref, (v_d * amt) / v_elig as fl, (v_d * amt) % v_elig as fr from e),
       r as (select ref, fl, row_number() over (order by fr desc, ref asc) as rn, sum(fl) over () as sf from b)
  select jsonb_agg(jsonb_build_object('ref', ref, 'discount_paise', fl + case when rn <= (v_d - sf) then 1 else 0 end) order by ref) into v_alloc from r;

  return jsonb_build_object('ok', true, 'discount_paise', v_d, 'eligible_paise', v_elig, 'subtotal_paise', v_total, 'allocations', v_alloc);
end $$;

-- ---- Customer: preview a code against a bag (no side effects) ------------------------------------------------------
create or replace function public.coupon_quote(p_member uuid, p_code text, p_lines jsonb, p_shipping bigint)
returns jsonb language plpgsql stable as $$
declare
  c public.coupons%rowtype;
  v jsonb;
begin
  select * into c from public.coupons where code = public.coupon_normalise_code(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  v := public.coupon_compute(c, p_member, p_lines, p_shipping, null);
  return v || jsonb_build_object('code', c.code, 'description', c.description);
end $$;

-- ---- Customer: put a code on the saved bag ----------------------------------------------------------------------------
-- Records the attempt. More than 10 failed attempts in 15 minutes by one member are refused (TOO_MANY), whatever the code.
create or replace function public.coupon_cart_apply(p_member uuid, p_code text, p_lines jsonb)
returns jsonb language plpgsql as $$
declare
  c public.coupons%rowtype;
  v jsonb;
  v_code text := public.coupon_normalise_code(p_code);
  v_cart uuid;
begin
  if p_member is null then raise exception 'KH:INVALID'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    insert into public.coupon_applications (member_id, code_input, outcome) values (p_member, left(v_code, 40), 'malformed');
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if (select count(*) from public.coupon_applications where member_id = p_member and outcome <> 'applied' and created_at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  select * into c from public.coupons where code = v_code;
  if not found then
    insert into public.coupon_applications (member_id, code_input, outcome) values (p_member, v_code, 'not_found');
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  v := public.coupon_compute(c, p_member, p_lines, 0, null);
  insert into public.coupon_applications (member_id, code_input, coupon_id, outcome)
  values (p_member, v_code, c.id, case when (v ->> 'ok')::boolean then 'applied' else lower(v ->> 'reason') end);
  if (v ->> 'ok')::boolean then
    select id into v_cart from public.carts where member_id = p_member for update;
    if v_cart is null then raise exception 'KH:NOT_FOUND'; end if;
    update public.carts set coupon_id = c.id, coupon_code = c.code, updated_at = now() where id = v_cart;
  end if;
  return v || jsonb_build_object('code', c.code, 'description', c.description);
end $$;

create or replace function public.coupon_cart_clear(p_member uuid) returns void language sql as $$
  update public.carts set coupon_id = null, coupon_code = null, updated_at = now() where member_id = p_member and coupon_code is not null;
$$;

-- A paid order empties the bag: the coupon on the bag goes with it (replaces cart_clear from carts.sql).
create or replace function public.cart_clear(p_member uuid)
returns void language sql as $$
  delete from public.cart_items where cart_id in (select id from public.carts where member_id = p_member);
  update public.carts set coupon_id = null, coupon_code = null where member_id = p_member and coupon_code is not null;
$$;

-- ---- Reserve a coupon on a just-created order (same transaction as the order and its stock) ---------------------------
-- Locks the coupon row, so two checkouts racing for the last use are serialised: one gets it, the other gets USAGE_LIMIT.
-- Writes the discount onto the order and its lines, and records a RESERVED redemption.
create or replace function public.coupon_reserve_for_order(p_member uuid, p_order uuid, p_code text)
returns jsonb language plpgsql as $$
declare
  c public.coupons%rowtype;
  o public.orders%rowtype;
  v jsonb;
  v_lines jsonb;
  a jsonb;
  v_d bigint;
begin
  select * into c from public.coupons where code = public.coupon_normalise_code(p_code) for update;
  if not found then raise exception 'KH:COUPON:NOT_FOUND'; end if;
  select * into o from public.orders where id = p_order and member_id is not distinct from p_member for update;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  if o.coupon_id is not null or exists (select 1 from public.coupon_redemptions where order_id = o.id) then raise exception 'KH:COUPON:STACKING'; end if;

  select jsonb_agg(jsonb_build_object('ref', i.id::text, 'variant_id', i.variant_id, 'line_total_paise', i.line_total_paise)) into v_lines from public.order_items i where i.order_id = o.id;
  v := public.coupon_compute(c, p_member, v_lines, o.shipping_paise, o.id);
  if not (v ->> 'ok')::boolean then raise exception 'KH:COUPON:%', v ->> 'reason'; end if;
  v_d := (v ->> 'discount_paise')::bigint;

  for a in select e.value from jsonb_array_elements(v -> 'allocations') e loop
    update public.order_items set discount_paise = (a ->> 'discount_paise')::bigint where id = (a ->> 'ref')::uuid and order_id = o.id;
  end loop;
  if (select coalesce(sum(discount_paise), 0) from public.order_items where order_id = o.id) <> v_d then raise exception 'KH:INVALID'; end if;

  update public.orders set discount_paise = v_d, coupon_id = c.id, coupon_code = c.code, total_paise = subtotal_paise - v_d + shipping_paise, updated_at = now() where id = o.id;
  insert into public.coupon_redemptions (coupon_id, order_id, member_id, code, status, discount_paise, eligible_subtotal_paise, order_subtotal_paise, terms)
  values (c.id, o.id, p_member, c.code, 'reserved', v_d, (v ->> 'eligible_paise')::bigint, o.subtotal_paise,
          jsonb_build_object('type', c.discount_type, 'percent_bps', c.percent_bps, 'fixed_paise', c.fixed_paise, 'min_order_paise', c.min_order_paise, 'max_discount_paise', c.max_discount_paise));
  insert into public.order_events (order_id, kind, note, actor)
  values (o.id, 'note', left('Coupon ' || c.code || ' reserved: Rs ' || to_char(v_d / 100.0, 'FM9999990.00') || ' off', 1000), 'coupon');
  return jsonb_build_object('discount_paise', v_d, 'coupon_id', c.id);
end $$;

-- ---- Place an order, with an optional coupon (replaces the checkout_place signature in checkout.sql by adding p_coupon) --
-- Same behaviour as checkout.sql. The coupon is reserved before the expected-total check, so the customer's displayed total is compared
-- with the real discounted total, and any failure (coupon or stock) rolls back the order, the stock reservation and the redemption together.
create or replace function public.checkout_place(
  p_member uuid, p_key uuid, p_hash text, p_order jsonb, p_expected_total bigint, p_test boolean, p_hold_minutes integer, p_min_days integer, p_coupon text
) returns jsonb language plpgsql as $$
declare
  a public.checkout_attempts%rowtype;
  v_order uuid;
  v_total bigint;
  v_open integer;
begin
  if p_member is null or p_key is null or p_hash is null then raise exception 'KH:INVALID'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'KH:NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout:' || p_member::text, 0));

  select * into a from public.checkout_attempts where member_id = p_member and idempotency_key = p_key;
  if found then
    if a.request_hash <> p_hash then raise exception 'KH:IDEMPOTENCY_MISMATCH'; end if;
    return jsonb_build_object('order_id', a.order_id, 'replay', true);
  end if;

  select ca.* into a
    from public.checkout_attempts ca join public.orders o on o.id = ca.order_id
   where ca.member_id = p_member and ca.request_hash = p_hash and o.status = 'placed' and o.pay_by is not null and o.pay_by > now()
   order by ca.created_at desc limit 1;
  if found then
    insert into public.checkout_attempts (member_id, idempotency_key, request_hash, order_id) values (p_member, p_key, p_hash, a.order_id);
    return jsonb_build_object('order_id', a.order_id, 'replay', true);
  end if;

  select count(*) into v_open from public.orders where member_id = p_member and status = 'placed' and pay_by > now();
  if v_open >= 3 then raise exception 'KH:TOO_MANY_OPEN'; end if;

  if not exists (select 1 from public.shipping_pincodes where pincode = p_order ->> 'ship_pincode' and active) then raise exception 'KH:NOT_SERVICEABLE'; end if;

  v_order := public.order_create(p_order, 'customer:' || p_member::text, p_min_days);
  update public.orders set member_id = p_member, channel = 'online', is_test = p_test, pay_by = now() + make_interval(mins => p_hold_minutes) where id = v_order;

  if p_coupon is not null and btrim(p_coupon) <> '' then perform public.coupon_reserve_for_order(p_member, v_order, p_coupon); end if;

  select total_paise into v_total from public.orders where id = v_order;
  if v_total is distinct from p_expected_total then raise exception 'KH:PRICE_CHANGED'; end if;

  insert into public.checkout_attempts (member_id, idempotency_key, request_hash, order_id) values (p_member, p_key, p_hash, v_order);
  return jsonb_build_object('order_id', v_order, 'replay', false);
end $$;

-- ---- Lifecycle: the redemption follows the order's status, on every path (customer cancel, expiry sweep, admin, webhook) ----
-- paid      : reserved -> committed (once; a second 'paid' update finds nothing reserved)
-- cancelled : reserved -> released (unpaid order cancelled or expired); committed -> released (a PAID order cancelled before it ships:
--             the customer is refunded in full, so the use is given back). Refunds on shipped or delivered orders never release a use.
create or replace function public.orders_coupon_sync() returns trigger language plpgsql as $$
declare
  v_n integer;
begin
  if new.coupon_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'paid' then
    update public.coupon_redemptions set status = 'committed', committed_at = now() where order_id = new.id and status = 'reserved';
    get diagnostics v_n = row_count;
    if v_n > 0 then insert into public.order_events (order_id, kind, note, actor) values (new.id, 'note', left('Coupon ' || new.coupon_code || ' used', 1000), 'coupon'); end if;
  elsif new.status = 'cancelled' then
    update public.coupon_redemptions
       set status = 'released', released_at = now(), release_reason = case when status = 'reserved' then 'unpaid_order_cancelled' else 'paid_order_cancelled' end
     where order_id = new.id and status in ('reserved', 'committed');
    get diagnostics v_n = row_count;
    if v_n > 0 then insert into public.order_events (order_id, kind, note, actor) values (new.id, 'note', left('Coupon ' || new.coupon_code || ' released', 1000), 'coupon'); end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_coupon_sync_trg on public.orders;
create trigger orders_coupon_sync_trg after update of status on public.orders for each row execute function public.orders_coupon_sync();

-- ---- Refund basis: what the customer actually paid per line, after the discount -----------------------------------------
-- Partial refunds must use these figures, not the list price. A line's net value is line_total - discount; the value of q of its qty units
-- is floor(net x q / qty), and of all its units exactly net. Shipping is separate. 'remaining' is what refund_create will still accept.
create or replace function public.order_refund_basis(p_order uuid) returns jsonb language plpgsql stable as $$
declare
  o public.orders%rowtype;
  v_refunded bigint;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
  select coalesce(sum(amount_paise), 0) into v_refunded from public.order_refunds where order_id = p_order and status in ('requested', 'approved', 'refunded');
  return jsonb_build_object(
    'order_id', o.id, 'coupon_code', o.coupon_code, 'subtotal_paise', o.subtotal_paise, 'discount_paise', o.discount_paise,
    'shipping_paise', o.shipping_paise, 'paid_paise', o.total_paise, 'refund_committed_paise', v_refunded, 'remaining_paise', greatest(o.total_paise - v_refunded, 0),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'product', i.product_name, 'pack_size', i.pack_size, 'qty', i.qty,
        'line_total_paise', i.line_total_paise, 'discount_paise', i.discount_paise, 'net_paise', i.line_total_paise - i.discount_paise,
        'unit_net_paise', (i.line_total_paise - i.discount_paise) / i.qty) order by i.product_name, i.pack_size) from public.order_items i where i.order_id = o.id), '[]'::jsonb));
end $$;

-- ---- Admin: list with usage, and analytics from real orders ---------------------------------------------------------------
-- status filter: all | active (switched on and inside its dates) | scheduled | expired | inactive
create or replace function public.coupon_admin_list(p_q text, p_status text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total from public.coupons c
   where (v_q is null or c.code ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or c.description ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
     and case coalesce(p_status, 'all')
           when 'active' then c.active and (c.starts_at is null or c.starts_at <= now()) and (c.expires_at is null or c.expires_at > now())
           when 'scheduled' then c.active and c.starts_at > now()
           when 'expired' then c.expires_at <= now()
           when 'inactive' then not c.active
           else true end;
  select coalesce(jsonb_agg(x order by (x ->> 'created_at') desc), '[]'::jsonb) into v_items from (
    select to_jsonb(c) || jsonb_build_object(
      'reserved', coalesce(s.reserved, 0), 'committed', coalesce(s.committed, 0), 'released', coalesce(s.released, 0),
      'discount_committed_paise', coalesce(s.disc, 0),
      'state', case when not c.active then 'inactive' when c.expires_at <= now() then 'expired' when c.starts_at > now() then 'scheduled' else 'active' end) as x
      from public.coupons c
      left join (select coupon_id, count(*) filter (where status = 'reserved') as reserved, count(*) filter (where status = 'committed') as committed,
                        count(*) filter (where status = 'released') as released, coalesce(sum(discount_paise) filter (where status = 'committed'), 0) as disc
                   from public.coupon_redemptions group by coupon_id) s on s.coupon_id = c.id
     where (v_q is null or c.code ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or c.description ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
       and case coalesce(p_status, 'all')
             when 'active' then c.active and (c.starts_at is null or c.starts_at <= now()) and (c.expires_at is null or c.expires_at > now())
             when 'scheduled' then c.active and c.starts_at > now()
             when 'expired' then c.expires_at <= now()
             when 'inactive' then not c.active
             else true end
     order by c.created_at desc
     limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  ) t;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

-- Analytics over [p_from, p_to) from real redemptions and orders. "Revenue with a coupon" is the amount paid on orders that used one:
-- it is attribution, not proof that the coupon created the sale, and the figures say so. Refunded money is shown separately.
create or replace function public.coupon_analytics(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
begin
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'totals', (select jsonb_build_object(
        'redemptions', count(*), 'discount_paise', coalesce(sum(r.discount_paise), 0), 'revenue_paise', coalesce(sum(o.total_paise), 0),
        'average_order_paise', case when count(*) = 0 then null else (sum(o.total_paise) / count(*)) end,
        'refunded_paise', coalesce(sum((select coalesce(sum(f.amount_paise), 0) from public.order_refunds f where f.order_id = o.id and f.status = 'refunded')), 0))
       from public.coupon_redemptions r join public.orders o on o.id = r.order_id where r.status = 'committed' and r.committed_at >= v_from and r.committed_at < v_to),
    'all_orders', (select jsonb_build_object('orders', count(*), 'average_order_paise', case when count(*) = 0 then null else sum(o.total_paise) / count(*) end)
       from public.orders o where o.status in ('paid', 'packed', 'shipped', 'delivered') and o.created_at >= v_from and o.created_at < v_to),
    'per_coupon', (select coalesce(jsonb_agg(t order by (t ->> 'redemptions')::int desc, t ->> 'code'), '[]'::jsonb) from (
        select jsonb_build_object('coupon_id', c.id, 'code', c.code, 'redemptions', count(*), 'discount_paise', coalesce(sum(r.discount_paise), 0),
               'revenue_paise', coalesce(sum(o.total_paise), 0), 'average_order_paise', sum(o.total_paise) / nullif(count(*), 0)) as t
          from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id join public.orders o on o.id = r.order_id
         where r.status = 'committed' and r.committed_at >= v_from and r.committed_at < v_to group by c.id, c.code) q),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'redemptions', d.n, 'discount_paise', d.disc) order by d.day), '[]'::jsonb) from (
        select to_char((r.committed_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*) as n, coalesce(sum(r.discount_paise), 0) as disc
          from public.coupon_redemptions r where r.status = 'committed' and r.committed_at >= v_from and r.committed_at < v_to group by 1) d),
    'reserved_now', (select count(*) from public.coupon_redemptions where status = 'reserved'),
    'active_campaigns', (select count(*) from public.coupons c where c.active and (c.starts_at is null or c.starts_at <= now()) and (c.expires_at is null or c.expires_at > now())),
    'expired_coupons', (select count(*) from public.coupons c where c.expires_at <= now()));
end $$;

-- ---- Lock everything down: only the server (service role) touches these ---------------------------------------------------
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.coupon_applications enable row level security;
revoke all on public.coupons, public.coupon_redemptions, public.coupon_applications from anon, authenticated;
revoke all on function public.coupons_guard() from public, anon, authenticated;
revoke all on function public.orders_coupon_sync() from public, anon, authenticated;
revoke all on function public.coupon_normalise_code(text) from public, anon, authenticated;
revoke all on function public.coupon_lines(public.coupons, jsonb) from public, anon, authenticated;
revoke all on function public.coupon_compute(public.coupons, uuid, jsonb, bigint, uuid) from public, anon, authenticated;
revoke all on function public.coupon_quote(uuid, text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.coupon_cart_apply(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.coupon_cart_clear(uuid) from public, anon, authenticated;
revoke all on function public.cart_clear(uuid) from public, anon, authenticated;
revoke all on function public.coupon_reserve_for_order(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.checkout_place(uuid, uuid, text, jsonb, bigint, boolean, integer, integer, text) from public, anon, authenticated;
revoke all on function public.order_refund_basis(uuid) from public, anon, authenticated;
revoke all on function public.coupon_admin_list(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.coupon_analytics(timestamptz, timestamptz) from public, anon, authenticated;
