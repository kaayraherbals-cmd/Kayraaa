-- Self-test for delivery_areas_upsert. Run in the Supabase SQL editor on STAGING after checkout.sql and delivery_areas.sql.
-- One transaction, rolled back at the end, so nothing is kept. Expect PASS notices, then ALL PASSED.
-- NOT executed when this version was prepared. Run it before trusting delivery_areas.sql.
begin;
do $$
declare
  r jsonb;
  c text;
  s text;
  rate integer;
  msg text;
begin
  insert into public.shipping_pincodes (pincode, active, rate_paise, free_above_paise, city, state) values ('221005', true, 6000, 150000, 'Varanasi', 'Uttar Pradesh');

  -- skip mode leaves an existing row alone and adds the new one
  r := public.delivery_areas_upsert('[{"pincode":"221005","city":"Other"},{"pincode":"221006"}]'::jsonb, 9900, null, true, false);
  if r <> '{"added":1,"updated":0,"skipped":1}'::jsonb then raise exception 'FAIL skip mode: %', r; end if;
  select rate_paise, city into rate, c from public.shipping_pincodes where pincode = '221005';
  if rate <> 6000 or c <> 'Varanasi' then raise exception 'FAIL skip changed the existing row'; end if;
  raise notice 'PASS skip mode';

  -- update mode changes charge and on/off, keeps city and state when none are given, replaces them when given
  r := public.delivery_areas_upsert('[{"pincode":"221005"},{"pincode":"221007","city":"Mirzapur","state":"Uttar Pradesh"}]'::jsonb, 4000, 99900, false, true);
  if r <> '{"added":1,"updated":1,"skipped":0}'::jsonb then raise exception 'FAIL update mode: %', r; end if;
  select rate_paise, city, state into rate, c, s from public.shipping_pincodes where pincode = '221005';
  if rate <> 4000 or c <> 'Varanasi' or s <> 'Uttar Pradesh' then raise exception 'FAIL update kept/changed wrong columns'; end if;
  if (select active from public.shipping_pincodes where pincode = '221005') then raise exception 'FAIL update did not switch off'; end if;
  raise notice 'PASS update mode';

  -- bad input is refused
  begin
    perform public.delivery_areas_upsert('[{"pincode":"221008"},{"pincode":"221008"}]'::jsonb, 100, null, true, true);
    raise exception 'FAIL repeated pincode accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INVALID%' then raise exception 'FAIL expected KH:INVALID, got %', msg; end if;
  end;
  begin
    perform public.delivery_areas_upsert('[{"pincode":"221008"}]'::jsonb, -1, null, true, true);
    raise exception 'FAIL negative rate accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'KH:INVALID%' then raise exception 'FAIL expected KH:INVALID, got %', msg; end if;
  end;
  begin
    insert into public.shipping_pincodes (pincode, rate_paise, city) values ('221009', 0, repeat('x', 61));
    raise exception 'FAIL 61-character city accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS refuses bad input';
  raise notice 'ALL PASSED';
end $$;
rollback;
