# Chai Green Stock — notes for Claude

Stock management web app for Chai Green (company-owned + franchised stores).
Static HTML/JS (no build) on Vercel + Supabase (database, auth, photo storage).
See README.md for features and setup, and docs/PROJECT-HISTORY.md for everything done so far
(menu costing document, supplier research, spreadsheet, open items).

## Current status
- Code complete and tested end-to-end (local PostgREST harness, 20 browser checks).
- Live on Vercel: https://chai-green-stock.vercel.app (project `chai-green-stock`,
  team `harperanddad-s-projects`, auto-deploys on push to `main`).
- Database: Supabase project `aamacfkbpigtolysxgym` ("chai-green-stock", London) in the
  user's Wizardtec Supabase organisation, created 31 Oct 2026 and reachable through the
  Supabase connector (apply_migration / execute_sql). The first database
  (`bysgrggktdjmwffupfjp`, separate Chai Green account) disappeared after being idle,
  so `api/keep-alive.js` runs daily from the Vercel cron to stop the free project pausing.
- Avoid UPDATE without WHERE and DROP in connector SQL: they trigger an approval box the
  user can't see. Large SQL already in the public repo can be loaded with
  `extensions.http_get('https://raw.githubusercontent.com/lifetold/chai-green-stock/<commit>/...')`.
- 184 products + September stock-take quantities + 16 suppliers reloaded 31 Oct 2026
  (prices are NOT kept in this public repo). Users must sign up again on the new
  database; the first sign-up becomes admin.
- Stores side (31 Oct 2026): daily/monthly safety checks with server-timed "rushed"
  flags, EHO read-only records, head-office overview, recipes, allergen chart, manual
  (supabase/seed-stores.sql has the starter content).
- SAMPLE DATA (31 Oct 2026): 7 test logins (test-*@example.com, roles manager/staff/
  store_manager/store/inspector; password given to the user in chat, not stored here), 3 staff
  per store (PIN 1234), 14 days of check runs, 4 POs, 2 goods-ins, 24 dispatches/invoices,
  4 write-offs, a submitted weekly stock check. Every sample row id is in `sample.rows`; stock
  and invoice counter before seeding are in `sample.products_before`, `sample.batches_before`,
  `sample.settings_before`, so it can all be removed exactly when the user is ready to go live.
  Check history was topped up to 9 Nov and 5 sample shop orders added (also in `sample.rows`).
- Shop orders (9 Nov 2026): store_orders/store_order_lines, RPCs place_store_order,
  order_catalogue, store_order_items, start_picking_store_order, mark_store_order_sent,
  cancel_store_order, open_store_orders; page js/pages/orders.js; Stock out takes
  `#/dispatch/<store>/<order>`. Local test: /var/tmp/harness/e2e-orders.js (7 checks pass).

## To finish setup (when the Supabase connector points at the Chai Green account)
1. `list_organizations` → pick the Chai Green org (NOT Wizardtec).
2. `create_project` name `chai-green-stock`, region `eu-west-2` (free tier).
3. Wait until ACTIVE_HEALTHY, then `apply_migration` with the whole of
   `supabase/schema.sql` (safe to re-run). Run `get_advisors` (security) after.
4. `get_project_url` + `get_publishable_keys` → put URL and anon/publishable key
   in `js/config.js`, commit, push to `main` (Vercel deploys automatically).
5. Tell the user to open the site and sign up first (first account = admin).
   Emails are auto-confirmed by a trigger, so the Site URL isn't needed for
   sign-up. For password-reset emails, the user should set Authentication →
   URL Configuration → Site URL to the Vercel address (optional).

## Working with the user (their instructions — always follow)
- Never ask the user to find someone else (IT person, colleague, etc.) to do a task.
  Claude chose the tools for this project, so Claude owns any set-up problems.
- The user is non-technical: do the work yourself wherever possible. When the user
  must do something, give ONE small step at a time, in plain words, and don't
  assume what they can see. Ask them what's on screen.
Never use the service_role key in browser code.
