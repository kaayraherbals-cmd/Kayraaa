/**
 * Turns a failed database call into one plain-language hint for the signed-in admin (never for the public).
 * Handlers throw `new Error('<label> <http status>')`; PostgREST answers 404 for a missing table or function and 400 for a
 * missing column or relationship, which is what happens when a file in supabase/ has not been run (or is out of date).
 */
const SQL_FILES: [RegExp, string][] = [
  [/delivery areas?|shipping_pincodes/i, 'delivery_areas.sql'],
  [/order_refunds|refunds/i, 'refunds.sql'],
  [/order_payments|payment_events|payments?/i, 'payments.sql'],
  [/members?/i, 'auth_members.sql'],
  [/issues?/i, 'issues.sql'],
  [/product_variants|product_images|variants|gallery/i, 'variants_gallery.sql'],
  [/inventory|batch|movements?|orders?|order_items|order_events/i, 'inventory_orders.sql'],
  [/products?/i, 'products.sql'],
  [/launch_subscribers|subscribers?|contact_messages|messages?|admin_audit|audit/i, 'launch_subscribers.sql'],
  [/admin_mfa|mfa/i, 'roles_mfa_audit.sql'],
];

export function dbHint(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /fetch failed|ECONN|ENOTFOUND|timeout/i.test(text)) {
    return 'The server could not reach Supabase. Check SUPABASE_URL in the Vercel settings and that the Supabase project is not paused.';
  }
  const status = /\b(\d{3})\b/.exec(text)?.[1];
  const file = SQL_FILES.find(([re]) => re.test(text))?.[1];
  const fileTip = file ? ` Run supabase/${file} in the Supabase SQL editor (order is in docs/DATABASE_MIGRATIONS.md).` : ' See docs/DATABASE_MIGRATIONS.md for the SQL files and their order.';
  if (status === '404') return `A database table or function is missing.${fileTip}`;
  if (status === '400') return `A database column is missing or out of date.${fileTip}`;
  if (status === '401' || status === '403') return 'Supabase refused the key. Check that SUPABASE_SERVICE_ROLE_KEY is the service-role key (not the anon key) for this project.';
  return `The database returned an error${status ? ` (HTTP ${status})` : ''}. Search the Vercel logs for the reference shown.${file ? fileTip : ''}`;
}
