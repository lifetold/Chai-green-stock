// Stock history: every change to stock, newest first, with links to the proof.
import { sb, q, html, raw, num, dateTime, isoDate, options, downloadCsv, fail } from '../lib.js';

const TYPE = { goods_in: 'Goods in', dispatch: 'Stock out', adjustment: 'Adjustment', stock_check: 'Stock check', void_return: 'Invoice void (returned)' };

export async function render(main) {
  const stores = await q(sb.from('stores').select('id, name').order('name'));
  main.innerHTML = html`
    <div class="page-head"><div><h1>Stock history</h1><p class="muted">Every change to stock. Nothing here can be edited or deleted.</p></div>
      <button class="btn" data-csv>Export CSV</button></div>
    <div class="card"><div class="grid three">
      <label>Type<select name="type"><option value="">All</option>${Object.entries(TYPE).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label>Store<select name="store">${raw(options(stores, null, { blank: 'Any' }))}</select></label>
      <label>From<input type="date" name="from" value="${isoDate(new Date(Date.now() - 14 * 864e5))}"></label>
      <label>To<input type="date" name="to" value="${isoDate(new Date())}"></label>
    </div></div>
    <div class="card"><div class="table-wrap" data-list></div></div>`;
  const $ = s => main.querySelector(s);
  let rows = [];
  const link = m => m.type === 'dispatch' ? `#/dispatches/${m.ref_id}` : m.type === 'stock_check' ? `#/stock-check/${m.ref_id}`
    : m.type === 'void_return' ? `#/invoices/${m.ref_id}` : `#/product/${m.product_id}`;
  async function load() {
    let query = sb.from('stock_movements').select('*, products(name, unit), stores(name), profiles:user_id(full_name)')
      .gte('created_at', $('[name=from]').value).lt('created_at', isoDate(new Date(new Date($('[name=to]').value).getTime() + 864e5)))
      .order('created_at', { ascending: false }).limit(1000);
    if ($('[name=type]').value) query = query.eq('type', $('[name=type]').value);
    if ($('[name=store]').value) query = query.eq('store_id', $('[name=store]').value);
    rows = await q(query);
    $('[data-list]').innerHTML = rows.length ? html`<table>
      <thead><tr><th>When</th><th>What</th><th>Product</th><th>Who</th><th class="num">Change</th><th class="num">Stock after</th></tr></thead>
      <tbody>${rows.map(m => html`<tr class="click" data-href="${link(m)}"><td>${dateTime(m.created_at)}</td>
        <td>${TYPE[m.type]}${m.stores ? ' → ' + m.stores.name : ''}<br><small>${m.ref_text}</small></td>
        <td>${m.products?.name}</td><td>${m.profiles?.full_name || ''}</td>
        <td class="num"><b>${m.qty_change > 0 ? '+' : ''}${num(m.qty_change)}</b></td><td class="num">${num(m.qty_after)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">No stock movements in this period.</div>`;
    main.querySelectorAll('[data-href]').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  }
  main.querySelectorAll('select, input').forEach(el => el.onchange = () => load().catch(fail));
  await load();
  $('[data-csv]').onclick = () => downloadCsv(`chai-green-stock-history-${$('[name=from]').value}-to-${$('[name=to]').value}.csv`, [
    ['When', 'Type', 'Reference', 'Store', 'Product', 'Change', 'Stock after', 'By'],
    ...rows.map(m => [m.created_at, TYPE[m.type], m.ref_text, m.stores?.name, m.products?.name, m.qty_change, m.qty_after, m.profiles?.full_name])
  ]);
}
