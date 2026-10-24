-- Kaayra Rewards: loyalty points, VIP tiers, reservations (V5 Phase 9, database core).
-- Run AFTER inventory_orders.sql, refunds.sql, checkout.sql (orders.member_id, is_test), coupons.sql (orders.discount_paise, coupon_id)
-- and launch_subscribers.sql (admin_audit). Safe to run again: new tables are `if not exists`, functions are replaced, no data is deleted.
-- Server-only: RLS on, no grants to anon or authenticated. Only our API (service role) calls these functions.
-- The program ships OFF (loyalty_settings.enabled = false). Nothing here creates a customer, an order, a point or a balance.
--
-- RULES (also in docs/PHASE9_LOYALTY.md)
--  * Earning basis: eligible NET MERCHANDISE after coupon discount, excluding GST and shipping, in integer paise.
--    points = floor(floor(net * earn_points / earn_per_paise) * tier_multiplier_bps / 10000), then the per-order cap.
--    Orders flagged is_test, unpaid, cancelled, or placed by someone not enrolled when payment arrived earn nothing.
--  * Lifecycle: PENDING (order paid) -> AVAILABLE (order delivered + activation_days) -> RESERVED (checkout) -> REDEEMED,
--    or EXPIRED (expiry_months after activation) or REVERSED (cancel/refund).
--  * Append-only ledger (loyalty_ledger). Balances are sums of its deltas. loyalty_lots is a derived projection used only to
--    spend the earliest-expiring points first; it is written only by the functions below.
--  * Refunds: reversal is proportional to the cumulative refunded amount (idempotent by construction: a repeat event
--    computes a zero difference). A full refund or cancellation also restores redeemed points. If points were already spent, the
--    shortfall becomes `debt_points` on the account and is recovered from the next points that become available. No balance goes negative.
--  * Tier: one model, eligible LIFETIME NET SPEND of orders whose points have been activated, less proportional refunds. No expiry, no renewal.
--  * Coupons: loyalty_settings.stacking = 'exclusive' (default: a coupon order cannot also use points) or 'both'.

-- ---- Settings (one row) ---------------------------------------------------------------------------------------------
create table if not exists public.loyalty_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  earn_points integer not null default 10 check (earn_points between 1 and 1000),
  earn_per_paise bigint not null default 10000 check (earn_per_paise between 100 and 100000000),
  min_order_paise bigint not null default 0 check (min_order_paise between 0 and 1000000000),
  max_points_per_order integer check (max_points_per_order is null or max_points_per_order between 1 and 10000000),
  activation_days integer not null default 7 check (activation_days between 0 and 90),
  expiry_months integer check (expiry_months is null or expiry_months between 1 and 60),
  redeem_block_points integer not null default 100 check (redeem_block_points between 1 and 100000),
  redeem_block_paise integer not null default 1000 check (redeem_block_paise between 1 and 10000000),
  min_redeem_points integer not null default 100 check (min_redeem_points between 1 and 1000000),
  max_redeem_bps integer not null default 2000 check (max_redeem_bps between 0 and 10000),
  stacking text not null default 'exclusive' check (stacking in ('exclusive', 'both')),
  excluded_product_ids uuid[] not null default '{}' check (cardinality(excluded_product_ids) <= 200),
  eligible_forms text[] not null default '{}' check (cardinality(eligible_forms) <= 30),
  birthday_enabled boolean not null default false,
  birthday_points integer not null default 0 check (birthday_points between 0 and 100000),
  birthday_min_enrol_days integer not null default 30 check (birthday_min_enrol_days between 0 and 365),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.loyalty_settings (id) values (true) on conflict (id) do nothing;

-- ---- Tiers (configuration, owner-editable; thresholds are starting values to review) -----------------------------------
create table if not exists public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{3,20}$'),
  name text not null check (char_length(name) between 1 and 40),
  min_spend_paise bigint not null check (min_spend_paise between 0 and 100000000000),
  earn_multiplier_bps integer not null default 10000 check (earn_multiplier_bps between 10000 and 30000),
  sort_order smallint not null unique,
  active boolean not null default true
);
insert into public.loyalty_tiers (code, name, min_spend_paise, earn_multiplier_bps, sort_order) values
  ('SILVER', 'Silver', 0, 10000, 1),
  ('GOLD', 'Gold', 500000, 11000, 2),
  ('PLATINUM', 'Platinum', 2000000, 12500, 3)
on conflict (code) do nothing;

-- ---- Accounts -------------------------------------------------------------------------------------------------------
create table if not exists public.loyalty_accounts (
  member_id uuid primary key references public.members(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  tier_id uuid references public.loyalty_tiers(id) on delete set null,
  lifetime_spend_paise bigint not null default 0 check (lifetime_spend_paise >= 0),
  completed_orders integer not null default 0 check (completed_orders >= 0),
  debt_points integer not null default 0 check (debt_points >= 0),
  birthday_month smallint check (birthday_month is null or birthday_month between 1 and 12),
  birthday_day smallint check (birthday_day is null or birthday_day between 1 and 31),
  birthday_set_at timestamptz,
  birthday_last_year smallint,
  constraint loyalty_birthday_pair check ((birthday_month is null) = (birthday_day is null))
);

-- ---- Lots (projection used for earliest-expiry-first spending) -------------------------------------------------------------
create table if not exists public.loyalty_lots (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  order_id uuid references public.orders(id) on delete restrict,
  source text not null check (source in ('order', 'bonus', 'restore', 'adjust', 'birthday', 'milestone')),
  points integer not null check (points > 0),
  pending_points integer not null default 0 check (pending_points >= 0),
  remaining integer not null default 0 check (remaining >= 0),
  reversed integer not null default 0 check (reversed >= 0),
  spend_paise bigint not null default 0 check (spend_paise >= 0),
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint loyalty_lots_fit check (pending_points + remaining <= points)
);
create unique index if not exists loyalty_lots_one_per_order on public.loyalty_lots (order_id) where source = 'order';
create index if not exists loyalty_lots_spend_idx on public.loyalty_lots (member_id, expires_at nulls last, created_at, id) where remaining > 0;
create index if not exists loyalty_lots_pending_idx on public.loyalty_lots (order_id) where pending_points > 0;
create index if not exists loyalty_lots_expiry_idx on public.loyalty_lots (expires_at) where remaining > 0 and expires_at is not null;

-- ---- Ledger (append-only) --------------------------------------------------------------------------------------------------
create table if not exists public.loyalty_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  lot_id uuid references public.loyalty_lots(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  kind text not null check (kind in ('earn', 'activate', 'reserve', 'release', 'redeem', 'expire', 'reverse', 'restore', 'recover', 'adjust', 'bonus')),
  delta_pending integer not null default 0,
  delta_available integer not null default 0,
  delta_reserved integer not null default 0,
  delta_debt integer not null default 0,
  idem_key text not null unique check (char_length(idem_key) between 3 and 160),
  reason text check (reason is null or char_length(reason) <= 200),
  actor text not null,
  at timestamptz not null default now()
);
create index if not exists loyalty_ledger_member_idx on public.loyalty_ledger (member_id, at desc);
create index if not exists loyalty_ledger_kind_idx on public.loyalty_ledger (kind, at);

create or replace function public.loyalty_append_only() returns trigger language plpgsql as $$
begin raise exception 'KH:APPEND_ONLY'; end $$;
drop trigger if exists loyalty_ledger_ro on public.loyalty_ledger;
create trigger loyalty_ledger_ro before update or delete on public.loyalty_ledger for each row execute function public.loyalty_append_only();
drop trigger if exists loyalty_ledger_ro_trunc on public.loyalty_ledger;
create trigger loyalty_ledger_ro_trunc before truncate on public.loyalty_ledger for each statement execute function public.loyalty_append_only();

-- ---- Reservations ---------------------------------------------------------------------------------------------------------
create table if not exists public.loyalty_reservations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  points integer not null check (points > 0),
  value_paise bigint not null check (value_paise > 0),
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released', 'refunded')),
  idem_key text not null unique,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists loyalty_reservations_status_idx on public.loyalty_reservations (status, created_at);
create table if not exists public.loyalty_reservation_lots (
  reservation_id uuid not null references public.loyalty_reservations(id) on delete cascade,
  lot_id uuid not null references public.loyalty_lots(id) on delete restrict,
  points integer not null check (points > 0),
  primary key (reservation_id, lot_id)
);

-- ---- Tier history (append-only) and milestones ------------------------------------------------------------------------------
create table if not exists public.loyalty_tier_history (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  from_tier uuid references public.loyalty_tiers(id) on delete set null,
  to_tier uuid references public.loyalty_tiers(id) on delete set null,
  spend_paise bigint not null,
  at timestamptz not null default now()
);
drop trigger if exists loyalty_tier_history_ro on public.loyalty_tier_history;
create trigger loyalty_tier_history_ro before update or delete on public.loyalty_tier_history for each row execute function public.loyalty_append_only();

create table if not exists public.loyalty_milestones (
  id uuid primary key default gen_random_uuid(),
  orders_required integer not null unique check (orders_required between 2 and 1000),
  bonus_points integer not null check (bonus_points between 1 and 100000),
  active boolean not null default false
);
create table if not exists public.loyalty_milestone_grants (
  member_id uuid not null references public.members(id) on delete cascade,
  milestone_id uuid not null references public.loyalty_milestones(id) on delete restrict,
  lot_id uuid references public.loyalty_lots(id) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (member_id, milestone_id)
);

-- ---- RLS: on, nobody but the service role ------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['loyalty_settings','loyalty_tiers','loyalty_accounts','loyalty_lots','loyalty_ledger','loyalty_reservations',
                           'loyalty_reservation_lots','loyalty_tier_history','loyalty_milestones','loyalty_milestone_grants'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---- Helpers ----------------------------------------------------------------------------------------------------------------
create or replace function public.loyalty_lock(p_member uuid) returns public.loyalty_accounts language plpgsql as $$
declare a public.loyalty_accounts%rowtype;
begin
  select * into a from public.loyalty_accounts where member_id = p_member for update;
  if not found then raise exception 'KH:NOT_ENROLLED'; end if;
  return a;
end $$;

-- Eligible net merchandise of an order, in paise: line total less coupon discount, excluded products and non-eligible forms left out.
create or replace function public.loyalty_net_eligible(p_order uuid) returns bigint language sql stable as $$
  select coalesce(sum(i.line_total_paise - i.discount_paise), 0)::bigint
    from public.order_items i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    cross join public.loyalty_settings s
   where i.order_id = p_order
     and not (p.id = any (s.excluded_product_ids))
     and (cardinality(s.eligible_forms) = 0 or p.form = any (s.eligible_forms))
$$;

create or replace function public.loyalty_tier_eval(p_member uuid) returns void language plpgsql as $$
declare a public.loyalty_accounts%rowtype; v_to uuid;
begin
  select * into a from public.loyalty_accounts where member_id = p_member;
  if not found then return; end if;
  select id into v_to from public.loyalty_tiers where active and min_spend_paise <= a.lifetime_spend_paise order by min_spend_paise desc, sort_order desc limit 1;
  if v_to is distinct from a.tier_id then
    insert into public.loyalty_tier_history (member_id, from_tier, to_tier, spend_paise) values (p_member, a.tier_id, v_to, a.lifetime_spend_paise);
    update public.loyalty_accounts set tier_id = v_to where member_id = p_member;
  end if;
end $$;

-- ---- Enrolment (consent to marketing is a separate table and is never touched here) ------------------------------------------
create or replace function public.loyalty_enrol(p_member uuid) returns boolean language plpgsql as $$
declare s public.loyalty_settings%rowtype; v_new boolean;
begin
  select * into s from public.loyalty_settings;
  if not s.enabled then raise exception 'KH:DISABLED'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'KH:NOT_FOUND'; end if;
  insert into public.loyalty_accounts (member_id) values (p_member) on conflict (member_id) do nothing;
  get diagnostics v_new = row_count;
  perform public.loyalty_tier_eval(p_member);
  return v_new;
end $$;

-- ---- Earn (PENDING) ----------------------------------------------------------------------------------------------------------
create or replace function public.loyalty_earn_for_order(p_order uuid) returns integer language plpgsql as $$
declare
  o public.orders%rowtype; s public.loyalty_settings%rowtype; a public.loyalty_accounts%rowtype;
  v_net bigint; v_mult integer; v_pts bigint; v_lot uuid;
begin
  select * into s from public.loyalty_settings;
  if not s.enabled then return 0; end if;
  select * into o from public.orders where id = p_order;
  if not found or o.member_id is null or o.is_test or o.status not in ('paid', 'packed', 'shipped', 'delivered') then return 0; end if;
  if not exists (select 1 from public.loyalty_accounts where member_id = o.member_id) then return 0; end if;
  a := public.loyalty_lock(o.member_id);
  v_net := public.loyalty_net_eligible(p_order);
  if v_net <= 0 or v_net < s.min_order_paise then return 0; end if;
  select coalesce((select earn_multiplier_bps from public.loyalty_tiers where id = a.tier_id), 10000) into v_mult;
  v_pts := ((v_net * s.earn_points / s.earn_per_paise) * v_mult) / 10000;
  if s.max_points_per_order is not null then v_pts := least(v_pts, s.max_points_per_order); end if;
  if v_pts <= 0 then return 0; end if;
  insert into public.loyalty_lots (member_id, order_id, source, points, pending_points, spend_paise)
  values (o.member_id, p_order, 'order', v_pts, v_pts, v_net)
  on conflict (order_id) where source = 'order' do nothing
  returning id into v_lot;
  if v_lot is null then return 0; end if;  -- duplicate payment event: already earned
  insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_pending, idem_key, actor)
  values (o.member_id, v_lot, p_order, 'earn', v_pts, 'earn:' || p_order, 'system');
  return v_pts;
end $$;

-- ---- Activate (PENDING -> AVAILABLE) -----------------------------------------------------------------------------------------
create or replace function public.loyalty_activate_due(p_limit integer default 200) returns integer language plpgsql as $$
declare
  s public.loyalty_settings%rowtype; r record; l public.loyalty_lots%rowtype; a public.loyalty_accounts%rowtype;
  v_n integer := 0; v_off integer; v_exp timestamptz; m record; v_ml uuid;
begin
  select * into s from public.loyalty_settings;
  if not s.enabled then return 0; end if;
  for r in
    select l2.id, l2.member_id from public.loyalty_lots l2 join public.orders o on o.id = l2.order_id
     where l2.pending_points > 0 and l2.source = 'order' and o.status = 'delivered'
       and coalesce((select max(e.at) from public.order_events e where e.order_id = o.id and e.to_status = 'delivered'), o.updated_at)
           + make_interval(days => s.activation_days) <= now()
     order by l2.created_at limit greatest(p_limit, 1)
  loop
    a := public.loyalty_lock(r.member_id);
    select * into l from public.loyalty_lots where id = r.id for update;
    continue when l.pending_points <= 0;
    v_exp := case when s.expiry_months is null then null else now() + make_interval(months => s.expiry_months) end;
    update public.loyalty_lots set remaining = pending_points, pending_points = 0, activated_at = now(), expires_at = v_exp where id = l.id;
    insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_pending, delta_available, idem_key, actor)
    values (l.member_id, l.id, l.order_id, 'activate', -l.pending_points, l.pending_points, 'activate:' || l.id, 'system');
    if a.debt_points > 0 then  -- recover earlier reversals of spent points before anything becomes spendable
      v_off := least(a.debt_points, l.pending_points);
      update public.loyalty_lots set remaining = remaining - v_off where id = l.id;
      update public.loyalty_accounts set debt_points = debt_points - v_off where member_id = l.member_id;
      insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_available, delta_debt, idem_key, actor)
      values (l.member_id, l.id, l.order_id, 'recover', -v_off, -v_off, 'recover:' || l.id, 'system');
    end if;
    update public.loyalty_accounts set lifetime_spend_paise = lifetime_spend_paise + l.spend_paise, completed_orders = completed_orders + 1
     where member_id = l.member_id returning * into a;
    perform public.loyalty_tier_eval(l.member_id);
    for m in select * from public.loyalty_milestones where active and orders_required <= a.completed_orders order by orders_required loop
      insert into public.loyalty_milestone_grants (member_id, milestone_id) values (l.member_id, m.id) on conflict do nothing;
      if found then
        insert into public.loyalty_lots (member_id, source, points, remaining, activated_at, expires_at)
        values (l.member_id, 'milestone', m.bonus_points, m.bonus_points, now(), v_exp) returning id into v_ml;
        update public.loyalty_milestone_grants set lot_id = v_ml where member_id = l.member_id and milestone_id = m.id;
        insert into public.loyalty_ledger (member_id, lot_id, kind, delta_available, idem_key, reason, actor)
        values (l.member_id, v_ml, 'bonus', m.bonus_points, 'milestone:' || l.member_id || ':' || m.id, 'Repeat-purchase milestone', 'system');
      end if;
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---- Reserve / release / commit ---------------------------------------------------------------------------------------------
-- The order is read from the database. The only customer input is the number of points and an idempotency key.
create or replace function public.loyalty_reserve(p_member uuid, p_order uuid, p_points integer, p_key text) returns jsonb language plpgsql as $$
declare
  s public.loyalty_settings%rowtype; o public.orders%rowtype; a public.loyalty_accounts%rowtype; res public.loyalty_reservations%rowtype;
  v_value bigint; v_net bigint; v_avail bigint; v_need integer; v_take integer; r record;
begin
  select * into s from public.loyalty_settings;
  if not s.enabled then raise exception 'KH:DISABLED'; end if;
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
  if v_value > o.subtotal_paise - o.discount_paise - 100 then raise exception 'KH:LIMIT'; end if;  -- never below Rs 1 payable
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

create or replace function public.loyalty_release(p_order uuid) returns boolean language plpgsql as $$
declare res public.loyalty_reservations%rowtype; r record;
begin
  select * into res from public.loyalty_reservations where order_id = p_order;
  if not found then return false; end if;
  perform public.loyalty_lock(res.member_id);
  select * into res from public.loyalty_reservations where id = res.id for update;
  if res.status <> 'reserved' then return false; end if;
  for r in select * from public.loyalty_reservation_lots where reservation_id = res.id loop
    update public.loyalty_lots set remaining = remaining + r.points where id = r.lot_id;
  end loop;
  update public.loyalty_reservations set status = 'released', settled_at = now() where id = res.id;
  insert into public.loyalty_ledger (member_id, order_id, kind, delta_available, delta_reserved, idem_key, actor)
  values (res.member_id, p_order, 'release', res.points, -res.points, 'release:' || res.id, 'system');
  return true;
end $$;

create or replace function public.loyalty_commit(p_order uuid) returns boolean language plpgsql as $$
declare res public.loyalty_reservations%rowtype;
begin
  select * into res from public.loyalty_reservations where order_id = p_order and status = 'reserved' for update;
  if not found then return false; end if;
  update public.loyalty_reservations set status = 'committed', settled_at = now() where id = res.id;
  insert into public.loyalty_ledger (member_id, order_id, kind, delta_reserved, idem_key, actor)
  values (res.member_id, p_order, 'redeem', -res.points, 'redeem:' || res.id, 'system');
  return true;
end $$;

-- ---- Reverse (cancel / refund) ------------------------------------------------------------------------------------------------
create or replace function public.loyalty_reverse_for_order(p_order uuid, p_refunded_paise bigint, p_full boolean) returns integer language plpgsql as $$
declare
  o public.orders%rowtype; l public.loyalty_lots%rowtype; s public.loyalty_settings%rowtype; res public.loyalty_reservations%rowtype;
  v_target integer; v_delta integer; v_pend integer; v_avail integer; v_short integer; v_spend_cut bigint; v_full_credit boolean; v_rl uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.member_id is null then return 0; end if;
  select * into l from public.loyalty_lots where order_id = p_order and source = 'order';
  if found then
    perform public.loyalty_lock(l.member_id);
    select * into l from public.loyalty_lots where id = l.id for update;
    v_target := case when p_full or o.total_paise <= 0 then l.points else ((l.points::bigint * least(p_refunded_paise, o.total_paise)) / o.total_paise)::integer end;
    v_delta := v_target - l.reversed;
    if v_delta > 0 then
      v_pend := least(v_delta, l.pending_points);
      v_avail := least(v_delta - v_pend, l.remaining);
      v_short := v_delta - v_pend - v_avail;
      update public.loyalty_lots set reversed = v_target, pending_points = pending_points - v_pend, remaining = remaining - v_avail where id = l.id;
      insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_pending, delta_available, delta_debt, idem_key, reason, actor)
      values (l.member_id, l.id, p_order, 'reverse', -v_pend, -v_avail, v_short, 'reverse:' || l.id || ':' || v_target,
              case when p_full then 'Order cancelled or fully refunded' else 'Partial refund' end, 'system');
      if v_short > 0 then update public.loyalty_accounts set debt_points = debt_points + v_short where member_id = l.member_id; end if;
      if l.activated_at is not null then
        v_spend_cut := (l.spend_paise * v_target) / l.points - (l.spend_paise * l.reversed) / l.points;
        update public.loyalty_accounts set lifetime_spend_paise = greatest(lifetime_spend_paise - v_spend_cut, 0),
               completed_orders = case when v_target >= l.points then greatest(completed_orders - 1, 0) else completed_orders end
         where member_id = l.member_id;
        perform public.loyalty_tier_eval(l.member_id);
      end if;
    end if;
  end if;
  -- Redeemed points come back only when the whole order is cancelled or refunded (partial refunds keep the redemption).
  select * into res from public.loyalty_reservations where order_id = p_order;
  if found and p_full then
    if res.status = 'reserved' then perform public.loyalty_release(p_order);
    elsif res.status = 'committed' then
      perform public.loyalty_lock(res.member_id);
      select * into s from public.loyalty_settings;
      update public.loyalty_reservations set status = 'refunded', settled_at = now() where id = res.id and status = 'committed';
      if found then
        insert into public.loyalty_lots (member_id, order_id, source, points, remaining, activated_at, expires_at)
        values (res.member_id, p_order, 'restore', res.points, res.points, now(),
                case when s.expiry_months is null then null else now() + make_interval(months => s.expiry_months) end) returning id into v_rl;
        insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_available, idem_key, reason, actor)
        values (res.member_id, v_rl, p_order, 'restore', res.points, 'restore:' || res.id, 'Redeemed points restored after full refund or cancellation', 'system');
      end if;
    end if;
  end if;
  return coalesce(v_delta, 0);
end $$;

-- ---- Expire ----------------------------------------------------------------------------------------------------------------
create or replace function public.loyalty_expire_due(p_limit integer default 500) returns integer language plpgsql as $$
declare r record; l public.loyalty_lots%rowtype; v_n integer := 0;
begin
  for r in select id, member_id from public.loyalty_lots where remaining > 0 and expires_at is not null and expires_at <= now() order by expires_at limit greatest(p_limit, 1) loop
    perform public.loyalty_lock(r.member_id);
    select * into l from public.loyalty_lots where id = r.id for update;
    continue when l.remaining <= 0 or l.expires_at is null or l.expires_at > now();
    insert into public.loyalty_ledger (member_id, lot_id, order_id, kind, delta_available, idem_key, actor)
    values (l.member_id, l.id, l.order_id, 'expire', -l.remaining, 'expire:' || l.id, 'system');
    update public.loyalty_lots set remaining = 0 where id = l.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---- Manual adjustment (ledger only; caller must have verified the owner and written admin_audit) ------------------------------
create or replace function public.loyalty_adjust(p_member uuid, p_points integer, p_reason text, p_actor text, p_key text) returns jsonb language plpgsql as $$
declare s public.loyalty_settings%rowtype; v_lot uuid; v_need integer; v_take integer; r record; v_avail bigint;
begin
  if p_points is null or p_points = 0 or abs(p_points) > 100000 then raise exception 'KH:INVALID'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 200 then raise exception 'KH:INVALID'; end if;
  if p_actor is null or p_actor = '' or p_key is null then raise exception 'KH:INVALID'; end if;
  perform public.loyalty_lock(p_member);
  if exists (select 1 from public.loyalty_ledger where idem_key = 'adjust:' || p_key) then return jsonb_build_object('replayed', true); end if;
  select * into s from public.loyalty_settings;
  if p_points > 0 then
    insert into public.loyalty_lots (member_id, source, points, remaining, activated_at, expires_at)
    values (p_member, 'adjust', p_points, p_points, now(), case when s.expiry_months is null then null else now() + make_interval(months => s.expiry_months) end) returning id into v_lot;
    insert into public.loyalty_ledger (member_id, lot_id, kind, delta_available, idem_key, reason, actor) values (p_member, v_lot, 'adjust', p_points, 'adjust:' || p_key, p_reason, p_actor);
  else
    select coalesce(sum(remaining), 0) into v_avail from public.loyalty_lots where member_id = p_member and remaining > 0 and (expires_at is null or expires_at > now());
    if v_avail < -p_points then raise exception 'KH:INSUFFICIENT'; end if;
    v_need := -p_points;
    for r in select id, remaining from public.loyalty_lots where member_id = p_member and remaining > 0 and (expires_at is null or expires_at > now()) order by expires_at nulls last, created_at, id for update loop
      exit when v_need = 0;
      v_take := least(v_need, r.remaining);
      update public.loyalty_lots set remaining = remaining - v_take where id = r.id;
      v_need := v_need - v_take;
    end loop;
    insert into public.loyalty_ledger (member_id, kind, delta_available, idem_key, reason, actor) values (p_member, 'adjust', p_points, 'adjust:' || p_key, p_reason, p_actor);
  end if;
  return jsonb_build_object('replayed', false, 'points', p_points);
end $$;

-- ---- Birthday (optional, month and day only, disabled by default) -------------------------------------------------------------
create or replace function public.loyalty_birthday_set(p_member uuid, p_month integer, p_day integer) returns void language plpgsql as $$
declare a public.loyalty_accounts%rowtype;
begin
  a := public.loyalty_lock(p_member);
  if p_month is null and p_day is null then
    update public.loyalty_accounts set birthday_month = null, birthday_day = null where member_id = p_member;  -- last claim year is kept: removing and re-adding cannot reset it
    return;
  end if;
  if p_month not between 1 and 12 or p_day not between 1 and 31 then raise exception 'KH:INVALID'; end if;
  begin perform make_date(2024, p_month, p_day); exception when others then raise exception 'KH:INVALID'; end;
  if a.birthday_month is not null and (a.birthday_month, a.birthday_day) is distinct from (p_month::smallint, p_day::smallint) and a.birthday_set_at > now() - interval '365 days' then
    raise exception 'KH:BIRTHDAY_LOCKED';
  end if;
  if a.birthday_month is distinct from p_month::smallint or a.birthday_day is distinct from p_day::smallint or a.birthday_set_at is null then
    update public.loyalty_accounts set birthday_month = p_month, birthday_day = p_day, birthday_set_at = now() where member_id = p_member;
  end if;
end $$;

create or replace function public.loyalty_birthday_grant(p_member uuid) returns integer language plpgsql as $$
declare s public.loyalty_settings%rowtype; a public.loyalty_accounts%rowtype; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_lot uuid;
begin
  select * into s from public.loyalty_settings;
  if not (s.enabled and s.birthday_enabled and s.birthday_points > 0) then raise exception 'KH:DISABLED'; end if;
  a := public.loyalty_lock(p_member);
  if a.birthday_month is null or a.birthday_month <> extract(month from v_today) then raise exception 'KH:NOT_ELIGIBLE'; end if;
  if a.birthday_last_year = extract(year from v_today) then raise exception 'KH:ALREADY_CLAIMED'; end if;
  if a.enrolled_at > now() - make_interval(days => s.birthday_min_enrol_days) or a.completed_orders < 1 then raise exception 'KH:NOT_ELIGIBLE'; end if;
  insert into public.loyalty_lots (member_id, source, points, remaining, activated_at, expires_at)
  values (p_member, 'birthday', s.birthday_points, s.birthday_points, now(), case when s.expiry_months is null then null else now() + make_interval(months => s.expiry_months) end) returning id into v_lot;
  insert into public.loyalty_ledger (member_id, lot_id, kind, delta_available, idem_key, reason, actor)
  values (p_member, v_lot, 'bonus', s.birthday_points, 'birthday:' || p_member || ':' || extract(year from v_today)::int, 'Birthday reward', 'system');
  update public.loyalty_accounts set birthday_last_year = extract(year from v_today) where member_id = p_member;
  return s.birthday_points;
end $$;

-- ---- Customer wallet (own member id only; the API passes the session's id, never one from the request) -----------------------
create or replace function public.loyalty_wallet(p_member uuid) returns jsonb language plpgsql stable as $$
declare
  s public.loyalty_settings%rowtype; a public.loyalty_accounts%rowtype; t public.loyalty_tiers%rowtype; nt public.loyalty_tiers%rowtype; b record;
begin
  select * into s from public.loyalty_settings;
  select * into a from public.loyalty_accounts where member_id = p_member;
  if not found then
    return jsonb_build_object('enabled', s.enabled, 'enrolled', false, 'rules', jsonb_build_object('earn_points', s.earn_points, 'earn_per_paise', s.earn_per_paise,
      'redeem_block_points', s.redeem_block_points, 'redeem_block_paise', s.redeem_block_paise, 'activation_days', s.activation_days, 'expiry_months', s.expiry_months));
  end if;
  select coalesce(sum(delta_pending), 0) as pending, coalesce(sum(delta_available), 0) as available, coalesce(sum(delta_reserved), 0) as reserved into b from public.loyalty_ledger where member_id = p_member;
  select * into t from public.loyalty_tiers where id = a.tier_id;
  select * into nt from public.loyalty_tiers where active and min_spend_paise > a.lifetime_spend_paise order by min_spend_paise limit 1;
  return jsonb_build_object(
    'enabled', s.enabled, 'enrolled', true, 'enrolled_at', a.enrolled_at,
    'available', b.available, 'pending', b.pending, 'reserved', b.reserved, 'debt', a.debt_points,
    'expiring_soon', (select coalesce(sum(remaining), 0) from public.loyalty_lots where member_id = p_member and remaining > 0 and expires_at is not null and expires_at <= now() + interval '30 days' and expires_at > now()),
    'next_expiry', (select min(expires_at) from public.loyalty_lots where member_id = p_member and remaining > 0 and expires_at > now()),
    'tier', case when t.id is null then null else jsonb_build_object('code', t.code, 'name', t.name, 'earn_multiplier_bps', t.earn_multiplier_bps) end,
    'next_tier', case when nt.id is null then null else jsonb_build_object('code', nt.code, 'name', nt.name, 'spend_needed_paise', nt.min_spend_paise - a.lifetime_spend_paise) end,
    'birthday', jsonb_build_object('set', a.birthday_month is not null, 'month', a.birthday_month, 'day', a.birthday_day, 'enabled', s.birthday_enabled, 'points', s.birthday_points),
    'rules', jsonb_build_object('earn_points', s.earn_points, 'earn_per_paise', s.earn_per_paise, 'redeem_block_points', s.redeem_block_points, 'redeem_block_paise', s.redeem_block_paise,
      'min_redeem_points', s.min_redeem_points, 'max_redeem_bps', s.max_redeem_bps, 'activation_days', s.activation_days, 'expiry_months', s.expiry_months, 'stacking', s.stacking),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'order_id', x.order_id, 'pending', x.delta_pending, 'available', x.delta_available, 'reserved', x.delta_reserved, 'reason', x.reason) order by x.id desc)
                           from (select * from public.loyalty_ledger where member_id = p_member order by id desc limit 50) x), '[]'::jsonb));
end $$;

-- ---- Read-only analytics (safe for the future owner AI to call; nothing here writes) ----------------------------------------------
create or replace function public.loyalty_overview(p_from timestamptz, p_to timestamptz) returns jsonb language plpgsql stable as $$
declare
  s public.loyalty_settings%rowtype; v_issued bigint; v_redeemed bigint; v_expired bigint; v_pend bigint; v_avail bigint; v_resv bigint; v_enrolled integer; v_active integer;
  v_two integer; v_one integer; v_disc bigint; v_rev bigint;
begin
  select * into s from public.loyalty_settings;
  select count(*) into v_enrolled from public.loyalty_accounts;
  select count(distinct member_id) into v_active from public.loyalty_ledger where at >= now() - interval '90 days';
  select coalesce(sum(delta_pending + delta_available) filter (where kind in ('earn', 'bonus', 'adjust') and delta_pending + delta_available > 0), 0),
         coalesce(-sum(delta_reserved) filter (where kind = 'redeem'), 0), coalesce(-sum(delta_available) filter (where kind = 'expire'), 0)
    into v_issued, v_redeemed, v_expired from public.loyalty_ledger where at >= p_from and at < p_to;
  select coalesce(sum(delta_pending), 0), coalesce(sum(delta_available), 0), coalesce(sum(delta_reserved), 0) into v_pend, v_avail, v_resv from public.loyalty_ledger;
  select count(*) filter (where n >= 2), count(*) into v_two, v_one from (select o.member_id, count(*) n from public.orders o join public.loyalty_accounts a on a.member_id = o.member_id
        where o.status in ('paid', 'packed', 'shipped', 'delivered') and not o.is_test and o.created_at >= a.enrolled_at group by o.member_id) q;
  select coalesce(sum(value_paise), 0) into v_disc from public.loyalty_reservations where status = 'committed' and settled_at >= p_from and settled_at < p_to;
  select coalesce(sum(o.total_paise - o.shipping_paise), 0) into v_rev from public.orders o join public.loyalty_accounts a on a.member_id = o.member_id
   where o.status in ('paid', 'packed', 'shipped', 'delivered') and not o.is_test and o.created_at >= p_from and o.created_at < p_to and o.created_at >= a.enrolled_at;
  return jsonb_build_object(
    'enabled', s.enabled, 'enrolled', v_enrolled, 'active_90d', v_active,
    'points', jsonb_build_object('issued', v_issued, 'redeemed', v_redeemed, 'expired', v_expired, 'pending_now', v_pend, 'available_now', v_avail, 'reserved_now', v_resv),
    'redemption_rate_bps', case when v_issued > 0 then (v_redeemed * 10000 / v_issued) else null end,
    'liability_paise_estimate', ((v_avail + v_resv) / s.redeem_block_points) * s.redeem_block_paise,
    'liability_note', 'Estimate: spendable points (available + reserved) valued at the current redemption rate. Pending points are excluded. Not all points will be redeemed; this is not a cash expense.',
    'redeemed_discount_paise', v_disc,
    'member_merchandise_revenue_paise', v_rev,
    'revenue_note', 'Revenue from enrolled members after enrolment. This is association, not proof that the program caused those sales.',
    'repeat_purchase', jsonb_build_object('members_with_orders', v_one, 'members_with_2plus', v_two),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'members', (select count(*) from public.loyalty_accounts a where a.tier_id = t.id)) order by t.sort_order) from public.loyalty_tiers t), '[]'::jsonb));
end $$;

-- ---- Triggers: order status and refunds drive the lifecycle ------------------------------------------------------------------
create or replace function public.orders_loyalty_sync() returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status or new.member_id is null then return new; end if;
  if new.status = 'paid' then
    perform public.loyalty_commit(new.id);
    perform public.loyalty_earn_for_order(new.id);
  elsif new.status = 'cancelled' then
    perform public.loyalty_reverse_for_order(new.id, new.total_paise, true);
  end if;
  return new;
end $$;
drop trigger if exists orders_loyalty_sync_trg on public.orders;
create trigger orders_loyalty_sync_trg after update of status on public.orders for each row execute function public.orders_loyalty_sync();

create or replace function public.refunds_loyalty_sync() returns trigger language plpgsql as $$
declare v_cum bigint; v_total bigint;
begin
  if new.status <> 'refunded' or (tg_op = 'UPDATE' and old.status = 'refunded') then return new; end if;
  select coalesce(sum(amount_paise), 0) into v_cum from public.order_refunds where order_id = new.order_id and status = 'refunded';
  select total_paise into v_total from public.orders where id = new.order_id;
  perform public.loyalty_reverse_for_order(new.order_id, v_cum, v_cum >= v_total);
  return new;
end $$;
drop trigger if exists refunds_loyalty_sync_trg on public.order_refunds;
create trigger refunds_loyalty_sync_trg after insert or update of status on public.order_refunds for each row execute function public.refunds_loyalty_sync();

-- Every function above is server-only.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'loyalty\_%' or p.proname in ('orders_loyalty_sync', 'refunds_loyalty_sync') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
