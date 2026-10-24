-- Phase 7 Step 2: shared rate limiting. ADDITIVE and safe to run again. Needs nothing. NOT YET RUN on any database.
-- Fixed windows shared by every serverless instance. A caller can burst up to twice the limit across a window boundary.
-- No personal data: the server stores only a salted SHA-256 of the IP address or email, never the address itself.
create table if not exists public.rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 40),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key_hash, window_start)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Counts one hit. Returns true when the caller is OVER the limit.
create or replace function public.rate_limit_hit(p_bucket text, p_key_hash text, p_window_seconds integer, p_max integer) returns boolean language plpgsql as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_window_seconds < 1 or p_window_seconds > 86400 or p_max < 1 then raise exception 'KH:INVALID:bad limit'; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (bucket, key_hash, window_start, hits) values (p_bucket, p_key_hash, v_start, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '2 days'; end if;
  return v_hits > p_max;
end $$;

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
