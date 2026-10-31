import { validateBundleInput, type BundleKind, type PricingMode } from '../../shared/bundles.js';
import { isUuid } from '../../shared/cart.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { bodyOf, need, type AdminCtx } from './ctx.js';

const KINDS: BundleKind[] = ['bundle', 'wellness_kit', 'gift_set', 'promo'];
const MODES: PricingMode[] = ['fixed_price', 'percent_off', 'amount_off'];
const STATUSES = new Set(['draft', 'active', 'inactive']);
const MSG: Record<string, string> = {
  slug: 'The web name (slug) must be 3 to 60 characters: lowercase letters, numbers and hyphens.',
  name: 'The name must be 2 to 120 characters.',
  components_min_two: 'A bundle needs at least two different pack sizes.',
  components_duplicate: 'Each pack size can appear only once. Raise its quantity instead.',
  component_qty: 'Each quantity must be a whole number from 1 to 10.',
  pricing_exactly_one_value: 'Enter one price value for the chosen pricing type.',
  gift_message_needs_gift_set: 'Gift messages can only be switched on for a gift set.',
};

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'Run supabase/stage7_commerce.sql (order in docs/DATABASE_MIGRATIONS.md).' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined);

/**
 * Bundles admin (Phase 12 Stage 7E). Owner only: reading needs bundles.read and every change needs bundles.write (shared/roles.ts gives
 * both to the owner and to nobody else). The price is validated here and again by the database, which refuses a bundle that is not
 * cheaper than its parts, has an unsellable component, or has no price. The member of staff is recorded by the database in admin_audit.
 * Nothing is deleted: a bundle is switched off, because orders keep their own snapshot. Returns true when it handled the action.
 */
export async function handleBundles(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'bundles' && method === 'GET') {
    if (!(await need(ctx, 'bundles.read'))) return true;
    const r = await rpc<unknown[]>(db, 'bundle_admin_list', { p_limit: 100, p_offset: 0 });
    if (!r.ok) return failWith(ctx, r.failure), true;
    json(200, { status: 'ok', items: r.data });
    return true;
  }

  if (action === 'bundle-stats' && method === 'GET') {
    if (!(await need(ctx, 'bundles.read'))) return true;
    const [a, c] = await Promise.all([rpc<unknown>(db, 'bundle_analytics', { p_limit: 20 }), rpc<unknown>(db, 'bundle_inventory_constraints', { p_limit: 20 })]);
    if (!a.ok) return failWith(ctx, a.failure), true;
    json(200, { status: 'ok', analytics: a.data, constraints: c.ok ? c.data : [] });
    return true;
  }

  if (action === 'bundle-options' && method === 'GET') {
    if (!(await need(ctx, 'bundles.read'))) return true;
    const r = await rest(db, 'product_variants?select=id,pack_size,price_paise,status,products(status,public_name,internal_name)&status=eq.active&price_paise=not.is.null&limit=500');
    if (!r.ok) throw new Error(`bundle options ${r.status}`);
    const rows = (await r.json()) as { id: string; pack_size: string; price_paise: number; products: { status: string; public_name: string | null; internal_name: string } | { status: string; public_name: string | null; internal_name: string }[] | null }[];
    const variants = rows.flatMap((v) => {
      const p = Array.isArray(v.products) ? v.products[0] : v.products;
      return p && p.status === 'APPROVED_FOR_SALE' ? [{ id: v.id, label: `${p.public_name?.trim() || p.internal_name} (${v.pack_size})`, pricePaise: v.price_paise }] : [];
    });
    json(200, { status: 'ok', variants: variants.sort((x, y) => x.label.localeCompare(y.label)) });
    return true;
  }

  if (action === 'bundle-save' && method === 'POST') {
    if (!(await need(ctx, 'bundles.write'))) return true;
    const b = bodyOf(req);
    const id = typeof b.id === 'string' && b.id ? b.id : null;
    if (id !== null && !isUuid(id)) return json(400, { status: 'invalid', message: 'That bundle id is not valid.' }), true;
    const kind = KINDS.find((k) => k === b.kind) ?? 'bundle';
    const mode = MODES.find((m) => m === b.pricingMode);
    const comps = Array.isArray(b.components) ? (b.components as Record<string, unknown>[]) : [];
    const components = comps.map((c) => ({ variantId: String(c.variantId ?? ''), qty: int(c.qty) ?? 0 }));
    const description = typeof b.description === 'string' ? b.description.trim() : '';
    const giftNote = typeof b.giftNote === 'string' ? b.giftNote.trim() : '';
    const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const fixed = int(b.fixedPricePaise), bps = int(b.percentBps), off = int(b.amountOffPaise);
    const errors: string[] = [];
    if (!mode) errors.push('Choose how the bundle is priced.');
    if (description.length > 1000) errors.push('The description is too long (1000 characters at most).');
    if (giftNote.length > 300) errors.push('The gift note is too long (300 characters at most).');
    if (components.some((c) => !isUuid(c.variantId))) errors.push('A component is not a valid product pack.');
    if (mode) {
      const pricing = mode === 'fixed_price' ? { mode, ...(fixed !== undefined ? { fixedPricePaise: fixed } : {}) } : mode === 'percent_off' ? { mode, ...(bps !== undefined ? { percentBps: bps } : {}) } : { mode, ...(off !== undefined ? { amountOffPaise: off } : {}) };
      errors.push(...validateBundleInput({ slug, name, kind, pricing, components, giftMessageAllowed: b.giftMessageAllowed === true }).map((e) => MSG[e] ?? e));
    }
    if (errors.length) return json(400, { status: 'invalid', message: errors[0], errors }), true;
    const payload = {
      ...(id ? { id } : {}), slug, name, kind, description, gift_note: giftNote, pricing_mode: mode,
      fixed_price_paise: mode === 'fixed_price' ? fixed : null, percent_bps: mode === 'percent_off' ? bps : null, amount_off_paise: mode === 'amount_off' ? off : null,
      gift_message_allowed: kind === 'gift_set' && b.giftMessageAllowed === true, components: components.map((c) => ({ variant_id: c.variantId.toLowerCase(), qty: c.qty })),
    };
    const r = await rpc<string>(db, 'bundle_upsert', { p_bundle: payload, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    json(200, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'bundle-status' && method === 'POST') {
    if (!(await need(ctx, 'bundles.write'))) return true;
    const b = bodyOf(req);
    if (typeof b.id !== 'string' || !isUuid(b.id) || typeof b.status !== 'string' || !STATUSES.has(b.status)) return json(400, { status: 'invalid', message: 'That change is not valid.' }), true;
    const r = await rpc(db, 'bundle_set_status', { p_bundle: b.id, p_status: b.status, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    json(200, { status: 'ok' });
    return true;
  }

  return false;
}
