-- Run once in the Supabase SQL editor, AFTER products.sql and products_catalog.sql. Safe to run again.
-- Adds: pack-size variants (own SKU, MRP, tax fields, low-stock level), several photos per product, and two public views
-- that expose only photo paths and pack-size LABELS of publicly approved products. No price, SKU, tax or stock is ever public.

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  pack_size text not null check (char_length(pack_size) between 1 and 40),
  price_paise integer check (price_paise is null or (price_paise > 0 and price_paise <= 100000000)),
  gst_rate numeric(5,2) check (gst_rate is null or gst_rate in (0, 3, 5, 12, 18, 28)),
  hsn_code text check (hsn_code is null or hsn_code ~ '^\d{4}(\d{2}(\d{2})?)?$'),
  barcode text check (barcode is null or barcode ~ '^\d{8,14}$'),
  low_stock_threshold integer not null default 10 check (low_stock_threshold between 0 and 100000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, pack_size)
);
create index if not exists product_variants_product_idx on public.product_variants (product_id, sort_order);
drop trigger if exists product_variants_touch on public.product_variants;
create trigger product_variants_touch before update on public.product_variants for each row execute function public.touch_updated_at();

-- One variant per existing product, from its current pack size and MRP.
insert into public.product_variants (product_id, sku, pack_size, price_paise, sort_order)
select p.id,
       left(trim(both '-' from regexp_replace(upper(p.slug), '[^A-Z0-9]+', '-', 'g')) || '-' || regexp_replace(upper(p.pack_size), '[^A-Z0-9]+', '', 'g'), 40),
       p.pack_size, p.price_paise, 10
from public.products p
where not exists (select 1 from public.product_variants v where v.product_id = p.id)
on conflict do nothing;

-- Keep the product's own pack_size and price_paise (used by cards and older code) equal to its first active variant.
create or replace function public.sync_product_from_variants(p_product uuid) returns void language plpgsql as $$
declare v record;
begin
  select pack_size, price_paise into v from public.product_variants
   where product_id = p_product and status = 'active' order by sort_order, created_at limit 1;
  if found then
    update public.products set pack_size = v.pack_size, price_paise = v.price_paise
     where id = p_product and (pack_size is distinct from v.pack_size or price_paise is distinct from v.price_paise);
  end if;
end $$;
create or replace function public.variants_sync_trigger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_product_from_variants(old.product_id);
    return old;
  end if;
  perform public.sync_product_from_variants(new.product_id);
  return new;
end $$;
drop trigger if exists variants_sync on public.product_variants;
create trigger variants_sync after insert or update or delete on public.product_variants for each row execute function public.variants_sync_trigger();

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  path text not null check (path ~ '^(/images/products/[a-z0-9][a-z0-9-]{0,80}|/api/media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webp|jpg|jpeg|png|avif)$'),
  alt text not null check (char_length(alt) between 3 and 200),
  sort_order integer not null check (sort_order between 0 and 100),
  created_at timestamptz not null default now(),
  unique (product_id, path)
);
create index if not exists product_images_product_idx on public.product_images (product_id, sort_order);

-- Existing single photos become the first gallery photo.
insert into public.product_images (product_id, path, alt, sort_order)
select p.id, p.public_image, case when char_length(coalesce(p.public_image_alt, '')) >= 3 then p.public_image_alt else 'Product photo' end, 0
from public.products p
where p.public_image is not null
  and not exists (select 1 from public.product_images i where i.product_id = p.id)
on conflict do nothing;

-- Replaces a product's whole gallery in one transaction and mirrors the first photo onto the product (public_image).
create or replace function public.replace_product_images(p_product uuid, p_images jsonb) returns void language plpgsql as $$
declare first_img jsonb;
begin
  if not exists (select 1 from public.products where id = p_product) then raise exception 'KH:NOT_FOUND'; end if;
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 8 then raise exception 'KH:INVALID'; end if;
  delete from public.product_images where product_id = p_product;
  insert into public.product_images (product_id, path, alt, sort_order)
  select p_product, t.e ->> 'path', t.e ->> 'alt', (t.ord - 1)::int
  from jsonb_array_elements(p_images) with ordinality as t(e, ord);
  first_img := p_images -> 0;
  update public.products set public_image = first_img ->> 'path', public_image_alt = first_img ->> 'alt' where id = p_product;
end $$;

alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
revoke all on public.product_variants from anon, authenticated;
revoke all on public.product_images from anon, authenticated;
revoke all on function public.replace_product_images(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_product_from_variants(uuid) from public, anon, authenticated;

-- Public views: same publication rule as public_products (approved status, claims reviewed, public name and description).
create or replace view public.public_product_images as
select p.slug, i.path, i.alt, i.sort_order
from public.product_images i
join public.products p on p.id = i.product_id
where p.status in ('APPROVED_FOR_PREVIEW', 'APPROVED_FOR_SALE') and p.claims_reviewed and p.public_name is not null and p.public_description is not null;

create or replace view public.public_product_variants as
select p.slug, v.pack_size, v.sort_order
from public.product_variants v
join public.products p on p.id = v.product_id
where v.status = 'active' and p.status in ('APPROVED_FOR_PREVIEW', 'APPROVED_FOR_SALE') and p.claims_reviewed and p.public_name is not null and p.public_description is not null;

revoke all on public.public_product_images from anon, authenticated;
revoke all on public.public_product_variants from anon, authenticated;
