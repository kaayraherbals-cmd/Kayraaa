# Admin V7: Vessa layout

Scope: the admin page only (`/admin`). Public site, API, SQL and permissions are untouched.

## What changed
- Top bar: brand, the tabs of the current area, search (Ctrl/Cmd+K jumps to it and lists matching sections), settings (opens Security), bell (counts of what is waiting, each line opens its section), New (add product, stock, coupon, delivery area, shown by permission), account menu (role and Sign out).
- Side rail: light/dark toggle (remembered in this browser), then one icon per area. Shop and Inbox show count badges.
- Areas and their tabs: Overview; Shop (Products, Stock, Orders, Shipments, Delivery areas, Coupons, Cart recovery, Refunds); People (Members, Launch list); Inbox (Messages, Problem reports, Reviews); Settings (Activity log, Security). Nothing was removed; the row of tabs that used to sit under the title now sits in the top bar.
- Overview: welcome block, three summary cards (Orders to handle, Members or Launch list, Low stock items), Orders by status chart, Catalogue overview gauge (share of products approved for sale). Stock table, Audience and Products by status stay below.
- Dark theme for the whole admin (tokens in `src/admin-premium.css`).

## Deliberately not copied
The reference shows sales goals, revenue lines, sales by state, stock-in/out history and percentage trends. The admin has no such data (and none is invented), so those panels are not shown. Add them only when real data exists.

## Checked
typecheck, eslint (changed files), 948 tests, production build, Chromium screenshots of the overview, Shop tab, menus and mobile in light and dark with a stubbed API. Not checked: the real sign-in and MFA screens, and the inside of each tab in dark mode.
