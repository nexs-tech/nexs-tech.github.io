# Safety Union Backup backend

Static site on Cloudflare Pages, API on a Cloudflare Worker, data in Supabase, money in via Paystack.
Plain HTML/CSS/JS. No build step.

## Setup (about 20 minutes)

1. **Supabase**: new project. Auth settings: turn ON "Confirm email", set minimum password length 10,
   enable MFA (TOTP). Paste `supabase/schema.sql` into the SQL editor and run it.
   Make yourself admin: `update profiles set is_admin = true where email = 'you@example.com';`
2. **Paystack**: add webhook URL `https://YOURDOMAIN/api/webhooks/paystack`. Settings > Preferences:
   turn OFF transfer OTP so approved payouts go through (or whitelist the Worker egress). Use test keys first.
3. **Worker**: edit `worker/wrangler.toml` (domain, Supabase URL, APP_ORIGIN). Then in `worker/`:
   `npm i`, then `wrangler secret put` for `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `PAYSTACK_SECRET_KEY`,
   `TURNSTILE_SECRET`. `wrangler deploy`.
4. **Pages**: deploy this folder (root, not `worker/`). `_headers` ships the CSP and HSTS.
   Site and Worker must share one domain so cookies stay first-party.
5. **Turnstile**: create a widget, put the site key in `TURNSTILE_SITEKEY`.
6. Money settings live in SQL (`fee_config`, `plan_limits`). Currency must match your Paystack account.

## How money stays safe

- Browsers never talk to Supabase. Tables have RLS on with no policies, and anon/authenticated have zero grants.
  Only the Worker (service key) can call the money functions.
- Balances change only inside SQL functions that lock rows, check limits and write an append-only ledger.
  `integrity_check` view must always return zero rows. Admin page shows it.
- Amounts and fees are computed server side. The payer page only sends name and email.
- Webhook: HMAC-SHA512 signature (constant time), optional Paystack IP check, then Paystack Verify API,
  then an idempotent SQL settle. Replays, wrong amounts and wrong currency cannot credit twice or wrongly.
- Withdrawals: MFA required, bank name verified by Paystack, full account number never stored, 24h cooldown on
  new accounts, daily limits, manual approval by a different admin, refund path guarded so it can happen once.
- Sessions: HttpOnly Secure SameSite=Strict cookies, Origin check on every write, rate limits in Postgres,
  Turnstile on signup, login and public pay, generic login and signup errors, audit log.
- Frontend: all output escaped, no inline scripts, strict CSP.

## Important: temporary holding only

Safety Union Backup is **not a bank** and is **not licensed** to hold customer funds long-term.
We do not perform full KYC/AML verification required of deposit-taking institutions.

- Balances are temporary settlement vaults only.
- Users are strongly advised to withdraw to their own verified bank account promptly.
- The product surfaces clear notices and encourages (and can auto-prompt) moving money to a real bank account.
- Do not market this as a savings product, deposit account, or long-term wallet.
- Get local regulatory advice before accepting real user money.

## Known gaps to close before real users

- Holding customer balances usually needs a licence and KYC where you operate. Get advice before launch.
- `cdn.jsdelivr.net` FSCSS runtime has no SRI hash. Self-host it or add `integrity=`.
- If the FSCSS runtime needs eval, the CSP will block it. Test, then add the narrowest fix.
- Paystack's own fees are not in the SUB fee math. Check small payments do not lose money.
- Dashboard trend chart is still sample data. The virtual card is cosmetic (no issuer).
- Paystack webhook IPs in `paystack.js` should be checked against their docs. Turn off with `PAYSTACK_IP_CHECK=false`.
- Plans last 30 days and are re-bought manually (no auto renewal).
- Run `integrity_check` on a schedule and alert if it returns rows.
- All tables use the `sub_` prefix so this project can share a Supabase instance with other apps.
