import { buildSales, buildStockHealth, soldByVariant, type AnalyticsDays, type ItemRow, type OrderRow, type PincodeRow, type SalesReport, type StockBatch, type StockHealth, type StockVariant } from '../shared/analytics.js';
import { todayIST } from '../shared/inventory.js';
import { can, type AdminRole } from '../shared/roles.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Sales and stock-health figures. The owner's Analytics screens (server/admin/extras.ts) and Kaayra Intelligence both call this, so the
 * AI can never disagree with the screens. Moved out of the admin handler unchanged. Each block needs its own permission and fails alone.
 */
export interface AnalyticsResult { sales?: SalesReport; stock?: StockHealth; failed: { area: string; error: unknown }[] }
const ORDER_CAP = 10000;

export async function loadAnalytics(db: SupabaseConfig, role: AdminRole, days: AnalyticsDays, nowMs: number): Promise<AnalyticsResult> {
  const out: AnalyticsResult = { failed: [] };
  let orders: OrderRow[] = [];
  let items: ItemRow[] = [];
  if (can(role, 'orders.read')) {
    try {
      const since = encodeURIComponent(new Date(nowMs - (days * 2 + 1) * 86_400_000).toISOString());
      const [or, pr] = await Promise.all([
        rest(db, `orders?select=id,status,channel,total_paise,ship_pincode,created_at&created_at=gte.${since}&order=created_at.desc&limit=${ORDER_CAP}`),
        rest(db, 'shipping_pincodes?select=pincode,state&limit=20000'),
      ]);
      if (!or.ok) throw new Error(`analytics orders ${or.status}`);
      orders = (await or.json()) as OrderRow[];
      // A missing state column (delivery_areas.sql not run) only costs the by-state list, never the report.
      const pins = pr.ok ? ((await pr.json()) as PincodeRow[]) : [];
      const ids = orders.filter((o) => o.status !== 'cancelled').map((o) => o.id);
      for (let i = 0; i < ids.length; i += 200) {
        const ir = await rest(db, `order_items?select=order_id,variant_id,product_name,qty,line_total_paise&order_id=in.(${ids.slice(i, i + 200).join(',')})&limit=5000`);
        if (!ir.ok) throw new Error(`analytics items ${ir.status}`);
        items = items.concat((await ir.json()) as ItemRow[]);
      }
      out.sales = buildSales(orders, items, pins, days, nowMs, orders.length >= ORDER_CAP);
    } catch (e) {
      console.error('analytics sales failed', e instanceof Error ? e.message : e);
      out.failed.push({ area: 'Sales', error: e });
    }
  }
  if (can(role, 'inventory.read')) {
    try {
      const [vr, br] = await Promise.all([
        rest(db, 'product_variants?select=id,pack_size,price_paise,low_stock_threshold,products(internal_name,public_name)&status=eq.active&limit=500'),
        rest(db, 'inventory_batches?select=variant_id,status,expiry_date,qty_on_hand,qty_reserved&qty_on_hand=gt.0&limit=5000'),
      ]);
      if (!vr.ok || !br.ok) throw new Error(`analytics stock ${vr.status}/${br.status}`);
      const vs = ((await vr.json()) as { id: string; pack_size: string; price_paise: number | null; low_stock_threshold: number; products: { internal_name?: string; public_name?: string | null } | null }[])
        .map((v): StockVariant => ({ id: v.id, product: v.products?.internal_name ?? v.products?.public_name ?? 'Product', pack_size: v.pack_size, price_paise: v.price_paise, threshold: v.low_stock_threshold }));
      out.stock = buildStockHealth(vs, (await br.json()) as StockBatch[], soldByVariant(orders, items, days, nowMs), days, todayIST(nowMs));
    } catch (e) {
      console.error('analytics stock failed', e instanceof Error ? e.message : e);
      out.failed.push({ area: 'Stock', error: e });
    }
  }
  return out;
}
