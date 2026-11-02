-- Run once in the Supabase SQL editor AFTER auth_members.sql, variants_gallery.sql and inventory_orders.sql. Safe to run again.
-- Adds server-backed carts for signed-in customers. A cart stores ONLY variant ids and quantities. Prices, tax, names and
-- stock are always read live from product_variants / inventory_batches, so a cart can never hold a stale or forged price.
-- Server-only tables: RLS on, no policies, no grants to anon or authenticated. Only the service role (our API) can read them,
-- so one customer can never see another's cart even with a leaked public key.

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  qty integer not null check (qty between 1 and 10),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);
create index if not exists cart_items_variant_idx on public.cart_items (variant_id);
create index if not exists carts_updated_idx on public.carts (updated_at);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
revoke all on public.carts from anon, authenticated;
revoke all on public.cart_items from anon, authenticated;

-- Set one line. p_qty = 0 removes it. Atomic: the cart row is locked, so two tabs cannot push the cart past 20 lines.
create or replace function public.cart_set_item(p_member uuid, p_variant uuid, p_qty integer)
returns void language plpgsql as $$
declare v_cart uuid;
begin
  if p_qty is null or p_qty < 0 or p_qty > 10 then raise exception 'KH:INVALID'; end if;
  insert into public.carts (member_id) values (p_member) on conflict (member_id) do nothing;
  select id into v_cart from public.carts where member_id = p_member for update;
  if p_qty = 0 then
    delete from public.cart_items where cart_id = v_cart and variant_id = p_variant;
  else
    if not exists (select 1 from public.product_variants where id = p_variant) then raise exception 'KH:NOT_FOUND'; end if;
    if not exists (select 1 from public.cart_items where cart_id = v_cart and variant_id = p_variant)
       and (select count(*) from public.cart_items where cart_id = v_cart) >= 20 then
      raise exception 'KH:CART_FULL';
    end if;
    insert into public.cart_items (cart_id, variant_id, qty) values (v_cart, p_variant, p_qty)
    on conflict (cart_id, variant_id) do update set qty = excluded.qty, updated_at = now();
  end if;
  update public.carts set updated_at = now() where id = v_cart;
end $$;

-- Merge a guest cart (JSON array of {variant_id, qty}) into the signed-in cart: quantities add, capped at 10 per line;
-- unknown variants are skipped; at most 20 lines. Used once, right after sign-in.
create or replace function public.cart_merge(p_member uuid, p_lines jsonb)
returns void language plpgsql as $$
declare v_cart uuid; v_line jsonb; v_var uuid; v_qty integer;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'KH:INVALID'; end if;
  insert into public.carts (member_id) values (p_member) on conflict (member_id) do nothing;
  select id into v_cart from public.carts where member_id = p_member for update;
  for v_line in select e.value from jsonb_array_elements(p_lines) as e order by e.value ->> 'variant_id' loop
    v_var := (v_line ->> 'variant_id')::uuid;
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty < 1 then continue; end if;
    if not exists (select 1 from public.product_variants where id = v_var) then continue; end if;
    if not exists (select 1 from public.cart_items where cart_id = v_cart and variant_id = v_var)
       and (select count(*) from public.cart_items where cart_id = v_cart) >= 20 then
      continue;
    end if;
    insert into public.cart_items (cart_id, variant_id, qty) values (v_cart, v_var, least(v_qty, 10))
    on conflict (cart_id, variant_id) do update set qty = least(10, public.cart_items.qty + excluded.qty), updated_at = now();
  end loop;
  update public.carts set updated_at = now() where id = v_cart;
end $$;

create or replace function public.cart_clear(p_member uuid)
returns void language sql as $$
  delete from public.cart_items where cart_id in (select id from public.carts where member_id = p_member);
$$;

revoke all on function public.cart_set_item(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.cart_merge(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cart_clear(uuid) from public, anon, authenticated;
