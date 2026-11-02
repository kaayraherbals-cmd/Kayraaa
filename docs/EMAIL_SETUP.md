# Email setup

Two separate paths. Both use your domain, `kaayraherbals.com`.

| What | Sent by | Configured in |
|---|---|---|
| Sign-up verification, password reset | Supabase Auth | Supabase > Authentication > Emails > SMTP Settings |
| Contact receipt, owner notifications, launch-list confirmation | This site (`server/mail.ts`) through Resend | Vercel environment variables |

## 1. Resend and the domain
1. resend.com > Domains > Add `kaayraherbals.com`. Add the DNS records it shows (SPF, DKIM, optional DMARC) in Vercel > Domains > DNS Records. Wait until every row says Verified.
2. API Keys > Create (sending access). Put it in Vercel as `RESEND_API_KEY` (Sensitive).

## 2. Supabase SMTP (sign-up and reset mails)
Host `smtp.resend.com`, port `465`, user `resend`, password = the Resend API key, sender `no-reply@kaayraherbals.com`, name `Kaayra Herbals`. Confirm email ON. Site URL `https://kaayraherbals.com`, redirect `https://kaayraherbals.com/api/auth/callback`.

## 3. Run the SQL
`supabase/email_outbox.sql` once (safe to re-run). It creates `email_outbox`, a log of kind, recipient and result. It never stores the message body. RLS on, no public policies.

## 4. Optional variables
`MAIL_FROM`, `MAIL_OWNER_TO` (default: the first `ADMIN_EMAILS` address), `MAIL_REPLY_TO` (default: owner), `MAIL_AUTOREPLY=off` to stop the contact receipt. Redeploy after changing any variable.

## What the site sends
| Trigger | To | Subject |
|---|---|---|
| Contact form saved | Owner (reply goes to the visitor) | New website message |
| Contact form saved | Visitor (receipt, can be switched off) | We received your message |
| New launch-list sign-up (a repeat within 15 minutes sends nothing) | Subscriber | Please confirm your email for Kaayra Herbals |
| Subscriber pressed the confirm button (sent once, on the pending to confirmed change only) | Subscriber | You are on the Kaayra Herbals list |
| Problem report saved | Owner | New problem report |

## Safety rules built in
- Mail never breaks a form: the message is saved first, and a mail failure is logged and recorded without telling the visitor anything went wrong.
- Nothing is sent until `RESEND_API_KEY` is set.
- Subjects are fixed text. Visitor text is HTML-escaped and kept out of headers. Sender, owner and recipient addresses are checked against a strict pattern.
- Requests to Resend time out after 5 seconds. Logs contain the kind and an error code, never an address.
- The copy makes no product, price, health or launch-date claims.

## Receiving mail at hello@kaayraherbals.com
Not handled by this site. Use a forwarder at DNS level (Cloudflare Email Routing, ImprovMX, or a hosted mailbox). Add it after Resend is verified, and check the MX records do not clash with Resend's.

## Owner items
- The Privacy Policy draft should name the email delivery provider (Resend) as a processor. Have it reviewed before launch.
- Launch list is double opt-in: the form saves a pending row and sends a confirmation; nobody is confirmed until they press the button on `/subscription`. Every launch mail carries an unsubscribe link plus `List-Unsubscribe` and `List-Unsubscribe-Post` (one-click) headers. Consent, confirmation and withdrawal are recorded in `launch_consent_log` (a hash of the address, never the address). Run `supabase/launch_optin.sql` first and set `SUBSCRIBE_TOKEN_SECRET`.
- Addresses that joined before this change are marked `single_legacy` and stay unconfirmed: nobody is mailed on that basis. Decide with your adviser whether to ask them to confirm.
- Export from the admin lists confirmed addresses only. Send any launch campaign only to that list.
- SPF, DKIM and DMARC records must show Verified in Resend and be checked by sending a real test message to Gmail and Outlook and reading the message source for `spf=pass dkim=pass dmarc=pass`. Not yet done.
- Not yet built: an admin screen for `email_outbox`, retries, order and shipping mails. Read the log in Supabase > Table editor for now.
- Checked here: 18 new tests (templates and sender) through a small stand-in for Vitest, and the three edited endpoints parse. Real Vitest, `npm run build` and a live send have not been run.
