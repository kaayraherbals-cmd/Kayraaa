# Phase 8: Business Intelligence, profit tracking and financial intelligence

Owner-only. Works without any AI. Built on the Phase 12 audit ZIP (which also contains Phases 9 and 10 step 1 and the V8 admin analytics). The ZIP named in the brief (`...phase7-cart-recovery.zip`) was never supplied; no earlier Phase 8 existed in any ZIP received.

## What exists already and was NOT duplicated or changed
The V8 admin "Analytics" group (Reports, Sales, Stock health, `shared/analytics.ts`) stays as it was. It defines revenue loosely (every non-cancelled order total, unpaid included, no refunds) and values stock at selling price. Phase 8 is a separate, stricter group, **Business Intelligence**, so the two will show different revenue; that is intended. Coupon analytics, review analytics and cart recovery are untouched.

## Files
- `supabase/finance.sql` (run after the files listed in `DATABASE_MIGRATIONS.md`, #29) and `finance_selftest.sql`.
- `shared/finance.ts` (+ tests): all profit, margin, forecast, KPI, range and CSV maths, integer paise only.
- `server/financeService.ts`: the read-only service (see "Future owner AI").
- `server/admin/finance.ts` (+ tests): HTTP actions, registered in `backoffice.ts`. No new file under `api/` (still the same function count).
- `src/pages/AdminFinance.tsx`: six screens in a new side-rail group; uses existing admin classes, no new CSS.
- `shared/roles.ts`: `finance.read`, `finance.write`, `finance.export`, owner only.

## Data model (all additive; nothing existing is altered)
| Table | Purpose |
|---|---|
| `product_cost_history` | Per pack size: purchase, manufacturing, packaging, other (paise), `effective_from`, source, note, who. **Append-only** (trigger refuses update, delete, truncate). |
| `business_expenses` | Date, category, amount, description, vendor, reference. Edited in place (audited); wrong entries are **voided**, never deleted. Unique index on date+category+amount+vendor+reference among active rows blocks duplicates. |
| `payment_fee_records` | One per captured payment: fee, fee tax, refund fee reversal, settlement ref. Entered by the owner from the Razorpay settlement report; **nothing is inferred from published pricing**. |
| `shipment_cost_records` | Carrier charge per shipment, `confirmed` or `estimated`. Estimates are shown apart and never subtracted. |
| `financial_kpi_targets` | Targets the owner sets. None exist until set. |
All have row-level security on, no policies, no grants to `anon`/`authenticated`; every function is revoked from them. Only the server (service key) reaches them.

## Definitions (every figure on screen follows these)
- **Money** is integer paise end to end (database `bigint`, TypeScript safe integers; a non-safe value throws). Rupee text is built from integers, never floats.
- **Time**: India time. A period is `[from, to)` in India dates; the screen's "To" is the last day inclusive. Ranges over 800 days are refused.
- **Recognised order**: not a test order and has a `paid` status event; dated by the *first* paid event (a repeated event does not duplicate or move it). Unpaid, never-paid cancelled, failed-payment and test orders are excluded. A paid order later cancelled still counts; if it was cancelled with no refund on record, the screen warns.
- **Gross sales** = sum of line totals. **Discounts** = the per-line discounts already allocated by the coupon engine (deterministic, proportional). **Net merchandise (incl. GST)** = gross - discounts.
- **GST inside** = per line `round(net x rate / (100 + rate))`: shop prices are GST-inclusive. Shipping is treated as tax-inclusive with no GST split (as the checkout does).
- **Net sales (ex GST)** = net merchandise - GST. **Net collected** (cash view, includes GST) = net merchandise + shipping charged - refunds paid in the period.
- **Refunds** are counted when paid out (`refunded` status, by `refunded_at`), so a refund can belong to an earlier month's sale. Requested/approved refunds are shown as pending only. The deduction is the full refunded amount (GST on refunds is not recovered here). Product-level refund share: goods part pro rata to line net value, capped at the order's goods net; the rest is shipping.
- **COGS**: for each sold unit, the unit cost in force at the order's paid time (newest `effective_from` at or before it). A cost entered later never changes earlier sales; entering a back-dated cost does change sales paid on/after that date (the screen says so and it is audited). Returned goods are **not** added back to stock value, so COGS stays (conservative).
- **Gross profit** = net sales (ex GST) - refunds - COGS. Shown only if every unit sold has a cost.
- **Operating expenses** = payment fees (incl. fee tax, less reversals) + confirmed carrier costs + manual expenses. Manual `payment_processing` and `shipping` entries are **excluded when per-order fee/carrier records exist for the period** (same money) and listed as excluded.
- **Operating profit** = gross profit + shipping charged - operating expenses. **Net profit** = operating profit (no income tax or interest is modelled: label says "before income tax"), shown only when COGS, payment fees (every online order) and carrier costs (every shipped order) are all covered. Inventory purchases are not treated as COGS; tax collected is not income.
- **Status**: `complete`, `partial` ("Partial estimate: cost data incomplete"; profit lines show "Not available", never a guess) or `unavailable` ("Profit unavailable: cost data incomplete."). Gaps are listed in words.
- **Margins** are basis points (`bps`), rounded half away from zero.
- **Inventory valuation** (as of today; history is not stored): batches with stock x latest recorded unit cost. Units with no cost are counted and not valued. Selling value is shown separately and labelled not an accounting value. Expired = past expiry; expiring = within N days (default 90); blocked = quarantine/recalled; low stock = sellable at or under the pack's level; slow-moving = sellable stock with no paid sales in N days (default 90). Reserved stock is shown; stock logic is not touched.
- **Customers**: key = member id, else lower-cased e-mail, else the order. New = first-ever paid order falls in the period. Repeat rate = customers with 2+ paid orders / all who ever paid. **Lifetime value is observed spend to date**; predicted value is always `null`. Only counts and sums leave the database.
- **Forecast**: mean daily revenue (net incl. shipping) of the last 28 complete days x 30, band +/- one standard deviation of that total, floored at 0. Needs 56 days of history with sales on 20 days, else an explanation and no number. Labelled a prediction.
- **KPI targets**: only what the owner sets. Refund-rate progress counts lower as better. Inventory turnover = this month's COGS / current inventory cost value (only when profit is complete).

## Security
Owner only; `need()` checks the signed-session role server-side per action and records denied attempts. The service functions check `can(role, 'finance.read')` again, so a future caller cannot skip the route. Writes are audited with before/after: `finance_cost_add`, `finance_expense_add/update/void`, `finance_fee_record`, `finance_ship_cost_record`, `finance_kpi_set`, `finance_export`. Public product APIs were not changed and contain no cost or margin. CSV: text cells starting `= + - @` tab/CR get a leading apostrophe, numbers are written as numbers, exports are capped (5,000 rows, 800 days), carry no names/e-mails, and are built from the same service functions as the dashboard.

## Future owner AI
Do not call the database directly. Import from `server/financeService.ts` and pass `{ db, role }` for the signed-in owner:
`getRevenueSummary`, `getProfitSummary`, `getProductProfitability` (50 rows per page), `getExpenseBreakdown`, `getInventoryValuation`, `getRefundFinancialImpact`, `getCustomerPurchaseMetrics`, `getSalesForecast` (+ `getDailySeries`, `getKpiProgress`). All read-only, bounded, authorise inside, return no personal data. Pass through `profit.status`, `gaps` and `forecast.label` so the assistant repeats the caveats instead of inventing numbers. Writes must stay in `server/admin/finance.ts` behind the owner's own action.

## Limits and not done
- Payment fees, carrier costs and the first costs must be **entered**: there is no Razorpay settlement import and no carrier import (webhook and shipping code are untouched). Until they are, net profit shows "Not available". The API actions `finance-fee` and `finance-ship-cost` exist; there is **no screen yet** for them.
- Packaging/other per-unit costs are in the unit cost; there are no separate per-order packaging costs.
- Bundles (Phase 10) and loyalty (Phase 9) are not wired to checkout in this ZIP, so their discounts are not separately reported; bundle component costs are not modelled.
- No analytics snapshot table: everything is computed live from source rows (nothing can go stale). Large shops may need indexes/materialisation later; `order_events` is read per order.
- Seasonal forecasting is not implemented (stated on screen when history is under four months).
- No cache, no scheduled report.
