-- Self-test for supabase/rate_limits.sql (single session). ISOLATED STAGING ONLY. Rolled back. NOT YET RUN.
-- Cross-session concurrency is a separate script: supabase/rate_limits_concurrency.md.
begin;
do $$
declare k text := repeat('a', 64); k2 text := repeat('b', 64); i integer; over boolean; n integer;
begin
  for i in 1..3 loop
    over := public.rate_limit_hit('zz_test', k, 60, 3);
    if over then raise exception 'FAIL: hit % of 3 should be allowed', i; end if;
  end loop;
  if not public.rate_limit_hit('zz_test', k, 60, 3) then raise exception 'FAIL: hit 4 of 3 should be limited'; end if;
  if public.rate_limit_hit('zz_test', k2, 60, 3) then raise exception 'FAIL: a different key must have its own count'; end if;
  if public.rate_limit_hit('zz_other', k, 60, 3) then raise exception 'FAIL: a different bucket must have its own count'; end if;
  raise notice 'PASS: counts per bucket and key; limit applies on the hit after the maximum';

  select hits into n from public.rate_limits where bucket = 'zz_test' and key_hash = k;
  if n <> 4 then raise exception 'FAIL: expected 4 stored hits, got %', n; end if;
  begin perform public.rate_limit_hit('zz_test', 'not-a-hash', 60, 3); raise exception 'FAIL: non-hash key accepted';
  exception when check_violation then null; end;
  begin perform public.rate_limit_hit('zz_test', k, 0, 3); raise exception 'FAIL: zero window accepted';
  exception when others then if sqlerrm not like 'KH:INVALID%' then raise; end if; end;
  raise notice 'PASS: only a 64-hex hash is stored; bad limits refused (no raw IP or email can be written)';

  begin execute 'set local role anon'; perform public.rate_limit_hit('zz_test', k, 60, 3); execute 'reset role'; raise exception 'FAIL: anon called rate_limit_hit';
  exception when insufficient_privilege then execute 'reset role'; end;
  begin execute 'set local role authenticated'; perform count(*) from public.rate_limits; execute 'reset role'; raise exception 'FAIL: authenticated read rate_limits';
  exception when insufficient_privilege then execute 'reset role'; end;
  raise notice 'PASS: server-only';
  raise notice 'ALL RATE LIMIT SELF-TESTS PASSED';
end $$;
rollback;
