-- Self-test for ai.sql. Run on a disposable database only. Prints PASS notices; raises on failure.
do $$
declare ok1 boolean; ok2 boolean; ok3 boolean; n integer;
begin
  delete from public.ai_usage_daily where day = date '2030-01-01';
  ok1 := public.ai_usage_reserve(date '2030-01-01', 'customer', 2);
  ok2 := public.ai_usage_reserve(date '2030-01-01', 'customer', 2);
  ok3 := public.ai_usage_reserve(date '2030-01-01', 'customer', 2);
  if not (ok1 and ok2 and not ok3) then raise exception 'FAIL reserve: % % %', ok1, ok2, ok3; end if;
  raise notice 'PASS: reserve stops at the limit';
  if public.ai_usage_reserve(date '2030-01-01', 'bogus', 5) then raise exception 'FAIL: bad scope accepted'; end if;
  raise notice 'PASS: unknown scope refused';
  perform public.ai_usage_add_tokens(date '2030-01-01', 'customer', 100, 40);
  perform public.ai_usage_add_tokens(date '2030-01-01', 'customer', 5, 2);
  select input_tokens + output_tokens into n from public.ai_usage_daily where day = date '2030-01-01' and scope = 'customer';
  if n <> 147 then raise exception 'FAIL tokens: %', n; end if;
  raise notice 'PASS: tokens add up';
  begin
    insert into public.ai_drafts (kind, body, model, created_by) values ('nonsense', 'x', 'm', 'a');
    raise exception 'FAIL: bad draft kind accepted';
  exception when check_violation then raise notice 'PASS: draft kind constrained'; end;
  insert into public.ai_drafts (kind, body, model, created_by, status, created_at) values ('social_caption', 'old', 'm', 'a', 'rejected', now() - interval '60 days');
  insert into public.ai_drafts (kind, body, model, created_by) values ('social_caption', 'keep', 'm', 'a');
  perform public.ai_purge(30);
  select count(*) into n from public.ai_drafts where body in ('old', 'keep');
  if n <> 1 then raise exception 'FAIL purge: %', n; end if;
  raise notice 'PASS: purge removes only old rejected drafts';
  delete from public.ai_drafts where body in ('old', 'keep');
  delete from public.ai_usage_daily where day = date '2030-01-01';
end $$;
