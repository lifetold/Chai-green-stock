-- Chai Green stock management — database schema.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.
--
-- Security model
--   * Every table has row level security ON.
--   * Signed-in staff whose profile is active can read everything.
--   * Master data (products, stores, suppliers, settings) is edited by
--     managers/admins; staff may add new products at goods-in.
--   * Stock never changes by direct table writes. Goods in, dispatch,
--     adjustments, stock-check approval and invoice voids all go through the
--     functions at the bottom of this file, which run in one transaction and
--     write the movement ledger.

create extension if not exists pgcrypto;

-- ============================================================== helpers
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  full_name      text,
  role           text not null default 'staff' check (role in ('admin','manager','staff')),
  active         boolean not null default false,   -- an admin switches new users on
  in_check_rota  boolean not null default true,    -- takes a turn doing the weekly stock check
  created_at     timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() is not null, false)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','manager'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- New sign-ups get a profile. The very first user becomes an active admin;
-- everyone after that waits for an admin to switch them on.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean;
begin
  select not exists (select 1 from public.profiles) into first;
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          case when first then 'admin' else 'staff' end,
          first)
  on conflict (id) do nothing;
  return new;
end $$;

-- Staff accounts must be switched on by an admin before they can do
-- anything, so there's no need for an email confirmation step as well.
-- This also means sign-up works before the Site URL is configured.
create or replace function public.auto_confirm_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;
drop trigger if exists auto_confirm_email on auth.users;
create trigger auto_confirm_email before insert on auth.users
  for each row execute function public.auto_confirm_email();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================== settings
create table if not exists public.settings (
  id                    int primary key default 1 check (id = 1),
  company_name          text not null default 'Chai Green',
  company_address       text default '',
  company_email         text default '',
  company_phone         text default '',
  vat_number            text default '',
  company_number        text default '',
  bank_details          text default '',
  invoice_prefix        text not null default 'CG-',
  next_invoice_no       int  not null default 1001,
  payment_terms_days    int  not null default 14,
  default_margin_pct    numeric(6,2) not null default 25,
  default_vat_rate      numeric(5,2) not null default 20,
  check_cycle_weeks     int  not null default 4 check (check_cycle_weeks between 1 and 52),
  check_day             int  not null default 1 check (check_day between 1 and 7), -- 1 = Monday
  expiry_warning_days   int  not null default 30,
  usage_window_days     int  not null default 56,   -- how far back to average usage
  safety_stock_days     int  not null default 7,    -- extra cover on top of lead time
  alert_emails          text default '',            -- comma separated, daily reorder email
  require_dispatch_photo boolean not null default true,
  updated_at            timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ============================================================== master data
create table if not exists public.suppliers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  contact_name           text,
  email                  text,
  phone                  text,
  address                text,
  account_ref            text,           -- our account number with them
  default_lead_time_days int not null default 7,
  min_order_value        numeric(12,2),
  notes                  text,
  active                 boolean not null default true,
  created_at             timestamptz not null default now()
);

create table if not exists public.stores (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  code               text unique,                 -- short code, e.g. LDN01
  type               text not null check (type in ('company','franchise')),
  margin_pct         numeric(6,2),                -- franchise only: overrides product margins for this store
  contact_name       text,
  email              text,                        -- invoices go here
  phone              text,
  address            text,
  payment_terms_days int,                         -- null = settings default
  account_ref        text,                        -- accounts package contact code
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  sku               text unique,
  name              text not null,
  description       text,
  category          text,
  unit              text not null default 'each',  -- what one "1" means: each, case, bag, box…
  pack_size         text,                          -- e.g. "6 x 1kg"
  supplier_id       uuid references public.suppliers(id) on delete set null,
  supplier_code     text,                          -- supplier's own product code
  cost_price        numeric(12,4) not null default 0,  -- per unit, ex VAT
  margin_pct        numeric(6,2),                  -- franchise margin; null = settings default
  vat_rate          numeric(5,2),                  -- null = settings default
  lead_time_days    int,                           -- null = supplier default
  reorder_point     numeric(12,2),                 -- null = calculated from usage and lead time
  reorder_qty       numeric(12,2),                 -- null = calculated
  min_stock         numeric(12,2) not null default 0, -- never let the reorder point drop below this
  location          text,                          -- warehouse bin / shelf
  track_expiry      boolean not null default false,
  check_group       int,                           -- weekly stock-check group, set automatically
  check_every_week  boolean not null default false, -- high value / high risk: counted every week
  photo_path        text,
  qty_on_hand       numeric(12,2) not null default 0,
  active            boolean not null default true,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));
-- added later: a fixed franchise selling price (from the price list) and the
-- order products appear in the full stock take (the stock-take sheet order)
alter table public.products add column if not exists sell_price numeric(12,2);
alter table public.products add column if not exists sort_order int;

-- Logistics (third-party storage and delivery). A supplier marked as a
-- logistics company can store and deliver products for us; its charge per
-- unit is added to the product's cost ("landed cost"), so prices and
-- margins include it. stored_by = null means our own warehouse.
alter table public.suppliers add column if not exists is_logistics boolean not null default false;
alter table public.suppliers add column if not exists logistics_cost_per_unit numeric(12,4);
alter table public.suppliers add column if not exists logistics_rates text;
alter table public.products add column if not exists stored_by uuid references public.suppliers(id) on delete set null;
alter table public.products add column if not exists logistics_cost numeric(12,4);  -- per unit; null = company's standard charge

create table if not exists public.product_barcodes (
  barcode     text primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  label       text,                 -- e.g. "outer case", "single"
  created_at  timestamptz not null default now()
);
create index if not exists product_barcodes_product_idx on public.product_barcodes (product_id);

-- Every photo taken in the app: packaging, deliveries, collections, write-offs, counts.
create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('product','goods_in','dispatch','signature','adjustment','stock_check','purchase_order')),
  ref_id     uuid not null,
  path       text not null,
  caption    text,
  taken_by   uuid references public.profiles(id),
  taken_at   timestamptz not null default now()
);
create index if not exists photos_ref_idx on public.photos (kind, ref_id);

-- ============================================================== purchasing
create table if not exists public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique not null default ('PO-' || to_char(now(), 'YYMMDD-') || upper(substr(md5(random()::text), 1, 4))),
  supplier_id  uuid not null references public.suppliers(id),
  status       text not null default 'draft' check (status in ('draft','sent','part_received','received','cancelled')),
  ordered_at   timestamptz,
  expected_at  date,
  notes        text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table if not exists public.po_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.purchase_orders(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty_ordered   numeric(12,2) not null check (qty_ordered > 0),
  qty_received  numeric(12,2) not null default 0,
  unit_cost     numeric(12,4)
);
create index if not exists po_lines_po_idx on public.po_lines (po_id);

-- ============================================================== stock
create table if not exists public.goods_in (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique not null default ('GI-' || to_char(now(), 'YYMMDD-') || upper(substr(md5(random()::text), 1, 4))),
  supplier_id       uuid references public.suppliers(id),
  po_id             uuid references public.purchase_orders(id),
  delivery_note_ref text,
  notes             text,
  received_by       uuid references public.profiles(id),
  received_at       timestamptz not null default now()
);

create table if not exists public.goods_in_lines (
  id          uuid primary key default gen_random_uuid(),
  goods_in_id uuid not null references public.goods_in(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  qty         numeric(12,2) not null check (qty > 0),
  cost_price  numeric(12,4),
  expiry_date date,
  batch_code  text
);

-- Stock held, by delivery. Dispatches take the earliest expiry first (FEFO),
-- then oldest delivery first (FIFO).
create table if not exists public.stock_batches (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  qty_received  numeric(12,2) not null,
  qty_remaining numeric(12,2) not null check (qty_remaining >= 0),
  expiry_date   date,
  batch_code    text,
  cost_price    numeric(12,4),
  source        text not null default 'goods_in',   -- goods_in, adjustment, return, opening
  source_id     uuid,
  received_at   timestamptz not null default now()
);
create index if not exists stock_batches_live_idx on public.stock_batches (product_id) where qty_remaining > 0;

create table if not exists public.dispatches (
  id                 uuid primary key default gen_random_uuid(),
  ref                text unique not null default ('DN-' || to_char(now(), 'YYMMDD-') || upper(substr(md5(random()::text), 1, 4))),
  store_id           uuid not null references public.stores(id),
  method             text not null default 'collection' check (method in ('collection','delivery')),
  collected_by_name  text,
  signature_path     text,
  notes              text,
  dispatched_by      uuid references public.profiles(id),
  dispatched_at      timestamptz not null default now(),
  invoice_id         uuid
);

create table if not exists public.dispatch_lines (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  qty          numeric(12,2) not null check (qty > 0),
  unit_cost    numeric(12,4) not null,
  unit_price   numeric(12,4) not null,
  margin_pct   numeric(6,2) not null,
  vat_rate     numeric(5,2) not null
);

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null,
  store_id      uuid not null references public.stores(id),
  dispatch_id   uuid references public.dispatches(id),
  store_name    text not null,              -- snapshot at time of invoice
  store_address text,
  store_email   text,
  store_type    text not null,
  issue_date    date not null default current_date,
  due_date      date not null,
  subtotal      numeric(12,2) not null,
  vat_total     numeric(12,2) not null,
  total         numeric(12,2) not null,
  status        text not null default 'unpaid' check (status in ('unpaid','paid','void')),
  paid_at       timestamptz,
  payment_ref   text,
  void_reason   text,
  emailed_at    timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists invoices_store_idx on public.invoices (store_id, issue_date desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispatches_invoice_fk') then
    alter table public.dispatches add constraint dispatches_invoice_fk foreign key (invoice_id) references public.invoices(id);
  end if;
end $$;

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  product_id  uuid references public.products(id),
  sku         text,
  description text not null,
  qty         numeric(12,2) not null,
  unit_price  numeric(12,4) not null,
  vat_rate    numeric(5,2) not null,
  net         numeric(12,2) not null,
  vat         numeric(12,2) not null
);

create table if not exists public.adjustments (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id),
  qty_change  numeric(12,2) not null check (qty_change <> 0),
  reason      text not null check (reason in ('damaged','expired','lost','found','sample','return_from_store','return_to_supplier','opening_stock','correction','stock_check')),
  notes       text,
  expiry_date date,
  user_id     uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- The ledger: one row for every change to stock. Never edited.
create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products(id),
  qty_change  numeric(12,2) not null,
  qty_after   numeric(12,2) not null,
  type        text not null check (type in ('goods_in','dispatch','adjustment','stock_check','void_return')),
  ref_id      uuid,
  ref_text    text,
  store_id    uuid references public.stores(id),
  user_id     uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);

-- ============================================================== stock checks
create table if not exists public.stock_checks (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  assigned_to   uuid references public.profiles(id),
  status        text not null default 'open' check (status in ('open','submitted','approved')),
  submitted_at  timestamptz,
  submitted_by  uuid references public.profiles(id),
  approved_at   timestamptz,
  approved_by   uuid references public.profiles(id),
  notes         text,
  created_at    timestamptz not null default now()
);

-- 'weekly' = the rota check; 'full' = a count of every product (full stock take)
alter table public.stock_checks add column if not exists kind text not null default 'weekly';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_checks_kind_check') then
    alter table public.stock_checks add constraint stock_checks_kind_check check (kind in ('weekly','full'));
  end if;
end $$;
alter table public.stock_checks drop constraint if exists stock_checks_week_start_key;
create unique index if not exists stock_checks_week_kind_idx on public.stock_checks (week_start, kind);

create table if not exists public.stock_check_lines (
  id            uuid primary key default gen_random_uuid(),
  check_id      uuid not null references public.stock_checks(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  expected_qty  numeric(12,2),      -- system qty when the count was saved
  counted_qty   numeric(12,2),
  counted_by    uuid references public.profiles(id),
  counted_at    timestamptz,
  note          text,
  unique (check_id, product_id)
);

-- ============================================================== RLS
alter table public.profiles          enable row level security;
alter table public.settings          enable row level security;
alter table public.suppliers         enable row level security;
alter table public.stores            enable row level security;
alter table public.products          enable row level security;
alter table public.product_barcodes  enable row level security;
alter table public.photos            enable row level security;
alter table public.purchase_orders   enable row level security;
alter table public.po_lines          enable row level security;
alter table public.goods_in          enable row level security;
alter table public.goods_in_lines    enable row level security;
alter table public.stock_batches     enable row level security;
alter table public.dispatches        enable row level security;
alter table public.dispatch_lines    enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.adjustments       enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.stock_checks      enable row level security;
alter table public.stock_check_lines enable row level security;

do $$
declare t text;
begin
  -- read access for every active staff member
  foreach t in array array['settings','suppliers','stores','products','product_barcodes','photos',
    'purchase_orders','po_lines','goods_in','goods_in_lines','stock_batches','dispatches',
    'dispatch_lines','invoices','invoice_lines','adjustments','stock_movements','stock_checks',
    'stock_check_lines','profiles']
  loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
  -- full write access for managers on master data / purchasing
  foreach t in array array['suppliers','stores','products','product_barcodes','purchase_orders','po_lines']
  loop
    execute format('drop policy if exists "manager write" on public.%I', t);
    execute format('create policy "manager write" on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

-- Users can always see their own profile (so the app can say "waiting for approval").
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin settings" on public.settings;
create policy "admin settings" on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Staff can add a new product (and its barcode) when it turns up at goods in.
drop policy if exists "staff add product" on public.products;
create policy "staff add product" on public.products for insert to authenticated with check (public.is_staff());
drop policy if exists "staff add barcode" on public.product_barcodes;
create policy "staff add barcode" on public.product_barcodes for insert to authenticated with check (public.is_staff());
drop policy if exists "staff add photo" on public.photos;
create policy "staff add photo" on public.photos for insert to authenticated with check (public.is_staff());

-- Staff record counts on open stock checks.
drop policy if exists "staff count" on public.stock_check_lines;
create policy "staff count" on public.stock_check_lines for update to authenticated
  using (public.is_staff() and exists (select 1 from public.stock_checks c where c.id = check_id and c.status = 'open'))
  with check (public.is_staff());

-- Managers can mark invoices paid / emailed, and edit purchase-order drafts.
drop policy if exists "manager invoices" on public.invoices;
create policy "manager invoices" on public.invoices for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists "manager checks" on public.stock_checks;
create policy "manager checks" on public.stock_checks for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ============================================================== storage (photos)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "staff read photos" on storage.objects;
create policy "staff read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_staff());
drop policy if exists "staff upload photos" on storage.objects;
create policy "staff upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_staff());

-- ============================================================== views
-- Average daily usage, reorder point and status for every product.
drop view if exists public.product_stock;
create view public.product_stock
with (security_invoker = true) as
with s as (select * from public.settings where id = 1),
usage as (
  select m.product_id, -sum(m.qty_change) as used
  from public.stock_movements m, s
  where m.type = 'dispatch' and m.created_at > now() - make_interval(days => s.usage_window_days)
  group by m.product_id
),
incoming as (
  select l.product_id, sum(greatest(l.qty_ordered - l.qty_received, 0)) as on_order,
         min(po.expected_at) as next_due
  from public.po_lines l join public.purchase_orders po on po.id = l.po_id
  where po.status in ('draft','sent','part_received')
  group by l.product_id
),
expiry as (
  select product_id, min(expiry_date) as next_expiry
  from public.stock_batches where qty_remaining > 0 and expiry_date is not null
  group by product_id
),
base as (
  select p.*,
    sup.name as supplier_name,
    coalesce(p.lead_time_days, sup.default_lead_time_days, 7) as lead_days,
    round(coalesce(u.used, 0) / s.usage_window_days, 3) as daily_usage,
    coalesce(i.on_order, 0) as on_order,
    i.next_due,
    e.next_expiry,
    s.safety_stock_days,
    case when p.sell_price > 0 and lc.landed > 0
         then round((p.sell_price / lc.landed - 1) * 100, 2)
         else coalesce(p.margin_pct, s.default_margin_pct) end as eff_margin_pct,
    coalesce(p.vat_rate, s.default_vat_rate) as eff_vat_rate,
    lg.name as stored_by_name,
    lc.logistics as logistics_unit_cost,
    lc.landed as landed_cost
  from public.products p
  cross join s
  left join public.suppliers sup on sup.id = p.supplier_id
  left join public.suppliers lg on lg.id = p.stored_by
  cross join lateral (select
      case when p.stored_by is not null then coalesce(p.logistics_cost, lg.logistics_cost_per_unit, 0) else 0 end as logistics,
      p.cost_price + case when p.stored_by is not null then coalesce(p.logistics_cost, lg.logistics_cost_per_unit, 0) else 0 end as landed) lc
  left join usage u on u.product_id = p.id
  left join incoming i on i.product_id = p.id
  left join expiry e on e.product_id = p.id
),
calc as (
  select b.*,
    coalesce(b.reorder_point,
      greatest(b.min_stock, ceil(b.daily_usage * (b.lead_days + b.safety_stock_days)))) as eff_reorder_point,
    case when b.daily_usage > 0 then round(b.qty_on_hand / b.daily_usage, 1) end as days_cover
  from base b
)
select c.*,
  coalesce(c.reorder_qty,
    greatest(1, ceil(c.daily_usage * 28 + c.eff_reorder_point - c.qty_on_hand - c.on_order))) as eff_reorder_qty,
  coalesce(nullif(c.sell_price, 0), round(c.landed_cost * (1 + c.eff_margin_pct / 100), 2)) as franchise_price,
  case
    when not c.active then 'inactive'
    when c.qty_on_hand <= 0 then 'out'
    when c.qty_on_hand + c.on_order <= c.eff_reorder_point then 'reorder'
    when c.qty_on_hand <= c.eff_reorder_point then 'on_order'
    else 'ok'
  end as stock_status
from calc c;

-- ============================================================== functions
create or replace function public.require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Your account is not active yet. Ask an admin to switch it on.'; end if;
end $$;

create or replace function public.require_manager() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only a manager or admin can do this.'; end if;
end $$;

-- Put the new product in the stock-check group with the fewest products.
create or replace function public.assign_check_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; g int;
begin
  if new.check_group is null then
    select check_cycle_weeks into n from public.settings where id = 1;
    select gs into g
    from generate_series(1, n) gs
    left join public.products p on p.check_group = gs and p.active
    group by gs order by count(p.id), gs limit 1;
    new.check_group := g;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_check_group on public.products;
create trigger products_check_group before insert or update on public.products
  for each row execute function public.assign_check_group();

-- Spread every active product evenly across the check groups again
-- (run after changing the number of weeks in the cycle).
create or replace function public.rebalance_check_groups() returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_manager();
  select check_cycle_weeks into n from public.settings where id = 1;
  with ranked as (
    select id, row_number() over (order by coalesce(category,''), name) as rn
    from public.products where active
  )
  update public.products p set check_group = ((r.rn - 1) % n) + 1
  from ranked r where r.id = p.id;
end $$;

-- Internal: move stock and write the ledger. Positive qty creates a batch;
-- negative qty consumes batches, earliest expiry first then oldest first.
create or replace function public._move_stock(
  p_product uuid, p_qty numeric, p_type text, p_ref uuid, p_ref_text text,
  p_store uuid default null, p_expiry date default null, p_cost numeric default null,
  p_batch_code text default null, p_source text default null, p_allow_negative boolean default false
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  on_hand numeric; left_to_take numeric; b record; take numeric; prod_name text;
begin
  select qty_on_hand, name into on_hand, prod_name from public.products where id = p_product for update;
  if not found then raise exception 'Product not found'; end if;

  if p_qty > 0 then
    insert into public.stock_batches (product_id, qty_received, qty_remaining, expiry_date, batch_code, cost_price, source, source_id)
    values (p_product, p_qty, p_qty, p_expiry, p_batch_code,
            coalesce(p_cost, (select cost_price from public.products where id = p_product)),
            coalesce(p_source, p_type), p_ref);
  elsif p_qty < 0 then
    if on_hand + p_qty < 0 and not p_allow_negative then
      raise exception 'Not enough % in stock: % on hand, % needed', prod_name, on_hand, -p_qty;
    end if;
    left_to_take := -p_qty;
    for b in
      select id, qty_remaining from public.stock_batches
      where product_id = p_product and qty_remaining > 0
      order by expiry_date nulls last, received_at
      for update
    loop
      exit when left_to_take <= 0;
      take := least(b.qty_remaining, left_to_take);
      update public.stock_batches set qty_remaining = qty_remaining - take where id = b.id;
      left_to_take := left_to_take - take;
    end loop;
  end if;

  update public.products set qty_on_hand = qty_on_hand + p_qty where id = p_product
  returning qty_on_hand into on_hand;

  insert into public.stock_movements (product_id, qty_change, qty_after, type, ref_id, ref_text, store_id, user_id)
  values (p_product, p_qty, on_hand, p_type, p_ref, p_ref_text, p_store, auth.uid());
  return on_hand;
end $$;
revoke all on function public._move_stock from public, anon, authenticated;

create or replace function public._add_photos(p_kind text, p_ref uuid, p_paths text[]) returns void
language sql security definer set search_path = public as $$
  insert into public.photos (kind, ref_id, path, taken_by)
  select p_kind, p_ref, x, auth.uid() from unnest(coalesce(p_paths, '{}')) x where x is not null and x <> '';
$$;
revoke all on function public._add_photos from public, anon, authenticated;

-- Price a product for a store.
-- "Cost" here is the landed cost: cost price + any logistics charge per unit.
--   company-owned store → cost, no margin
--   franchise store     → the store's agreed margin on cost, if it has one;
--                         otherwise the product's selling price, if set;
--                         otherwise cost + the product's margin (or the default)
create or replace function public.price_for(p_product uuid, p_store uuid)
returns table (unit_cost numeric, margin_pct numeric, unit_price numeric, vat_rate numeric)
language sql stable security definer set search_path = public as $$
  select lc.landed,
         case when pr.price is null or lc.landed <= 0 then 0
              else least(greatest(round((pr.price / lc.landed - 1) * 100, 2), -999), 9999) end,
         pr.price,
         coalesce(p.vat_rate, s.default_vat_rate)
  from public.products p
  cross join public.settings s
  cross join public.stores st
  left join public.suppliers lg on lg.id = p.stored_by
  cross join lateral (select p.cost_price + case when p.stored_by is not null
      then coalesce(p.logistics_cost, lg.logistics_cost_per_unit, 0) else 0 end as landed) lc
  cross join lateral (select case
      when st.type = 'company' then round(lc.landed, 2)
      when st.margin_pct is not null then round(lc.landed * (1 + st.margin_pct / 100), 2)
      when p.sell_price > 0 then p.sell_price
      else round(lc.landed * (1 + coalesce(p.margin_pct, s.default_margin_pct) / 100), 2)
    end as price) pr
  where p.id = p_product and st.id = p_store and s.id = 1 and public.is_staff()
$$;

-- ---------------------------------------------------------------- goods in
-- p_lines: [{product_id, qty, cost_price?, expiry_date?, batch_code?}]
create or replace function public.receive_goods(
  p_id uuid, p_supplier uuid, p_po uuid, p_delivery_ref text, p_notes text,
  p_lines jsonb, p_photo_paths text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare l jsonb; v_ref text; v_qty numeric; v_cost numeric; v_prod uuid; v_left numeric;
begin
  perform public.require_staff();
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Nothing to receive'; end if;

  insert into public.goods_in (id, supplier_id, po_id, delivery_note_ref, notes, received_by)
  values (coalesce(p_id, gen_random_uuid()), p_supplier, p_po, nullif(p_delivery_ref, ''), nullif(p_notes, ''), auth.uid())
  returning id, ref into p_id, v_ref;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_prod := (l->>'product_id')::uuid;
    v_qty  := (l->>'qty')::numeric;
    v_cost := nullif(l->>'cost_price', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;

    insert into public.goods_in_lines (goods_in_id, product_id, qty, cost_price, expiry_date, batch_code)
    values (p_id, v_prod, v_qty, v_cost, nullif(l->>'expiry_date', '')::date, nullif(l->>'batch_code', ''));

    -- latest delivery cost becomes the product's cost price
    if v_cost is not null and v_cost > 0 then
      update public.products set cost_price = v_cost where id = v_prod;
    end if;

    perform public._move_stock(v_prod, v_qty, 'goods_in', p_id, v_ref, null,
      nullif(l->>'expiry_date', '')::date, v_cost, nullif(l->>'batch_code', ''), 'goods_in');

    -- book it against the purchase order, oldest line first
    if p_po is not null then
      v_left := v_qty;
      update public.po_lines pl set qty_received = pl.qty_received + least(v_left, greatest(pl.qty_ordered - pl.qty_received, 0))
      where pl.id = (select id from public.po_lines where po_id = p_po and product_id = v_prod
                     order by (qty_ordered - qty_received) desc limit 1);
    end if;
  end loop;

  if p_po is not null then
    update public.purchase_orders po set status =
      case when not exists (select 1 from public.po_lines where po_id = p_po and qty_received < qty_ordered)
           then 'received' else 'part_received' end
    where po.id = p_po;
  end if;

  perform public._add_photos('goods_in', p_id, p_photo_paths);
  return p_id;
end $$;

-- ---------------------------------------------------------------- dispatch + invoice
-- p_lines: [{product_id, qty}]
create or replace function public.dispatch_stock(
  p_id uuid, p_store uuid, p_lines jsonb, p_method text, p_collected_by text,
  p_signature_path text, p_notes text, p_photo_paths text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st public.stores; s public.settings; l record; pr record; v_ref text;
  v_inv uuid := gen_random_uuid(); v_no text; v_net numeric; v_vat numeric;
  v_sub numeric := 0; v_vat_total numeric := 0;
begin
  perform public.require_staff();
  select * into st from public.stores where id = p_store and active;
  if not found then raise exception 'Choose a store'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Scan at least one item'; end if;

  select * into s from public.settings where id = 1 for update;  -- locks the invoice counter
  if s.require_dispatch_photo and coalesce(array_length(p_photo_paths, 1), 0) = 0 then
    raise exception 'Take at least one photo of the stock going out';
  end if;

  insert into public.dispatches (id, store_id, method, collected_by_name, signature_path, notes, dispatched_by)
  values (coalesce(p_id, gen_random_uuid()), p_store, coalesce(p_method, 'collection'),
          nullif(p_collected_by, ''), nullif(p_signature_path, ''), nullif(p_notes, ''), auth.uid())
  returning id, ref into p_id, v_ref;

  v_no := s.invoice_prefix || s.next_invoice_no;
  update public.settings set next_invoice_no = next_invoice_no + 1 where id = 1;

  insert into public.invoices (id, number, store_id, dispatch_id, store_name, store_address, store_email,
    store_type, due_date, subtotal, vat_total, total, created_by)
  values (v_inv, v_no, p_store, p_id, st.name, st.address, st.email, st.type,
    current_date + coalesce(st.payment_terms_days, s.payment_terms_days), 0, 0, 0, auth.uid());

  -- merge duplicate scans of the same product
  for l in
    select (x->>'product_id')::uuid as product_id, sum((x->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) x group by 1
  loop
    if l.qty is null or l.qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
    select * into pr from public.price_for(l.product_id, p_store);
    insert into public.dispatch_lines (dispatch_id, product_id, qty, unit_cost, unit_price, margin_pct, vat_rate)
    values (p_id, l.product_id, l.qty, pr.unit_cost, pr.unit_price, pr.margin_pct, pr.vat_rate);

    v_net := round(l.qty * pr.unit_price, 2);
    v_vat := round(v_net * pr.vat_rate / 100, 2);
    v_sub := v_sub + v_net; v_vat_total := v_vat_total + v_vat;
    insert into public.invoice_lines (invoice_id, product_id, sku, description, qty, unit_price, vat_rate, net, vat)
    select v_inv, p.id, p.sku, p.name || coalesce(' (' || nullif(p.pack_size, '') || ')', ''),
           l.qty, pr.unit_price, pr.vat_rate, v_net, v_vat
    from public.products p where p.id = l.product_id;

    perform public._move_stock(l.product_id, -l.qty, 'dispatch', p_id, v_ref, p_store);
  end loop;

  update public.invoices set subtotal = v_sub, vat_total = v_vat_total, total = v_sub + v_vat_total where id = v_inv;
  update public.dispatches set invoice_id = v_inv where id = p_id;

  perform public._add_photos('dispatch', p_id, p_photo_paths);
  if nullif(p_signature_path, '') is not null then
    perform public._add_photos('signature', p_id, array[p_signature_path]);
  end if;
  return jsonb_build_object('dispatch_id', p_id, 'dispatch_ref', v_ref, 'invoice_id', v_inv, 'invoice_number', v_no);
end $$;

-- Void an invoice. If the goods came back, put them back into stock.
create or replace function public.void_invoice(p_invoice uuid, p_reason text, p_restock boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; l record;
begin
  perform public.require_manager();
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status = 'void' then raise exception 'Invoice is already void'; end if;
  update public.invoices set status = 'void', void_reason = nullif(p_reason, '') where id = p_invoice;
  if p_restock and inv.dispatch_id is not null then
    for l in select product_id, qty, unit_cost from public.dispatch_lines where dispatch_id = inv.dispatch_id loop
      perform public._move_stock(l.product_id, l.qty, 'void_return', inv.id, inv.number || ' void',
        inv.store_id, null, l.unit_cost, null, 'return');
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------- adjustments
create or replace function public.adjust_stock(
  p_id uuid, p_product uuid, p_qty_change numeric, p_reason text, p_notes text,
  p_expiry date, p_photo_paths text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  if p_reason in ('found','correction','opening_stock') then perform public.require_manager(); end if;
  insert into public.adjustments (id, product_id, qty_change, reason, notes, expiry_date, user_id)
  values (coalesce(p_id, gen_random_uuid()), p_product, p_qty_change, p_reason, nullif(p_notes, ''), p_expiry, auth.uid())
  returning id into p_id;
  perform public._move_stock(p_product, p_qty_change, 'adjustment', p_id, p_reason, null, p_expiry, null, null, 'adjustment');
  perform public._add_photos('adjustment', p_id, p_photo_paths);
  return p_id;
end $$;

-- ---------------------------------------------------------------- weekly stock check
-- Monday (or the configured day) of the week containing p_date.
create or replace function public.check_week_start(p_date date) returns date
language sql stable set search_path = public as $$
  select p_date - ((extract(isodow from p_date)::int - s.check_day + 7) % 7)
  from public.settings s where s.id = 1
$$;

-- Which group is due in a given week: weeks since 2024-01-01, mod cycle length.
create or replace function public.check_group_for(p_week date) returns int
language sql stable set search_path = public as $$
  select (((p_week - date '2024-01-01') / 7) % s.check_cycle_weeks) + 1
  from public.settings s where s.id = 1
$$;

-- Who is on the rota for a given week: active staff in the rota, in name order.
create or replace function public.check_assignee_for(p_week date) returns uuid
language sql stable security definer set search_path = public as $$
  with r as (
    select id, row_number() over (order by lower(coalesce(full_name, email)), id) - 1 as i, count(*) over () as n
    from public.profiles where active and in_check_rota
  )
  select id from r where i = ((p_week - date '2024-01-01') / 7) % n
$$;

-- The rota for the next p_weeks weeks.
create or replace function public.check_rota(p_weeks int default 8)
returns table (week_start date, check_group int, assigned_to uuid, assigned_name text, product_count bigint, check_id uuid, status text)
language sql stable security definer set search_path = public as $$
  with w as (
    select public.check_week_start(current_date) + 7 * g as wk from generate_series(0, greatest(p_weeks, 1) - 1) g
  )
  select w.wk, public.check_group_for(w.wk),
         coalesce(c.assigned_to, public.check_assignee_for(w.wk)),
         (select coalesce(full_name, email) from public.profiles where id = coalesce(c.assigned_to, public.check_assignee_for(w.wk))),
         case when c.id is not null then (select count(*) from public.stock_check_lines where check_id = c.id)
              else (select count(*) from public.products p where p.active and (p.check_every_week or p.check_group = public.check_group_for(w.wk))) end,
         c.id, coalesce(c.status, 'not started')
  from w left join public.stock_checks c on c.week_start = w.wk and c.kind = 'weekly'
  where public.is_staff()
  order by w.wk
$$;

-- Create (or return) this week's stock check: the group due this week plus
-- every product flagged "check every week", plus anything with a variance
-- in last week's approved count.
create or replace function public.start_stock_check(p_date date default current_date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_week date; v_id uuid; v_group int;
begin
  perform public.require_staff();
  v_week := public.check_week_start(p_date);
  select id into v_id from public.stock_checks where week_start = v_week and kind = 'weekly';
  if v_id is not null then return v_id; end if;

  v_group := public.check_group_for(v_week);
  insert into public.stock_checks (week_start, assigned_to)
  values (v_week, public.check_assignee_for(v_week))
  returning id into v_id;

  insert into public.stock_check_lines (check_id, product_id)
  select v_id, p.id from public.products p
  where p.active and (
    p.check_every_week or p.check_group = v_group
    or p.id in (select l.product_id from public.stock_check_lines l
                join public.stock_checks c on c.id = l.check_id
                where c.week_start = v_week - 7 and c.status = 'approved'
                  and l.counted_qty is distinct from l.expected_qty)
  )
  on conflict do nothing;
  return v_id;
end $$;

-- Record one count. Saves the system qty at the moment of counting.
create or replace function public.record_count(p_check uuid, p_product uuid, p_counted numeric, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  perform public.require_staff();
  select status into st from public.stock_checks where id = p_check;
  if st is distinct from 'open' then raise exception 'This stock check is closed'; end if;
  insert into public.stock_check_lines (check_id, product_id, expected_qty, counted_qty, counted_by, counted_at, note)
  select p_check, p_product, qty_on_hand, p_counted, auth.uid(), now(), nullif(p_note, '')
  from public.products where id = p_product
  on conflict (check_id, product_id) do update
    set expected_qty = excluded.expected_qty, counted_qty = excluded.counted_qty,
        counted_by = excluded.counted_by, counted_at = excluded.counted_at,
        note = coalesce(excluded.note, public.stock_check_lines.note);
end $$;

create or replace function public.submit_stock_check(p_check uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  if exists (select 1 from public.stock_check_lines where check_id = p_check and counted_qty is null) then
    raise exception 'Some products have not been counted yet';
  end if;
  update public.stock_checks set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
  where id = p_check and status = 'open';
  if not found then raise exception 'This stock check is not open'; end if;
end $$;

-- Manager approves: every variance is posted as a stock-check adjustment.
-- The variance is worked out against the qty at the time of counting, so
-- stock that moved after the count isn't double counted.
create or replace function public.approve_stock_check(p_check uuid) returns int
language plpgsql security definer set search_path = public as $$
declare l record; n int := 0; v_ref text;
begin
  perform public.require_manager();
  select 'Stock check w/c ' || to_char(week_start, 'DD Mon YYYY') into v_ref
  from public.stock_checks where id = p_check and status = 'submitted' for update;
  if not found then raise exception 'Only a submitted stock check can be approved'; end if;
  for l in
    select product_id, counted_qty - expected_qty as diff from public.stock_check_lines
    where check_id = p_check and counted_qty is not null and counted_qty <> expected_qty
  loop
    perform public._move_stock(l.product_id, l.diff, 'stock_check', p_check, v_ref, null,
      null, null, null, 'stock_check', true);
    n := n + 1;
  end loop;
  update public.stock_checks set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_check;
  return n;
end $$;

-- Send a counted stock check back to be recounted.
create or replace function public.reopen_stock_check(p_check uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  update public.stock_checks set status = 'open', submitted_at = null, submitted_by = null
  where id = p_check and status = 'submitted';
  if not found then raise exception 'Only a submitted stock check can be reopened'; end if;
end $$;

-- ---------------------------------------------------------------- full stock take
-- Count every active product, one by one, in stock-take sheet order.
-- Returns the open full stock take, or starts a new one.
create or replace function public.start_full_stock_take() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_staff();
  select id into v_id from public.stock_checks where kind = 'full' and status = 'open'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.stock_checks where kind = 'full' and week_start = current_date) then
    raise exception 'A full stock take has already been done today';
  end if;
  insert into public.stock_checks (week_start, kind, assigned_to)
  values (current_date, 'full', auth.uid()) returning id into v_id;
  insert into public.stock_check_lines (check_id, product_id)
  select v_id, id from public.products where active;
  return v_id;
end $$;

-- One item in the full stock take: the count, plus (optionally) a photo of
-- the product and its barcode, which are saved against the product.
create or replace function public.stocktake_record(
  p_check uuid, p_product uuid, p_counted numeric, p_barcode text, p_photo_path text
) returns void
language plpgsql security definer set search_path = public as $$
declare other text;
begin
  perform public.require_staff();
  if nullif(trim(p_barcode), '') is not null then
    select pr.name into other from public.product_barcodes b join public.products pr on pr.id = b.product_id
    where b.barcode = trim(p_barcode) and b.product_id <> p_product;
    if other is not null then raise exception 'That barcode is already linked to %', other; end if;
    insert into public.product_barcodes (barcode, product_id) values (trim(p_barcode), p_product)
    on conflict (barcode) do nothing;
  end if;
  if nullif(p_photo_path, '') is not null then
    perform public._add_photos('product', p_product, array[p_photo_path]);
    update public.products set photo_path = p_photo_path where id = p_product and photo_path is null;
  end if;
  if p_counted is not null then
    perform public.record_count(p_check, p_product, p_counted, null);
  end if;
end $$;

-- ---------------------------------------------------------------- dashboard
create or replace function public.dashboard_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else jsonb_build_object(
    'products',       (select count(*) from public.products where active),
    'stock_value',    (select coalesce(sum(qty_on_hand * cost_price), 0) from public.products where active and qty_on_hand > 0),
    'out_of_stock',   (select count(*) from public.product_stock where stock_status = 'out'),
    'to_reorder',     (select count(*) from public.product_stock where stock_status in ('out','reorder') and on_order = 0),
    'on_order',       (select count(*) from public.purchase_orders where status in ('sent','part_received')),
    'overdue_pos',    (select count(*) from public.purchase_orders where status in ('sent','part_received') and expected_at < current_date),
    'expiring',       (select count(distinct b.product_id) from public.stock_batches b, public.settings s
                         where s.id = 1 and b.qty_remaining > 0 and b.expiry_date <= current_date + s.expiry_warning_days),
    'unpaid_total',   (select coalesce(sum(total), 0) from public.invoices where status = 'unpaid'),
    'overdue_total',  (select coalesce(sum(total), 0) from public.invoices where status = 'unpaid' and due_date < current_date),
    'dispatched_7d',  (select coalesce(sum(total), 0) from public.invoices where status <> 'void' and issue_date > current_date - 7),
    'pending_users',  (select count(*) from public.profiles where not active)
  ) end
$$;

-- Functions: signed-in users only, never anonymous visitors. The two
-- internal helpers can only be called from inside the functions above.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._move_stock, public._add_photos from authenticated;

-- ==================================================================
-- STORES: SAFETY CHECKS, EHO RECORDS, RECIPES AND OPERATIONS MANUAL
-- ==================================================================
-- Roles
--   admin / manager  head office: see every store, edit checklists, recipes, manual
--   staff            warehouse staff (stock tools only)
--   store_manager    a store's manager: daily checks, records, recipes, store team
--   store            a shared store device: daily checks, recipes, manual
--   inspector        Environmental Health Officer: read-only records for one store,
--                    until access_expires_at
alter table public.profiles add column if not exists store_id uuid references public.stores(id);
alter table public.profiles add column if not exists access_expires_at timestamptz;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','manager','staff','store_manager','store','inspector'));

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and active and (access_expires_at is null or access_expires_at > now())
$$;

-- Warehouse and head-office people only: store accounts and inspectors
-- never see stock, costs, suppliers or invoices.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','manager','staff'), false)
$$;

create or replace function public.my_store() returns uuid
language sql stable security definer set search_path = public as $$
  select store_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

-- Can see a store's safety records.
create or replace function public.can_view_store(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    when public.my_role() in ('store_manager','store','inspector') then p_store = public.my_store()
    else false end
$$;

-- Can carry out checks for a store.
create or replace function public.can_check_store(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    when public.my_role() in ('store_manager','store') then p_store = public.my_store()
    else false end
$$;

-- Can manage a store's team (names and PINs).
create or replace function public.can_manage_team(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (public.my_role() = 'store_manager' and p_store = public.my_store())
$$;

-- Everyone signed in can read the company details (shown on printed records).
drop policy if exists "active read settings" on public.settings;
create policy "active read settings" on public.settings for select to authenticated using (public.is_active_user());

-- Store people can see their own store (name, address).
drop policy if exists "store sees own store" on public.stores;
create policy "store sees own store" on public.stores for select to authenticated
  using (public.can_view_store(id));

-- ---------------------------------------------------------------- store team
create table if not exists public.staff_members (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id),
  name        text not null,
  role_title  text,                      -- e.g. Barista, Kitchen, Supervisor
  pin_hash    text,                      -- bcrypt of the 4-digit PIN; never sent to the browser
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon, authenticated;
grant select (id, store_id, name, role_title, active, created_at) on public.staff_members to authenticated;
drop policy if exists "view team" on public.staff_members;
create policy "view team" on public.staff_members for select to authenticated using (public.can_view_store(store_id));

create or replace function public.save_staff_member(p_id uuid, p_store uuid, p_name text, p_role_title text,
  p_pin text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_id;
begin
  if not public.can_manage_team(p_store) then raise exception 'Only a manager can change the store team'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Enter a name'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4}$' then raise exception 'The PIN must be 4 numbers'; end if;
  if v_id is null then
    if p_pin is null then raise exception 'Choose a 4-number PIN'; end if;
    insert into public.staff_members (store_id, name, role_title, pin_hash, active)
    values (p_store, trim(p_name), nullif(trim(p_role_title), ''), crypt(p_pin, gen_salt('bf')), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.staff_members set name = trim(p_name), role_title = nullif(trim(p_role_title), ''),
      active = coalesce(p_active, active),
      pin_hash = case when p_pin is null then pin_hash else crypt(p_pin, gen_salt('bf')) end
    where id = v_id and store_id = p_store;
    if not found then raise exception 'Team member not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.check_pin(p_staff uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare m record;
begin
  select * into m from public.staff_members where id = p_staff and active;
  if not found or not public.can_check_store(m.store_id) then return false; end if;
  return m.pin_hash = crypt(coalesce(p_pin, ''), m.pin_hash);
end $$;

-- ---------------------------------------------------------------- checklists
create table if not exists public.check_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  kind              text not null default 'daily' check (kind in ('daily','monthly')),
  description       text,
  icon              text,
  min_seconds       numeric not null default 3,   -- quicker than this per question = "rushed"
  manager_only      boolean not null default false, -- e.g. the monthly management audit
  sort_order        int not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists public.check_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.check_templates(id) on delete cascade,
  sort_order   int not null default 0,
  section      text,
  question     text not null,
  help         text,
  kind         text not null default 'yes_no' check (kind in ('yes_no','temperature','number','text')),
  expected     text not null default 'yes',      -- yes_no: the safe answer
  min_value    numeric,                           -- temperature / number: safe range
  max_value    numeric,
  critical     boolean not null default false,
  actions      text[] not null default '{}',      -- what to do if it fails
  active       boolean not null default true,
  unique (template_id, question)
);

create table if not exists public.check_runs (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references public.check_templates(id),
  template_name    text not null,
  store_id         uuid not null references public.stores(id),
  staff_member_id  uuid references public.staff_members(id),
  profile_id       uuid references public.profiles(id),
  done_by          text not null,
  started_at       timestamptz not null default now(),
  last_at          timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'in_progress' check (status in ('in_progress','complete','abandoned')),
  total_items      int not null default 0,
  answered         int not null default 0,
  passed           int not null default 0,
  failed           int not null default 0,
  critical_failed  int not null default 0,
  rushed_items     int not null default 0,
  rushed           boolean not null default false,
  duration_seconds int,
  score            numeric(5,1)
);
create index if not exists check_runs_store_day on public.check_runs (store_id, started_at desc);

create table if not exists public.check_answers (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.check_runs(id) on delete cascade,
  item_id           uuid references public.check_items(id) on delete set null,
  sort_order        int,
  section           text,
  question          text not null,
  kind              text not null,
  answer            text,
  value             numeric,
  ok                boolean not null,
  critical          boolean not null default false,
  corrective_action text,
  note              text,
  photo_path        text,
  seconds           numeric,
  rushed            boolean not null default false,
  answered_at       timestamptz not null default now(),
  unique (run_id, item_id)
);

alter table public.check_templates enable row level security;
alter table public.check_items enable row level security;
alter table public.check_runs enable row level security;
alter table public.check_answers enable row level security;
drop policy if exists "read checklists" on public.check_templates;
create policy "read checklists" on public.check_templates for select to authenticated using (public.is_active_user());
drop policy if exists "manage checklists" on public.check_templates;
create policy "manage checklists" on public.check_templates for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "read checklist items" on public.check_items;
create policy "read checklist items" on public.check_items for select to authenticated using (public.is_active_user());
drop policy if exists "manage checklist items" on public.check_items;
create policy "manage checklist items" on public.check_items for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "view runs" on public.check_runs;
create policy "view runs" on public.check_runs for select to authenticated using (public.can_view_store(store_id));
drop policy if exists "view answers" on public.check_answers;
create policy "view answers" on public.check_answers for select to authenticated
  using (exists (select 1 from public.check_runs r where r.id = run_id and public.can_view_store(r.store_id)));

-- Start a check. Store staff pick their name and type their PIN; head-office
-- managers (e.g. the monthly audit) sign with their own login.
create or replace function public.start_check(p_template uuid, p_store uuid, p_staff uuid, p_pin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t record; v_by text; v_run uuid; v_items int;
begin
  select * into t from public.check_templates where id = p_template and active;
  if not found then raise exception 'Checklist not found'; end if;
  if not public.can_check_store(p_store) then raise exception 'You can''t do checks for this store'; end if;
  if t.manager_only and public.my_role() not in ('admin','manager','store_manager') then
    raise exception 'Only a manager can do the %', t.name;
  end if;
  if p_staff is not null then
    if not public.check_pin(p_staff, p_pin) then raise exception 'Wrong PIN, try again'; end if;
    select name into v_by from public.staff_members where id = p_staff and store_id = p_store;
    if v_by is null then raise exception 'That person isn''t in this store''s team'; end if;
  else
    select coalesce(full_name, email) into v_by from public.profiles where id = auth.uid();
  end if;
  select count(*) into v_items from public.check_items where template_id = p_template and active;
  -- leaving a check half way through abandons it
  update public.check_runs set status = 'abandoned'
    where template_id = p_template and store_id = p_store and status = 'in_progress';
  insert into public.check_runs (template_id, template_name, store_id, staff_member_id, profile_id, done_by, total_items)
  values (p_template, t.name, p_store, p_staff, auth.uid(), v_by, v_items)
  returning id into v_run;
  return v_run;
end $$;

-- Record one answer. The time taken is measured here on the server, from the
-- previous answer (or the start), so it can't be faked by the device.
create or replace function public.answer_check(p_run uuid, p_item uuid, p_answer text, p_value numeric,
  p_action text default null, p_note text default null, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; i record; t record; v_ok boolean; v_secs numeric; v_min numeric; v_prev record;
begin
  select * into r from public.check_runs where id = p_run for update;
  if not found or r.status <> 'in_progress' then raise exception 'This check has already finished'; end if;
  if not public.can_check_store(r.store_id) then raise exception 'You can''t do checks for this store'; end if;
  select * into i from public.check_items where id = p_item and template_id = r.template_id;
  if not found then raise exception 'Question not found'; end if;
  select * into t from public.check_templates where id = r.template_id;

  v_ok := case i.kind
    when 'yes_no' then lower(coalesce(p_answer, '')) = lower(i.expected)
    when 'text'   then nullif(trim(coalesce(p_answer, '')), '') is not null
    else p_value is not null and (i.min_value is null or p_value >= i.min_value) and (i.max_value is null or p_value <= i.max_value)
  end;
  select * into v_prev from public.check_answers where run_id = p_run and item_id = p_item;
  if found then
    -- second call for the same question = adding what was done about a problem
    update public.check_answers set corrective_action = coalesce(nullif(trim(p_action), ''), corrective_action),
      note = coalesce(nullif(trim(p_note), ''), note), photo_path = coalesce(p_photo, photo_path)
    where id = v_prev.id;
  else
    if i.kind in ('temperature','number') and p_value is null then raise exception 'Enter the reading'; end if;
    v_secs := round(extract(epoch from now() - r.last_at)::numeric, 1);
    v_min := t.min_seconds * case when i.kind in ('temperature','number') then 2 else 1 end;
    insert into public.check_answers (run_id, item_id, sort_order, section, question, kind, answer, value, ok, critical,
      corrective_action, note, photo_path, seconds, rushed)
    values (p_run, p_item, i.sort_order, i.section, i.question, i.kind, p_answer, p_value, v_ok, i.critical,
      nullif(trim(p_action), ''), nullif(trim(p_note), ''), p_photo, v_secs, v_secs < v_min);
    update public.check_runs set last_at = now(), answered = answered + 1 where id = p_run;
  end if;
  if v_prev.id is not null then v_ok := v_prev.ok; end if;
  return jsonb_build_object('ok', v_ok, 'critical', i.critical,
    'needs_action', not v_ok and nullif(trim(coalesce(p_action, '')), '') is null and v_prev.corrective_action is null,
    'actions', to_jsonb(i.actions));
end $$;

create or replace function public.finish_check(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; t record; a record; v_dur int;
begin
  select * into r from public.check_runs where id = p_run for update;
  if not found or r.status <> 'in_progress' then raise exception 'This check has already finished'; end if;
  if not public.can_check_store(r.store_id) then raise exception 'You can''t do checks for this store'; end if;
  select * into t from public.check_templates where id = r.template_id;
  select count(*) n, count(*) filter (where ok) passed, count(*) filter (where not ok) failed,
         count(*) filter (where not ok and critical) crit, count(*) filter (where rushed) rushed,
         count(*) filter (where not ok and corrective_action is null) unfixed
    into a from public.check_answers where run_id = p_run;
  if a.n < r.total_items then raise exception 'There are still % questions to answer', r.total_items - a.n; end if;
  if a.unfixed > 0 then raise exception 'Say what was done about every problem before finishing'; end if;
  v_dur := extract(epoch from now() - r.started_at)::int;
  update public.check_runs set status = 'complete', finished_at = now(), duration_seconds = v_dur,
    answered = a.n, passed = a.passed, failed = a.failed, critical_failed = a.crit, rushed_items = a.rushed,
    -- rushed: a third or more of the answers were too quick, or the whole check was
    rushed = (a.n > 0 and (a.rushed * 3 >= a.n or v_dur < a.n * t.min_seconds)),
    score = case when a.n = 0 then null else round(100.0 * a.passed / a.n, 1) end
  where id = p_run
  returning * into r;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------- recipe cards
create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  category      text not null default 'Other',
  description   text,
  price         numeric(8,2),
  allergens     text[] not null default '{}',     -- the 14 UK allergens it contains
  allergens_confirmed boolean not null default false, -- ticked once checked against the supplier's product specification
  dietary       text[] not null default '{}',     -- V, VG, Halal…
  portion       text,
  ingredients   jsonb not null default '[]',      -- [{name, qty, code}]  (code = Brakes product code)
  method        text,                             -- one step per line
  plating       text,                             -- how it should look; one point per line
  hold_notes    text,                             -- holding / shelf life / reheating
  photo_path    text,
  sort_order    int not null default 0,
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.recipes enable row level security;
drop policy if exists "read recipes" on public.recipes;
create policy "read recipes" on public.recipes for select to authenticated using (public.is_active_user());
drop policy if exists "manage recipes" on public.recipes;
create policy "manage recipes" on public.recipes for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------- operations manual
create table if not exists public.manual_pages (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,
  title       text not null,
  body        text not null default '',
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (section, title)
);
alter table public.manual_pages enable row level security;
drop policy if exists "read manual" on public.manual_pages;
create policy "read manual" on public.manual_pages for select to authenticated using (public.is_active_user());
drop policy if exists "manage manual" on public.manual_pages;
create policy "manage manual" on public.manual_pages for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Photos: store people can upload check photos, and read check and recipe photos.
drop policy if exists "store read photos" on storage.objects;
create policy "store read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_active_user() and (name like 'checks/%' or name like 'recipes/%'));
drop policy if exists "store upload check photos" on storage.objects;
create policy "store upload check photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.my_role() in ('store_manager','store') and name like 'checks/%');

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._move_stock, public._add_photos from authenticated;

-- A tiny check-in the daily keep-alive job calls, so the free database is
-- never paused for inactivity. It reveals nothing.
create or replace function public.keep_alive() returns text
language sql stable set search_path = public as $$ select 'ok ' || now()::date $$;
grant execute on function public.keep_alive() to anon;

