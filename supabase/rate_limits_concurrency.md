# Rate-limit counter: concurrency test (two or more sessions)

Single-session logic is in `rate_limits_selftest.sql`. Atomicity across connections cannot be shown in one transaction. Run this against the **staging** project only. NOT YET RUN.

Postgres `insert ... on conflict do update set hits = hits + 1` takes a row lock, so concurrent callers must each get a distinct count. To check: with `psql` or `pgbench` against the staging connection string (service role), run this file with 50 clients for 5 seconds:

```
-- rl.sql
select public.rate_limit_hit('zz_conc', repeat('c', 64), 3600, 100);
```
```
pgbench -n -c 50 -j 10 -T 5 -f rl.sql "$STAGING_DATABASE_URL"
```
Afterwards, in the SQL editor:
```
select hits from public.rate_limits where bucket = 'zz_conc';   -- must equal the number of transactions pgbench reports
delete from public.rate_limits where bucket = 'zz_conc';
```
PASS: `hits` equals pgbench's "number of transactions actually processed" exactly (no lost updates) and no client got a deadlock or unique-violation error. With a window of 3600 s the whole run falls in one window unless it straddles the hour; re-run if it does.
