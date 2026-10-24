-- Self-test for loyalty.sql. Run on a DISPOSABLE or STAGING database after loyalty.sql. One transaction that ROLLS BACK: it leaves nothing
-- behind, prints "PASS" notices and raises on the first failure. Do not run on production (it takes row locks and temporarily
-- switches the program on inside the transaction). Concurrency cannot be tested in one transaction: see loyalty_concurrency.sh.
begin;
-- The existing guard orders_require_capture refuses 'paid' without a captured payment, so fixtures record one first (as the webhook would).
create function pg_temp.pay(p_order uuid) returns void language plpgsql as $f$
begin
  insert into public.order_payments (order_id, rp_order_id, amount_paise, status, created_by, captured_at)
  select id, 'order_SELF' || replace(id::text, '-', ''), total_paise, 'captured', 'selftest', now() from public.orders where id = p_order;
  update public.orders set status = 'paid' where id = p_order;
end $f$;
do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  pa uuid; pb uuid; va uuid; vb uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid;
  v jsonb; n integer; w jsonb; err text; k integer; lot_a uuid;

begin
  -- fixtures: two members, two products (one Syrup, one Tablet), no orders yet
  insert into public.members (id, email, provider) values (m1, 'zz-l1@example.org', 'email'), (m2, 'zz-l2@example.org', 'email');
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-ly-a', 'ZZ LY A', 'Tablet', '60 tabs', 'APPROVED_FOR_SALE', 'Loyalty test A', 'Test only.', true, 'selftest') returning id into pa;
  insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by)
  values ('zz-ly-b', 'ZZ LY B', 'Syrup', '200 ml', 'APPROVED_FOR_SALE', 'Loyalty test B', 'Test only.', true, 'selftest') returning id into pb;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pa, 'ZZ-LY-A', '60 tabs', 50000) returning id into va;
  insert into public.product_variants (product_id, sku, pack_size, price_paise) values (pb, 'ZZ-LY-B', '200 ml', 30000) returning id into vb;

  -- 1. ships OFF: enrolment and earning refuse / do nothing
  begin perform public.loyalty_enrol(m1); err := null; exception when others then err := sqlerrm; end;
  if err is distinct from 'KH:DISABLED' then raise exception 'FAIL 1: enrolment must be refused while the program is off, got %', err; end if;
  raise notice 'PASS 1 program ships off';

  update public.loyalty_settings set redemption_tax_confirmed = true, refund_policy_confirmed = true, enabled = true, activation_days = 0, expiry_months = 12, birthday_enabled = true, birthday_points = 50, birthday_min_enrol_days = 0;

  -- 2. enrolment: idempotent, lowest tier assigned, no marketing consent row created
  if not public.loyalty_enrol(m1) then raise exception 'FAIL 2a: first enrolment should report new'; end if;
  if public.loyalty_enrol(m1) then raise exception 'FAIL 2b: second enrolment should report existing'; end if;
  if (select code from public.loyalty_tiers t join public.loyalty_accounts a on a.tier_id = t.id where a.member_id = m1) <> 'SILVER' then raise exception 'FAIL 2c: SILVER expected'; end if;
  if exists (select 1 from public.marketing_preferences where member_id = m1) then raise exception 'FAIL 2d: enrolment must not create marketing consent'; end if;
  raise notice 'PASS 2 enrolment (separate from marketing consent)';

  -- helper-free order creation
  -- o1: Tablet 2 x 500 + Syrup 1 x 300 = 1300.00, coupon-free, placed
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 130000, 130000, 'selftest', m1) returning id into o1;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise)
  values (o1, va, 'A', '60 tabs', 'ZZ-LY-A', 2, 50000, 100000), (o1, vb, 'B', '200 ml', 'ZZ-LY-B', 1, 30000, 30000);

  -- 3. unpaid order earns nothing; cancelled unpaid order earns nothing
  if public.loyalty_earn_for_order(o1) <> 0 then raise exception 'FAIL 3a: placed order must not earn'; end if;
  -- 4. paid order earns floor(130000 * 10 / 10000) = 130 points PENDING
  perform pg_temp.pay(o1);
  w := public.loyalty_wallet(m1);
  if (w ->> 'pending')::int <> 130 or (w ->> 'available')::int <> 0 then raise exception 'FAIL 4: expected 130 pending, 0 available, got %', w; end if;
  raise notice 'PASS 3-4 earning basis (net merchandise) and pending state';

  -- 5. duplicate payment event / direct re-call does not earn again
  if public.loyalty_earn_for_order(o1) <> 0 then raise exception 'FAIL 5a: duplicate earn'; end if;
  update public.orders set status = 'packed' where id = o1;
  update public.orders set status = 'paid' where id = o1;  -- captured payment already exists: this is a replayed transition
  if (select count(*) from public.loyalty_ledger where order_id = o1 and kind = 'earn') <> 1 then raise exception 'FAIL 5b: earn must be recorded once'; end if;
  raise notice 'PASS 5 duplicate earning blocked';

  -- 6. test orders and non-members earn nothing
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id, is_test)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 50000, 50000, 'selftest', m1, true) returning id into o2;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise) values (o2, va, 'A', '60 tabs', 'ZZ-LY-A', 1, 50000, 50000);
  perform pg_temp.pay(o2);
  if exists (select 1 from public.loyalty_lots where order_id = o2) then raise exception 'FAIL 6a: test order earned'; end if;
  raise notice 'PASS 6 test orders excluded';

  -- 7. exclusions: excluded product and non-eligible form are left out of the base
  update public.loyalty_settings set excluded_product_ids = array[pb];
  if public.loyalty_net_eligible(o1) <> 100000 then raise exception 'FAIL 7a: excluded product should be left out, got %', public.loyalty_net_eligible(o1); end if;
  update public.loyalty_settings set excluded_product_ids = '{}', eligible_forms = array['Syrup'];
  if public.loyalty_net_eligible(o1) <> 30000 then raise exception 'FAIL 7b: only Syrup eligible'; end if;
  update public.loyalty_settings set eligible_forms = '{}';
  raise notice 'PASS 7 exclusions and eligible forms';

  -- 8. not spendable before delivery
  begin perform public.loyalty_reserve(m1, o1, 100, 'k-early'); err := null; exception when others then err := sqlerrm; end;
  if err is null then raise exception 'FAIL 8: reserve must fail before points are available (order is not placed anyway)'; end if;

  -- 9. activation after delivery (activation_days = 0)
  update public.orders set status = 'shipped' where id = o1;
  update public.orders set status = 'delivered' where id = o1;
  if public.loyalty_activate_due(100) <> 1 then raise exception 'FAIL 9a: one lot should activate'; end if;
  if public.loyalty_activate_due(100) <> 0 then raise exception 'FAIL 9b: second run must do nothing'; end if;
  w := public.loyalty_wallet(m1);
  if (w ->> 'available')::int <> 130 or (w ->> 'pending')::int <> 0 then raise exception 'FAIL 9c: expected 130 available, got %', w; end if;
  if (select lifetime_spend_paise from public.loyalty_accounts where member_id = m1) <> 130000 then raise exception 'FAIL 9d: spend'; end if;
  raise notice 'PASS 9 activation, idempotent';

  -- 10. reservation: validations
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 60000, 60000, 'selftest', m1) returning id into o3;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise) values (o3, vb, 'B', '200 ml', 'ZZ-LY-B', 2, 30000, 60000);
  -- max 20% of 60000 = 12000 paise = 1200 points; only 130 available
  begin perform public.loyalty_reserve(m1, o3, 200, 'k1'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:INSUFFICIENT' then raise exception 'FAIL 10a: insufficient points, got %', err; end if;
  begin perform public.loyalty_reserve(m1, o3, 50, 'k1'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:LIMIT' then raise exception 'FAIL 10b: below minimum, got %', err; end if;
  begin perform public.loyalty_reserve(m1, o3, 110, 'k1'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:LIMIT' then raise exception 'FAIL 10c: not a whole block, got %', err; end if;
  begin perform public.loyalty_reserve(m2, o3, 100, 'k1'); err := null; exception when others then err := sqlerrm; end;
  if err is distinct from 'KH:NOT_ENROLLED' then raise exception 'FAIL 10d: other member, got %', err; end if;
  perform public.loyalty_enrol(m2);
  begin perform public.loyalty_reserve(m2, o3, 100, 'k1'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:NOT_FOUND' then raise exception 'FAIL 10e: another customer''s order must look not found, got %', err; end if;
  raise notice 'PASS 10 redemption validation (balance, block, minimum, owner of order)';

  -- 11. reserve 100 points = Rs 10 (1000 paise); idempotent replay; different key refused
  v := public.loyalty_reserve(m1, o3, 100, 'k1');
  if (v ->> 'discount_paise')::int <> 1000 then raise exception 'FAIL 11a: 100 points should be 1000 paise, got %', v; end if;
  v := public.loyalty_reserve(m1, o3, 100, 'k1');
  if (v ->> 'replayed')::boolean is not true then raise exception 'FAIL 11b: replay'; end if;
  begin perform public.loyalty_reserve(m1, o3, 100, 'k2'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:CONFLICT' then raise exception 'FAIL 11c: second reservation on same order, got %', err; end if;
  w := public.loyalty_wallet(m1);
  if (w ->> 'available')::int <> 30 or (w ->> 'reserved')::int <> 100 then raise exception 'FAIL 11d: balances %', w; end if;
  raise notice 'PASS 11 reservation and idempotency';

  -- 12. cancelled checkout releases; a second release is a no-op
  update public.orders set status = 'cancelled' where id = o3;
  w := public.loyalty_wallet(m1);
  if (w ->> 'available')::int <> 130 or (w ->> 'reserved')::int <> 0 then raise exception 'FAIL 12a: release %', w; end if;
  if public.loyalty_release(o3) then raise exception 'FAIL 12b: double release'; end if;
  raise notice 'PASS 12 failed checkout releases points';

  -- 13. coupon exclusivity (default policy) and "both" policy
  insert into public.coupons (code, discount_type, percent_bps, active, created_by) values ('ZZLY10', 'percent', 1000, true, 't');
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, discount_paise, total_paise, created_by, member_id, coupon_id, coupon_code)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 60000, 6000, 54000, 'selftest', m1, (select id from public.coupons where code = 'ZZLY10'), 'ZZLY10') returning id into o4;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise, discount_paise) values (o4, vb, 'B', '200 ml', 'ZZ-LY-B', 2, 30000, 60000, 6000);
  begin perform public.loyalty_reserve(m1, o4, 100, 'k3'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:STACKING' then raise exception 'FAIL 13a: coupon + points must be refused by default, got %', err; end if;
  update public.loyalty_settings set stacking = 'both';
  v := public.loyalty_reserve(m1, o4, 100, 'k3');
  if (v ->> 'discount_paise')::int <> 1000 then raise exception 'FAIL 13b: both-policy reserve'; end if;
  update public.loyalty_settings set stacking = 'exclusive';
  raise notice 'PASS 13 coupon stacking policy';

  -- 14. pay o4: reservation commits; earn is on net (60000 - 6000) = 54000 -> 54 points pending
  perform pg_temp.pay(o4);
  w := public.loyalty_wallet(m1);
  if (w ->> 'reserved')::int <> 0 or (w ->> 'available')::int <> 30 or (w ->> 'pending')::int <> 54 then raise exception 'FAIL 14: %', w; end if;
  if (select status from public.loyalty_reservations where order_id = o4) <> 'committed' then raise exception 'FAIL 14b: commit'; end if;
  raise notice 'PASS 14 commit on payment, earning after coupon discount';

  -- 15. partial refund reverses proportionally (pending lot): refund 27000 of 54000 -> 27 points; repeat event is a no-op
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, status, requested_by) values (o4, 'refund_only', 'other', 'selftest', 27000, 'refunded', 't');
  w := public.loyalty_wallet(m1);
  if (w ->> 'pending')::int <> 27 then raise exception 'FAIL 15a: expected 27 pending, got %', w; end if;
  update public.order_refunds set updated_at = now() where order_id = o4;
  if (public.loyalty_wallet(m1) ->> 'pending')::int <> 27 then raise exception 'FAIL 15b: repeated refund event changed balance'; end if;
  if public.loyalty_reverse_for_order(o4, 27000, false) <> 0 then raise exception 'FAIL 15c: duplicate reversal'; end if;
  raise notice 'PASS 15 partial refund, duplicate refund event';

  -- 16. full refund: remaining 27 reversed AND redeemed 100 points restored (once)
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, status, requested_by) values (o4, 'refund_only', 'other', 'selftest', 27000, 'refunded', 't');
  w := public.loyalty_wallet(m1);
  if (w ->> 'pending')::int <> 0 or (w ->> 'available')::int <> 130 then raise exception 'FAIL 16: expected 0 pending, 130 available (30 + 100 restored), got %', w; end if;
  if (select count(*) from public.loyalty_ledger where kind = 'restore' and order_id = o4) <> 1 then raise exception 'FAIL 16b: restore once'; end if;
  raise notice 'PASS 16 full refund reverses earn and restores redeemed points once';

  -- 17. refund of an activated order after the points were spent creates debt, never a negative balance; debt is recovered
  update public.loyalty_settings set stacking = 'exclusive';
  perform public.loyalty_adjust(m1, -130, 'Selftest: simulate spent points', 'selftest', 'adj-spend');
  if (public.loyalty_wallet(m1) ->> 'available')::int <> 0 then raise exception 'FAIL 17a: adjust'; end if;
  insert into public.order_refunds (order_id, kind, reason_code, reason_note, amount_paise, status, requested_by) values (o1, 'refund_only', 'other', 'selftest', 65000, 'refunded', 't');
  w := public.loyalty_wallet(m1);
  if (w ->> 'available')::int <> 0 or (w ->> 'debt')::int <> 65 then raise exception 'FAIL 17b: half of 130 should be debt 65, got %', w; end if;
  if (select lifetime_spend_paise from public.loyalty_accounts where member_id = m1) <> 65000 then raise exception 'FAIL 17c: spend not reduced'; end if;
  raise notice 'PASS 17 shortfall becomes debt, no negative balance';

  -- 18. debt is recovered from the next activated points
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 100000, 100000, 'selftest', m1) returning id into o5;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise) values (o5, va, 'A', '60 tabs', 'ZZ-LY-A', 2, 50000, 100000);
  perform pg_temp.pay(o5);
  update public.orders set status = 'shipped' where id = o5;
  update public.orders set status = 'delivered' where id = o5;
  perform public.loyalty_activate_due(100);
  w := public.loyalty_wallet(m1);
  if (w ->> 'debt')::int <> 0 or (w ->> 'available')::int <> 35 then raise exception 'FAIL 18: 100 earned - 65 debt = 35, got %', w; end if;
  raise notice 'PASS 18 debt recovery';

  -- 19. tier: spend 65000 + 100000 = 165000 < 500000 so SILVER; push spend over the GOLD threshold and check one history row per change
  update public.loyalty_accounts set lifetime_spend_paise = 600000 where member_id = m1;
  perform public.loyalty_tier_eval(m1); perform public.loyalty_tier_eval(m1);
  if (select t.code from public.loyalty_accounts a join public.loyalty_tiers t on t.id = a.tier_id where a.member_id = m1) <> 'GOLD' then raise exception 'FAIL 19a: GOLD expected'; end if;
  if (select count(*) from public.loyalty_tier_history where member_id = m1) <> 2 then raise exception 'FAIL 19b: duplicate evaluations must not add history (expected SILVER + GOLD rows)'; end if;
  raise notice 'PASS 19 tiers, no churn from repeated evaluation';

  -- 20. expiry: expired points cannot be reserved; sweep records an expire entry
  update public.loyalty_lots set expires_at = now() - interval '1 day' where order_id = o5 and source = 'order';
  begin perform public.loyalty_adjust(m1, -35, 'Selftest: should fail, points expired', 'selftest', 'adj-expired'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:INSUFFICIENT' then raise exception 'FAIL 20a: expired points spendable, got %', err; end if;
  if public.loyalty_expire_due(100) < 1 then raise exception 'FAIL 20b: sweep'; end if;
  if public.loyalty_expire_due(100) <> 0 then raise exception 'FAIL 20c: sweep twice'; end if;
  if (public.loyalty_wallet(m1) ->> 'available')::int <> 0 then raise exception 'FAIL 20d'; end if;
  raise notice 'PASS 20 expiry';

  -- 21. earliest-expiring points are spent first
  perform public.loyalty_adjust(m1, 100, 'Selftest: grant late', 'selftest', 'adj-g1');
  perform public.loyalty_adjust(m1, 100, 'Selftest: grant early', 'selftest', 'adj-g2');
  update public.loyalty_lots set expires_at = now() + interval '10 days' where member_id = m1 and remaining = 100 and id = (select id from public.loyalty_lots where member_id = m1 and source = 'adjust' and remaining = 100 order by created_at desc, id desc limit 1);
  perform public.loyalty_adjust(m1, -100, 'Selftest: spend', 'selftest', 'adj-s1');
  if (select count(*) from public.loyalty_lots where member_id = m1 and source = 'adjust' and remaining = 100 and expires_at > now() + interval '11 days') <> 1 then raise exception 'FAIL 21: the earlier-expiring lot should have been spent first'; end if;
  raise notice 'PASS 21 earliest expiry first';

  -- 22. manual adjustment: reason required, idempotent, ledger only
  begin perform public.loyalty_adjust(m1, 10, 'no', 'selftest', 'adj-bad'); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:INVALID' then raise exception 'FAIL 22a: reason too short, got %', err; end if;
  perform public.loyalty_adjust(m1, 10, 'Selftest: goodwill', 'selftest', 'adj-dup');
  v := public.loyalty_adjust(m1, 10, 'Selftest: goodwill', 'selftest', 'adj-dup');
  if (v ->> 'replayed')::boolean is not true then raise exception 'FAIL 22b: replay'; end if;
  raise notice 'PASS 22 manual adjustment';

  -- 23. ledger is append-only
  begin update public.loyalty_ledger set delta_available = 1 where id = (select min(id) from public.loyalty_ledger); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:APPEND_ONLY' then raise exception 'FAIL 23a: update allowed, got %', err; end if;
  begin delete from public.loyalty_ledger where member_id = m1; err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:APPEND_ONLY' then raise exception 'FAIL 23b: delete allowed, got %', err; end if;
  raise notice 'PASS 23 append-only ledger';

  -- 24. ledger sums equal the lot projection (no drift)
  select coalesce(sum(delta_available), 0) + coalesce(sum(delta_reserved), 0) into k from public.loyalty_ledger where member_id = m1;
  if k <> (select coalesce(sum(remaining), 0) from public.loyalty_lots where member_id = m1) + (select coalesce(sum(points), 0) from public.loyalty_reservations where member_id = m1 and status = 'reserved') then
    raise exception 'FAIL 24: ledger total % differs from lots', k;
  end if;
  raise notice 'PASS 24 ledger equals lots';

  -- 25. birthday: month/day only, locked after set, one claim a year, removal does not reset
  perform public.loyalty_birthday_set(m1, extract(month from now() at time zone 'Asia/Kolkata')::int, 15);
  begin perform public.loyalty_birthday_set(m1, 1, 1); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:BIRTHDAY_LOCKED' then raise exception 'FAIL 25a: changing birthday inside a year, got %', err; end if;
  if public.loyalty_birthday_grant(m1) <> 50 then raise exception 'FAIL 25b: grant'; end if;
  begin perform public.loyalty_birthday_grant(m1); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:ALREADY_CLAIMED' then raise exception 'FAIL 25c: second claim, got %', err; end if;
  perform public.loyalty_birthday_set(m1, null, null);
  perform public.loyalty_birthday_set(m1, extract(month from now() at time zone 'Asia/Kolkata')::int, 15);
  begin perform public.loyalty_birthday_grant(m1); err := null; exception when others then err := sqlerrm; end;
  if err <> 'KH:ALREADY_CLAIMED' then raise exception 'FAIL 25d: remove-and-readd must not reset the claim, got %', err; end if;
  begin perform public.loyalty_birthday_grant(m2); err := null; exception when others then err := sqlerrm; end;
  if err is null then raise exception 'FAIL 25e: member with no birthday and no orders must not claim'; end if;
  raise notice 'PASS 25 birthday rules';

  -- 26. milestone granted once
  insert into public.loyalty_milestones (orders_required, bonus_points, active) values (3, 40, true);
  insert into public.orders (order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
  values (public.next_order_no(), 'placed', 'online', 'T', 'Test address 12345', '221001', 50000, 50000, 'selftest', m1) returning id into o6;
  insert into public.order_items (order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise) values (o6, va, 'A', '60 tabs', 'ZZ-LY-A', 1, 50000, 50000);
  perform pg_temp.pay(o6);
  update public.orders set status = 'shipped' where id = o6;
  update public.orders set status = 'delivered' where id = o6;
  perform public.loyalty_activate_due(100);
  if (select count(*) from public.loyalty_ledger where idem_key like 'milestone:%') <> 1 then raise exception 'FAIL 26a: milestone should be granted once'; end if;
  perform public.loyalty_activate_due(100);
  if (select count(*) from public.loyalty_milestone_grants where member_id = m1) <> 1 then raise exception 'FAIL 26b'; end if;
  raise notice 'PASS 26 milestone once';

  -- 27. overview is read-only and consistent
  v := public.loyalty_overview(now() - interval '1 day', now() + interval '1 day');
  if (v ->> 'enrolled')::int < 2 or (v #>> '{points,issued}')::bigint <= 0 then raise exception 'FAIL 27: overview %', v; end if;
  raise notice 'PASS 27 overview';

  -- 28. wallet of a member who never enrolled shows no balance
  w := public.loyalty_wallet(gen_random_uuid());
  if (w ->> 'enrolled')::boolean then raise exception 'FAIL 28'; end if;

  -- 29. RLS: tables are closed to anon and authenticated
  if exists (select 1 from information_schema.role_table_grants where table_name like 'loyalty\_%' and grantee in ('anon', 'authenticated')) then raise exception 'FAIL 29: grants found'; end if;
  if (select count(*) from pg_tables where schemaname = 'public' and tablename like 'loyalty\_%' and not rowsecurity) <> 0 then raise exception 'FAIL 29b: RLS off'; end if;
  raise notice 'PASS 28-29 wallet isolation shape, RLS on, no public grants';
end $$;
rollback;
