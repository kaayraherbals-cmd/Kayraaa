# V6 admin premium restyle

Reference: a light "Vertix" dashboard video (pill top navigation, floating icon rail, greeting header, soft white rounded cards, one bold accent card, stat tiles, bar chart, activity table).

## What changed (front end only)
- `src/admin-premium.css` (new, loaded after `admin.css`, scoped to `.admin-shell`): canvas, rounded cards, pill buttons and badges, airy tables, dashboard layout.
- `src/lib/adminIcons.tsx` (new): inline icons (no icon library is installed).
- `src/pages/Admin.tsx`: header is three floating pills (brand, area nav, user). Area nav is rendered into the header through a portal. Floating icon rail (desktop) lists every section with a hover label; sub-tab pills show the sections of the current group. The old menu hub screen is gone; the app opens on Overview.
- `src/pages/AdminHome.tsx`: greeting, "Orders to handle" card, "Waiting for you" accent card with message, report and refund tiles, orders-by-status bar chart, stock table with status chips, audience facts, product status meters.

## Not changed
API, permissions, data shapes, tests. Old `.admin-hub*` and `.admin-crumbs` CSS in `admin.css` is now unused and can be deleted later.

## Not verified (no network)
`npm ci`, lint, typecheck, tests, build and a browser check were not run. Run them first.

## Follow-ups worth doing
Revenue and sales-over-time need a new field on the `dashboard` API (order totals by day); not added because it changes server code and tests.
