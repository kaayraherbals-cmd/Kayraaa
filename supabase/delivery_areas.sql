-- Delivery areas (admin). Run AFTER checkout.sql, which creates public.shipping_pincodes. Safe to run again.
-- Adds a city and state label to each PIN code and one function that adds or updates many PIN codes in a single transaction.
-- Checkout is unchanged: it still reads only pincode, active, rate_paise and free_above_paise. The label never decides deliverability.
-- This file has NOT been run on a database. Run supabase/delivery_areas_selftest.sql after it, on staging.

alter table public.shipping_pincodes add column if not exists city text check (city is null or char_length(city) between 1 and 60);
alter table public.shipping_pincodes add column if not exists state text check (state is null or char_length(state) between 1 and 60);

-- Adds or updates many PIN codes at once. All or nothing: any error rolls the whole call back.
--   p_rows     [{"pincode":"221005","city":"Varanasi","state":"Uttar Pradesh"}, ...]  (city and state optional, no repeated pincode)
--   p_update   true: an existing PIN code gets the new charge, free-delivery amount and on/off; its city and state change only when given.
--              false: an existing PIN code is left exactly as it is.
-- Returns {added, updated, skipped}.
create or replace function public.delivery_areas_upsert(
  p_rows jsonb, p_rate integer, p_free bigint, p_active boolean, p_update boolean
) returns jsonb language plpgsql as $$
declare
  v_added integer := 0;
  v_updated integer := 0;
  v_total integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'KH:INVALID'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 or v_total > 2000 then raise exception 'KH:INVALID'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 1000000 or p_active is null or p_update is null then raise exception 'KH:INVALID'; end if;
  if p_free is not null and p_free <= 0 then raise exception 'KH:INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r group by r ->> 'pincode' having count(*) > 1) then raise exception 'KH:INVALID'; end if;

  with incoming as (
    select r ->> 'pincode' as pincode, nullif(btrim(r ->> 'city'), '') as city, nullif(btrim(r ->> 'state'), '') as state
    from jsonb_array_elements(p_rows) r
  ), done as (
    insert into public.shipping_pincodes as s (pincode, active, rate_paise, free_above_paise, city, state, updated_at)
    select pincode, p_active, p_rate, p_free, city, state, now() from incoming
    on conflict (pincode) do update set
      active = excluded.active,
      rate_paise = excluded.rate_paise,
      free_above_paise = excluded.free_above_paise,
      city = coalesce(excluded.city, s.city),
      state = coalesce(excluded.state, s.state),
      updated_at = now()
    where p_update
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_added, v_updated from done;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_total - v_added - v_updated);
end $$;

revoke all on function public.delivery_areas_upsert(jsonb, integer, bigint, boolean, boolean) from public, anon, authenticated;
