import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { referenceDiscount } from './coupons.js';

/**
 * SQL and TypeScript must agree. Runs only when DATABASE_URL names a DISPOSABLE database that has supabase/coupons.sql applied
 * (the script runs inside a transaction that rolls back). Skipped otherwise, so `npm test` needs no database.
 */
const url = process.env.DATABASE_URL;
describe.skipIf(!url)('coupon_compute (SQL) agrees with referenceDiscount (TypeScript)', () => {
  it('gives identical discounts and per-line splits for 300 seeded bags', () => {
    let seed = 987654;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const cases = Array.from({ length: 300 }, (_, i) => {
      const lines = Array.from({ length: 1 + rnd(5) }, (_, k) => ({ ref: `l${k}`, amt: 100 + rnd(300000), eligible: rnd(3) !== 0 }));
      const ship = rnd(3) === 0 ? 0 : rnd(20000);
      const percent = rnd(2) === 0;
      return { i, lines, ship, percent, bps: 1 + rnd(10000), fixed: 100 + rnd(400000), cap: rnd(2) ? 100 + rnd(100000) : null };
    });
    const sql = [
      'begin;',
      `with p as (insert into public.products (slug, internal_name, form, pack_size, status, public_name, public_description, claims_reviewed, reviewed_by) values ('zz-par-a','ZZ PAR A','Tablet','60','APPROVED_FOR_SALE','A','t',true,'t'),('zz-par-b','ZZ PAR B','Syrup','60','APPROVED_FOR_SALE','B','t',true,'t') returning id, form)
       insert into public.product_variants (product_id, sku, pack_size, price_paise) select id, 'ZZ-PAR-' || upper(left(form,1)), '60', 1000 from p;`,
      ...cases.map((c) => {
        const code = `PAR${String(c.i).padStart(4, '0')}`;
        const val = c.percent ? `'percent', ${c.bps}, null, ${c.cap ?? 'null'}` : `'fixed', null, ${c.fixed}, null`;
        // eligible lines use the Tablet variant, ineligible the Syrup one; the coupon is limited to the Tablet form
        const lines = c.lines.map((l) => `jsonb_build_object('ref','${l.ref}','variant_id',(select id from public.product_variants where sku='ZZ-PAR-${l.eligible ? 'T' : 'S'}'),'line_total_paise',${l.amt})`).join(',');
        return `insert into public.coupons (code, discount_type, percent_bps, fixed_paise, max_discount_paise, product_forms, active, created_by) values ('${code}', ${val}, array['Tablet'], true, 't');
select ${c.i} || '|' || coalesce((select public.coupon_compute(c, null, jsonb_build_array(${lines}), ${c.ship}, null)::text from public.coupons c where c.code='${code}'), 'none');`;
      }),
      'rollback;',
    ].join('\n');
    const out = execFileSync('psql', [url as string, '-v', 'ON_ERROR_STOP=1', '-qtA'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const rows = new Map(out.split('\n').filter((l) => /^\d+\|/.test(l)).map((l) => [Number(l.split('|')[0]), JSON.parse(l.slice(l.indexOf('|') + 1))]));
    expect(rows.size).toBe(300);
    let compared = 0;
    for (const c of cases) {
      const sqlRes = rows.get(c.i);
      const ref = referenceDiscount(c.percent ? { type: 'percent', percentBps: c.bps, maxDiscountPaise: c.cap } : { type: 'fixed', fixedPaise: c.fixed }, c.lines, c.ship);
      if (!ref) { expect(sqlRes.ok, `case ${c.i}`).toBe(false); continue; }
      expect(sqlRes.ok, `case ${c.i}`).toBe(true);
      expect(sqlRes.discount_paise, `case ${c.i}`).toBe(ref.discount);
      expect(sqlRes.allocations, `case ${c.i}`).toEqual(ref.allocations);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
