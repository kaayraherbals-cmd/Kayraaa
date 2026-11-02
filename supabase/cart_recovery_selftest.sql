-- Self-test for cart_recovery.sql. NOT RUN (no PostgreSQL was available when it was written): treat it as unverified until you run it.
-- Run on a DISPOSABLE or STAGING database after cart_recovery.sql (and every migration before it). One transaction that ROLLS BACK.
-- Prints "PASS: ..." notices and raises an exception on the first failure. Do not run on production.
begin;
do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid(); m4 uuid := gen_random_uuid();
  pa uuid; va uuid; vx uuid; px uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  v jsonb; n int; cy uuid; msg uuid; tok text := repeat('a', 64); o uuid;
  st text;
begin
  insert into public.members (id, email, provider) values (m1, 'zz-r1@example.org', 'email'), (m2, 'zz-r2@example.org', 'email'), (m3, 'zz-r3@example.org', 'email'), (m4, 'zz-r4@example.org', 'email');
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-rc-a', 'ZZ RC A', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'Recovery test A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-rc-x', 'ZZ RC X', 'Syrup', '100 ml', 'DRAFT', 'Recovery test X', 'Test only.', false, null) returning id into px;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pa, 'ZZ-RC-A', '200 ml', 49900) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (px, 'ZZ-RC-X', '100 ml', 29900) returning id into vx;
  insert into public.carts (member_id, updated_at) values (m1, now() - interval '3 hours') returning id into c1;
  insert into public.carts (member_id, updated_at) values (m2, now() - interval '3 hours') returning id into c2;
  insert into public.carts (member_id, updated_at) values (m3, now() - interval '3 hours') returning id into c3;
  insert into public.carts (member_id, updated_at) values (m4, now() - interval '3 hours') returning id into c4;
  insert into public.cart_items (cart_id, variant_id, qty) values (c1, va, 2), (c2, va, 1), (c3, va, 1), (c4, vx, 1);

  -- ---- ships off, consent defaults to none ----
  if (select enabled from public.cart_recovery_settings) then raise exception 'FAIL: settings must ship disabled'; end if;
  if exists (select 1 from public.marketing_preferences where member_id in (m1, m2, m3, m4)) then raise exception 'FAIL: nobody may be opted in by default'; end if;
  raise notice 'PASS: ships off, no default consent';

  -- ---- nothing happens while disabled, and nobody without consent is ever detected ----
  if public.cart_recovery_detect(50) <> 0 then raise exception 'FAIL: detect ran while disabled'; end if;
  update public.cart_recovery_settings set enabled = true;
  if public.cart_recovery_detect(50) <> 0 then raise exception 'FAIL: carts without consent were detected'; end if;
  raise notice 'PASS: disabled = nothing; no consent = no cycle';

  -- ---- consent, then detection (m1, m2, m3 opt in; m4 holds only an unpublished product) ----
  perform public.marketing_opt_in(m1, 'cart-reminders-v1'); perform public.marketing_opt_in(m2, 'cart-reminders-v1');
  perform public.marketing_opt_in(m3, 'cart-reminders-v1'); perform public.marketing_opt_in(m4, 'cart-reminders-v1');
  if public.cart_recovery_detect(50) <> 3 then raise exception 'FAIL: expected exactly 3 cycles (m4 has nothing buyable)'; end if;
  if exists (select 1 from public.cart_recovery_cycles where member_id = m4) then raise exception 'FAIL: unpublished-only cart must not be abandoned'; end if;
  if public.cart_recovery_detect(50) <> 0 then raise exception 'FAIL: detect is not idempotent'; end if;
  select count(*) into n from public.cart_recovery_messages msgs join public.cart_recovery_cycles cc on cc.id = msgs.cycle_id where cc.member_id = m1;
  if n <> 3 then raise exception 'FAIL: expected 3 scheduled reminders, got %', n; end if;
  raise notice 'PASS: detection, idempotent, valid-product rule, three reminders scheduled';

  -- ---- duplicate guard at the database level ----
  select id into cy from public.cart_recovery_cycles where member_id = m1;
  begin insert into public.cart_recovery_messages (cycle_id, step, due_at, idempotency_key) values (cy, 1, now(), 'cart-recovery:dup:dup:dup:dup'); raise exception 'FAIL: duplicate (cycle, step) accepted';
  exception when unique_violation then null; end;
  raise notice 'PASS: duplicate reminder impossible';

  -- ---- delays: reminders are not due yet (default 60 min after abandonment) -> make step 1 due, claim it ----
  update public.cart_recovery_messages set due_at = now() - interval '1 minute' where cycle_id = cy and step = 1;
  select id into msg from public.cart_recovery_messages where cycle_id = cy and step = 1;
  if (select count(*) from public.cart_recovery_claim(10) where id = msg) <> 1 then raise exception 'FAIL: due reminder not claimed'; end if;
  if (select count(*) from public.cart_recovery_claim(10) where id = msg) <> 0 then raise exception 'FAIL: a claimed reminder was handed out twice'; end if;
  v := public.cart_recovery_preflight(msg);
  if (v ->> 'ok') <> 'true' then raise exception 'FAIL: preflight should pass: %', v; end if;
  raise notice 'PASS: claim is exclusive; preflight passes for a clean cart';

  -- ---- send bookkeeping and the minimum gap between reminders ----
  perform public.cart_recovery_finish(msg, 'sent', null, 'prov_1');
  update public.cart_recovery_messages set due_at = now() - interval '1 minute' where cycle_id = cy and step = 2;
  perform public.cart_recovery_claim(10);
  select id into msg from public.cart_recovery_messages where cycle_id = cy and step = 2;
  v := public.cart_recovery_preflight(msg);
  if (v ->> 'reason') <> 'min_gap' or (v ->> 'defer') <> 'true' then raise exception 'FAIL: expected min_gap deferral, got %', v; end if;
  perform public.cart_recovery_finish(msg, 'scheduled', 'min_gap');
  raise notice 'PASS: minimum gap defers instead of bursting';

  -- ---- pause: nothing is claimed ----
  update public.cart_recovery_messages set due_at = now() - interval '1 minute' where cycle_id = cy and step = 3;
  update public.cart_recovery_settings set paused = true;
  if (select count(*) from public.cart_recovery_claim(10)) <> 0 then raise exception 'FAIL: claim ran while paused'; end if;
  update public.cart_recovery_settings set paused = false;
  raise notice 'PASS: pause stops sending';

  -- ---- restore tokens: hash only, expiry, wrong account, sign-in, click counting ----
  perform public.cart_recovery_issue_token(msg, tok, 24);
  if (public.cart_recovery_redeem(tok, null) ->> 'result') <> 'signin_required' then raise exception 'FAIL: anonymous redeem'; end if;
  if (public.cart_recovery_redeem(tok, m2) ->> 'result') <> 'wrong_account' then raise exception 'FAIL: cross-account redeem'; end if;
  if (select clicked_at from public.cart_recovery_messages where id = msg) is not null then raise exception 'FAIL: click counted without the right customer'; end if;
  if (public.cart_recovery_redeem(tok, m1) ->> 'result') <> 'ok' then raise exception 'FAIL: owner redeem'; end if;
  if (select clicked_at from public.cart_recovery_messages where id = msg) is null then raise exception 'FAIL: click not recorded'; end if;
  if (public.cart_recovery_redeem(repeat('b', 64), m1) ->> 'result') <> 'invalid' then raise exception 'FAIL: unknown token'; end if;
  update public.cart_recovery_tokens set expires_at = now() - interval '1 second' where token_hash = tok;
  if (public.cart_recovery_redeem(tok, m1) ->> 'result') <> 'expired' then raise exception 'FAIL: expired token accepted'; end if;
  raise notice 'PASS: tokens: signin_required / wrong_account / ok / invalid / expired';

  -- ---- a cart changed by the customer ends the cycle (resumed) and revokes links ----
  update public.carts set updated_at = now() where id = c2;
  perform public.cart_recovery_sync();
  select status into st from public.cart_recovery_cycles where member_id = m2;
  if st <> 'resumed' then raise exception 'FAIL: activity should end the cycle, got %', st; end if;
  if exists (select 1 from public.cart_recovery_messages msgs join public.cart_recovery_cycles cc on cc.id = msgs.cycle_id where cc.member_id = m2 and msgs.status = 'scheduled') then raise exception 'FAIL: reminders survived activity'; end if;
  raise notice 'PASS: customer activity stops reminders';

  -- ---- purchase: a paid order after the last cart change supersedes the cart; recovery stops; attribution once ----
  -- Fixture fix (Phase 12 Stage 2): the reminder that was clicked above was left 'scheduled' by the min-gap deferral, and attribution only counts clicks on SENT mail.
  -- Mark it sent, and place the order 1 minute after the click: now() is frozen inside this transaction, and attribution needs the order strictly after the click.
  update public.cart_recovery_messages set status = 'sent', sent_at = now() where id = msg;
  insert into public.orders (order_no, status, channel, customer_name, customer_email, ship_address, ship_pincode, subtotal_paise, shipping_paise, total_paise, created_by, member_id, created_at)
  values (public.next_order_no(), 'paid', 'online', 'Z', 'zz-r1@example.org', '12 Test Road, Test', '221001', 99800, 0, 99800, 'selftest', m1, now() + interval '1 minute') returning id into o;
  if public.cart_recovery_member_state(m1, (select updated_at from public.carts where id = c1)) <> 'purchased' then raise exception 'FAIL: paid order must supersede the cart'; end if;
  perform public.cart_recovery_sync();
  select status into st from public.cart_recovery_cycles where member_id = m1;
  if st not in ('purchased', 'recovered') then raise exception 'FAIL: purchase should end the cycle, got %', st; end if;
  select count(*) into n from public.cart_recovery_attribution where order_id = o;
  if n <> 1 then raise exception 'FAIL: expected the order attributed once (the customer clicked, then paid), got %', n; end if;
  perform public.cart_recovery_sync();
  select count(*) into n from public.cart_recovery_attribution where order_id = o;
  if n <> 1 then raise exception 'FAIL: attribution counted twice'; end if;
  begin insert into public.cart_recovery_attribution (order_id, revenue_paise) values (o, 1); raise exception 'FAIL: second attribution accepted'; exception when unique_violation then null; end;
  raise notice 'PASS: purchase stops recovery; the order is attributed exactly once';

  -- ---- unsubscribe: persistent, stops everything in flight, a hard suppression survives a new opt-in ----
  perform public.marketing_unsubscribe('ZZ-R3@example.org ', 'recovery_email');
  if exists (select 1 from public.marketing_preferences where member_id = m3 and cart_reminders) then raise exception 'FAIL: still opted in'; end if;
  if exists (select 1 from public.cart_recovery_messages msgs join public.cart_recovery_cycles cc on cc.id = msgs.cycle_id where cc.member_id = m3 and msgs.status in ('scheduled', 'claimed')) then raise exception 'FAIL: reminders survived unsubscribe'; end if;
  if (select status from public.cart_recovery_cycles where member_id = m3) <> 'stopped' then raise exception 'FAIL: cycle not stopped'; end if;
  if not exists (select 1 from public.marketing_suppressions where email_hash = public.marketing_email_hash('zz-r3@example.org')) then raise exception 'FAIL: no suppression row'; end if;
  if exists (select 1 from public.marketing_suppressions where email_hash like '%zz-r3%') then raise exception 'FAIL: suppression must be a hash'; end if;
  update public.cart_recovery_settings set enabled = true;
  update public.carts set updated_at = now() - interval '3 hours' where id = c3;
  if public.cart_recovery_detect(50) <> 0 then raise exception 'FAIL: unsubscribed customer detected again'; end if;
  insert into public.marketing_suppressions (email_hash, reason, source) values (public.marketing_email_hash('zz-r4@example.org'), 'complaint', 'provider');
  if (public.marketing_opt_in(m4, 'cart-reminders-v1') ->> 'result') <> 'suppressed' then raise exception 'FAIL: a complaint suppression must survive a new opt-in'; end if;
  if (public.marketing_opt_in(m3, 'cart-reminders-v1') ->> 'result') <> 'ok' then raise exception 'FAIL: an explicit new opt-in after an unsubscribe is valid'; end if;
  raise notice 'PASS: unsubscribe is persistent; hard suppressions are not overridden; explicit re-opt-in works';

  -- ---- stats run and report the right shape ----
  v := public.cart_recovery_stats(now() - interval '1 day', now() + interval '1 day');
  if (v ->> 'recovered_orders')::int <> 1 or (v ->> 'attributed_revenue_paise')::bigint <> 99800 then raise exception 'FAIL: stats %', v; end if;
  raise notice 'PASS: stats';

  -- ---- privacy: nothing is exposed to public roles ----
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name like 'cart_recovery%' and grantee in ('anon', 'authenticated')) then raise exception 'FAIL: public grants on recovery tables'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('marketing_preferences', 'marketing_suppressions') and grantee in ('anon', 'authenticated')) then raise exception 'FAIL: public grants on marketing tables'; end if;
  raise notice 'PASS: no grants to anon or authenticated';
end $$;
rollback;
