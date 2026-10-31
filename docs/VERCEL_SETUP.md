# Vercel setup: site, login and sign up

This project is built for **Vercel** (Vite + React, prerendered, serverless functions in `/api`). It does not run on Netlify as is.

## 1. Pages

| URL | What it is |
|---|---|
| `/login` | Sign in: email + password, or Continue with Google |
| `/signup` | Create account: name, email, password, confirm password, or Google |
| `/forgot-password` | Emails a reset link |
| `/set-password` | Google users choose name + password + confirm here; also used by the reset link |
| `/account` | Member page: sign out, delete account |
| `/admin` | Admin panel (emails in `ADMIN_EMAILS` only) |

The header has **Sign in** and **Sign up** links.

## 2. Supabase (do all of these)

1. Run `supabase/launch_subscribers.sql`, then `supabase/email_outbox.sql`, then `supabase/launch_optin.sql` (double opt-in), then `supabase/auth_members.sql` (run it again if you already ran an older copy: it adds `has_password`), then `supabase/products.sql` and `supabase/products_seed.sql`, then `supabase/issues.sql` (problem reports and the admin Issues tab), then `supabase/products_catalog.sql` (price, labelling fields and the private `product-images` photo bucket; needed to add products with photos), then the three back-office files **in this order**: `supabase/roles_mfa_audit.sql`, `supabase/variants_gallery.sql`, `supabase/inventory_orders.sql`. Finally paste `supabase/phase3_selftest.sql` into the SQL editor once: it must print `ALL PASSED` and keeps nothing (see docs/CHANGES_PHASE3.md).
2. **Authentication > Sign In / Providers > Email**: enabled, **Confirm email ON**, minimum password length 8 or less.
3. **Authentication > Sign In / Providers**: "Allow new users to sign up" must be **ON** (the earlier guide said to turn it off; that would block sign-up). The site decides who may join through `MEMBER_SIGNUP`.
4. **Authentication > Providers > Google**: enable it (Google Cloud Console OAuth client; its authorised redirect URI is `https://<project>.supabase.co/auth/v1/callback`).
5. **Authentication > URL Configuration**: Site URL = your production URL. Redirect URLs: `https://<your-domain>/api/auth/callback` (add `http://localhost:3000/api/auth/callback` for `vercel dev`).
6. **Authentication > SMTP Settings: set up your own SMTP** (Resend, Brevo, Gmail workspace, etc.). Supabase's built-in email is for testing only: it is heavily rate-limited and may only deliver to your own team members, so real visitors would never get the verification or reset email.
7. Optional: in Authentication > Email Templates, edit "Confirm signup" and "Reset password" to match the brand. Keep the `{{ .ConfirmationURL }}` link.

## 3. Vercel environment variables

| Variable | Value |
|---|---|
| `VITE_SITE_URL` | Production URL, no trailing slash |
| `SITE_URL` | Same URL. **Required in production** (email and OAuth links point here) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only) |
| `SUPABASE_ANON_KEY` | Publishable/anon key |
| `ADMIN_SESSION_SECRET` | `openssl rand -base64 48` |
| `ADMIN_EMAILS` | Comma-separated admin emails (optional, but needed for `/admin`) |
| `SUBSCRIBE_TOKEN_SECRET` | 32+ random characters (`openssl rand -base64 48`). Signs the confirm and unsubscribe links. Required for the launch list to open |
| `ADMIN_ROLES` | `email:role` pairs (owner, manager, support). **Required**: if unset or invalid the admin refuses everyone (no default owner). At least one owner |
| `ADMIN_MFA` | `required` (default) or `optional` |
| `ADMIN_MFA_KEY` | `openssl rand -base64 32`. Needed for two-step verification |
| `OAUTH_PROVIDERS` | `google` (Google is always shown; add `github`, `azure` to offer more) |
| `MEMBER_SIGNUP` | `open` (default) or `closed` |

Never prefix server secrets with `VITE_`. Redeploy after changing variables.

## 4. Deploy

Push to Git, import into Vercel (framework preset **Vite**), Node 20+. Locally first if you can: `npm install && npm run lint && npm run typecheck && npm test && npm run build`.

## 5. How it behaves

- **Sign up (manual):** name, email, password, confirm, agree to terms. A verification email is sent. After clicking the link (in the same browser) the person is signed in. If they open it elsewhere, they just sign in with their email and password.
- **Sign in (manual):** email + password. Unverified emails are told to verify first.
- **Google:** first time, the person lands on `/set-password` to confirm their name and choose and confirm a password, then is signed in. Later they can use Google or email + password. Returning Google users who already have a password go straight in.
- **Forgot password:** `/forgot-password` > emailed link (valid 1 hour) > `/set-password`.

## 6. If it still does not work

- Page says sign-in is unavailable: a server variable is missing (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_SESSION_SECRET` of 32+ characters, or `SITE_URL`). Check Vercel > Logs for `/api/auth/status`.
- Sign-up says it worked but no email arrives: SMTP not set up (step 2.6), or check spam.
- Google button shows but clicking it errors: Google is not enabled in Supabase > Authentication > Providers, or the Google client ID and secret are missing there.
- Google returns to `/login?error=expired`: the Redirect URL in step 2.5 is missing or does not match `SITE_URL`.
- Page not found or old page: redeploy and hard refresh; confirm the deployment is from this version (header shows both Sign in and Sign up).

## Not built

Change password while signed in (use Forgot password), member list in the admin panel, MFA. The build and real Google/Supabase round trip have not been run in this environment.

## KH-AUTH-010 quick fix

Vercel > Logs now prints `[KH-AUTH-010] ... Missing or invalid: <names>` when sign-in is not configured. Set exactly those variables in Vercel > Settings > Environment Variables (Production), then **redeploy** (changes do not apply to existing deployments).
