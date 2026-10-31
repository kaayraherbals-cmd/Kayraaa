# Error codes

Every error a visitor sees carries a code (`KH-AREA-NNN`) and, when it came from the server, a one-off reference (`R-XXXXXXXX`).

- **The code** says what kind of problem it was. It is stable and listed below. Source of truth: `shared/errors.ts` (this page is generated from it).
- **The reference** identifies that one occurrence. For server faults (HTTP 5xx) it is written to the Vercel function logs as `[KH-AREA-NNN] R-XXXXXXXX message`, so search the logs for the reference a visitor quotes.
- **Reports.** Every error box has a *Report this problem* link that opens `/report-a-problem` with the code, reference and page already filled in. Reports appear in Admin > Issues.

Adding a code: add one line to `ERRORS` in `shared/errors.ts` (keep one entry per line), map it in `deriveErrorCode` if it should be chosen automatically, and regenerate this page.


## AUTH: Sign in, sign up and accounts

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-AUTH-001` | 401 | That email and password do not match. | Check both and try again, or reset your password. |
| `KH-AUTH-002` | 403 | Please verify your email first. | Open the verification link we emailed you. Check spam if it is missing. |
| `KH-AUTH-003` | 429 | Too many attempts. Please wait a few minutes and try again. | Wait 15 minutes, then try again. |
| `KH-AUTH-004` | 403 | We are not accepting new accounts right now. | Join the launch list and we will tell you when accounts open. |
| `KH-AUTH-005` | 401 | Your session has ended. Please sign in again. | Sign in again. |
| `KH-AUTH-006` | 400 | That password cannot be used. | Use at least 8 characters with a letter and a number, and avoid common passwords. |
| `KH-AUTH-007` | 400 | Sign-in was cancelled. Nothing was changed. | Start again when you are ready. |
| `KH-AUTH-008` | 400 | That link or sign-in attempt expired. | Start again to get a fresh link. |
| `KH-AUTH-009` | 400 | We could not confirm a verified email address. | Use an account with a verified email, or sign up with email and password. |
| `KH-AUTH-010` | 503 | Sign-in is not set up yet. | Owner: check the Supabase and session variables in docs/VERCEL_SETUP.md. |
| `KH-AUTH-011` | 502 | Sign-in is busy right now. Please try again shortly. | Wait a minute and retry. If it keeps happening, report it. |
| `KH-AUTH-012` | 403 | This action is not allowed for this account. | Contact us if you think this is a mistake. |
| `KH-AUTH-013` | 400 | Your email is verified. Please sign in with your email and password. | Sign in below. The verification link only signs you in on the browser where you started. |
| `KH-AUTH-014` | 400 | That sign-in method is not available. | Choose another method, or use email and password. |
| `KH-AUTH-015` | 403 | That account does not have administrator access. | Sign in with an administrator account. |

## FORM: Contact and launch-list forms

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-FORM-001` | 400 | Some details need fixing. | Check the highlighted fields and send again. |
| `KH-FORM-002` | 503 | This form is not open yet. Nothing has been sent. | Try again later. |
| `KH-FORM-003` | 502 | We could not save that. Please try again. | Try again in a minute. If it keeps happening, report it. |
| `KH-FORM-004` | 429 | Too many attempts. Please try again later. | Wait about ten minutes. |

## ADMIN: Admin panel

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-ADMIN-001` | 503 | Admin access is not configured on the server. | Owner: set the admin variables in docs/VERCEL_SETUP.md and redeploy. |
| `KH-ADMIN-002` | 401 | Incorrect email or password, or this account has no admin access. | Check your details, or ask the owner to add your email to ADMIN_EMAILS. |
| `KH-ADMIN-003` | 401 | Your admin session has ended. Sign in to continue. | Sign in again. |
| `KH-ADMIN-004` | 502 | The database request failed. Try again. | Read the hint shown with it. Most often a file in `supabase/` has not been run (see `docs/DATABASE_MIGRATIONS.md`). Otherwise search the Vercel logs for the reference. |
| `KH-ADMIN-005` | 409 | This change is not allowed yet. | Complete the checklist shown with the message. |
| `KH-ADMIN-006` | 429 | Too many attempts. Try again in 15 minutes. | Wait 15 minutes. |
| `KH-ADMIN-007` | 403 | Your role does not have permission for this action. | Ask an owner to do it, or to change your role (ADMIN_ROLES). |
| `KH-ADMIN-008` | 401 | Two-step verification is needed before you can continue. | Enter the code from your authenticator app, or set it up if you have not yet. |
| `KH-ADMIN-009` | 409 | That change conflicts with the current stock or order state. | Reload the page to see the latest figures, then try again. |
| `KH-ADMIN-010` | 409 | Selling is not enabled, so orders cannot be created yet. | Owner: see docs/ECOMMERCE_ARCHITECTURE.md before changing COMMERCE_ENABLED. |
| `KH-ADMIN-011` | 401 | That verification code is not correct or has expired. | Wait for the next code and try again, or use a recovery code. |
| `KH-ADMIN-012` | 503 | Two-step verification is not set up on the server. | Owner: set ADMIN_MFA_KEY and run supabase/roles_mfa_audit.sql, or set ADMIN_MFA=optional meanwhile. |
| `KH-ADMIN-013` | 503 | Online payments are not set up on the server. | Owner: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel (see docs/RAZORPAY_SETUP.md) and redeploy. |

## ISSUE: Problem reports

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-ISSUE-001` | 400 | Your report needs a little more detail. | Check the highlighted fields and send again. |
| `KH-ISSUE-002` | 429 | You have sent several reports. Please try again later. | Wait about ten minutes. |
| `KH-ISSUE-003` | 503 | Problem reports are not open yet. Nothing has been sent. | Email us instead, or try again later. |
| `KH-ISSUE-004` | 502 | We could not save your report. Please try again. | Try again in a minute. |

## CART: Shopping bag (development preview only)

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-CART-001` | 404 | The shopping bag is not open yet. | Nothing is for sale yet. Join the launch list and we will tell you first. |
| `KH-CART-002` | 401 | Please sign in to keep a saved bag. | Sign in, then try again. Your bag on this device is kept. |
| `KH-CART-003` | 400 | Some items in your bag need fixing. | Check the items shown and try again. |
| `KH-CART-004` | 409 | Your bag is full. | Remove an item before adding another. |
| `KH-CART-005` | 429 | Too many requests. Please try again in a moment. | Wait a minute, then try again. |
| `KH-CART-006` | 502 | We could not update your bag. Please try again. | Try again in a minute. If it keeps happening, report it. |
| `KH-CART-007` | 422 | That coupon could not be applied. | Read the reason shown, or remove the coupon and continue without it. |

## NET: Connection (raised in the browser)

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-NET-001` | n/a | We could not reach the server. Check your connection and try again. | Check your internet connection, then retry. |

## SYS: General

| Code | HTTP | What the visitor sees | What to try |
|---|---|---|---|
| `KH-SYS-001` | 500 | Something went wrong on our side. Please try again. | Retry. If it keeps happening, report it with this code. |
| `KH-SYS-002` | 405 | That request is not supported. | Reload the page and try again. |
| `KH-SYS-003` | 404 | We could not find that. | Check the address, or go back to the home page. |
| `KH-SYS-004` | 403 | That request was not allowed. | Reload the page and try again. |

## CHECKOUT: Checkout (development testing only)

| Code | Status | What the visitor sees | What to try |
|---|---|---|---|
| `KH-CHK-001` | 404 | Checkout is not open yet. | Nothing is for sale yet. Join the launch list and we will tell you first. |
| `KH-CHK-002` | 401 | Please sign in to check out. | Sign in, then return to your bag. Your bag is kept. |
| `KH-CHK-003` | 400 | Some delivery details need fixing. | Check the highlighted fields and try again. |
| `KH-CHK-004` | 409 | Something in your bag changed. | Review your bag and the updated total, then continue. |
| `KH-CHK-005` | 422 | We cannot deliver to that PIN code yet. | Try a different delivery address, or join the launch list for updates. |
| `KH-CHK-006` | 429 | Too many attempts. Please wait a moment. | Wait a minute, then try again. |
| `KH-CHK-007` | 502 | We could not place your order. Nothing was charged. | Try again in a minute. If it keeps happening, report it with this code. |
| `KH-CHK-008` | 409 | This order was already submitted differently. | Reload checkout and try again. |
| `KH-PAY-001` | 404 | Online payment is not open yet. | Nothing is for sale yet, so no payment can be made. |
| `KH-PAY-002` | 401 | Please sign in to pay for your order. | Sign in, then return to your order. |
| `KH-PAY-003` | 400 | That payment request was not valid. | Go back to your order and try again. |
| `KH-PAY-004` | 400 | We could not confirm that payment. | If money left your account, do not pay again. Keep this code and report it; we will check with Razorpay. |
| `KH-PAY-005` | 409 | This order can no longer be paid. | The payment window ended or the order was cancelled. Place the order again from your bag. |
| `KH-PAY-006` | 429 | Too many attempts. Please wait a moment. | Wait a minute, then try again. |
| `KH-PAY-007` | 502 | We could not start the payment. Nothing was charged. | Try again in a minute. If it keeps happening, report it with this code. |
| `KH-PAY-008` | 503 | Online payment is not set up on the server. | Owner: set the Razorpay variables in Vercel (docs/RAZORPAY_SETUP.md) and redeploy. |
