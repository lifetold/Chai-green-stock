// Collections / deliveries out, with the photo and signature proof.
import { sb, q, state, html, raw, block, num, money, date, dateTime, badge, photoStrip, hydratePhotos, options, isoDate, fail } from '../lib.js';

export async function render(main, params) {
  if (params[0]) return note(main, params[0]);
  const stores = await q(sb.from('stores').select('id, name').order('name'));
  main.innerHTML = html`
    <div class="page-head"><div><h1>Collections</h1><p class="muted">Everything booked out, with photos and signatures.</p></div>
      <a class="btn primary" href="#/dispatch">📤 Stock out</a></div>
    <div class="card"><div class="grid three">
      <label>Store<select name="store">${raw(options(stores, null, { blank: 'All stores' }))}</select></label>
      <label>From<input type="date" name="from" value="${isoDate(new Date(Date.now() - 30 * 864e5))}"></label>
      <label>To<input type="date" name="to" value="${isoDate(new Date())}"></label>
    </div></div>
    <div class="card"><div data-list class="table-wrap"></div></div>`;
  const $ = s => main.querySelector(s);
  async function load() {
    let query = sb.from('dispatches').select('id, ref, dispatched_at, method, collected_by_name, stores(name, type), invoices:invoice_id(number, total, status), profiles:dispatched_by(full_name)')
      .gte('dispatched_at', $('[name=from]').value).lt('dispatched_at', isoDate(new Date(new Date($('[name=to]').value).getTime() + 864e5)))
      .order('dispatched_at', { ascending: false });
    if ($('[name=store]').value) query = query.eq('store_id', $('[name=store]').value);
    const rows = await q(query);
    $('[data-list]').innerHTML = rows.length ? html`<table>
      <thead><tr><th>When</th><th>Ref</th><th>Store</th><th>Collected by</th><th>Invoice</th><th class="num">Total</th></tr></thead>
      <tbody>${rows.map(r => html`<tr class="click" data-id="${r.id}"><td>${dateTime(r.dispatched_at)}</td><td>${r.ref}</td>
        <td>${r.stores?.name}</td><td>${r.collected_by_name || '—'}<br><small>${r.method === 'delivery' ? 'Delivered' : 'Collected'} · booked by ${r.profiles?.full_name || ''}</small></td>
        <td>${r.invoices?.number} ${r.invoices ? badge(r.invoices.status) : ''}</td><td class="num">${money(r.invoices?.total)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">Nothing booked out in this period.</div>`;
    main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/dispatches/' + tr.dataset.id; });
  }
  main.querySelectorAll('select, input').forEach(el => el.onchange = () => load().catch(fail));
  await load();
}

async function note(main, id) {
  const [d, lines] = await Promise.all([
    q(sb.from('dispatches').select('*, stores(name, address, type), invoices:invoice_id(id, number, status), profiles:dispatched_by(full_name)').eq('id', id).single()),
    q(sb.from('dispatch_lines').select('qty, products(name, sku, pack_size, unit)').eq('dispatch_id', id))
  ]);
  const S = state.settings;
  main.innerHTML = html`
    <div class="page-head no-print"><a href="#/dispatches">← Collections</a>
      <div class="btn-row"><button class="btn primary" onclick="print()">Print delivery note</button>
      ${d.invoices ? html`<a class="btn" href="#/invoices/${d.invoices.id}">Invoice ${d.invoices.number}</a>` : ''}</div></div>
    <div class="doc">
      <div class="doc-head"><div><p class="doc-title">DELIVERY NOTE</p>
        <dl class="meta"><dt>Ref</dt><dd>${d.ref}</dd><dt>Date</dt><dd>${dateTime(d.dispatched_at)}</dd>
        <dt>Invoice</dt><dd>${d.invoices?.number || '—'}</dd><dt>Booked out by</dt><dd>${d.profiles?.full_name || '—'}</dd></dl></div>
        <div class="from"><b>${S.company_name}</b><br>${block(S.company_address)}</div></div>
      <h3>To</h3><div class="to"><b>${d.stores.name}</b><br>${block(d.stores.address)}</div>
      <div class="table-wrap" style="margin-top:1rem"><table><thead><tr><th>Item</th><th>SKU</th><th class="num">Qty</th></tr></thead>
        <tbody>${lines.map(l => html`<tr><td>${l.products.name}${l.products.pack_size ? ` (${l.products.pack_size})` : ''}</td><td>${l.products.sku || ''}</td>
        <td class="num">${num(l.qty)} ${l.products.unit}</td></tr>`)}</tbody></table></div>
      <h3>${d.method === 'delivery' ? 'Received by' : 'Collected by'}</h3>
      <p><b>${d.collected_by_name || '—'}</b></p>
      ${d.signature_path ? html`<img data-photo="${d.signature_path}" alt="Signature" style="max-width:320px;border-bottom:1px solid #999">` : ''}
      ${d.notes ? html`<h3>Notes</h3><p>${d.notes}</p>` : ''}
      <h3>Photos</h3><div class="photos">${raw(await photoStrip('dispatch', id))}</div>
    </div>`;
  hydratePhotos(main);
}
