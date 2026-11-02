-- Self-test for supabase/reviews.sql (single session). DISPOSABLE DATABASE ONLY. Rolled back.
begin;
do $$
declare m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); p uuid; v uuid; o uuid := gen_random_uuid(); oi uuid := gen_random_uuid();
        o2 uuid := gen_random_uuid(); oi2 uuid := gen_random_uuid(); res jsonb; rid uuid; ok boolean; n integer; st jsonb; lst jsonb;
begin
  insert into public.members (id, email, name, provider) values (m1, 'a@example.test', 'Asha Verma', 'password'), (m2, 'b@example.test', 'Ravi K', 'password');
  select id into p from public.products limit 1;
  insert into public.product_variants (product_id, sku, pack_size) values (p, 'ZZ-TEST-1', '100 ml') returning id into v;
  -- order 1: delivered + captured; order 2: placed (not eligible)
  insert into public.orders (id, order_no, status, channel, customer_name, ship_address, ship_pincode, subtotal_paise, total_paise, created_by, member_id)
    values (o, 'KH-2026-900001', 'placed', 'online', 'Asha Verma', '1 Test Road, Pune', '411001', 10000, 10000, 'test', m1),
           (o2, 'KH-2026-900002', 'placed', 'online', 'Asha Verma', '1 Test Road, Pune', '411001', 10000, 10000, 'test', m1);
  insert into public.order_items (id, order_id, variant_id, product_name, pack_size, sku, qty, unit_price_paise, line_total_paise)
    values (oi, o, v, 'T', '100 ml', 'ZZ-TEST-1', 1, 10000, 10000), (oi2, o2, v, 'T', '100 ml', 'ZZ-TEST-1', 1, 10000, 10000);
  -- not delivered, not paid: not eligible
  select count(*) into n from public.review_eligible_items(m1, p); if n <> 0 then raise exception 'FAIL: unpaid undelivered order must not be eligible'; end if;
  begin perform public.review_submit(m1, p, 5, 'Good product', 'Used it for a month, happy.', '{}', false); raise exception 'FAIL: submit without eligibility succeeded';
  exception when others then if sqlerrm not like 'KH:NOT_ELIGIBLE%' then raise; end if; end;
  insert into public.order_payments (order_id, rp_order_id, amount_paise, status, created_by) values (o, 'order_test001', 10000, 'captured', 'test');
  update public.orders set status = 'paid' where id = o; update public.orders set status = 'packed' where id = o; update public.orders set status = 'shipped' where id = o; update public.orders set status = 'delivered' where id = o;
  select count(*) into n from public.review_eligible_items(m1, p); if n <> 1 then raise exception 'FAIL: delivered+captured order must be eligible (got %)', n; end if;
  select count(*) into n from public.review_eligible_items(m2, p); if n <> 0 then raise exception 'FAIL: another customer must not be eligible'; end if;
  -- invalid rating
  begin perform public.review_submit(m1, p, 6, 'Good product', 'Used it for a month, happy.', '{}', false); raise exception 'FAIL: rating 6 accepted';
  exception when others then if sqlerrm not like 'KH:INVALID%' then raise; end if; end;
  begin insert into public.product_reviews (product_id, member_id, order_item_id, rating, title, body) values (p, m1, oi, 0, 'abc', 'abcdefghij'); raise exception 'FAIL: rating 0 row accepted';
  exception when check_violation then null; end;
  res := public.review_submit(m1, p, 4, 'Good product', 'Used it for a month, happy.', '{}', false);
  rid := (res->>'id')::uuid; if res->>'status' <> 'PUBLISHED' then raise exception 'FAIL: text-only review should publish'; end if;
  begin perform public.review_submit(m1, p, 5, 'Second one', 'Trying to review twice here.', '{}', false); raise exception 'FAIL: duplicate review accepted';
  exception when others then if sqlerrm not like 'KH:NOT_ELIGIBLE%' then raise; end if; end;
  st := public.review_stats(p); if (st->>'count')::int <> 1 or (st->>'average')::numeric <> 4.00 or (st->'distribution'->>'4')::int <> 1 then raise exception 'FAIL: stats %', st; end if;
  lst := public.review_public_list(p, null, 'recent', 10, 0);
  if jsonb_array_length(lst->'items') <> 1 then raise exception 'FAIL: public list'; end if;
  if lst::text ~* 'example\.test|order_no|KH-2026|411001|Test Road' then raise exception 'FAIL: private data in public list: %', lst; end if;
  if lst->'items'->0->>'name' <> 'Asha' then raise exception 'FAIL: display name should be first name only'; end if;
  -- someone else cannot edit or withdraw
  begin perform public.review_update_own(m2, rid, 5, 'Hijacked', 'This is not my review at all.', '{}'); raise exception 'FAIL: cross-customer edit';
  exception when others then if sqlerrm not like 'KH:NOT_FOUND%' then raise; end if; end;
  begin perform public.review_withdraw_own(m2, rid); raise exception 'FAIL: cross-customer withdraw';
  exception when others then if sqlerrm not like 'KH:NOT_FOUND%' then raise; end if; end;
  perform public.review_update_own(m1, rid, 5, 'Very good product', 'Used it for a month, very happy now.', '{}');
  -- hide needs a reason; text and stars untouched; stats and list exclude hidden
  begin perform public.review_moderate(rid, 'hide', 'owner@x', ''); raise exception 'FAIL: hide without reason';
  exception when others then if sqlerrm not like 'KH:INVALID%' then raise; end if; end;
  perform public.review_moderate(rid, 'hide', 'owner@x', 'Contains personal information');
  st := public.review_stats(p); if (st->>'count')::int <> 0 or st->>'average' is not null then raise exception 'FAIL: hidden review counted'; end if;
  if jsonb_array_length(public.review_public_list(p, null, 'recent', 10, 0)->'items') <> 0 then raise exception 'FAIL: hidden review listed'; end if;
  select rating into n from public.product_reviews where id = rid; if n <> 5 then raise exception 'FAIL: rating changed by moderation'; end if;
  perform public.review_moderate(rid, 'restore', 'owner@x', null);
  if (public.review_stats(p)->>'count')::int <> 1 then raise exception 'FAIL: restore'; end if;
  -- reply stored separately; report rules
  perform public.review_reply_set(rid, 'owner@x', 'Thank you for the feedback.');
  if public.review_public_list(p, null, 'recent', 10, 0)->'items'->0->'reply'->>'body' <> 'Thank you for the feedback.' then raise exception 'FAIL: reply'; end if;
  begin perform public.review_report_add(rid, m1, 'spam', null); raise exception 'FAIL: self-report';
  exception when others then if sqlerrm not like 'KH:STATE%' then raise; end if; end;
  perform public.review_report_add(rid, m2, 'spam', 'x'); perform public.review_report_add(rid, m2, 'spam', 'x');
  select count(*) into n from public.review_reports where review_id = rid; if n <> 1 then raise exception 'FAIL: duplicate reports stored (%)', n; end if;
  if (select status from public.product_reviews where id = rid) <> 'PUBLISHED' then raise exception 'FAIL: report changed review'; end if;
  -- history is append-only
  begin update public.review_moderation_events set actor = 'x'; raise exception 'FAIL: history updated';
  exception when others then if sqlerrm not like 'KH:IMMUTABLE%' then raise; end if; end;
  begin delete from public.review_moderation_events; raise exception 'FAIL: history deleted';
  exception when others then if sqlerrm not like 'KH:IMMUTABLE%' then raise; end if; end;
  -- withdraw keeps one-review-per-product
  perform public.review_withdraw_own(m1, rid);
  if (public.review_stats(p)->>'count')::int <> 0 then raise exception 'FAIL: withdrawn counted'; end if;
  select count(*) into n from public.review_eligible_items(m1, p); if n <> 0 then raise exception 'FAIL: withdrawn customer re-eligible'; end if;
  -- anon/authenticated have no access
  if has_table_privilege('anon', 'public.product_reviews', 'select') or has_table_privilege('authenticated', 'public.product_reviews', 'select') then raise exception 'FAIL: table grants'; end if;
  if has_function_privilege('anon', 'public.review_submit(uuid,uuid,integer,text,text,text[],boolean)', 'execute') then raise exception 'FAIL: function grants'; end if;
  raise notice 'reviews_selftest: PASS';
end $$;
rollback;
