# Delivery areas (admin hub card)

A **Delivery areas** card in the admin hub (Shop group). It edits `public.shipping_pincodes`, the table checkout already reads.

## What it does
- Add one PIN code: PIN, city, state, delivery charge (rupees, 0 allowed), free-delivery-above amount (empty = never free), on/off.
- Switch a PIN code on or off, or edit its charge, free-delivery amount, city and state. Nothing is deleted; off keeps the settings.
- Bulk paste (up to 2000): one per line, several per line, or `PIN, city, state`. Shared charge, free-delivery amount, city/state label (used when a line has none) and on/off apply to all. Choose whether a PIN already listed is updated or left alone. If any line is invalid nothing is saved and the lines are listed.
- Before a bulk save, the confirm box says how many PIN codes are new and how many are already listed (a read-only check; nothing is written).
- Export CSV of the whole list (every role that can read).
- Search by PIN prefix, city or state; filter All / On / Off with counts.
- City and state are a label for the shop team only. They never decide whether we can deliver.

## Permission
`delivery.read`: owner, manager, support (they can look). `delivery.write`: **owner only**, because the charge is part of what a customer pays (same reason managers cannot change prices). To let managers write, add `'delivery.write'` to the MANAGER list in `shared/roles.ts` and update `shared/roles.test.ts`.

## API (inside `api/admin/[action].ts`, so no new serverless function)
| Call | Permission |
|---|---|
| `GET delivery-areas?page&q&status=on|off` | delivery.read |
| `POST delivery-area` | delivery.write |
| `PATCH delivery-area?pincode=` (partial) | delivery.write |
| `POST delivery-areas-bulk` (`dryRun: true` only counts) | delivery.write |
| `GET delivery-areas-export` (CSV, audited) | delivery.read |

Money is in paise in the API. Every change is written to the activity log (`delivery_area_add`, `_update`, `_toggle`, `delivery_areas_bulk`).

## Before use
Run `supabase/delivery_areas.sql` (adds city, state and `delivery_areas_upsert`), then `supabase/delivery_areas_selftest.sql` on staging. Neither has been run on a database. Until the SQL is run, the card shows a hint to run it.

## Files
`shared/deliveryAreas.ts` (validation, bulk parser), `server/admin/delivery.ts`, `src/pages/AdminDelivery.tsx`, `shared/roles.ts`, `shared/audit.ts`, `server/admin/dbHint.ts`, tests: `shared/deliveryAreas.test.ts`, `server/admin/delivery.test.ts`, `shared/roles.test.ts`.
