// Reorder: everything at or below its reorder level, grouped by supplier,
// turned into purchase orders in one go.
import { sb, q, state, html, money, num, date, badge, busy, fail, toast, isManager, isoDate, addDays } from '../lib.js';
import { refreshCounts } from '../app.js';

export async function render(main, params) {
  const all = await q(sb.from('product_stock').select('*').eq('active', true).order('name'));
  const extra = params[0];  // "order more" from a product page
  const rows = all.filter(r => ['out', 'reorder'].includes(r.stock_status) || r.id === extra);
  const mgr = isManager();
  const groups = {};
  rows.forEach(r => { (groups[r.supplier_id || 'none'] ||= { name: r.supplier_name || 'No supplier set', items: [] }).items.push(r); });

  main.innerHTML = html`
    <div class="page-head"><div><h1>Reorder</h1>
      <p class="muted">Products at or below their reorder level that aren't already on order. Expected delivery = today + lead time.</p></div>
      <a class="btn" href="#/purchase-orders">Purchase orders</a></div>
    ${!mgr ? html`<div class="notice">Ask a manager to place these orders.</div>` : ''}
    ${rows.length ? Object.entries(groups).map(([sid, g]) => html`
      <div class="card" data-sup="${sid}"><h2>${g.name}</h2>
        <div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th class="num">In stock</th><th class="num">Reorder at</th>
          <th class="num">Use / day</th><th class="num">Lead time</th><th class="num">Arrives</th><th class="num">Order qty</th><th class="num">Cost</th></tr></thead>
        <tbody>${g.items.map(r => html`<tr>
          <td><input type="checkbox" data-pick="${r.id}" checked ${mgr && sid !== 'none' ? '' : 'disabled'}></td>
          <td><a href="#/product/${r.id}">${r.name}</a> ${badge(r.stock_status)}<br><small>${r.pack_size || ''} ${r.supplier_code ? '· code ' + r.supplier_code : ''}</small></td>
          <td class="num">${num(r.qty_on_hand)}</td><td class="num">${num(r.eff_reorder_point)}</td><td class="num">${num(r.daily_usage)}</td>
          <td class="num">${r.lead_days}d</td><td class="num">${date(addDays(new Date(), r.lead_days))}</td>
          <td class="num"><input class="qty-input" type="number" min="0" step="any" data-qty="${r.id}" value="${r.eff_reorder_qty}" ${mgr ? '' : 'disabled'}></td>
          <td class="num">${money(r.cost_price)}</td></tr>`)}</tbody></table></div>
        ${sid === 'none' ? html`<p class="muted">Set a supplier on these products to order them.</p>`
          : mgr ? html`<p><button class="btn primary" data-order="${sid}">Create purchase order</button></p>` : ''}
      </div>`) : html`<div class="card empty">Nothing needs reordering right now. 👍</div>`}`;

  main.querySelectorAll('[data-order]').forEach(btn => btn.onclick = () => busy(btn, async () => {
    const sid = btn.dataset.order;
    const card = main.querySelector(`[data-sup="${sid}"]`);
    const items = groups[sid].items
      .filter(r => card.querySelector(`[data-pick="${r.id}"]`).checked)
      .map(r => ({ r, qty: Number(card.querySelector(`[data-qty="${r.id}"]`).value) }))
      .filter(x => x.qty > 0);
    if (!items.length) return toast('Tick at least one product with a quantity.', 'bad');
    try {
      const lead = Math.max(...items.map(x => x.r.lead_days));
      const po = await q(sb.from('purchase_orders').insert({
        supplier_id: sid, status: 'draft', expected_at: isoDate(addDays(new Date(), lead)), created_by: state.profile.id
      }).select('id').single());
      await q(sb.from('po_lines').insert(items.map(x => ({ po_id: po.id, product_id: x.r.id, qty_ordered: x.qty, unit_cost: x.r.cost_price }))));
      refreshCounts();
      toast('Purchase order created', 'ok');
      location.hash = '#/purchase-orders/' + po.id;
    } catch (e) { fail(e); }
  }));
}
