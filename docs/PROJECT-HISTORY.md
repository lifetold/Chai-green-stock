# Chai Green — project history

Everything done so far for Chai Green, so a new chat can pick up where the last one left off.
The full conversation is kept in the original Claude session titled
"Chai Green — stock app & menu costing (history)".

## 1. Stock management app (this repo)
- Live at https://chai-green-stock.vercel.app (Vercel project `chai-green-stock`, deploys on push to `main`).
- Supabase project `bysgrggktdjmwffupfjp` (London) in the separate Chai Green Supabase account.
- Features: goods in (photos + barcodes, unknown barcodes create products), stock out to stores
  with photo proof and signature, invoice raised on stock out, company stores pay cost and
  franchises pay cost + margin, reorder alerts, lead times, weekly stock check rota, full
  one-by-one stock take, suppliers, logistics companies (3PL) whose charge is added to product cost.
- Data loaded 13 Oct 2026: 181 products and the September stock-take quantities from the
  stock-take spreadsheet, plus suppliers matched from supplier invoices (184 products, 16 suppliers now).
- Rules from the user: lead time 4 days for everything except packaging (3 months);
  all packaging from Gafbros; Chai Green spice blends are made in house.
- Prices are kept in the database only, never in this public repo.

## 2. Menu costing document (Claude Docs)
"Chai Green Menu Costing & Strategy": https://claude.ai/artifact/P6avoyczkgjr3Y7t6No3nv
Added on 16 Oct 2026:
- Ingredient prices from the stock app (27 priced per kg / unit, 11 need a pack size).
- Portion cost check (momos, kids nuggets, matcha and fructose costed too high; samosas, panini,
  patisseries, luxury cake slice and coffee match).
- Single supplier: Brakes match for every ingredient.
- Menu changes to fit Brakes.
- Spices and specialist items: second supplier (Surya, JK Foods, Khanjra, P&B).

## 3. Supplier research (16 Oct 2026)
- Brakes (brake.co.uk, public catalogue): stocks about 140 of the 165 menu ingredients.
- Liberty Frozen Foods (current supplier, Leicester): delivers direct on its own schedule;
  403 products online including Armaan parathas, puri, aloo tikki, samosas and NF momos.
- Surya Foods (current supplier): Laila spices fill most Brakes spice gaps (chaat masala,
  deggi mirch, kasoori methi, biryani masala), plus sev and melon seeds.
- JK Foods: Chinese / Thai / Japanese range (MSG, soy, noodles), few Indian spices.
- Bidfood, Khanjra, P&B (Heera): product lists need a trade login.
- Still no supplier: papri, gol gappa shells, amchur, anardana, black salt, jaggery, pink tea, a few others.

## 4. Spreadsheet
"Chai Green Sourcing & Menu Costing.xlsx" (sent to the user in chat on 16 Oct 2026; not in this
repo because it contains cost prices). Tabs: Read Me, Summary, Stock App Prices, Ingredients,
Dishes, Cost Check, Menu Changes, Suppliers — all linked by formulas.

## 5. Open items
- Fill unknown pack sizes (croissants, aloo tikki, channa case, maple syrup, pink tea, spice packs).
- Confirm portion weights (nuggets, fillets, matcha, fructose) and dish choices (sauces "all three or one").
- Ask Liberty which delivery days cover each store's postcode.
- Decide the menu changes (paratha source, chaats, momos, curries).
- October menu decisions already agreed: mostly chicken and veg, pre-cooked chicken, no lamb,
  beef or seafood, veggie English breakfast, 3–4 curries from two bases, full kids menu.
