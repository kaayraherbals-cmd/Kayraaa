# Phase 7 Step 3 deployment

## Staging / preview
Set Razorpay TEST keys. Do NOT set LIVE_SALES_*. Cart, checkout, test payments, order history and shipping work automatically; orders are marked test.

## Production before approval
Leave LIVE_SALES_* blank. Catalogue and bag are visible; checkout, pay and verify return 404; admin order creation is blocked. Webhook, refund and reconciliation still work.

## Approving live sales (owner, only after staging integration tests pass)
In Vercel Production set LIVE_SALES_APPROVED=on, LIVE_SALES_APPROVED_BY=<name>, LIVE_SALES_APPROVAL_REF=<reference>, plus Razorpay LIVE keys, then redeploy. Remove LIVE_SALES_APPROVED to close again.

## Scheduler
Target outbox ~1 min and reconcile ~5 min. vercel.json is still daily; confirm your Vercel plan's cron limits before changing it.

## Not production ready
Launch blockers: baseline unrun, migrations unverified, Razorpay/email unverified on staging, shipping UI and redesign not built.
