# Production Readiness: NOT READY
## Release blockers
1. SQL migrations and self-tests never run (KH-006). Run `scripts/db-verify.sh` on clean PostgreSQL 16, apply twice, run concurrency scripts.
2. Razorpay test-mode end to end (order, pay, webhook, refund) not done.
3. Dashboard-initiated refunds not reconciled (KH-018), needs a business rule.
4. Resend SPF/DKIM/DMARC unverified (KH-010).
5. `VITE_SITE_URL` must be set in Vercel, then `npm run seo:check` must pass (KH-009).
6. Production dependency advisory in react-router-dom (KH-007).
7. Stock-hold release only daily (KH-003): choose external scheduler or accept.
8. Bundles not purchasable (KH-004); loyalty must stay off until GST/refund policy is confirmed.
9. Sale-status wording in llms-full.txt (KH-020) and one AI test mismatch (KH-002).
10. Backups and recovery: no evidence in repo.
## Release checklist
- [ ] DB verified  - [ ] Razorpay test mode  - [ ] Refund reconciliation decision  - [ ] Email DNS verified  - [ ] VITE_SITE_URL + seo:check  - [ ] Dependency plan  - [ ] Cron/scheduler decision  - [ ] Admin browser pass  - [ ] Core Web Vitals  - [ ] Accessibility pass  - [ ] Backup restore test  - [ ] Real founder/product photos (KH-012)
## Status legend
Verified: lint, typecheck, build, 1193 tests, header at 320px, guards, ui:check. Fixed but unverified: ErrorBoundary fallback screen. Unresolved: KH-002, KH-003, KH-004, KH-007, KH-008. Blocked by owner: KH-018, KH-020, KH-012. Blocked by external: KH-006, KH-010.
