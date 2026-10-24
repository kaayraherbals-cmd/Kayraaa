-- Phase 6: verified customer reviews and ratings. Additive and re-runnable. Needs: 4 (members), 10 (variants), 12 (orders), 14 (payments),
-- 18 (shipments), 20 (rate_limits is used by the API, not here). Server-only: RLS on, no grants to anon or authenticated; every function is
-- executed by the server's service-role key. NOT YET RUN on any database (see docs/PHASE6_REVIEWS.md).
--
-- Policy (kept in step with shared/reviews.ts):
--  * A customer may review a product only from an order that is theirs (orders.member_id), delivered, not a test order, with a CAPTURED payment.
--    So every review is a verified-purchase review; verified_purchase is set here, never by a client.
--  * One review per purchased line (order_item_id) and one per customer per product.
--  * Text-only reviews publish at once. A review with photos, or one that trips a health-claim safety flag, waits as PENDING for a person.
--  * Staff can hide, reject, approve, restore and reply. They can never change stars, title or text. Every action is an append-only event.

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  order_item_id uuid not null unique references public.order_items(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  title text not null check (char_length(title) between 3 and 100),
  body text not null check (char_length(body) between 10 and 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'WITHDRAWN')),
  verified_purchase boolean not null default true check (verified_purchase),
  safety_flags text[] not null default '{}',
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  edit_count smallint not null default 0 check (edit_count between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, product_id)
);
create index if not exists product_reviews_public_idx on public.product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_rating_idx on public.product_reviews (product_id, status, rating);
create index if not exists product_reviews_status_idx on public.product_reviews (status, created_at desc);
drop trigger if exists product_reviews_touch on public.product_reviews;
create trigger product_reviews_touch before update on public.product_reviews for each row execute function public.touch_updated_at();

create table if not exists public.review_images (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  file text not null unique check (file ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'),
  bytes integer not null check (bytes between 1 and 2097152),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now()
);
create index if not exists review_images_review_idx on public.review_images (review_id);

create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  reporter_id uuid not null references public.members(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'personal_information', 'misleading', 'inappropriate', 'other')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'OPEN' check (status in ('OPEN', 'DISMISSED', 'ACTIONED')),
  handled_by text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);
create index if not exists review_reports_open_idx on public.review_reports (status, created_at desc);

create table if not exists public.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.product_reviews(id) on delete cascade,
  body text not null check (char_length(body) between 5 and 1000),
  author text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists review_replies_touch on public.review_replies;
create trigger review_replies_touch before update on public.review_replies for each row execute function public.touch_updated_at();

-- Append-only history of what staff did. No foreign key on purpose: history must survive a deleted review.
create table if not exists public.review_moderation_events (
  id bigint generated always as identity primary key,
  review_id uuid not null,
  actor text not null,
  action text not null check (action in ('approve', 'hide', 'reject', 'restore', 'reply', 'reply_edit', 'image_approve', 'image_reject', 'report_dismiss', 'report_action')),
  from_status text,
  to_status text,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists review_moderation_events_review_idx on public.review_moderation_events (review_id, created_at desc);
create or replace function public.review_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'KH:IMMUTABLE:review history is append-only'; end $$;
drop trigger if exists review_events_no_change on public.review_moderation_events;
create trigger review_events_no_change before update or delete on public.review_moderation_events for each row execute function public.review_events_immutable();

alter table public.product_reviews enable row level security;
alter table public.review_images enable row level security;
alter table public.review_reports enable row level security;
alter table public.review_replies enable row level security;
alter table public.review_moderation_events enable row level security;
revoke all on public.product_reviews, public.review_images, public.review_reports, public.review_replies, public.review_moderation_events from anon, authenticated;

-- Which purchased lines this customer may review now. Ownership, delivery and captured payment all come from our own order records.
create or replace function public.review_eligible_items(p_member uuid, p_product uuid) returns table (order_item_id uuid, order_no text, delivered boolean)
language sql stable as $$
  select oi.id, o.order_no, true
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.product_variants v on v.id = oi.variant_id
   where o.member_id = p_member and v.product_id = p_product
     and o.status = 'delivered' and not o.is_test
     and exists (select 1 from public.order_payments pay where pay.order_id = o.id and pay.status = 'captured')
     and not exists (select 1 from public.product_reviews r where r.order_item_id = oi.id)
     and not exists (select 1 from public.product_reviews r2 where r2.member_id = p_member and r2.product_id = p_product)
   order by o.created_at desc
$$;

-- One transaction: lock the customer-product pair, re-check eligibility, insert. Concurrent duplicates fail on the unique constraints.
create or replace function public.review_submit(p_member uuid, p_product uuid, p_rating integer, p_title text, p_body text, p_flags text[], p_has_images boolean)
returns jsonb language plpgsql as $$
declare v_item uuid; v_status text; v_id uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'KH:INVALID:rating must be 1 to 5'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_member::text || p_product::text, 0));
  select e.order_item_id into v_item from public.review_eligible_items(p_member, p_product) e limit 1;
  if v_item is null then raise exception 'KH:NOT_ELIGIBLE:only a delivered, paid order of this product can be reviewed'; end if;
  v_status := case when p_has_images or coalesce(array_length(p_flags, 1), 0) > 0 then 'PENDING' else 'PUBLISHED' end;
  insert into public.product_reviews (product_id, member_id, order_item_id, rating, title, body, status, safety_flags)
  values (p_product, p_member, v_item, p_rating::smallint, p_title, p_body, v_status, coalesce(p_flags, '{}')) returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;

-- Customer edit: only own review, only PUBLISHED, PENDING or HIDDEN, at most 3 times, within 30 days. A hidden review goes back to a person.
create or replace function public.review_update_own(p_member uuid, p_review uuid, p_rating integer, p_title text, p_body text, p_flags text[])
returns jsonb language plpgsql as $$
declare r public.product_reviews; v_status text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'KH:INVALID:rating must be 1 to 5'; end if;
  select * into r from public.product_reviews where id = p_review and member_id = p_member for update;
  if not found then raise exception 'KH:NOT_FOUND:review not found'; end if;
  if r.status not in ('PUBLISHED', 'PENDING', 'HIDDEN') then raise exception 'KH:STATE:this review can no longer be edited'; end if;
  if r.edit_count >= 3 then raise exception 'KH:STATE:a review can be edited three times'; end if;
  if r.created_at < now() - interval '30 days' then raise exception 'KH:STATE:reviews can be edited for 30 days'; end if;
  v_status := case when r.status = 'HIDDEN' or coalesce(array_length(p_flags, 1), 0) > 0
                     or exists (select 1 from public.review_images i where i.review_id = r.id and i.status = 'PENDING') then 'PENDING' else r.status end;
  update public.product_reviews set rating = p_rating::smallint, title = p_title, body = p_body, safety_flags = coalesce(p_flags, '{}'),
         status = v_status, status_reason = case when v_status = 'PENDING' then null else status_reason end, edit_count = edit_count + 1 where id = r.id;
  return jsonb_build_object('id', r.id, 'status', v_status);
end $$;

create or replace function public.review_withdraw_own(p_member uuid, p_review uuid) returns jsonb language plpgsql as $$
declare r public.product_reviews;
begin
  select * into r from public.product_reviews where id = p_review and member_id = p_member for update;
  if not found then raise exception 'KH:NOT_FOUND:review not found'; end if;
  if r.status = 'WITHDRAWN' then return jsonb_build_object('id', r.id, 'status', 'WITHDRAWN'); end if;
  update public.product_reviews set status = 'WITHDRAWN', status_reason = null where id = r.id;
  return jsonb_build_object('id', r.id, 'status', 'WITHDRAWN');
end $$;

-- Aggregates are computed here, from PUBLISHED reviews only. No client or AI supplies a number.
create or replace function public.review_stats(p_product uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'count', count(*),
    'average', case when count(*) = 0 then null else round(avg(rating)::numeric, 2) end,
    'distribution', jsonb_build_object('5', count(*) filter (where rating = 5), '4', count(*) filter (where rating = 4),
      '3', count(*) filter (where rating = 3), '2', count(*) filter (where rating = 2), '1', count(*) filter (where rating = 1)))
  from public.product_reviews where product_id = p_product and status = 'PUBLISHED'
$$;

-- Public listing. Returns first name only, never email, phone, address, order number or payment data.
create or replace function public.review_public_list(p_product uuid, p_rating integer, p_sort text, p_limit integer, p_offset integer) returns jsonb
language sql stable as $$
  with page as (
    select r.id, r.rating, r.title, r.body, r.created_at, r.updated_at,
           coalesce(nullif(left(split_part(btrim(m.name), ' ', 1), 30), ''), 'Verified customer') as display_name,
           (select jsonb_build_object('body', rp.body, 'at', rp.created_at) from public.review_replies rp where rp.review_id = r.id) as reply,
           coalesce((select jsonb_agg(i.file order by i.created_at) from public.review_images i where i.review_id = r.id and i.status = 'APPROVED'), '[]'::jsonb) as images
      from public.product_reviews r join public.members m on m.id = r.member_id
     where r.product_id = p_product and r.status = 'PUBLISHED' and (p_rating is null or r.rating = p_rating)
     order by case when p_sort = 'highest' then r.rating end desc nulls last, case when p_sort = 'lowest' then r.rating end asc nulls last, r.created_at desc
     limit least(greatest(p_limit, 1), 20) offset greatest(p_offset, 0))
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('id', id, 'rating', rating, 'title', title, 'body', body, 'createdAt', created_at,
    'edited', updated_at > created_at + interval '1 minute', 'name', display_name, 'verified', true, 'reply', reply, 'images', images)), '[]'::jsonb)) from page
$$;

-- Moderation: the only way a status changes on the staff side. Text and stars are never touched.
create or replace function public.review_moderate(p_review uuid, p_action text, p_actor text, p_reason text) returns jsonb language plpgsql as $$
declare r public.product_reviews; v_to text;
begin
  select * into r from public.product_reviews where id = p_review for update;
  if not found then raise exception 'KH:NOT_FOUND:review not found'; end if;
  if r.status = 'WITHDRAWN' then raise exception 'KH:STATE:the customer withdrew this review'; end if;
  if p_action in ('hide', 'reject') and char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'KH:INVALID:give a reason of at least 5 characters'; end if;
  v_to := case p_action
    when 'approve' then case when r.status = 'PENDING' then 'PUBLISHED' end
    when 'hide' then case when r.status in ('PUBLISHED', 'PENDING') then 'HIDDEN' end
    when 'reject' then case when r.status = 'PENDING' then 'REJECTED' end
    when 'restore' then case when r.status in ('HIDDEN', 'REJECTED') then 'PUBLISHED' end end;
  if v_to is null then raise exception 'KH:STATE:that action does not apply to a % review', r.status; end if;
  update public.product_reviews set status = v_to, status_reason = case when v_to in ('HIDDEN', 'REJECTED') then left(p_reason, 300) else null end where id = r.id;
  insert into public.review_moderation_events (review_id, actor, action, from_status, to_status, reason) values (r.id, p_actor, p_action, r.status, v_to, left(p_reason, 300));
  return jsonb_build_object('id', r.id, 'status', v_to);
end $$;

create or replace function public.review_reply_set(p_review uuid, p_actor text, p_body text) returns jsonb language plpgsql as $$
declare v_had boolean;
begin
  if not exists (select 1 from public.product_reviews where id = p_review and status in ('PUBLISHED', 'HIDDEN', 'PENDING')) then raise exception 'KH:NOT_FOUND:review not found'; end if;
  select exists (select 1 from public.review_replies where review_id = p_review) into v_had;
  insert into public.review_replies (review_id, body, author) values (p_review, p_body, p_actor)
  on conflict (review_id) do update set body = excluded.body, author = excluded.author;
  insert into public.review_moderation_events (review_id, actor, action) values (p_review, p_actor, case when v_had then 'reply_edit' else 'reply' end);
  return jsonb_build_object('id', p_review, 'edited', v_had);
end $$;

create or replace function public.review_image_decide(p_image uuid, p_actor text, p_approve boolean) returns jsonb language plpgsql as $$
declare i public.review_images;
begin
  select * into i from public.review_images where id = p_image for update;
  if not found then raise exception 'KH:NOT_FOUND:image not found'; end if;
  update public.review_images set status = case when p_approve then 'APPROVED' else 'REJECTED' end where id = i.id;
  insert into public.review_moderation_events (review_id, actor, action) values (i.review_id, p_actor, case when p_approve then 'image_approve' else 'image_reject' end);
  return jsonb_build_object('id', i.id, 'review', i.review_id, 'file', i.file);
end $$;

-- A report never changes a review by itself. Duplicate reports from one customer hit the unique key; own reviews cannot be reported.
create or replace function public.review_report_add(p_review uuid, p_reporter uuid, p_reason text, p_note text) returns jsonb language plpgsql as $$
declare v_owner uuid; v_open integer;
begin
  select member_id into v_owner from public.product_reviews where id = p_review and status = 'PUBLISHED';
  if v_owner is null then raise exception 'KH:NOT_FOUND:review not found'; end if;
  if v_owner = p_reporter then raise exception 'KH:STATE:you cannot report your own review'; end if;
  select count(*) into v_open from public.review_reports where reporter_id = p_reporter and created_at > now() - interval '1 day';
  if v_open >= 10 then raise exception 'KH:LIMIT:too many reports today'; end if;
  insert into public.review_reports (review_id, reporter_id, reason, note) values (p_review, p_reporter, p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  on conflict (review_id, reporter_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.review_report_handle(p_report uuid, p_actor text, p_outcome text) returns jsonb language plpgsql as $$
declare rp public.review_reports;
begin
  if p_outcome not in ('DISMISSED', 'ACTIONED') then raise exception 'KH:INVALID:outcome'; end if;
  select * into rp from public.review_reports where id = p_report for update;
  if not found then raise exception 'KH:NOT_FOUND:report not found'; end if;
  update public.review_reports set status = p_outcome, handled_by = p_actor, handled_at = now() where id = rp.id;
  insert into public.review_moderation_events (review_id, actor, action) values (rp.review_id, p_actor, case when p_outcome = 'DISMISSED' then 'report_dismiss' else 'report_action' end);
  return jsonb_build_object('id', rp.id, 'status', p_outcome);
end $$;

-- Admin analytics: deterministic counts only. No theme or sentiment is computed here.
create or replace function public.review_analytics(p_days integer) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'byProduct', coalesce((select jsonb_agg(x order by x->>'name') from (select jsonb_build_object('productId', p.id, 'name', coalesce(p.public_name, p.internal_name),
        'count', count(*), 'average', round(avg(r.rating)::numeric, 2),
        'distribution', jsonb_build_object('5', count(*) filter (where r.rating = 5), '4', count(*) filter (where r.rating = 4), '3', count(*) filter (where r.rating = 3),
          '2', count(*) filter (where r.rating = 2), '1', count(*) filter (where r.rating = 1))) x
      from public.product_reviews r join public.products p on p.id = r.product_id where r.status = 'PUBLISHED' group by p.id) s), '[]'::jsonb),
    'byStatus', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.product_reviews group by status) s), '{}'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n) order by d) from (select (created_at at time zone 'Asia/Kolkata')::date d, count(*) n
        from public.product_reviews where created_at > now() - make_interval(days => least(greatest(p_days, 1), 365)) group by 1) s), '[]'::jsonb),
    'openReports', (select count(*) from public.review_reports where status = 'OPEN'),
    'moderation', coalesce((select jsonb_object_agg(action, n) from (select action, count(*) n from public.review_moderation_events
        where created_at > now() - make_interval(days => least(greatest(p_days, 1), 365)) group by action) s), '{}'::jsonb))
$$;

revoke all on function public.review_eligible_items(uuid, uuid), public.review_submit(uuid, uuid, integer, text, text, text[], boolean),
  public.review_update_own(uuid, uuid, integer, text, text, text[]), public.review_withdraw_own(uuid, uuid), public.review_stats(uuid),
  public.review_public_list(uuid, integer, text, integer, integer), public.review_moderate(uuid, text, text, text), public.review_reply_set(uuid, text, text),
  public.review_image_decide(uuid, text, boolean), public.review_report_add(uuid, uuid, text, text), public.review_report_handle(uuid, text, text),
  public.review_analytics(integer), public.review_events_immutable() from public, anon, authenticated;

-- Private bucket for review photos. Photos are served only through /api/reviews?action=image, and only when approved on a published review.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
