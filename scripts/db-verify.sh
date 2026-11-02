#!/usr/bin/env bash
# Applies every migration in docs/DATABASE_MIGRATIONS.md order TWICE to a DISPOSABLE plain PostgreSQL, then runs each *_selftest.sql.
# NEVER point this at Supabase or any real database. It creates stand-ins for anon/authenticated/service_role and storage.buckets.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=kh_verify bash scripts/db-verify.sh   (database must be empty and disposable)
set -u
cd "$(dirname "$0")/../supabase"
PSQL="psql -X -q -v ON_ERROR_STOP=1"
case "${PGDATABASE:-}" in kh_verify*|*disposable*|*scratch*) ;; *) echo "Refusing: PGDATABASE must start with kh_verify (got '${PGDATABASE:-}')"; exit 2;; esac
ORDER="launch_subscribers email_outbox launch_optin auth_members issues roles_mfa_audit products products_seed products_catalog variants_gallery hsn_3004 inventory_orders refunds payments carts checkout payments_checkout shipments email_outbox_v2 rate_limits delivery_areas admin_passkeys reviews coupons cart_recovery loyalty bundles_wishlists launch_optin_member finance stage7_commerce"
TESTS="phase3_selftest refunds_selftest payments_selftest checkout_selftest payments_checkout_selftest shipments_selftest email_outbox_selftest rate_limits_selftest delivery_areas_selftest reviews_selftest coupons_selftest cart_recovery_selftest loyalty_selftest bundles_wishlists_selftest finance_selftest stage7_selftest"
$PSQL -c "do \$\$ begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end \$\$;
 create schema if not exists storage; create table if not exists storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
 create schema if not exists auth; create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text);" || exit 1
fail=0
for pass in 1 2; do
  for f in $ORDER; do
    if ! $PSQL -f "$f.sql" >/dev/null 2>/tmp/err.$$; then echo "APPLY FAIL pass=$pass $f: $(grep -m1 -i 'error' /tmp/err.$$)"; fail=1; fi
  done
  echo "apply pass $pass finished"
done
for t in $TESTS; do
  if $PSQL -f "$t.sql" >/tmp/t.$$ 2>&1; then echo "SELFTEST OK   $t: $(grep -ci 'pass' /tmp/t.$$) pass lines; $(grep -i 'all passed' /tmp/t.$$ | tail -1)"; else echo "SELFTEST FAIL $t: $(grep -m1 -i 'error' /tmp/t.$$)"; fail=1; fi
done
exit $fail
