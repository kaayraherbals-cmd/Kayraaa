-- Run once in the Supabase SQL editor, after products.sql. Safe to re-run.
-- Adds: price and labelling fields (internal only), uploaded product photos, and the private image bucket.
-- Nothing here makes anything public: the public_products view is unchanged and exposes no price.

alter table public.products add column if not exists price_paise integer;
alter table public.products add column if not exists country_of_origin text not null default 'India';
alter table public.products add column if not exists manufacturer_details text;
alter table public.products add column if not exists shelf_life text;

alter table public.products drop constraint if exists products_price_paise_check;
alter table public.products add constraint products_price_paise_check check (price_paise is null or (price_paise > 0 and price_paise <= 100000000));
alter table public.products drop constraint if exists products_country_check;
alter table public.products add constraint products_country_check check (char_length(country_of_origin) between 2 and 60);
alter table public.products drop constraint if exists products_manufacturer_check;
alter table public.products add constraint products_manufacturer_check check (manufacturer_details is null or char_length(manufacturer_details) <= 400);
alter table public.products drop constraint if exists products_shelf_life_check;
alter table public.products add constraint products_shelf_life_check check (shelf_life is null or char_length(shelf_life) <= 60);

-- Allow images uploaded through the admin panel (served by /api/media) as well as files under /images/products.
alter table public.products drop constraint if exists products_public_image_check;
alter table public.products add constraint products_public_image_check check (
  public_image is null
  or public_image ~ '^(/images/products/[a-z0-9][a-z0-9-]{0,80}|/api/media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webp|jpg|jpeg|png|avif)$'
);

-- Private bucket: no public URL. Files are read only by the server with the service role key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
