# Phase 7 Step 3.1 changes

- Documentation: `docs/COMMERCE_STATE.md` (canonical); HANDOFF.md, SESSION_RULES.md, PHASE7_STEP3_HANDOFF.md, ECOMMERCE_ARCHITECTURE.md corrected; "Historical document" banner on 13 older docs; drift test in shared/commerce.test.ts.
- `api/orders/[action].ts`: shared (database-backed, bucket `orders_read`, fails open) rate limit via `isLimited`; `list` paginated (page size 10, `page`, `total`).
- `src/pages/TrackOrder.tsx`: pagination controls, "Try again" on errors, safe login return (`/login?return=`), support link to /contact.
- `shared/returnPath.ts` (+ test): allow-listed same-site return paths only. `src/pages/Login.tsx` honours it when a session already exists.
- `src/track.css`: pager and support styles.
- Unchanged: `COMMERCE_ENABLED = true`; live-sales gate; key-mode guard.
- All of the above UNRUN beyond the logic checks in the audit.

## Admin shipment screens (this session)
- `src/pages/AdminShipments.tsx` (new): dashboard (status filter, pagination, open delivery problems), shipment detail (contents, history timeline with internal-only notes marked, open exceptions), create shipment (packed orders only, per-line quantity capped to what is left to ship), status updates limited to the legal next states, notes, resolve exception.
- Confirmation dialogs (`ConfirmDialog` in `src/lib/adminKit.tsx`, native modal `<dialog>`) before: creating a shipment, every status change, resolving an exception. Dispatch warns that stock may leave the shelf.
- Permissions: tab needs `shipments.read` (owner, manager, support); create, update, note and resolve controls render only with `shipments.write`. The server still enforces both; the UI hiding is not the control.
- `shared/shipments.ts`: row types, `EXCEPTION_LABELS`, `remainingToShip` (mirrors `shipment_create` in `supabase/shipments.sql`; cancelled shipments free their units). Test added.
- `src/pages/Admin.tsx`: Shipments tab under Shop. `src/admin.css`: dialog and timeline styles.
- No events are invented: every field is typed in by staff; nothing is pre-filled.

## Bug fixes found by running CI commands
- `api/checkout/[action].ts` line 160: quote response called `isTestOrder()` with no flags (type error, and the quote would not report test/live correctly). Now `isTestOrder(flags)`.
- `server/admin/admin-api.test.ts`: stale test expected 409 on order creation "while selling is off". Replaced with (a) the commerce-off path tested directly with `commerceEnabled: false` (still asserts 409 and no RPC call) and (b) creation succeeding with `COMMERCE_ENABLED = true`. No assertion was weakened.
- Lint: `shared/returnPath.ts` (intentional control-character check, annotated), unused `fetchCount` in `server/api-tests/checkout.test.ts` removed, `docs/evidence/` excluded from lint (labelled stand-in, not product code).
