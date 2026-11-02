-- Phase 8: Business intelligence and profit tracking (database core). Run after inventory_orders, refunds, payments, shipments,
-- coupons (and the files they need; see docs/DATABASE_MIGRATIONS.md #29). Additive and safe to run again. Server-only:
-- RLS on, no policies, no grants to anon or authenticated. Nothing here changes checkout, stock, payments or refunds.
-- All money is integer paise. Reporting days are India time (Asia/Kolkata); a period is [from, to) in India dates.
-- Revenue is recognised when an order FIRST reaches "paid" (order_events). Test orders are excluded.

-- ---- Product cost history (append-only; a cost change adds a row, it never edits one) ---------------------------------
create table if not exists public.product_cost_history (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  purchase_paise integer not null default 0 check (purchase_paise between 0 and 100000000),
  manufacturing_paise integer not null default 0 check (manufacturing_paise between 0 and 100000000),
  packaging_paise integer not null default 0 check (packaging_paise between 0 and 100000000),
  other_paise integer not null default 0 check (other_paise between 0 and 100000000),
  unit_cost_paise integer generated always as (purchase_paise + manufacturing_paise + packaging_paise + other_paise) stored,
  effective_from timestamptz not null,
  source text not null check (source in ('supplier_invoice', 'production_batch', 'owner_estimate', 'other')),
  note text check (note is null or char_length(note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint cost_positive check (purchase_paise + manufacturing_paise + packaging_paise + other_paise > 0),
  unique (variant_id, effective_from)
);
create index if not exists product_cost_history_lookup_idx on public.product_cost_history (variant_id, effective_from desc);

create or replace function public.finance_append_only() returns trigger language plpgsql as $$
begin raise exception 'KH:APPEND_ONLY'; end $$;
drop trigger if exists product_cost_history_no_change on public.product_cost_history;
create trigger product_cost_history_no_change before update or delete on public.product_cost_history for each row execute function public.finance_append_only();
drop trigger if exists product_cost_history_no_truncate on public.product_cost_history;
create trigger product_cost_history_no_truncate before truncate on public.product_cost_history for each statement execute function public.finance_append_only();

-- ---- Business expenses (edited in place; a wrong entry is voided, never deleted) --------------------------------------
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (category in ('packaging', 'shipping', 'advertising', 'marketing', 'software', 'payment_processing', 'warehouse', 'utilities', 'salaries', 'miscellaneous')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  description text not null check (char_length(btrim(description)) between 3 and 300),
  vendor text check (vendor is null or char_length(vendor) <= 120),
  reference text check (reference is null or char_length(reference) <= 80),
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint void_needs_reason check (status = 'active' or void_reason is not null)
);
-- The same date, category, amount, vendor and reference cannot be entered twice while both are active.
create unique index if not exists business_expenses_dedupe_idx on public.business_expenses (expense_date, category, amount_paise, (lower(coalesce(btrim(vendor), ''))), (lower(coalesce(btrim(reference), '')))) where status = 'active';
create index if not exists business_expenses_date_idx on public.business_expenses (expense_date desc, category);

-- ---- Payment fees (recorded from the Razorpay settlement report; nothing is estimated) ------------------------------
create table if not exists public.payment_fee_records (
  id uuid primary key default gen_random_uuid(),
  order_payment_id uuid not null unique references public.order_payments(id) on delete restrict,
  fee_paise integer not null check (fee_paise >= 0),
  fee_tax_paise integer not null default 0 check (fee_tax_paise >= 0),
  refund_fee_reversal_paise integer not null default 0 check (refund_fee_reversal_paise >= 0),
  settlement_ref text check (settlement_ref is null or char_length(settlement_ref) <= 80),
  source text not null check (source in ('razorpay_settlement', 'owner_entry')),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint reversal_within_fee check (refund_fee_reversal_paise <= fee_paise + fee_tax_paise)
);

-- ---- Shipping cost (carrier charge per shipment; "estimated" is shown apart and never counted as confirmed) --------------
create table if not exists public.shipment_cost_records (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references public.shipments(id) on delete restrict,
  cost_paise integer not null check (cost_paise >= 0 and cost_paise <= 100000000),
  basis text not null check (basis in ('confirmed', 'estimated')),
  note text check (note is null or char_length(note) <= 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Owner KPI targets (set by hand; nothing is invented or changed automatically) ------------------------------------
create table if not exists public.financial_kpi_targets (
  kpi text primary key check (kpi in ('monthly_revenue_paise', 'monthly_orders', 'gross_margin_bps', 'refund_rate_bps', 'inventory_turnover_x100')),
  target bigint not null check (target > 0),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

-- ---- Lockdown ---------------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['product_cost_history', 'business_expenses', 'payment_fee_records', 'shipment_cost_records', 'financial_kpi_targets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---- Recognised orders: one row per paid, non-test order whose FIRST paid time falls in the period ---------------------------
create or replace function public.finance_ist_bounds(p_from date, p_to date, out ts_from timestamptz, out ts_to timestamptz)
language plpgsql immutable as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'KH:INVALID'; end if;
  if p_to - p_from > 800 then raise exception 'KH:INVALID'; end if;
  ts_from := (p_from::timestamp) at time zone 'Asia/Kolkata';
  ts_to := (p_to::timestamp) at time zone 'Asia/Kolkata';
end $$;

-- Cost per unit in force at a moment: the newest row whose effective_from is at or before it. Null when none (unknown).
create or replace function public.finance_unit_cost(p_variant uuid, p_at timestamptz) returns integer language sql stable as $$
  select unit_cost_paise from public.product_cost_history where variant_id = p_variant and effective_from <= p_at order by effective_from desc limit 1
$$;

-- Per-line facts used by every report, so the dashboard, products and exports cannot disagree.
create or replace function public.finance_lines(p_from date, p_to date)
returns table (order_id uuid, order_item_id uuid, variant_id uuid, product_name text, pack_size text, paid_at timestamptz,
  qty integer, gross_paise bigint, discount_paise bigint, net_incl_paise bigint, gst_paise bigint, unit_cost_paise integer,
  goods_net_paise bigint, order_shipping_paise bigint, refund_goods_paise bigint)
language sql stable as $$
  with b as (select * from public.finance_ist_bounds(p_from, p_to)),
  ro as (
    select o.id, o.shipping_paise, o.subtotal_paise - o.discount_paise as goods_net, pe.paid_at
    from public.orders o
    join lateral (select min(e.at) as paid_at from public.order_events e where e.order_id = o.id and e.kind = 'status' and e.to_status = 'paid') pe on pe.paid_at is not null
    where not o.is_test and pe.paid_at >= (select ts_from from b) and pe.paid_at < (select ts_to from b)
  ),
  rf as (
    -- Refunds that were paid out, per order; goods part first, the rest is shipping.
    select r.order_id, sum(r.amount_paise) as refunded from public.order_refunds r where r.status = 'refunded' group by r.order_id
  )
  select ro.id, i.id, i.variant_id, i.product_name, i.pack_size, ro.paid_at, i.qty, i.line_total_paise, i.discount_paise,
    i.line_total_paise - i.discount_paise as net_incl,
    case when i.gst_rate is null then 0 else round((i.line_total_paise - i.discount_paise) * i.gst_rate / (100 + i.gst_rate))::bigint end as gst,
    public.finance_unit_cost(i.variant_id, ro.paid_at),
    ro.goods_net, ro.shipping_paise,
    case when ro.goods_net <= 0 then 0
         else round(least(coalesce(rf.refunded, 0), ro.goods_net)::numeric * (i.line_total_paise - i.discount_paise) / ro.goods_net)::bigint end
  from ro join public.order_items i on i.order_id = ro.id left join rf on rf.order_id = ro.id
$$;

-- ---- Period summary: only integer building blocks; profit is composed in shared/finance.ts from these --------------------------
create or replace function public.finance_period_summary(p_from date, p_to date)
returns jsonb language plpgsql stable as $$
declare
  b record; v jsonb;
begin
  select * into b from public.finance_ist_bounds(p_from, p_to);
  with l as (select * from public.finance_lines(p_from, p_to)),
  ord as (
    select o.id, max(l.order_shipping_paise) as shipping from l join public.orders o on o.id = l.order_id group by o.id
  ),
  rfn as (
    select r.* from public.order_refunds r where r.status = 'refunded' and r.refunded_at >= b.ts_from and r.refunded_at < b.ts_to
  ),
  fees as (
    select coalesce(sum(f.fee_paise + f.fee_tax_paise - f.refund_fee_reversal_paise), 0) as fee_paise, count(*) as fee_orders
    from public.payment_fee_records f join public.order_payments p on p.id = f.order_payment_id
    where p.status = 'captured' and p.order_id in (select id from ord)
  ),
  ship as (
    select coalesce(sum(case when c.basis = 'confirmed' then c.cost_paise end), 0) as confirmed,
           coalesce(sum(case when c.basis = 'estimated' then c.cost_paise end), 0) as estimated,
           count(distinct s.order_id) filter (where c.basis = 'confirmed') as confirmed_orders
    from public.shipments s join public.shipment_cost_records c on c.shipment_id = s.id where s.order_id in (select id from ord)
  ),
  exp as (
    select category, sum(amount_paise) as amt from public.business_expenses
    where status = 'active' and expense_date >= p_from and expense_date < p_to group by category
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'orders', (select count(*) from ord),
    'units', (select coalesce(sum(qty), 0) from l),
    'gross_sales_paise', (select coalesce(sum(gross_paise), 0) from l),
    'discount_paise', (select coalesce(sum(discount_paise), 0) from l),
    'net_incl_tax_paise', (select coalesce(sum(net_incl_paise), 0) from l),
    'gst_paise', (select coalesce(sum(gst_paise), 0) from l),
    'shipping_charged_paise', (select coalesce(sum(shipping), 0) from ord),
    'cogs_paise', (select coalesce(sum(qty::bigint * unit_cost_paise), 0) from l where unit_cost_paise is not null),
    'units_with_cost', (select coalesce(sum(qty), 0) from l where unit_cost_paise is not null),
    'units_without_cost', (select coalesce(sum(qty), 0) from l where unit_cost_paise is null),
    'refund_count', (select count(*) from rfn),
    'refund_paise', (select coalesce(sum(amount_paise), 0) from rfn),
    'fee_paise', (select fee_paise from fees), 'fee_orders', (select fee_orders from fees),
    'ship_cost_confirmed_paise', (select confirmed from ship), 'ship_cost_estimated_paise', (select estimated from ship),
    'ship_cost_orders', (select confirmed_orders from ship),
    'online_orders', (select count(*) from ord o join public.orders x on x.id = o.id where x.channel = 'online'),
    'shipped_orders', (select count(distinct s.order_id) from public.shipments s where s.order_id in (select id from ord) and s.status <> 'cancelled'),
    'expenses', coalesce((select jsonb_object_agg(category, amt) from exp), '{}'::jsonb),
    'cancelled_paid_without_refund', (
      select count(*) from ord o join public.orders x on x.id = o.id
      where x.status = 'cancelled' and not exists (select 1 from public.order_refunds r where r.order_id = x.id and r.status in ('approved', 'refunded'))
    )
  ) into v;
  return v;
end $$;

-- Per-day series of recognised revenue (net incl. tax + shipping) and order count, for charts and the forecast.
create or replace function public.finance_daily_series(p_from date, p_to date)
returns jsonb language sql stable as $$
  with l as (select * from public.finance_lines(p_from, p_to)),
  d as (
    select (l.paid_at at time zone 'Asia/Kolkata')::date as day, l.order_id, sum(l.net_incl_paise) as net, max(l.order_shipping_paise) as ship, sum(l.qty) as units
    from l group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', day, 'orders', n, 'net_paise', net, 'shipping_paise', sh, 'units', u) order by day), '[]'::jsonb)
  from (select day, count(*) as n, sum(net) as net, sum(ship) as sh, sum(units) as u from d group by day) x
$$;

-- Product and pack-size profitability, one page. p_sort: revenue | profit | margin | units | margin_asc | refunds
create or replace function public.finance_product_profitability(p_from date, p_to date, p_sort text default 'revenue', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable as $$
declare v jsonb; lim integer := least(greatest(coalesce(p_limit, 50), 1), 200); off integer := greatest(coalesce(p_offset, 0), 0);
begin
  with l as (select * from public.finance_lines(p_from, p_to)),
  g as (
    select variant_id, max(product_name) as product_name, max(pack_size) as pack_size, sum(qty) as units,
      sum(gross_paise) as gross, sum(discount_paise) as discount, sum(net_incl_paise) as net_incl, sum(gst_paise) as gst,
      sum(refund_goods_paise) as refunds,
      sum(qty::bigint * unit_cost_paise) filter (where unit_cost_paise is not null) as cogs,
      sum(qty) filter (where unit_cost_paise is null) as units_without_cost
    from l group by variant_id
  ), s as (
    select g.*, g.net_incl - g.gst as net_ex_tax,
      case when g.units_without_cost is null then g.net_incl - g.gst - g.refunds - coalesce(g.cogs, 0) end as gross_profit
    from g
  ), stock as (
    select variant_id, sum(qty_on_hand - qty_reserved) as available from public.inventory_batches where status = 'active' and expiry_date >= (now() at time zone 'Asia/Kolkata')::date group by variant_id
  ), r as (
    select s.*, coalesce(stock.available, 0) as available,
      case when s.gross_profit is not null and s.net_ex_tax > 0 then round(s.gross_profit * 10000.0 / s.net_ex_tax) end as margin_bps
    from s left join stock using (variant_id)
  )
  select jsonb_build_object('total', (select count(*) from r), 'items', coalesce(jsonb_agg(to_jsonb(q) - 'x'), '[]'::jsonb))
  into v from (
    select * from r order by
      case p_sort when 'profit' then gross_profit when 'margin' then margin_bps when 'units' then units when 'refunds' then refunds when 'revenue' then net_incl end desc nulls last,
      case when p_sort = 'margin_asc' then margin_bps end asc nulls last,
      variant_id
    limit lim offset off
  ) q;
  return v;
end $$;

-- Refund impact in a period (by refund date), by reason and by month.
create or replace function public.finance_refund_impact(p_from date, p_to date)
returns jsonb language plpgsql stable as $$
declare b record; v jsonb;
begin
  select * into b from public.finance_ist_bounds(p_from, p_to);
  select jsonb_build_object(
    'by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason_code, 'count', n, 'paise', amt) order by amt desc) from (
        select reason_code, count(*) n, sum(amount_paise) amt from public.order_refunds where status = 'refunded' and refunded_at >= b.ts_from and refunded_at < b.ts_to group by 1) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'count', n, 'paise', amt) order by m) from (
        select to_char(refunded_at at time zone 'Asia/Kolkata', 'YYYY-MM') m, count(*) n, sum(amount_paise) amt from public.order_refunds where status = 'refunded' and refunded_at >= b.ts_from and refunded_at < b.ts_to group by 1) x), '[]'::jsonb),
    'pending_paise', (select coalesce(sum(amount_paise), 0) from public.order_refunds where status in ('requested', 'approved') and requested_at >= b.ts_from and requested_at < b.ts_to)
  ) into v;
  return v;
end $$;

-- Inventory valuation now (nothing historical is stored, so this is "as of today", India time).
create or replace function public.finance_inventory_valuation(p_expiry_days integer default 90, p_slow_days integer default 90)
returns jsonb language plpgsql stable as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; v jsonb; ed integer := least(greatest(coalesce(p_expiry_days, 90), 1), 730); sd integer := least(greatest(coalesce(p_slow_days, 90), 7), 730);
begin
  with cost as (
    select distinct on (variant_id) variant_id, unit_cost_paise from public.product_cost_history where effective_from <= now() order by variant_id, effective_from desc
  ), sold as (
    select i.variant_id, sum(i.qty) as units from public.order_items i join public.orders o on o.id = i.order_id
    where not o.is_test and exists (select 1 from public.order_events e where e.order_id = o.id and e.kind = 'status' and e.to_status = 'paid' and e.at >= now() - make_interval(days => sd))
    group by i.variant_id
  ), bt as (
    select b.*, v.price_paise, v.low_stock_threshold, c.unit_cost_paise,
      (b.expiry_date < today) as expired, (b.expiry_date >= today and b.expiry_date < today + ed) as expiring,
      (b.status = 'active' and b.expiry_date >= today) as sellable
    from public.inventory_batches b join public.product_variants v on v.id = b.variant_id left join cost c on c.variant_id = b.variant_id where b.qty_on_hand > 0
  ), vs as (
    select variant_id, sum(qty_on_hand - qty_reserved) filter (where sellable) as sellable_units, max(low_stock_threshold) as threshold from bt group by variant_id
  )
  select jsonb_build_object(
    'as_of', today,
    'units_on_hand', (select coalesce(sum(qty_on_hand), 0) from bt),
    'units_reserved', (select coalesce(sum(qty_reserved), 0) from bt),
    'units_available', (select coalesce(sum(qty_on_hand - qty_reserved), 0) from bt where sellable),
    'units_blocked', (select coalesce(sum(qty_on_hand), 0) from bt where status in ('quarantine', 'recalled')),
    'units_without_cost', (select coalesce(sum(qty_on_hand), 0) from bt where unit_cost_paise is null),
    'cost_value_paise', (select coalesce(sum(qty_on_hand::bigint * unit_cost_paise), 0) from bt where unit_cost_paise is not null),
    'selling_value_paise', (select coalesce(sum(qty_on_hand::bigint * price_paise), 0) from bt where price_paise is not null),
    'expired_units', (select coalesce(sum(qty_on_hand), 0) from bt where expired),
    'expired_cost_paise', (select coalesce(sum(qty_on_hand::bigint * unit_cost_paise), 0) from bt where expired and unit_cost_paise is not null),
    'expiring_units', (select coalesce(sum(qty_on_hand), 0) from bt where expiring),
    'expiring_cost_paise', (select coalesce(sum(qty_on_hand::bigint * unit_cost_paise), 0) from bt where expiring and unit_cost_paise is not null),
    'expiry_window_days', ed,
    'low_stock_variants', (select count(*) from vs where coalesce(sellable_units, 0) <= threshold),
    'low_stock_cost_paise', (select coalesce(sum(bt.qty_on_hand::bigint * bt.unit_cost_paise), 0) from bt join vs using (variant_id) where coalesce(vs.sellable_units, 0) <= vs.threshold and bt.unit_cost_paise is not null),
    'slow_window_days', sd,
    'slow_units', (select coalesce(sum(bt.qty_on_hand), 0) from bt left join sold using (variant_id) where bt.sellable and coalesce(sold.units, 0) = 0),
    'slow_cost_paise', (select coalesce(sum(bt.qty_on_hand::bigint * bt.unit_cost_paise), 0) from bt left join sold using (variant_id) where bt.sellable and coalesce(sold.units, 0) = 0 and bt.unit_cost_paise is not null)
  ) into v;
  return v;
end $$;

-- Customer metrics from paid, non-test orders. Only counts and sums leave the database; no names, emails or ids.
create or replace function public.finance_customer_metrics(p_from date, p_to date)
returns jsonb language plpgsql stable as $$
declare b record; v jsonb;
begin
  select * into b from public.finance_ist_bounds(p_from, p_to);
  with po as (
    select o.id, coalesce(o.member_id::text, 'e:' || lower(nullif(btrim(o.customer_email), '')), 'o:' || o.id::text) as ckey,
      o.total_paise, (select min(e.at) from public.order_events e where e.order_id = o.id and e.kind = 'status' and e.to_status = 'paid') as paid_at
    from public.orders o where not o.is_test
  ), p as (select * from po where paid_at is not null),
  first_paid as (select ckey, min(paid_at) as first_at from p group by ckey),
  inper as (select p.* from p where paid_at >= b.ts_from and paid_at < b.ts_to),
  cust as (
    select i.ckey, count(*) as n, sum(i.total_paise) as spend, (f.first_at >= b.ts_from) as is_new, to_char(f.first_at at time zone 'Asia/Kolkata', 'YYYY-MM') as cohort
    from inper i join first_paid f using (ckey) group by i.ckey, f.first_at
  ), life as (select ckey, count(*) as n, sum(total_paise) as spend from p group by ckey)
  select jsonb_build_object(
    'customers', (select count(*) from cust),
    'new_customers', (select count(*) from cust where is_new),
    'returning_customers', (select count(*) from cust where not is_new),
    'orders', (select coalesce(sum(n), 0) from cust),
    'revenue_paise', (select coalesce(sum(spend), 0) from cust),
    'repeat_customers_in_period', (select count(*) from cust where n >= 2),
    'lifetime_customers', (select count(*) from life),
    'lifetime_repeat_customers', (select count(*) from life where n >= 2),
    'lifetime_orders', (select coalesce(sum(n), 0) from life),
    'lifetime_revenue_paise', (select coalesce(sum(spend), 0) from life),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('cohort', cohort, 'customers', c, 'orders', o, 'revenue_paise', r) order by cohort) from (
        select cohort, count(*) c, sum(n) o, sum(spend) r from cust group by cohort) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---- Writers (each runs in one transaction; the API writes the audit entry) -----------------------------------------------
create or replace function public.finance_cost_add(p_variant uuid, p_purchase integer, p_manufacturing integer, p_packaging integer, p_other integer, p_from timestamptz, p_source text, p_note text, p_actor text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if not exists (select 1 from public.product_variants where id = p_variant) then raise exception 'KH:NOT_FOUND'; end if;
  if p_from > now() + interval '1 day' then raise exception 'KH:INVALID'; end if;
  insert into public.product_cost_history (variant_id, purchase_paise, manufacturing_paise, packaging_paise, other_paise, effective_from, source, note, created_by)
  values (p_variant, coalesce(p_purchase, 0), coalesce(p_manufacturing, 0), coalesce(p_packaging, 0), coalesce(p_other, 0), p_from, p_source, nullif(btrim(p_note), ''), p_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.finance_expense_save(p_id uuid, p_date date, p_category text, p_amount bigint, p_description text, p_vendor text, p_reference text, p_actor text)
returns uuid language plpgsql as $$
declare v_id uuid := p_id;
begin
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'KH:INVALID'; end if;
  if v_id is null then
    insert into public.business_expenses (expense_date, category, amount_paise, description, vendor, reference, created_by)
    values (p_date, p_category, p_amount, btrim(p_description), nullif(btrim(p_vendor), ''), nullif(btrim(p_reference), ''), p_actor) returning id into v_id;
  else
    update public.business_expenses set expense_date = p_date, category = p_category, amount_paise = p_amount, description = btrim(p_description),
      vendor = nullif(btrim(p_vendor), ''), reference = nullif(btrim(p_reference), ''), updated_by = p_actor, updated_at = now()
    where id = v_id and status = 'active';
    if not found then raise exception 'KH:NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.finance_expense_void(p_id uuid, p_reason text, p_actor text) returns void language plpgsql as $$
begin
  update public.business_expenses set status = 'voided', void_reason = btrim(p_reason), updated_by = p_actor, updated_at = now() where id = p_id and status = 'active';
  if not found then raise exception 'KH:NOT_FOUND'; end if;
end $$;

create or replace function public.finance_fee_record(p_payment uuid, p_fee integer, p_tax integer, p_reversal integer, p_ref text, p_source text, p_actor text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.order_payments where id = p_payment and status = 'captured') then raise exception 'KH:NOT_FOUND'; end if;
  insert into public.payment_fee_records (order_payment_id, fee_paise, fee_tax_paise, refund_fee_reversal_paise, settlement_ref, source, created_by)
  values (p_payment, p_fee, coalesce(p_tax, 0), coalesce(p_reversal, 0), nullif(btrim(p_ref), ''), p_source, p_actor)
  on conflict (order_payment_id) do update set fee_paise = excluded.fee_paise, fee_tax_paise = excluded.fee_tax_paise,
    refund_fee_reversal_paise = excluded.refund_fee_reversal_paise, settlement_ref = excluded.settlement_ref, source = excluded.source
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.finance_ship_cost_record(p_shipment uuid, p_cost integer, p_basis text, p_note text, p_actor text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.shipments where id = p_shipment) then raise exception 'KH:NOT_FOUND'; end if;
  insert into public.shipment_cost_records (shipment_id, cost_paise, basis, note, created_by) values (p_shipment, p_cost, p_basis, nullif(btrim(p_note), ''), p_actor)
  on conflict (shipment_id) do update set cost_paise = excluded.cost_paise, basis = excluded.basis, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.finance_kpi_set(p_kpi text, p_target bigint, p_actor text) returns void language plpgsql as $$
begin
  insert into public.financial_kpi_targets (kpi, target, updated_by) values (p_kpi, p_target, p_actor)
  on conflict (kpi) do update set target = excluded.target, updated_by = excluded.updated_by, updated_at = now();
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'finance_ist_bounds(date,date)', 'finance_unit_cost(uuid,timestamptz)', 'finance_lines(date,date)', 'finance_period_summary(date,date)',
    'finance_daily_series(date,date)', 'finance_product_profitability(date,date,text,integer,integer)', 'finance_refund_impact(date,date)',
    'finance_inventory_valuation(integer,integer)', 'finance_customer_metrics(date,date)',
    'finance_cost_add(uuid,integer,integer,integer,integer,timestamptz,text,text,text)', 'finance_expense_save(uuid,date,text,bigint,text,text,text,text)',
    'finance_expense_void(uuid,text,text)', 'finance_fee_record(uuid,integer,integer,integer,text,text,text)',
    'finance_ship_cost_record(uuid,integer,text,text,text)', 'finance_kpi_set(text,bigint,text)', 'finance_append_only()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
