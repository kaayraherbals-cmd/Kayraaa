-- Self-test for supabase/email_outbox_v2.sql. ISOLATED STAGING ONLY. Run after email_outbox.sql, launch_optin.sql and email_outbox_v2.sql.
-- One transaction, rolled back. Expect "PASS" notices and no error. NOT YET RUN.
begin;
do $$
declare
  a uuid; b uuid; c uuid; d uuid; m public.email_outbox%rowtype; n integer; msg text; res text; mins numeric;
  delays numeric[] := array[1, 5, 30, 120, 720];
  i integer;
begin
  -- Old-style rows still insert
  insert into public.email_outbox (kind, to_email, status) values ('contact_owner', 'owner@example.org', 'sent');
  raise notice 'PASS: legacy direct-send rows still insert';

  -- Deduplication
  a := public.email_enqueue('payment_confirmed', 'Asha@Example.org', 'payment_confirmed:zz-1', '{"orderId":"x"}');
  b := public.email_enqueue('payment_confirmed', 'asha@example.org', 'payment_confirmed:zz-1', '{"orderId":"x"}');
  if a is null or a <> b then raise exception 'FAIL: same dedupe key must return the same row (% vs %)', a, b; end if;
  select count(*) into n from public.email_outbox where dedupe_key = 'payment_confirmed:zz-1';
  if n <> 1 then raise exception 'FAIL: duplicate row created'; end if;
  c := public.email_enqueue('delivered', 'asha@example.org', 'delivered:zz-1', '{"orderId":"x"}');
  if c = a then raise exception 'FAIL: different keys must be different rows'; end if;
  if (select to_email from public.email_outbox where id = a) <> 'asha@example.org' then raise exception 'FAIL: address not normalised'; end if;
  raise notice 'PASS: email deduplication';

  begin perform public.email_enqueue('not_a_kind', 'a@example.org', 'bad-kind-key-1', '{}'); raise exception 'FAIL: bad kind accepted';
  exception when check_violation then null; end;
  begin perform public.email_enqueue('delivered', 'a@example.org', 'big-payload-key-1', jsonb_build_object('x', repeat('a', 5000))); raise exception 'FAIL: oversize payload accepted';
  exception when check_violation then null; end;
  raise notice 'PASS: kind and payload size enforced';

  -- Claiming and locking
  select * into m from public.email_claim_due(1);
  if m.id is null or m.status <> 'sending' or m.attempts <> 1 then raise exception 'FAIL: claim should mark sending, attempt 1: %', m; end if;
  if m.id <> a then d := a; a := m.id; c := d; end if; -- the claim may have taken either row; keep a = the claimed one
  update public.email_outbox set next_attempt_at = now() + interval '1 hour' where id = c; -- park the other test row
  select count(*) into n from public.email_claim_due(10) where id = m.id;
  if n <> 0 then raise exception 'FAIL: a locked row was handed out twice'; end if;
  raise notice 'PASS: a claimed row is not handed out again';

  -- Retry scheduling: 1 min, 5 min, 30 min, 2 h, 12 h, then dead
  for i in 1..5 loop
    res := public.email_mark_failed(a, 'http_503', '{"error":"http_503"}');
    if res <> 'queued' then raise exception 'FAIL: attempt % should be queued, got %', i, res; end if;
    select extract(epoch from (next_attempt_at - now())) / 60 into mins from public.email_outbox where id = a;
    if abs(mins - delays[i]) > 1 then raise exception 'FAIL: attempt % delay should be % minutes, got %', i, delays[i], mins; end if;
    if (select count(*) from public.email_claim_due(10) where id = a) <> 0 then raise exception 'FAIL: claimed before it was due (attempt %)', i; end if;
    update public.email_outbox set next_attempt_at = now() where id = a;
    select * into m from public.email_claim_due(10) where id = a;
    if m.attempts <> i + 1 then raise exception 'FAIL: attempts should be %, got %', i + 1, m.attempts; end if;
  end loop;
  res := public.email_mark_failed(a, 'http_503');
  if res <> 'dead' then raise exception 'FAIL: sixth failure should be dead, got %', res; end if;
  if (select next_attempt_at from public.email_outbox where id = a) is not null then raise exception 'FAIL: dead mail must not be scheduled'; end if;
  raise notice 'PASS: retry schedule 1m, 5m, 30m, 2h, 12h then dead';

  -- Permanent error is dead at once; success erases the payload; sent mail is never reclaimed
  d := public.email_enqueue('payment_failed', 'b@example.org', 'payment_failed:zz-2', '{"orderId":"y"}');
  update public.email_outbox set next_attempt_at = now() where id = d;
  perform * from public.email_claim_due(10) where id = d;
  if public.email_mark_failed(d, 'http_422', null, true) <> 'dead' then raise exception 'FAIL: permanent error not dead'; end if;
  update public.email_outbox set status = 'queued', next_attempt_at = now(), attempts = 0 where id = c; -- reuse c
  perform * from public.email_claim_due(10) where id = c;
  perform public.email_mark_sent(c, 'resend_zz_1', '{"ok":true}');
  select * into m from public.email_outbox where id = c;
  if m.status <> 'sent' or m.payload is not null or m.provider_id <> 'resend_zz_1' or m.sent_at is null then raise exception 'FAIL: sent mail wrong: %', m; end if;
  perform public.email_mark_sent(c, 'resend_zz_2'); -- not in sending state: ignored
  if (select provider_id from public.email_outbox where id = c) <> 'resend_zz_1' then raise exception 'FAIL: a sent mail was overwritten'; end if;
  if (select count(*) from public.email_claim_due(50) where id = c) <> 0 then raise exception 'FAIL: sent mail reclaimed'; end if;
  raise notice 'PASS: permanent failure, payload erased on success, no resend of sent mail';

  -- Deferral does not use up an attempt; skipped clears the payload; a dead worker's lock expires
  a := public.email_enqueue('refund_completed', 'c@example.org', 'refund_completed:zz-3', '{"orderId":"z"}');
  update public.email_outbox set next_attempt_at = now() where id = a;
  perform * from public.email_claim_due(10) where id = a;
  perform public.email_defer(a, 10);
  select * into m from public.email_outbox where id = a;
  if m.status <> 'queued' or m.attempts <> 0 or m.next_attempt_at < now() + interval '9 minutes' then raise exception 'FAIL: defer wrong: %', m; end if;
  update public.email_outbox set status = 'sending', locked_until = now() - interval '1 minute' where id = a;
  select * into m from public.email_claim_due(10) where id = a;
  if m.id is null then raise exception 'FAIL: an expired lock should be reclaimed'; end if;
  perform public.email_mark_skipped(a, 'gate_not_met');
  if (select payload from public.email_outbox where id = a) is not null or (select status from public.email_outbox where id = a) <> 'skipped' then raise exception 'FAIL: skip wrong'; end if;
  raise notice 'PASS: defer, expired lock, skip';

  -- Purge
  update public.email_outbox set updated_at = now() - interval '100 days' where id = c;
  perform public.email_purge();
  if exists (select 1 from public.email_outbox where id = c) then raise exception 'FAIL: old sent mail not purged'; end if;
  if not exists (select 1 from public.email_outbox where id = d) then raise exception 'FAIL: recent dead mail was purged'; end if;
  raise notice 'PASS: purge';

  -- Browser roles reach nothing
  begin execute 'set local role anon'; perform count(*) from public.email_outbox; execute 'reset role'; raise exception 'FAIL: anon read the outbox';
  exception when insufficient_privilege then execute 'reset role'; end;
  begin execute 'set local role authenticated'; perform public.email_enqueue('delivered', 'a@example.org', 'anon-key-zz-1', '{}'); execute 'reset role'; raise exception 'FAIL: authenticated enqueued mail';
  exception when insufficient_privilege then execute 'reset role'; end;
  raise notice 'PASS: outbox is server-only';
  raise notice 'ALL EMAIL OUTBOX SELF-TESTS PASSED';
end $$;
rollback;
