# Chai Green Stock

Stock and warehouse system for Chai Green's company-owned and franchised stores.
It runs in the phone's web browser, so there's nothing to install. Staff can add it to the home
screen ("Add to Home Screen" / "Install app").

## What it does

| Area | What staff do | What the system does |
| --- | --- | --- |
| **Goods in** | Scan each item off the delivery, photograph the delivery and paperwork, enter use-by dates | Adds stock, records cost, books it against the purchase order. **An unknown barcode opens a "new product" form: photograph the packaging, name it, and the barcode is linked to it from then on.** |
| **Stock out** | Choose the store, scan everything going, photograph it, get the collector's name and signature | Takes it off stock (earliest use-by first), raises the **invoice** and a delivery note |
| **Invoices** | Print / save PDF, email to the store, mark paid, void | Company-owned stores pay **cost**. Franchise stores pay **cost + margin**: the store's agreed margin if it has one, otherwise the product's margin, otherwise the default. Sequential numbers, VAT per product, CSV export for Xero / Sage |
| **Stock levels** | See what's in stock, where it is, days of cover | Tracks every unit by delivery and use-by date |
| **Reorder alerts** | Press "Create purchase order" | Works out a reorder level from average daily use × (lead time + safety days), or uses one you set. Dashboard and menu badge, plus an optional daily email |
| **Lead times** | Set per supplier, override per product | Used for reorder levels and expected delivery dates |
| **Purchase orders** | Create from reorder suggestions, email to supplier, receive against it | Tracks what's on order and flags late deliveries |
| **Photo proof** | Photos at goods in, stock out (required), write-offs; signature on collection | Every photo is stored against the delivery / collection / write-off |
| **Weekly stock check** | The person on the rota scans and counts (blind count, without seeing the system figure). A manager approves | Every product is counted once every N weeks (default 4). High-value items can be counted every week, and anything wrong last week is counted again. Approval corrects stock and logs the difference |
| **Write-offs** | Damaged, out of date, lost, samples, returns, with a photo | Logged with reason, person and value |
| **Stock history** | Look anything up | Permanent record of every change: who, when, why |

**Roles**
- **Staff:** goods in, stock out, counts, write-offs.
- **Manager:** everything staff can do, plus prices, products, stores, suppliers, purchase orders, invoices and approving counts.
- **Admin:** everything a manager can do, plus switching users on and off.

## How it's built

- Plain HTML/JS, no build step. It's hosted on Vercel.
- **Supabase** (free tier) holds the database, staff logins and photo storage.
- All stock changes run inside database functions (`supabase/schema.sql`), so a stock out, its stock
  movement and its invoice are saved together or not at all.
- Row level security means only signed-in, switched-on staff can see anything.
- The barcode scanner uses the phone camera (EAN, UPC, Code 128, QR…). A USB or Bluetooth scanner also works:
  it types into the box and presses Enter.

## Setting it up

### 1. Supabase (free)

1. Create a project at [supabase.com](https://supabase.com), region **London (eu-west-2)**.
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**. It's safe to run again after updates.
3. **Authentication → URL configuration**: set **Site URL** to the website address (the Vercel address for now)
   and add the same address to **Redirect URLs**.
4. **Project settings → API**: copy the **Project URL** and the **anon public** key into `js/config.js`.

### 2. Vercel

1. In Vercel, **Add New → Project** → import `lifetold/chai-green-stock`. No build settings are needed.
2. Deploy. You get an address like `chai-green-stock.vercel.app`. That's the temporary website.
3. When the proper domain is ready: **Project → Settings → Domains → Add**, then update the Site URL in Supabase (step 1.3).

### 3. First login

1. Open the website → **New staff member** → sign up. **The first account becomes the admin.**
2. **Settings**: company address, VAT number, bank details (these go on invoices), invoice numbering, default margin.
3. Add **Suppliers** (with lead times) and **Stores** (company owned or franchise, invoice email, any agreed margin).
4. Add products by scanning them at **Goods in**. For stock already on the shelves, use
   **Write-off / adjust → Opening stock**.
5. Other staff sign up the same way; switch them on in **Users**.

### 4. Daily reorder email (optional)

Add these in Vercel → Project → Settings → Environment Variables, then redeploy:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key (Project settings → API). Keep it secret: never put it in `js/config.js` |
| `RESEND_API_KEY` | from [resend.com](https://resend.com) (free) |
| `ALERT_FROM` | e.g. `Chai Green Stock <stock@chaigreen.co.uk>` (domain verified in Resend) |
| `CRON_SECRET` | any long random string |

Then put the recipients in **Settings → Daily reorder email to**. The email goes out at 07:00 UTC
when something needs reordering, is going out of date, is late or is overdue.
