-- Run once in the Supabase SQL editor, after launch_subscribers.sql. Then run products_seed.sql.
-- Server-only: RLS on, no public policies. The public website reads ONLY the public_products view (through the API).

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  internal_name text not null,
  form text not null,
  pack_size text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','IN_DEVELOPMENT','UNDER_REVIEW','APPROVED_FOR_PREVIEW','APPROVED_FOR_SALE')),
  ingredients jsonb not null default '[]'::jsonb,
  sub_compositions jsonb not null default '{}'::jsonb,
  preservatives jsonb,                      -- null = not supplied, verification required
  preservative_label text not null default 'Preservatives',
  notes text not null default '',
  public_name text check (public_name is null or char_length(public_name) <= 80),
  public_description text check (public_description is null or char_length(public_description) <= 1200),
  public_image text check (public_image is null or public_image ~ '^/images/products/[a-z0-9][a-z0-9-]{0,80}\.(webp|jpg|jpeg|png|avif)$'),
  public_image_alt text check (public_image_alt is null or char_length(public_image_alt) <= 200),
  ingredients_public boolean not null default false,
  composition_verified boolean not null default false,
  preservatives_verified boolean not null default false,
  claims_reviewed boolean not null default false,
  reviewed_by text,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Defence in depth: even if API code were wrong, a public status alone exposes nothing without the review flags.
alter table public.products drop constraint if exists products_public_requires_review;
alter table public.products add constraint products_public_requires_review check (
  status not in ('APPROVED_FOR_PREVIEW','APPROVED_FOR_SALE')
  or (claims_reviewed and public_name is not null and public_description is not null and reviewed_by is not null)
);

create or replace function public.touch_products() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_products();

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;

-- The ONLY thing the public API reads. Approved statuses only, and the formulation appears only once it is verified
-- for public release and an admin has switched ingredients_public on.
create or replace view public.public_products as
select
  slug,
  public_name as name,
  form,
  pack_size,
  status,
  public_description as description,
  public_image,
  public_image_alt,
  sort_order,
  preservative_label,
  case when ingredients_public and composition_verified and preservatives_verified then ingredients end as ingredients,
  case when ingredients_public and composition_verified and preservatives_verified then sub_compositions end as sub_compositions,
  case when ingredients_public and composition_verified and preservatives_verified then preservatives end as preservatives
from public.products
where status in ('APPROVED_FOR_PREVIEW','APPROVED_FOR_SALE')
  and claims_reviewed and public_name is not null and public_description is not null;
revoke all on public.public_products from anon, authenticated;
