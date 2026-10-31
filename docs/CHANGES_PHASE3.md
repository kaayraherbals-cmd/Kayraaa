> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 3: back office (orders and inventory, roles/MFA/audit, variants and photos)

Everything here is admin-only. Nothing becomes public except photo files and pack-size **names** of products that were already publicly approved. **Selling is still off** (`COMMERCE_ENABLED = false`).

## Upgrade steps (in this order)

1. In Supabase SQL editor run, once each, after the earlier SQL files: `supabase/roles_mfa_audit.sql`, `supabase/variants_gallery.sql`, `supabase/inventory_orders.sql`, then (for refunds) `supabase/refunds.sql`. All are safe to re-run.
2. Paste `supabase/phase3_selftest.sql` and run it. It must end with `ALL PASSED`. It runs inside a transaction that is rolled back, so it keeps nothing. **The stock and order functions were written but not executed while this version was prepared (no database was available), so do this before trusting them.**
3. In Vercel add `ADMIN_MFA_KEY` (`openssl rand -base64 32`). Add `ADMIN_ROLES` (required, see below). Redeploy.
4. Sign in at `/admin`. Each admin is asked to set up an authenticator app (QR code, then a first code) and given 10 one-time recovery codes. Until `ADMIN_MFA_KEY` and the SQL are in place the API fails closed with a setup notice; set `ADMIN_MFA=optional` to get in meanwhile.

## Roles (`ADMIN_ROLES=email:role,email:role`)

**Phase 4 change:** `ADMIN_ROLES` is now required. If it is unset or invalid the admin refuses everyone; no address is made an owner by default. If set, unlisted admins become **support**, there must be one owner, and any typo makes the admin API refuse to start (it names the variable, never its value). Roles are read from configuration on every request, so removing or changing one applies at once.

| | owner | manager | support |
|---|---|---|---|
| Launch list, messages, issues: read and update | yes | yes | yes |
| Delete launch-list entries, messages, issues | yes | no | no |
| Export launch list / orders (personal data) | yes | no | no |
| Products: create, edit text, photos, pack sizes | yes | yes | no |
| Publish (status, review sign-off), prices, GST/HSN, delete pack sizes | yes | no | no |
| Inventory: receive, adjust, write off, batch status | yes | yes | read only |
| Orders: create, change status, tracking | yes | yes | no |
| Orders: view, add notes | yes | yes | yes |
| Audit log, team page, reset someone's two-step | yes | no | no |
| Refunds: view | yes | yes | yes |
| Refunds: request | yes | yes | no |
| Refunds: approve, reject, mark refunded, refund through Razorpay | yes | no | no |
| Payments (Razorpay): view | yes | yes | yes |
| Payments (Razorpay): start a charge (locked while selling is off) | yes | yes | no |
| Members: view | yes | yes | yes |
| Members: export (personal data), delete an account | yes | no | no |
| Audit log: export CSV | yes | no | no |

## Two-step verification

TOTP (RFC 6238) with any authenticator app. Secrets are AES-256-GCM encrypted with `ADMIN_MFA_KEY`; recovery codes are stored only as keyed hashes; a used code cannot be replayed; guesses are rate-limited and every failure is audited. A session proves two-step only for the enrolment it verified, so an owner reset (Security tab) invalidates the old sessions. Lost phone: use a recovery code, or ask an owner to reset you. Lost everything as the only owner: delete your row in `admin_mfa` in Supabase and sign in again. Do not change `ADMIN_MFA_KEY` casually: it makes enrolled authenticators unreadable (reset everyone's row afterwards).

## Inventory

Stock lives on **pack-size variants**, in **batches** with batch number, optional manufacturing date and a required expiry. Available = active batches with at least 30 days of shelf life left, minus reserved. Expired stock is never offered; the screen shows low, out, expiring (90 days) and expired. Every change goes through a database function that locks the batch rows, so stock cannot go below zero or below what orders reserved, and each change is written to an append-only ledger (the History button).

## Orders

Status ladder placed, paid, packed, shipped, delivered, with cancel allowed until it ships. Creating an order reserves stock first-expiry-first-out across batches, all or nothing; cancelling releases it; shipping takes it off the shelf (and refuses a batch that expired or was recalled since reservation). Prices are copied from the pack size by the database, never from the browser. **Creating orders is locked** while `COMMERCE_ENABLED` is false (returns `KH-ADMIN-010`); viewing, notes, status changes and CSV export are live. Unlocking selling needs your written business approval first (docs/ECOMMERCE_ARCHITECTURE.md).

## Variants and photos

Products now own one or more pack sizes (migrated from the old single pack size and price) and up to 8 photos (the first is the main one). Pack size and price are edited only in the Pack sizes table; photos only in the photo gallery. The public product API adds `images` and `packSizes` (names only). No price, SKU, tax or stock is ever public.

## Not built yet

Customer checkout and tracking, settlement matching (the Razorpay server side now exists, see below), GST invoices and invoice numbering, courier integration, COD, coupons, database-managed roles.

## New error codes

KH-ADMIN-007 role, 008 two-step needed, 009 stock/order conflict, 010 selling not enabled, 011 wrong code, 012 two-step not set up on the server. See docs/ERROR_CODES.md.

## Back-office restyle (18 October 2026)

New `src/admin.css`, imported by `src/pages/Admin.tsx` (so it ships only in the code-split admin chunk) and scoped to `.admin-shell`. It carries the public theme into the admin at working density: compact headings (the public display sizes were leaking into the admin), Tenor Sans labels for tabs and table heads, hairline tables with sticky heads, status as a dot plus label, serif numerals in the stat strip, 2px corners, tabs that scroll sideways on phones, reduced-motion respected. No markup, behaviour or API changed. **Not yet viewed in a browser**: run `npm run dev`, open `/admin` and check each tab, including a narrow phone width.

## Overview, members and audit export (18 October 2026)

- **Overview tab** (first tab for everyone): needs-attention counts (new messages, open and high-severity problem reports, orders to handle), stock problems listed worst first (expired, out, low, expiring in 90 days), audience counts, products and orders by status. Each block shows only if the role may read that area; each count links to its tab. Action: `GET /api/admin/dashboard`.
- **Members tab**: everyone with a site account, most recent sign-in first, searchable. Owners can export CSV and delete an account (removes the `members` row and the Supabase sign-in identity; the audit entry records the id only, not the email). An administrator's account cannot be deleted here: remove the address from `ADMIN_EMAILS` first. Actions: `members` (GET, DELETE), `members-export`.
- **Audit log export** (owner): CSV of the current filters, up to 20,000 rows, secret-looking keys masked, and the export itself is logged (`export_audit`). Action: `audit-export`.
- New permissions: `members.read` (all roles), `members.export`, `members.delete`, `audit.export` (owner). No SQL changes and no new environment variables.
- Checked offline: 40 tests pass through a small stand-in for Vitest (roles, the two-step gate, and the new actions: role limits, CSV formula neutralising, admin-account protection, audit masking). Real Vitest, `npm run build` and the screens in a browser have not been run.

## Refunds and returns (18 October 2026)

A record of the decision trail, not a payment: nothing here moves money or talks to a gateway. Pay the customer through your bank or gateway, then record the reference.

- **Run first:** `supabase/refunds.sql`, then `supabase/refunds_selftest.sql` (must end with `ALL PASSED`; it rolls itself back). The two functions were written but **not executed** while this version was prepared, so run the self-test before trusting them.
- **Request** (owner or manager) from the order itself: type (refund only, or return and refund), a reason from a fixed list, what happened, and the amount in rupees. The database refuses a request on an order that was never marked paid, and refuses any request that would take the live refunds above the order total. A rejected request frees its amount.
- **Decide** (owner only, so a manager cannot approve their own request): requested, then approved or rejected; approved, then refunded or rejected. Rejecting needs a reason; marking refunded needs the bank or gateway reference (and, for returns, whether the goods came back). Finished refunds cannot be reopened.
- **Refunds tab** lists every refund (default: awaiting decision) and the Overview counts those awaiting decision and approved-not-yet-paid. Each step is written to the order timeline and the audit log.
- **Returned goods are not added back to stock.** Someone must check the seal, batch and expiry, then receive them in Inventory.
- "Health concern after use" is a reason option; the form reminds staff to log it under Issues and follow up directly, not to give medical advice.
- New permissions `refunds.read` (all roles), `refunds.write` (owner, manager), `refunds.approve` (owner). Orders still cannot be created while selling is off, so there is nothing to refund until then.
- Checked offline: 58 tests pass through the Vitest stand-in (validators, the ladder, role limits, plain-language database messages, API paths). Real Vitest, the SQL functions, `npm run build` and the screens in a browser have not been run.

## Razorpay payments and gateway refunds (18 October 2026)

Server-side only and still switched off; see `docs/RAZORPAY_SETUP.md` for the steps, rules and what is not built.

- **Run first:** `supabase/payments.sql`, then `supabase/payments_selftest.sql` (must end `ALL PASSED`; rolls itself back). **The SQL was written but not executed**, and nothing was tried against Razorpay's test mode.
- New environment variables: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (all server only).
- New webhook `POST /api/payments/webhook` (signature on the raw body, idempotent by event id), new admin actions `payments`, `payment-create` (locked while selling is off, `KH-ADMIN-010`) and `refund-gateway`, new error code `KH-ADMIN-013` (payments not set up).
- New permissions `payments.read` (all roles) and `payments.write` (owner, manager). Refunding through Razorpay needs `refunds.approve` (owner).
- Refunds tab: an approved refund gets **Refund through Razorpay**; the existing manual **Mark refunded** is unchanged.
- Checked offline: 41 new tests pass through a small stand-in for Vitest (signatures, event parsing, webhook replies, amounts from the database, idempotent refunds, role limits), and the existing roles, errors, commerce, refunds and admin-api suites still pass. Real Vitest, `npm run build`, the SQL and the Refunds screen in a browser have not been run.

## HSN 3004 for all products (18 October 2026)

Run `supabase/hsn_3004.sql` once (safe to re-run). It sets HSN `3004` on every existing pack size and gives any new pack size `3004` when none is entered. GST rate is **not** set by it: choose it per pack size in Admin > Products > Pack sizes (owner only). Not executed while this version was prepared.
