# Admin V8: Reports, Sales, Stock health

Added from the "Vessa" reference video, on top of the V7 admin. Admin page only; public site, SQL, permissions model unchanged.

## What was added
- New side-rail group **Analytics** with three top-bar tabs: **Reports**, **Sales**, **Stock health**.
- Reports: five KPI cards (Revenue, Orders, Units sold, Average order, Cancelled) with change against the previous period and a sparkline; revenue (or orders) line chart with a dashed previous-period line, "Compare" and "Show online store" switches, hover/focus tooltip; revenue by channel; sales by state; Export CSV (daily rows). Period: 30 days, 90 days, This year.
- Sales: the same plus a Best sellers list.
- Stock health: pack sizes, units on hand, stock value at selling price, out/low count, expired units; shelf-health bar; units by expiry bucket; table per pack size with status, value, units sold in the period, rough days of cover, next expiry.
- API: one new GET action `analytics?days=30|90|365` in `server/admin/extras.ts` (no new file in `api/`, still 12 functions). Sales blocks need `orders.read`; stock needs `inventory.read`; each loads on its own and reports itself in `unavailable` if it fails.
- Maths in `shared/analytics.ts` (pure, 15 tests in `shared/analytics.test.ts`).

## Definitions (also printed on the screens)
- Revenue = order total (goods + shipping) of every order that is not cancelled, by placed date in India time. Refunds, GST and discounts are not netted.
- Sales by state uses `shipping_pincodes.state` (needs `delivery_areas.sql`); PIN codes without a state show as "Not labelled".
- Stock value = units on hand x pack selling price (not cost); unpriced units are counted separately.
- Cover = sellable units / units sold in the period, scaled to the period. A guide, not a forecast.
- Only the newest 10,000 orders in the window are read; the screen says so if that cap is hit.

## Deliberately not added
- Video "Sales goal" gauge, "Stock in / Stock out / Stock value" history chart, "Batches" and "Make a batch" screens: no sales-goal data exists; stock-movement history is not aggregated here. Batches already live in Stock.
- Video "Catalog" product gallery with grid/list toggle: Products tab is unchanged.
- Video "Activity" and "Alerts" overview tabs: covered by Settings > Activity log and the bell.
- Channels: the database only has `online` and `manual` (shown as "Entered by team"), not wholesale or studio shop.

## Checked
npm ci, typecheck, eslint (changed files), 963 vitest tests, production build: all passed. Chromium render with a stubbed API at 1280px light and dark and 390px: no horizontal overflow. NOT checked: the real database, real data volumes, SQL, sign-in and MFA, Razorpay, Resend.
