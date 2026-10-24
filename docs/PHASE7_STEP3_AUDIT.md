# Phase 7 Step 3 audit (partial)

**Status: only item 2 (commerce enablement gate) was done in this session. The sandbox had no network, so nothing below was executed except a small logic smoke test.**

## What was verified
- Node 22 smoke test (type-stripped copy of shared/liveSales, flags, checkout, payments): staging open in test mode; production before approval = bag only; production with approval = live key only; preview ignores approval variables. All 4 checks passed.

## What was NOT verified (not run, do not treat as passing)
npm ci, lint, typecheck, vitest, build, npm audit; any SQL migration or self-test; Razorpay test mode; email delivery; scheduler; responsive/accessibility testing; screenshots.

## Findings
- F1 (fixed): flags.ts let COMMERCE_ENABLED=true open checkout and live payments in production (old checkoutOpen/paymentsOpen used `master ||`). Replaced with a separate live-sales gate.
- F2 (fixed): admin manual order creation followed the master switch only; now follows the same gate.
- F3 (open): vercel.json crons are daily; Vercel plan limits for 1-minute / 5-minute crons are unconfirmed here. Check Vercel's current cron limits for your plan, or use an external scheduler calling the secret-protected endpoints.
- F4 (open): shipment dashboard, tracking page, UI redesign, responsive/a11y work not started.
