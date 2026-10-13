# Chai Green Stock — notes for Claude

Stock management web app for Chai Green (company-owned + franchised stores).
Static HTML/JS (no build) on Vercel + Supabase (database, auth, photo storage).
See README.md for features and setup.

## Current status
- Code complete and tested end-to-end (local PostgREST harness, 20 browser checks).
- Live on Vercel: https://chai-green-stock.vercel.app (project `chai-green-stock`,
  team `harperanddad-s-projects`, auto-deploys on push to `main`).
- Connected to Supabase project `bysgrggktdjmwffupfjp` (London) in the user's
  separate Chai Green Supabase account (not reachable via the Supabase connector,
  which is signed in to the Wizardtec account). Schema loaded 13 Oct 2026.
- To re-run supabase/schema.sql after changes: Vercel sandbox (private, temporary)
  connecting to aws-0-eu-west-2.pooler.supabase.com:5432 as postgres.<ref>
  with the database password (ask the user; never commit it). This sandbox can't
  reach Supabase or vercel.app directly.

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
