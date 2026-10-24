-- HSN 3004 for every product. Run in the Supabase SQL editor after variants_gallery.sql. Safe to run again.
-- HSN lives on each pack size (product_variants.hsn_code) because that is what an order copies onto its invoice lines.
-- 1) Set 3004 on every existing pack size. 2) Give any pack size added later 3004 when no HSN is typed in.
-- It does NOT set a GST rate: that needs your own decision (set it in Admin > Products > Pack sizes, owner only).
update public.product_variants set hsn_code = '3004' where hsn_code is distinct from '3004';

create or replace function public.variants_default_hsn() returns trigger language plpgsql as $$
begin
  if new.hsn_code is null then new.hsn_code := '3004'; end if;
  return new;
end $$;
drop trigger if exists product_variants_default_hsn on public.product_variants;
create trigger product_variants_default_hsn before insert on public.product_variants for each row execute function public.variants_default_hsn();
