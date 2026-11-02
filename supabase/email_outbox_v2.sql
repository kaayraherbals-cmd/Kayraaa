-- Phase 7 Step 2: durable email outbox. ADDITIVE and safe to run again. Run after email_outbox.sql (2) and launch_optin.sql (3).
-- NOT YET RUN on any database.
--
-- Old rows keep working: the direct-send path still inserts status 'sent' or 'failed' with no payload.
-- New flow: email_enqueue (status 'queued', payload = template PARAMETERS, never the rendered body and never a street address)
--   > email_claim_due ('sending', attempt counted, 5-minute lock) > email_mark_sent | email_mark_failed (back to 'queued' with a
--   backoff, or 'dead' after 6 attempts or a permanent error).
-- A stable dedupe_key (for example 'payment_confirmed:<order id>') means the same customer notification can be queued only once.
-- Payload is erased the moment a mail is sent, and from dead mail after 30 days (email_purge). Server-only: RLS on, no grants.

alter table public.email_outbox add column if not exists dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 8 and 120);
alter table public.email_outbox add column if not exists payload jsonb;
alter table public.email_outbox add column if not exists attempts integer not null default 0;
alter table public.email_outbox add column if not exists next_attempt_at timestamptz;
alter table public.email_outbox add column if not exists locked_until timestamptz;
alter table public.email_outbox add column if not exists last_error text check (last_error is null or char_length(last_error) <= 40);
alter table public.email_outbox add column if not exists provider_response jsonb;
alter table public.email_outbox add column if not exists sent_at timestamptz;
alter table public.email_outbox add column if not exists updated_at timestamptz not null default now();

alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in (
  'contact_owner', 'contact_autoreply', 'launch_confirm', 'launch_welcome', 'issue_owner',
  'order_created', 'payment_confirmed', 'payment_failed', 'order_cancelled', 'shipment_dispatched',
  'out_for_delivery', 'delivered', 'refund_initiated', 'refund_completed', 'return_received'));
alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'dead', 'skipped'));
alter table public.email_outbox drop constraint if exists email_outbox_payload_size;
alter table public.email_outbox add constraint email_outbox_payload_size check (payload is null or pg_column_size(payload) <= 4096);

create unique index if not exists email_outbox_dedupe_uidx on public.email_outbox (dedupe_key) where dedupe_key is not null;
create index if not exists email_outbox_due_idx on public.email_outbox (next_attempt_at) where status in ('queued', 'sending');

create or replace function public.email_enqueue(p_kind text, p_to text, p_dedupe text, p_payload jsonb) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.email_outbox (kind, to_email, status, dedupe_key, payload, next_attempt_at)
  values (p_kind, lower(p_to), 'queued', p_dedupe, p_payload, now())
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.email_outbox where dedupe_key = p_dedupe; end if;
  return v_id;
end $$;

-- Hands out due mail, skipping rows another worker holds. A worker that died leaves a lock that expires after 5 minutes.
create or replace function public.email_claim_due(p_limit integer default 10) returns setof public.email_outbox language plpgsql as $$
begin
  return query
  update public.email_outbox m set status = 'sending', attempts = m.attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
   where m.id in (
     select id from public.email_outbox
      where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now())
      order by next_attempt_at nulls first
      limit greatest(1, least(p_limit, 50))
        for update skip locked)
  returning m.*;
end $$;

create or replace function public.email_mark_sent(p_id uuid, p_provider_id text, p_response jsonb default null) returns void language sql as $$
  update public.email_outbox set status = 'sent', sent_at = now(), provider_id = left(p_provider_id, 80), provider_response = p_response,
         payload = null, locked_until = null, last_error = null, updated_at = now()
   where id = p_id and status = 'sending';
$$;

-- Backoff after attempt n: 1 min, 5 min, 30 min, 2 h, 12 h; then dead. A permanent error (a rejected address) is dead at once.
create or replace function public.email_mark_failed(p_id uuid, p_error text, p_response jsonb default null, p_permanent boolean default false) returns text language plpgsql as $$
declare m public.email_outbox%rowtype; v_status text; v_delay interval;
begin
  select * into m from public.email_outbox where id = p_id for update;
  if not found or m.status <> 'sending' then return 'ignored'; end if;
  if p_permanent or m.attempts >= 6 then v_status := 'dead';
  else
    v_status := 'queued';
    v_delay := case m.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes' when 4 then interval '2 hours' else interval '12 hours' end;
  end if;
  update public.email_outbox set status = v_status, last_error = left(p_error, 40), provider_response = p_response, locked_until = null,
         next_attempt_at = case when v_status = 'queued' then now() + v_delay else null end, updated_at = now()
   where id = p_id;
  return v_status;
end $$;

-- Not ready yet (for example the payment is not verified): try again later without using up an attempt.
create or replace function public.email_defer(p_id uuid, p_minutes integer) returns void language sql as $$
  update public.email_outbox set status = 'queued', attempts = greatest(attempts - 1, 0), locked_until = null,
         next_attempt_at = now() + make_interval(mins => greatest(1, least(p_minutes, 1440))), updated_at = now()
   where id = p_id and status = 'sending';
$$;

create or replace function public.email_mark_skipped(p_id uuid, p_reason text) returns void language sql as $$
  update public.email_outbox set status = 'skipped', last_error = left(p_reason, 40), payload = null, locked_until = null, next_attempt_at = null, updated_at = now()
   where id = p_id and status = 'sending';
$$;

create or replace function public.email_purge() returns integer language plpgsql as $$
declare n integer;
begin
  update public.email_outbox set payload = null where status = 'dead' and payload is not null and updated_at < now() - interval '30 days';
  delete from public.email_outbox where status in ('sent', 'skipped', 'dead') and updated_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- Counts only, for the admin overview and monitoring.
create or replace function public.email_outbox_stats() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'sending', count(*) filter (where status = 'sending'),
    'dead', count(*) filter (where status = 'dead'),
    'oldest_queued_minutes', coalesce(extract(epoch from (now() - min(next_attempt_at) filter (where status = 'queued')))::int / 60, 0))
  from public.email_outbox;
$$;

revoke all on function public.email_enqueue(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.email_claim_due(integer) from public, anon, authenticated;
revoke all on function public.email_mark_sent(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.email_mark_failed(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.email_defer(uuid, integer) from public, anon, authenticated;
revoke all on function public.email_mark_skipped(uuid, text) from public, anon, authenticated;
revoke all on function public.email_purge() from public, anon, authenticated;
revoke all on function public.email_outbox_stats() from public, anon, authenticated;
