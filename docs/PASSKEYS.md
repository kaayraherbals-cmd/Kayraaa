# Admin passkeys

Sign in to the admin with a fingerprint, face or device PIN. No new packages: verification is in `server/webauthn.ts` (Node `crypto`).

## Set up (once)
1. Run `supabase/admin_passkeys.sql` in the Supabase SQL editor.
2. Deploy. Optional: set `ADMIN_PASSKEY_RP_ID` in Vercel to your registrable domain (for example `kaayraherbals.com`) if you use both `kaayraherbals.com` and `www.kaayraherbals.com`. Without it the passkey is tied to the exact host in the address bar.
3. Sign in the usual way, open Security, choose **Add a passkey**, and approve on your device. Add one per device.

## How it behaves
- **Sign in:** "Sign in with a passkey" on the sign-in page. Type your email first, or leave it empty and pick a passkey (the empty route needs a discoverable passkey, which most phones and password managers create).
- **Counts as both steps:** user verification is required, so a passkey sign-in skips the authenticator code. Password sign-in still needs the code.
- **Adding a passkey needs a fully signed-in session** (password plus code, or another passkey). A password alone can never add one.
- **Removing a passkey** ends any session that was signed in with it, on the next request, in every two-step mode (fixed in V5 Phase 3H: before, `ADMIN_MFA=optional` left such a session signed in). If the passkey check itself cannot be reached the request gets a 503 and the session is kept.
- Only the public key is stored. Up to 10 passkeys per admin. Names can be changed.
- Allowlist unchanged: the address must be in `ADMIN_EMAILS`, checked on every request. Roles still come from `ADMIN_ROLES`.
- Sign-in answers look the same for unknown addresses and admins without passkeys (a decoy credential is returned). Rate limits fail closed, like password sign-in.
- Audit log: Signed in with a passkey, Passkey added / renamed / removed / removed by an owner / refused.

## If a passkey is lost
Sign in with the password and code, then remove the lost passkey in Security. If the code device is lost too, an owner can reset your two-step verification (Security, Team), then you can sign in with the password and set it up again.

An owner can also remove a teammate's passkey: Security, Team, **Passkeys** on that person's row, then **Remove**. Use this when someone cannot sign in to remove it themselves, or a device was lost or stolen. It needs the `team.manage` permission (owners), the person's session that used that passkey ends on its next request, and the audit log records "Passkey removed by an owner" with the person and passkey name. Owners remove their own passkeys in the Passkeys section above, not in the Team table. Removing a passkey does not touch the person's password or two-step setup.

## Limits and notes
- Supported keys: ES256 and RS256; attestation is "none" (device make is not checked).
- Challenges are signed tickets that expire in 3 minutes (no challenge table). Passkeys that report a counter are checked for replay; synced passkeys report 0, which is allowed.
- Tests: `server/webauthn.test.ts`, `server/admin/passkeys.test.ts`, passkey cases and owner-removal cases in `server/admin/admin-api.test.ts`.
- **Not verified on a real device.** The tests use a software authenticator and a mocked database. The table exists on the `kaayra-herbals` Supabase project (applied 2026-10-22), but no passkey has been created against it.
