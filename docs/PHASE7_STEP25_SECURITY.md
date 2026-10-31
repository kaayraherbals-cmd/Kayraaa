> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 7 Step 2.5: security report

Evidence level: code review plus the stand-in test run (mocks only). No penetration test, no database RLS test, no deployed environment.

## 1. Commerce safety
| Item | Result |
|---|---|
| `COMMERCE_ENABLED = false` | PASS |
| Production cannot enable purchasing with development flags | PASS (stand-in). `readFlags` returns every flag off when `VERCEL_ENV` is `production`; with the master switch off, checkout needs the bag flag **and** the testing flag, and payment needs the payment-test flag **and** a Razorpay **test** key. Tests assert production stays closed with all flags on. |
| Endpoints (cart, checkout place/pay/verify/status/cancel, admin order-create, admin payment-create) | 404 or a commerce-off error while closed (PASS (stand-in)) |
| Left open by design | Razorpay webhook (must record a payment already taken; signature mandatory), the two cron endpoints (secret), admin refunds on paid orders |
| Staging isolation (separate Supabase, Razorpay test keys, email config) | BLOCKED: only `VERCEL_ENV` separates environments in code; credentials are Vercel settings I cannot see. A live `rzp_live_` key is refused while commerce is off (PASS (stand-in)), which is a guard, not isolation. |

## 2. Rate limiting policy (implemented this step)

| Limiter | When the shared counter is unavailable |
|---|---|
| Admin sign-in (per IP, per email), admin two-step code (per IP, per email) | **Closed**: HTTP 503 `unavailable`, `Retry-After: 60`, no password or code is checked |
| Place order, start payment | **Closed**: `KH-CHK-009` / `KH-PAY-009` (503, "Nothing was charged"). Safe to retry: both are idempotent in the database |
| Verify a payment, payment status, cancel | **Open**: never blocked, because a customer who has paid must be recorded (verify is signature-checked and idempotent) |
| Public forms (contact, issues, subscribe), customer sign-in, register, password reset, other checkout calls, admin uploads | **Open**: in-memory per-instance limit still applies |
| Cart, media, products | In-memory only (no shared layer) |

Recovery for a closed limiter: (a) repair the database or run `supabase/rate_limits.sql`; (b) emergency owner access: set `RATE_LIMIT_BREAKGLASS_UNTIL` to an ISO time **no more than 60 minutes ahead** and redeploy. It turns closed limiters into in-memory-only until that time, expires by itself, a value further ahead is ignored, and one log line per instance per minute is written. (c) `RATE_LIMIT_SHARED=off` is ignored by closed limiters in production. Stored data: salted SHA-256 of IP or email only.

Residual: the break-glass needs a redeploy (minutes) and trusts whoever can set Vercel variables. A fixed window allows up to 2x the limit across a boundary. Real cross-instance concurrency NOT TESTED.

## 3. Logging review (every `console.*` in `api/`, `server/`, `shared/` was read)
- **Fixed:** the outbox worker and cron endpoint logged error message text; the `rpc` helper logged up to 300 characters of the database error body. Now only error classes, SQLSTATE codes and our own `KH:` codes. Tested with hostile content (PASS (stand-in)).
- **Checked and acceptable:** the other outbox, rate-limit, webhook and Razorpay logs write fixed text, status codes and Razorpay error codes only.
- **Not changed, not proven safe:** about ten older handlers log `e.message` of a caught error (`auth`, `admin`, `cart`, `checkout`, `subscribe`, `issues`, `contact`, `products`, `media`, reconcile). Those messages come from our own code (for example `orders 500`) or from `fetch` failures, which normally carry no row data, but I did not prove that for every path. Recommend replacing them with error class and code in Step 3.
- Outbox rows hold the recipient address (needed to send) and ids; the payload is erased on send. `last_error` holds a short code only. Not exercised on a real database.

## 4. Email
Transactional mail is queued only from verified backend events and re-checked at send time (captured payment and paid order for payment confirmation; provider-processed refund for refund completion; shipment state for shipping mail). Stale notices are dropped. Marketing consent is separate and untouched. Resend itself was never called (NOT TESTED).

## 5. Findings still open
| ID | Pri | Finding |
|---|---|---|
| SEC-1 | P0 | No real `npm test`, lint, typecheck, build, audit; 22 dependency advisories from Phase 6 untriaged |
| SEC-2 | P0 | New SQL never executed; RLS and privilege revokes unverified on a real database |
| SEC-3 | P1 | Staging and production credentials separation unverified |
| SEC-4 | P1 | Older `e.message` logs (above) |
| SEC-5 | P1 | MFA and place-order fail-closed paths have no API-level test |
| SEC-6 | P1 | No refund-webhook API test; refund reconciliation unverified |
| SEC-7 | P1 | Shipment admin API uses the existing CSRF and session gates, not re-tested for the new actions beyond permissions |
| SEC-8 | P2 | No alerting: nothing watches `email_outbox_stats()` or cron failures |

## 6. Cron architecture (Priority 6 recommendation)

**Daily cron is not adequate** for time-sensitive work: a payment-confirmation mail that missed the immediate path could wait up to 24 hours, the 1/5/30-minute retry schedule is pointless if the job runs once a day, and expired stock holds are only released at checkout activity or the daily run. Current `vercel.json` runs both jobs at 02:00 and 02:30 UTC only as a Hobby-compatible safety net. I could not check your Vercel plan.

Recommended, in order:
1. **Supabase `pg_cron` + `pg_net`** (example: `supabase/scheduler_pg_cron.sql.example`, **not run**): outbox every minute, reconcile every 5 minutes, calling the same secret-protected endpoints, independent of the Vercel plan. Monitoring queries are in the file (`cron.job_run_details`, `net._http_response`, `email_outbox_stats()`). Confirm both extensions are available on your Supabase plan.
2. **Vercel Pro cron** (shorten both schedules in `vercel.json`; check the plan's limits).
3. **GitHub Actions scheduled workflow** (about every 5 minutes at best, not exact).
4. At higher volume, a managed queue (for example Upstash QStash, Inngest, or Vercel Queues if available to you) pushing jobs to the same endpoints. The endpoints are idempotent and claim rows with locks, so any scheduler, or two at once, is safe.
Add alerting on: no successful outbox run in 15 minutes; `dead` count above 0; oldest queued mail older than 30 minutes.
