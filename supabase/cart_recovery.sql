-- Phase 7: abandoned cart recovery (migration 25). ADDITIVE and safe to run again. Run after carts.sql (15), checkout.sql (16), payments_checkout.sql (17),
-- email_outbox_v2.sql (19) and coupons.sql (24). NOT RUN on any database (no PostgreSQL was available when this was written).
-- Coupons: nothing here creates, applies, reserves or consumes a coupon. A reminder never touches coupon usage; the bag keeps whatever code the
-- customer applied, and coupon_quote re-checks it live when the bag is restored and again at checkout.
--
-- What this adds
--   marketing_preferences      one row per member: did they opt in to cart reminder emails (default: NO, nothing is assumed)
--   marketing_suppressions     email HASHES that must never receive marketing again (persistent; survives account deletion)
--   cart_recovery_settings     one row: on/off, pause, inactivity minutes, reminder delays, limits. Ships OFF.
--   cart_recovery_cycles       one row per detected abandonment of one cart (the "abandoned cart event")
--   cart_recovery_cycle_items  variant ids and quantities at detection (no prices, no names; used only for "most abandoned products")
--   cart_recovery_messages     the scheduled reminders; unique (cycle, step) is the database-level duplicate guard
--   cart_recovery_tokens       restore links: only a SHA-256 hash of the token is stored, never the token
--   cart_recovery_attribution  one row per recovered order; order_id is the primary key so an order can be counted once
-- Server-only: RLS on, no policies, no grants to anon or authenticated. Only the service role (our API) can touch them.
-- A cart is never copied: the member's saved cart stays the single source of truth. Prices, tax and stock are always read live.

-- ---- Marketing consent ---------------------------------------------------------------------------------------------------
create table if not exists public.marketing_preferences (
  member_id uuid primary key references public.members(id) on delete cascade,
  cart_reminders boolean not null default false,
  consent_text_version text check (consent_text_version is null or char_length(consent_text_version) <= 40),
  consented_at timestamptz,
  withdrawn_at timestamptz,
  source text check (source is null or source in ('account_page', 'checkout_optin')),
  updated_at timestamptz not null default now(),
  constraint marketing_consent_has_proof check (not cart_reminders or (consent_text_version is not null and consented_at is not null))
);

create table if not exists public.marketing_suppressions (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complaint', 'admin')),
  source text not null default 'account' check (source in ('account', 'recovery_email', 'provider', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.marketing_email_hash(p_email text) returns text language sql immutable as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
$$;

-- ---- Settings (one row, ships switched OFF) -------------------------------------------------------------------------------
create table if not exists public.cart_recovery_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  paused boolean not null default false,
  inactivity_minutes integer not null default 60 check (inactivity_minutes between 15 and 10080),
  -- Minutes AFTER abandonment (last cart change + inactivity_minutes) at which reminder 1, 2, 3 become due. Suggestions, not rules.
  step_delays_minutes integer[] not null default array[60, 1440, 4320],
  max_messages_per_cycle integer not null default 3 check (max_messages_per_cycle between 1 and 3),
  max_per_member_7d integer not null default 3 check (max_per_member_7d between 1 and 10),
  min_gap_hours integer not null default 12 check (min_gap_hours between 1 and 168),
  batch_size integer not null default 25 check (batch_size between 1 and 100),
  token_ttl_hours integer not null default 168 check (token_ttl_hours between 1 and 720),
  cycle_max_days integer not null default 14 check (cycle_max_days between 1 and 60),
  attribution_window_days integer not null default 7 check (attribution_window_days between 1 and 30),
  retention_days integer not null default 180 check (retention_days between 30 and 730),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint cart_recovery_delays_shape check (
    array_length(step_delays_minutes, 1) = 3
    and step_delays_minutes[1] between 1 and 43200
    and step_delays_minutes[1] < step_delays_minutes[2]
    and step_delays_minutes[2] < step_delays_minutes[3]
    and step_delays_minutes[3] <= 43200)
);
insert into public.cart_recovery_settings (id) values (true) on conflict (id) do nothing;

-- ---- Cycles, items, messages, tokens, attribution ---------------------------------------------------------------------------
create table if not exists public.cart_recovery_cycles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  cart_id uuid not null references public.carts(id) on delete cascade,
  cart_activity_at timestamptz not null,
  abandoned_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'resumed', 'purchased', 'recovered', 'stopped', 'expired')),
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 40),
  line_count integer not null check (line_count between 1 and 20),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint cart_recovery_cycle_once unique (cart_id, cart_activity_at)
);
create unique index if not exists cart_recovery_one_open_per_member on public.cart_recovery_cycles (member_id) where status = 'open';
create index if not exists cart_recovery_cycles_status_idx on public.cart_recovery_cycles (status, created_at desc);

create table if not exists public.cart_recovery_cycle_items (
  cycle_id uuid not null references public.cart_recovery_cycles(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  qty integer not null check (qty between 1 and 10),
  primary key (cycle_id, variant_id)
);
create index if not exists cart_recovery_cycle_items_variant_idx on public.cart_recovery_cycle_items (variant_id);

create table if not exists public.cart_recovery_messages (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cart_recovery_cycles(id) on delete cascade,
  step smallint not null check (step between 1 and 3),
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'claimed', 'sent', 'failed', 'skipped', 'cancelled')),
  reason text check (reason is null or char_length(reason) <= 40),
  attempts integer not null default 0 check (attempts between 0 and 10),
  locked_until timestamptz,
  idempotency_key text not null unique check (char_length(idempotency_key) between 20 and 120),
  provider_id text check (provider_id is null or char_length(provider_id) <= 80),
  sent_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_recovery_message_once unique (cycle_id, step)
);
create index if not exists cart_recovery_messages_due_idx on public.cart_recovery_messages (due_at) where status in ('scheduled', 'claimed');
create index if not exists cart_recovery_messages_sent_idx on public.cart_recovery_messages (sent_at) where status = 'sent';

create table if not exists public.cart_recovery_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  cycle_id uuid not null references public.cart_recovery_cycles(id) on delete cascade,
  message_id uuid not null references public.cart_recovery_messages(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  click_count integer not null default 0,
  first_used_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cart_recovery_tokens_cycle_idx on public.cart_recovery_tokens (cycle_id);

create table if not exists public.cart_recovery_attribution (
  order_id uuid primary key references public.orders(id) on delete cascade,
  cycle_id uuid references public.cart_recovery_cycles(id) on delete set null,
  message_id uuid references public.cart_recovery_messages(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  revenue_paise bigint not null check (revenue_paise >= 0),
  method text not null default 'click_then_paid' check (method = 'click_then_paid'),
  attributed_at timestamptz not null default now()
);
create index if not exists cart_recovery_attribution_at_idx on public.cart_recovery_attribution (attributed_at);

do $$ declare t text; begin
  foreach t in array array['marketing_preferences', 'marketing_suppressions', 'cart_recovery_settings', 'cart_recovery_cycles', 'cart_recovery_cycle_items',
                           'cart_recovery_messages', 'cart_recovery_tokens', 'cart_recovery_attribution'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Mail ledger: allow the three recovery kinds (same list as email_outbox_v2.sql plus the new ones).
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in (
  'contact_owner', 'contact_autoreply', 'launch_confirm', 'launch_welcome', 'issue_owner',
  'order_created', 'payment_confirmed', 'payment_failed', 'order_cancelled', 'shipment_dispatched',
  'out_for_delivery', 'delivered', 'refund_initiated', 'refund_completed', 'return_received',
  'cart_recovery_1', 'cart_recovery_2', 'cart_recovery_3'));

-- ---- Is this member's cart superseded by an order, or in the middle of a checkout? -----------------------------------------
-- 'purchased'       a paid order (or one with a captured payment) was created after the cart was last changed
-- 'checkout_active' an unpaid order is still inside its payment window, or a payment is authorised but not captured (being reconciled)
-- 'clear'           neither
create or replace function public.cart_recovery_member_state(p_member uuid, p_cart_updated timestamptz) returns text language sql stable as $$
  select case
    when exists (
      select 1 from public.orders o
       where o.member_id = p_member and o.created_at >= p_cart_updated and o.status <> 'cancelled'
         and (o.status in ('paid', 'packed', 'shipped', 'delivered')
              or exists (select 1 from public.order_payments p where p.order_id = o.id and p.status = 'captured'))
    ) then 'purchased'
    when exists (
      select 1 from public.orders o
       where o.member_id = p_member and o.status = 'placed'
         and (o.created_at > now() - interval '3 hours'
              or exists (select 1 from public.order_payments p where p.order_id = o.id and p.status = 'authorized' and p.created_at > now() - interval '3 days'))
    ) then 'checkout_active'
    else 'clear'
  end
$$;

-- ---- Consent -------------------------------------------------------------------------------------------------------------
-- A signed-in member's own, explicit opt-in. Clears an earlier "unsubscribed" suppression (that is a valid NEW opt-in), but never a
-- bounce, complaint or admin suppression: those stay until someone removes them on purpose.
create or replace function public.marketing_opt_in(p_member uuid, p_version text, p_source text default 'account_page') returns jsonb language plpgsql as $$
declare v_email text; v_hash text;
begin
  if p_version is null or char_length(p_version) not between 1 and 40 then raise exception 'KH:INVALID'; end if;
  select email into v_email from public.members where id = p_member;
  if v_email is null then raise exception 'KH:NOT_FOUND'; end if;
  v_hash := public.marketing_email_hash(v_email);
  if exists (select 1 from public.marketing_suppressions where email_hash = v_hash and reason <> 'unsubscribed') then
    return jsonb_build_object('result', 'suppressed');
  end if;
  delete from public.marketing_suppressions where email_hash = v_hash and reason = 'unsubscribed';
  insert into public.marketing_preferences (member_id, cart_reminders, consent_text_version, consented_at, withdrawn_at, source, updated_at)
  values (p_member, true, p_version, now(), null, p_source, now())
  on conflict (member_id) do update set cart_reminders = true, consent_text_version = excluded.consent_text_version, consented_at = now(),
    withdrawn_at = null, source = excluded.source, updated_at = now();
  return jsonb_build_object('result', 'ok');
end $$;

-- Withdraws consent for an address (signed-in toggle, or the unsubscribe link in an email). Persistent: stored as a hash.
-- Stops everything in flight for that member in the same transaction.
create or replace function public.marketing_unsubscribe(p_email text, p_source text default 'account') returns void language plpgsql as $$
declare v_hash text; v_members uuid[];
begin
  if p_source not in ('account', 'recovery_email') then raise exception 'KH:INVALID'; end if;
  v_hash := public.marketing_email_hash(p_email);
  insert into public.marketing_suppressions (email_hash, reason, source) values (v_hash, 'unsubscribed', p_source) on conflict (email_hash) do nothing;
  select coalesce(array_agg(id), '{}') into v_members from public.members where email = lower(btrim(p_email));
  update public.marketing_preferences set cart_reminders = false, withdrawn_at = now(), updated_at = now() where member_id = any (v_members);
  update public.cart_recovery_messages set status = 'cancelled', reason = 'unsubscribed', updated_at = now()
   where status in ('scheduled', 'claimed') and cycle_id in (select id from public.cart_recovery_cycles where member_id = any (v_members) and status = 'open');
  update public.cart_recovery_tokens set revoked_at = now() where member_id = any (v_members) and revoked_at is null;
  update public.cart_recovery_cycles set status = 'stopped', stop_reason = 'unsubscribed', closed_at = now() where member_id = any (v_members) and status = 'open';
end $$;

-- ---- Close what no longer needs a reminder; attribute recovered orders; tidy ---------------------------------------------------
create or replace function public.cart_recovery_sync() returns jsonb language plpgsql as $$
declare s public.cart_recovery_settings%rowtype; v_closed integer := 0; v_attr integer := 0; v_purged integer := 0; r record; n integer;
begin
  select * into s from public.cart_recovery_settings where id;
  if not found then return jsonb_build_object('closed', 0, 'attributed', 0, 'purged', 0); end if;

  -- 1. Open cycles that must stop. First matching reason wins.
  for r in
    select cy.id, cy.member_id,
           case
             when ca.id is null or not exists (select 1 from public.cart_items ci where ci.cart_id = ca.id) then 'cart_empty'
             when ca.updated_at <> cy.cart_activity_at then 'resumed'
             when public.cart_recovery_member_state(cy.member_id, cy.cart_activity_at) = 'purchased' then 'purchased'
             when coalesce(not mp.cart_reminders, true)
                  or exists (select 1 from public.marketing_suppressions x where x.email_hash = public.marketing_email_hash(m.email)) then 'unsubscribed'
             when cy.created_at < now() - make_interval(days => s.cycle_max_days) then 'expired'
             else null
           end as why
      from public.cart_recovery_cycles cy
      join public.members m on m.id = cy.member_id
      left join public.carts ca on ca.id = cy.cart_id
      left join public.marketing_preferences mp on mp.member_id = cy.member_id
     where cy.status = 'open'
       for update of cy skip locked
  loop
    continue when r.why is null;
    update public.cart_recovery_cycles
       set status = case r.why when 'resumed' then 'resumed' when 'purchased' then 'purchased' when 'expired' then 'expired' else 'stopped' end,
           stop_reason = r.why, closed_at = now()
     where id = r.id;
    update public.cart_recovery_messages set status = 'cancelled', reason = r.why, updated_at = now() where cycle_id = r.id and status in ('scheduled', 'claimed');
    update public.cart_recovery_tokens set revoked_at = now() where cycle_id = r.id and revoked_at is null;
    v_closed := v_closed + 1;
  end loop;

  -- 2. Attribution: a paid order that came after a click on one of our links, inside the window. One row per order, ever.
  --    This is ATTRIBUTED revenue (the customer clicked, then paid). It is not proof the reminder caused the purchase.
  with candidates as (
    select distinct on (o.id) o.id as order_id, o.total_paise, msg.id as message_id, msg.cycle_id, cy.member_id
      from public.orders o
      join public.cart_recovery_cycles cy on cy.member_id = o.member_id
      join public.cart_recovery_messages msg on msg.cycle_id = cy.id and msg.status = 'sent' and msg.clicked_at is not null
     where o.created_at > msg.clicked_at
       and o.created_at <= msg.clicked_at + make_interval(days => s.attribution_window_days)
       and o.status <> 'cancelled'
       and (o.status in ('paid', 'packed', 'shipped', 'delivered')
            or exists (select 1 from public.order_payments p where p.order_id = o.id and p.status = 'captured'))
       and not exists (select 1 from public.cart_recovery_attribution a where a.order_id = o.id)
     order by o.id, msg.clicked_at desc
  ), ins as (
    insert into public.cart_recovery_attribution (order_id, cycle_id, message_id, member_id, revenue_paise)
    select order_id, cycle_id, message_id, member_id, total_paise from candidates
    on conflict (order_id) do nothing
    returning cycle_id
  )
  update public.cart_recovery_cycles set status = 'recovered', closed_at = coalesce(closed_at, now()) where id in (select cycle_id from ins);
  get diagnostics n = row_count;
  v_attr := n;

  -- 3. Retention: closed cycles (and, by cascade, their items, messages and tokens) go after retention_days. Attribution rows stay
  --    (cycle_id becomes null) because they are order-level money records, not personal cart data.
  delete from public.cart_recovery_cycles where status <> 'open' and closed_at < now() - make_interval(days => s.retention_days);
  get diagnostics v_purged = row_count;
  delete from public.cart_recovery_tokens where expires_at < now() - interval '30 days';
  return jsonb_build_object('closed', v_closed, 'attributed', v_attr, 'purged', v_purged);
end $$;

-- ---- Detect: open one cycle per newly abandoned, consented cart ------------------------------------------------------------
create or replace function public.cart_recovery_detect(p_limit integer default 50) returns integer language plpgsql as $$
declare s public.cart_recovery_settings%rowtype; c record; v_cycle uuid; v_n integer := 0; v_abandoned timestamptz; i integer;
begin
  select * into s from public.cart_recovery_settings where id;
  if not found or not s.enabled or s.paused then return 0; end if;
  for c in
    select ca.id as cart_id, ca.member_id, ca.updated_at
      from public.carts ca
      join public.members m on m.id = ca.member_id
      join public.marketing_preferences mp on mp.member_id = ca.member_id and mp.cart_reminders
     where ca.updated_at <= now() - make_interval(mins => s.inactivity_minutes)
       and ca.updated_at > now() - make_interval(days => s.cycle_max_days)
       and exists (select 1 from public.cart_items ci
                     join public.product_variants v on v.id = ci.variant_id
                     join public.products p on p.id = v.product_id
                    where ci.cart_id = ca.id and p.status = 'APPROVED_FOR_SALE' and v.status = 'active' and v.price_paise > 0)
       and not exists (select 1 from public.marketing_suppressions x where x.email_hash = public.marketing_email_hash(m.email))
       and not exists (select 1 from public.cart_recovery_cycles cy where cy.cart_id = ca.id and cy.cart_activity_at = ca.updated_at)
       and not exists (select 1 from public.cart_recovery_cycles cy where cy.member_id = ca.member_id and cy.status = 'open')
       and public.cart_recovery_member_state(ca.member_id, ca.updated_at) = 'clear'
       and (select count(*) from public.cart_recovery_messages msg join public.cart_recovery_cycles cy on cy.id = msg.cycle_id
             where cy.member_id = ca.member_id and msg.status = 'sent' and msg.sent_at > now() - interval '7 days') < s.max_per_member_7d
     order by ca.updated_at
     limit greatest(1, least(p_limit, 200))
       for update of ca skip locked
  loop
    v_abandoned := c.updated_at + make_interval(mins => s.inactivity_minutes);
    insert into public.cart_recovery_cycles (member_id, cart_id, cart_activity_at, abandoned_at, line_count)
    select c.member_id, c.cart_id, c.updated_at, v_abandoned, count(*) from public.cart_items where cart_id = c.cart_id
    on conflict do nothing returning id into v_cycle;
    if v_cycle is null then continue; end if;
    insert into public.cart_recovery_cycle_items (cycle_id, variant_id, qty) select v_cycle, variant_id, qty from public.cart_items where cart_id = c.cart_id;
    for i in 1..s.max_messages_per_cycle loop
      insert into public.cart_recovery_messages (cycle_id, step, due_at, idempotency_key)
      values (v_cycle, i, v_abandoned + make_interval(mins => s.step_delays_minutes[i]), 'cart-recovery:' || v_cycle::text || ':' || i::text);
    end loop;
    v_n := v_n + 1;
    v_cycle := null;
  end loop;
  return v_n;
end $$;

-- ---- Claim due reminders (safe with several workers: rows are locked; a dead worker's lock expires after 10 minutes) -----------
create or replace function public.cart_recovery_claim(p_limit integer default 25)
returns table (id uuid, cycle_id uuid, step smallint, member_id uuid, idempotency_key text, attempts integer) language plpgsql as $$
declare s public.cart_recovery_settings%rowtype;
begin
  select * into s from public.cart_recovery_settings where cart_recovery_settings.id;
  if not found or not s.enabled or s.paused then return; end if;
  return query
  with picked as (
    select msg.id from public.cart_recovery_messages msg
      join public.cart_recovery_cycles cy on cy.id = msg.cycle_id
     where cy.status = 'open' and msg.attempts < 4
       and ((msg.status = 'scheduled' and msg.due_at <= now()) or (msg.status = 'claimed' and msg.locked_until < now()))
     order by msg.due_at
     limit greatest(1, least(p_limit, 100))
       for update of msg skip locked
  ), upd as (
    update public.cart_recovery_messages m set status = 'claimed', attempts = m.attempts + 1, locked_until = now() + interval '10 minutes', updated_at = now()
     where m.id in (select picked.id from picked)
    returning m.id, m.cycle_id, m.step, m.idempotency_key, m.attempts
  )
  select upd.id, upd.cycle_id, upd.step, cy.member_id, upd.idempotency_key, upd.attempts from upd join public.cart_recovery_cycles cy on cy.id = upd.cycle_id;
end $$;

-- ---- Re-check everything immediately before sending. ok=false with defer=true means "try again later, do not count it". -----------
create or replace function public.cart_recovery_preflight(p_message uuid) returns jsonb language plpgsql as $$
declare s public.cart_recovery_settings%rowtype; msg public.cart_recovery_messages%rowtype; cy public.cart_recovery_cycles%rowtype;
        m public.members%rowtype; ca public.carts%rowtype; v_state text; v_hash text;
begin
  select * into msg from public.cart_recovery_messages where id = p_message;
  if not found or msg.status <> 'claimed' then return jsonb_build_object('ok', false, 'reason', 'not_claimed'); end if;
  select * into s from public.cart_recovery_settings where id;
  if not found or not s.enabled then return jsonb_build_object('ok', false, 'defer', true, 'reason', 'disabled'); end if;
  if s.paused then return jsonb_build_object('ok', false, 'defer', true, 'reason', 'paused'); end if;
  select * into cy from public.cart_recovery_cycles where id = msg.cycle_id;
  if not found or cy.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'cycle_closed'); end if;
  select * into m from public.members where id = cy.member_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'member_missing'); end if;
  v_hash := public.marketing_email_hash(m.email);
  if exists (select 1 from public.marketing_suppressions where email_hash = v_hash) then return jsonb_build_object('ok', false, 'reason', 'suppressed'); end if;
  if not exists (select 1 from public.marketing_preferences where member_id = m.id and cart_reminders) then return jsonb_build_object('ok', false, 'reason', 'no_consent'); end if;
  select * into ca from public.carts where id = cy.cart_id;
  if not found or not exists (select 1 from public.cart_items where cart_id = ca.id) then return jsonb_build_object('ok', false, 'reason', 'cart_empty'); end if;
  if ca.updated_at <> cy.cart_activity_at then return jsonb_build_object('ok', false, 'reason', 'cart_changed'); end if;
  v_state := public.cart_recovery_member_state(m.id, cy.cart_activity_at);
  if v_state = 'purchased' then return jsonb_build_object('ok', false, 'reason', 'purchased'); end if;
  if v_state = 'checkout_active' then return jsonb_build_object('ok', false, 'defer', true, 'reason', 'checkout_active'); end if;
  if exists (select 1 from public.cart_recovery_messages x where x.cycle_id = cy.id and x.step = msg.step and x.status = 'sent') then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if (select count(*) from public.cart_recovery_messages x where x.cycle_id = cy.id and x.status = 'sent') >= s.max_messages_per_cycle then
    return jsonb_build_object('ok', false, 'reason', 'cycle_limit');
  end if;
  if (select count(*) from public.cart_recovery_messages x join public.cart_recovery_cycles y on y.id = x.cycle_id
       where y.member_id = m.id and x.status = 'sent' and x.sent_at > now() - interval '7 days') >= s.max_per_member_7d then
    return jsonb_build_object('ok', false, 'reason', 'member_limit');
  end if;
  -- After an outage several steps can be due at once. Spread them: never two reminders closer than min_gap_hours.
  if exists (select 1 from public.cart_recovery_messages x where x.cycle_id = cy.id and x.status = 'sent' and x.sent_at > now() - make_interval(hours => s.min_gap_hours)) then
    return jsonb_build_object('ok', false, 'defer', true, 'reason', 'min_gap');
  end if;
  return jsonb_build_object('ok', true, 'cycle_id', cy.id, 'member_id', m.id, 'step', msg.step, 'email', m.email, 'name', m.name, 'settings_ttl_hours', s.token_ttl_hours);
end $$;

-- Outcome of one attempt. 'scheduled' = put back (defer: attempt not counted). 'failed' retries up to 3 attempts, 30 minutes apart.
create or replace function public.cart_recovery_finish(p_message uuid, p_status text, p_reason text default null, p_provider text default null) returns void language plpgsql as $$
declare msg public.cart_recovery_messages%rowtype;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'scheduled') then raise exception 'KH:INVALID'; end if;
  select * into msg from public.cart_recovery_messages where id = p_message for update;
  if not found or msg.status <> 'claimed' then return; end if;
  if p_status = 'sent' then
    update public.cart_recovery_messages set status = 'sent', sent_at = now(), provider_id = left(p_provider, 80), reason = null, locked_until = null, updated_at = now() where id = p_message;
  elsif p_status = 'skipped' then
    update public.cart_recovery_messages set status = 'skipped', reason = left(p_reason, 40), locked_until = null, updated_at = now() where id = p_message;
  elsif p_status = 'scheduled' then
    update public.cart_recovery_messages set status = 'scheduled', reason = left(p_reason, 40), attempts = greatest(0, attempts - 1), due_at = greatest(due_at, now()) + interval '1 hour', locked_until = null, updated_at = now() where id = p_message;
  elsif msg.attempts >= 3 then
    update public.cart_recovery_messages set status = 'failed', reason = left(p_reason, 40), locked_until = null, updated_at = now() where id = p_message;
  else
    update public.cart_recovery_messages set status = 'scheduled', reason = left(p_reason, 40), due_at = now() + interval '30 minutes', locked_until = null, updated_at = now() where id = p_message;
  end if;
end $$;

-- ---- Restore links ---------------------------------------------------------------------------------------------------------
create or replace function public.cart_recovery_issue_token(p_message uuid, p_hash text, p_ttl_hours integer) returns void language plpgsql as $$
begin
  if p_hash !~ '^[0-9a-f]{64}$' or p_ttl_hours not between 1 and 720 then raise exception 'KH:INVALID'; end if;
  insert into public.cart_recovery_tokens (token_hash, cycle_id, message_id, member_id, expires_at)
  select p_hash, msg.cycle_id, msg.id, cy.member_id, now() + make_interval(hours => p_ttl_hours)
    from public.cart_recovery_messages msg join public.cart_recovery_cycles cy on cy.id = msg.cycle_id
   where msg.id = p_message;
  if not found then raise exception 'KH:NOT_FOUND'; end if;
end $$;

-- p_member is the signed-in customer (null when nobody is signed in). A click is counted only when the right customer is signed in,
-- so mail scanners and link previews, which have no session, never count as a click.
create or replace function public.cart_recovery_redeem(p_hash text, p_member uuid) returns jsonb language plpgsql as $$
declare t public.cart_recovery_tokens%rowtype;
begin
  select * into t from public.cart_recovery_tokens where token_hash = p_hash for update;
  if not found then return jsonb_build_object('result', 'invalid'); end if;
  if t.revoked_at is not null then return jsonb_build_object('result', 'closed'); end if;
  if t.expires_at <= now() then return jsonb_build_object('result', 'expired'); end if;
  if p_member is null then return jsonb_build_object('result', 'signin_required'); end if;
  if p_member <> t.member_id then return jsonb_build_object('result', 'wrong_account'); end if;
  update public.cart_recovery_tokens set click_count = click_count + 1, first_used_at = coalesce(first_used_at, now()), last_used_at = now() where token_hash = p_hash;
  update public.cart_recovery_messages set clicked_at = coalesce(clicked_at, now()), updated_at = now() where id = t.message_id;
  return jsonb_build_object('result', 'ok');
end $$;

-- ---- Numbers for the owner dashboard (read only) ---------------------------------------------------------------------------
-- Definitions (also shown in the dashboard and docs/PHASE7_CART_RECOVERY.md):
--   abandoned_carts          carts last changed in the period, idle at least the inactivity time, holding a buyable item, not superseded by an
--                            order and not mid-checkout, whether or not the customer agreed to reminders
--   eligible_carts           of those, the ones opened as a recovery cycle (customer agreed, not suppressed)
--   emails_queued            reminders scheduled in the period
--   emails_sent / failed     reminders that reached 'sent' (sent_at in period) / ended 'failed' (updated in period)
--   clicks                   reminders whose link was opened by the signed-in owner of the cart, first click in period
--   recovered_orders / carts / revenue_paise   rows in cart_recovery_attribution created in period: ATTRIBUTED, not proven incremental
--   conversion_rate          recovered_carts / cycles that received at least one email in the period
--   unsubscribe_rate         unsubscribes made through a recovery email link / distinct customers emailed in the period
create or replace function public.cart_recovery_stats(p_from timestamptz, p_to timestamptz) returns jsonb language plpgsql stable as $$
declare s public.cart_recovery_settings%rowtype; v_abandoned integer; v_eligible integer; v_queued integer; v_sent integer; v_failed integer; v_clicks integer;
        v_rec_orders integer; v_rec_carts integer; v_rev bigint; v_emailed_cycles integer; v_emailed_members integer; v_unsubs integer; v_top jsonb;
begin
  select * into s from public.cart_recovery_settings where id;
  select count(*) into v_abandoned from public.carts ca
   where ca.updated_at >= p_from and ca.updated_at < p_to and ca.updated_at <= now() - make_interval(mins => coalesce(s.inactivity_minutes, 60))
     and exists (select 1 from public.cart_items ci join public.product_variants v on v.id = ci.variant_id join public.products p on p.id = v.product_id
                  where ci.cart_id = ca.id and p.status = 'APPROVED_FOR_SALE' and v.status = 'active' and v.price_paise > 0)
     and public.cart_recovery_member_state(ca.member_id, ca.updated_at) = 'clear';
  select count(*) into v_eligible from public.cart_recovery_cycles where created_at >= p_from and created_at < p_to;
  select count(*) into v_queued from public.cart_recovery_messages where created_at >= p_from and created_at < p_to;
  select count(*) into v_sent from public.cart_recovery_messages where status = 'sent' and sent_at >= p_from and sent_at < p_to;
  select count(*) into v_failed from public.cart_recovery_messages where status = 'failed' and updated_at >= p_from and updated_at < p_to;
  select count(*) into v_clicks from public.cart_recovery_messages where clicked_at >= p_from and clicked_at < p_to;
  select count(*), count(distinct cycle_id), coalesce(sum(revenue_paise), 0) into v_rec_orders, v_rec_carts, v_rev
    from public.cart_recovery_attribution where attributed_at >= p_from and attributed_at < p_to;
  select count(distinct msg.cycle_id), count(distinct cy.member_id) into v_emailed_cycles, v_emailed_members
    from public.cart_recovery_messages msg join public.cart_recovery_cycles cy on cy.id = msg.cycle_id
   where msg.status = 'sent' and msg.sent_at >= p_from and msg.sent_at < p_to;
  select count(*) into v_unsubs from public.marketing_suppressions where source = 'recovery_email' and created_at >= p_from and created_at < p_to;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top from (
    select coalesce(nullif(btrim(p.public_name), ''), p.internal_name) as product, v.pack_size, count(distinct ci.cycle_id) as carts
      from public.cart_recovery_cycle_items ci
      join public.cart_recovery_cycles cy on cy.id = ci.cycle_id
      join public.product_variants v on v.id = ci.variant_id
      join public.products p on p.id = v.product_id
     where cy.created_at >= p_from and cy.created_at < p_to
     group by 1, 2 order by 3 desc, 1 limit 10) t;
  return jsonb_build_object(
    'abandoned_carts', v_abandoned, 'eligible_carts', v_eligible, 'emails_queued', v_queued, 'emails_sent', v_sent, 'delivery_failures', v_failed,
    'clicks', v_clicks, 'recovered_carts', v_rec_carts, 'recovered_orders', v_rec_orders, 'attributed_revenue_paise', v_rev,
    'emailed_carts', v_emailed_cycles, 'emailed_customers', v_emailed_members, 'unsubscribes_from_email', v_unsubs, 'top_products', v_top,
    'conversion_rate', case when v_emailed_cycles > 0 then round(v_rec_carts::numeric / v_emailed_cycles, 4) else null end,
    'unsubscribe_rate', case when v_emailed_members > 0 then round(v_unsubs::numeric / v_emailed_members, 4) else null end);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'marketing_email_hash(text)', 'cart_recovery_member_state(uuid, timestamptz)', 'marketing_opt_in(uuid, text, text)', 'marketing_unsubscribe(text, text)',
    'cart_recovery_sync()', 'cart_recovery_detect(integer)', 'cart_recovery_claim(integer)', 'cart_recovery_preflight(uuid)',
    'cart_recovery_finish(uuid, text, text, text)', 'cart_recovery_issue_token(uuid, text, integer)', 'cart_recovery_redeem(text, uuid)',
    'cart_recovery_stats(timestamptz, timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
