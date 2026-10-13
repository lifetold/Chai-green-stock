// Products & stock levels.
import { sb, q, state, html, raw, money, num, date, badge, hydratePhotos, downloadCsv, isManager, isoDate, addDays, fail } from '../lib.js';
import { thumb } from '../widgets.js';

export async function render(main) {
  const filt = new URLSearchParams(location.hash.split('?')[1] || '');
  const rows = await q(sb.from('product_stock').select('*').order('name'));
  const cats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
  const mgr = isManager();

  main.innerHTML = html`
    <div class="page-head"><div><h1>Products &amp; stock</h1><p class="muted">${rows.filter(r => r.active).length} products</p></div>
      <div class="btn-row"><button class="btn" data-csv>Export CSV</button>
      ${mgr ? html`<a class="btn primary" href="#/product/new">+ New product</a>` : ''}</div></div>
    <div class="card"><div class="grid three">
      <label>Search<input type="search" name="q" placeholder="Name, SKU, location…"></label>
      <label>Show<select name="status">
        <option value="">All active</option><option value="attention">Needs attention</option><option value="out">Out of stock</option>
        <option value="reorder">Below reorder level</option><option value="expiring">Going out of date</option><option value="inactive">Inactive</option></select></label>
      <label>Category<select name="cat"><option value="">All</option>${cats.map(c => html`<option>${c}</option>`)}</select></label>
    </div></div>
    <div class="card"><div class="table-wrap" data-list></div></div>`;

  const $ = s => main.querySelector(s);
  $('[name=status]').value = filt.get('status') || '';
  const soon = isoDate(addDays(new Date(), state.settings.expiry_warning_days));
  let shown = [];

  function draw() {
    const term = $('[name=q]').value.trim().toLowerCase();
    const st = $('[name=status]').value;
    const cat = $('[name=cat]').value;
    shown = rows.filter(r => {
      if (st === 'inactive') { if (r.active) return false; } else if (!r.active) return false;
      if (st === 'out' && r.stock_status !== 'out') return false;
      if (st === 'reorder' && !['out', 'reorder', 'on_order'].includes(r.stock_status)) return false;
      if (st === 'attention' && r.stock_status === 'ok' && !(r.next_expiry && r.next_expiry <= soon)) return false;
      if (st === 'expiring' && !(r.next_expiry && r.next_expiry <= soon)) return false;
      if (cat && r.category !== cat) return false;
      if (term && ![r.name, r.sku, r.location, r.category, r.supplier_name].some(v => (v || '').toLowerCase().includes(term))) return false;
      return true;
    });
    const value = shown.reduce((a, r) => a + Math.max(0, r.qty_on_hand) * r.cost_price, 0);
    $('[data-list]').innerHTML = shown.length ? html`<table>
      <thead><tr><th></th><th>Product</th><th>Location</th><th class="num">In stock</th><th class="num">Reorder at</th>
        <th class="num">On order</th><th class="num">Days cover</th><th class="num">Lead time</th>
        ${mgr ? html`<th class="num">Cost</th><th class="num">Franchise price</th>` : ''}<th>Status</th></tr></thead>
      <tbody>${shown.map(r => html`<tr class="click" data-id="${r.id}">
        <td>${thumb(r)}</td>
        <td><b>${r.name}</b><br><small>${[r.sku, r.pack_size, r.category].filter(Boolean).join(' · ')}</small></td>
        <td>${r.location || ''}</td>
        <td class="num"><b>${num(r.qty_on_hand)}</b> ${r.unit}</td>
        <td class="num">${num(r.eff_reorder_point)}${r.reorder_point == null ? html`<br><small>auto</small>` : ''}</td>
        <td class="num">${r.on_order ? num(r.on_order) : ''}</td>
        <td class="num">${r.days_cover == null ? '—' : num(r.days_cover)}</td>
        <td class="num">${r.lead_days}d</td>
        ${mgr ? html`<td class="num">${money(r.cost_price)}</td><td class="num">${money(r.franchise_price)}<br><small>${num(r.eff_margin_pct)}%</small></td>` : ''}
        <td>${badge(r.stock_status)}${r.next_expiry && r.next_expiry <= soon ? html`<br>${badge('warn', 'Use by ' + date(r.next_expiry))}` : ''}</td></tr>`)}</tbody>
      ${mgr ? html`<tfoot><tr><td colspan="8">${shown.length} products · stock value at cost</td><td class="num" colspan="2"><b>${money(value)}</b></td><td></td></tr></tfoot>` : ''}
      </table>` : html`<div class="empty">No products match. ${mgr && !rows.length ? html`<a href="#/product/new">Add your first product</a> or scan one in at <a href="#/goods-in">Goods in</a>.` : ''}</div>`;
    main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/product/' + tr.dataset.id; });
    hydratePhotos($('[data-list]'));
  }
  let t;
  $('[name=q]').oninput = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  $('[name=status]').onchange = draw;
  $('[name=cat]').onchange = draw;
  draw();

  $('[data-csv]').onclick = () => downloadCsv(`chai-green-stock-${isoDate(new Date())}.csv`, [
    ['SKU', 'Product', 'Category', 'Pack size', 'Unit', 'Location', 'Supplier', 'In stock', 'Reorder point', 'Reorder qty', 'On order',
      'Avg daily use', 'Days cover', 'Lead time (days)', 'Cost', 'Franchise margin %', 'Franchise price', 'Stock value', 'Status', 'Next use-by'],
    ...shown.map(r => [r.sku, r.name, r.category, r.pack_size, r.unit, r.location, r.supplier_name, r.qty_on_hand, r.eff_reorder_point,
      r.eff_reorder_qty, r.on_order, r.daily_usage, r.days_cover, r.lead_days, r.cost_price, r.eff_margin_pct, r.franchise_price,
      (Math.max(0, r.qty_on_hand) * r.cost_price).toFixed(2), r.stock_status, r.next_expiry])
  ]);
}
