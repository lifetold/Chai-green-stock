// Shop orders: a store asks the warehouse for stock. The warehouse packs it
// and books it out through Stock out, which raises the invoice.
import { sb, q, rpc, state, html, raw, num, date, dateTime, badge, busy, fail, toast, modal, isManager, isoDate, addDays } from '../lib.js';
import { myStoreId, storeSelect, bindStoreSelect, isStoreRole } from './store-common.js';
import { refreshCounts } from '../app.js';

const STATUS = {
  submitted: ['warn', 'New'],
  picking: ['on_order', 'Being packed'],
  sent: ['ok', 'Sent'],
  cancelled: ['out', 'Cancelled']
};
const statusBadge = s => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || s);
const isWarehouse = () => ['admin', 'manager', 'staff'].includes(state.profile.role);
const canOrder = () => isStoreRole() || isManager();

export async function render(main, params) {
  if (params[0] === 'new') return newOrder(main);
  if (params[0]) return detail(main, params[0]);
  return list(main);
}

// ------------------------------------------------------------------ list
async function list(main) {
  const store = isStoreRole();
  let query = sb.from('store_orders').select('*, stores(name, code), store_order_lines(count)')
    .order('created_at', { ascending: false }).limit(200);
  const filter = sessionStorage.getItem('cg-orders-filter') || 'open';
  if (!store && filter === 'open') query = query.in('status', ['submitted', 'picking']);
  const rows = await q(query);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${store ? 'Order stock' : 'Shop orders'}</h1>
      <p class="muted">${store ? 'Ask the warehouse for what your shop needs. You can see here when it\'s packed and sent.'
        : 'Orders from the shops. Pack each one and book it out with Stock out.'}</p></div>
      <div class="btn-row">
        ${store ? '' : html`<select data-filter style="width:auto"><option value="open" ${filter === 'open' ? 'selected' : ''}>Waiting to be sent</option>
          <option value="all" ${filter === 'all' ? 'selected' : ''}>All orders</option></select>`}
        ${canOrder() ? html`<a class="btn primary" href="#/orders/new">+ New order</a>` : ''}</div></div>
    <div class="card"><div class="table-wrap">${rows.length ? html`<table>
      <thead><tr><th>Order</th>${store ? '' : html`<th>Shop</th>`}<th>Ordered</th><th>Needed by</th><th class="num">Items</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => html`<tr class="click" data-id="${r.id}"><td><b>${r.ref}</b><br><small>${r.ordered_by_name || ''}</small></td>
        ${store ? '' : html`<td>${r.stores?.name}</td>`}
        <td>${dateTime(r.created_at)}</td><td>${r.needed_by ? date(r.needed_by) : '—'}</td>
        <td class="num">${r.store_order_lines?.[0]?.count ?? ''}</td><td>${statusBadge(r.status)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${store ? 'No orders yet. Press "+ New order" to ask the warehouse for stock.'
        : filter === 'open' ? 'No shop orders waiting. 👍' : 'No shop orders yet.'}</div>`}</div></div>`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/orders/' + tr.dataset.id; });
  const f = main.querySelector('[data-filter]');
  if (f) f.onchange = () => { sessionStorage.setItem('cg-orders-filter', f.value); list(main); };
}

// ------------------------------------------------------------------ new order
async function newOrder(main) {
  if (!canOrder()) { main.innerHTML = '<div class="notice bad">Only shops and head office can place shop orders.</div>'; return; }
  const [stores, items] = await Promise.all([
    q(sb.from('stores').select('id, name, code').eq('active', true).order('name')),
    rpc('order_catalogue')
  ]);
  if (!stores.length) { main.innerHTML = '<div class="notice warn">No shops set up yet.</div>'; return; }
  let storeId = myStoreId(stores);
  const qty = {};        // product id -> qty
  let term = '', cat = '';
  const cats = [...new Set(items.map(i => i.category || 'Other'))];

  main.innerHTML = html`
    <div class="page-head"><div><a href="#/orders">← Orders</a><h1>New order</h1>
      <p class="muted" data-for></p></div><div class="btn-row">${storeSelect(stores, storeId)}</div></div>
    <div class="card">
      <div class="grid two"><input type="search" data-search placeholder="Search, e.g. cups, mango, chicken">
        <select data-cat><option value="">All categories</option>${cats.map(c => html`<option>${c}</option>`)}</select></div>
      <ul class="lines order-list" data-list></ul>
    </div>
    <div class="basket-bar" data-bar hidden><span data-count></span><button class="btn primary" data-review>Review order →</button></div>`;
  const $ = s => main.querySelector(s);
  const showFor = () => { $('[data-for]').textContent = 'For ' + (stores.find(s => s.id === storeId)?.name || ''); };
  showFor();
  bindStoreSelect(main, () => { storeId = $('[data-store]').value; showFor(); });

  function draw() {
    const t = term.toLowerCase();
    const shown = items.filter(i => (!cat || (i.category || 'Other') === cat) && (!t || i.name.toLowerCase().includes(t))).slice(0, 150);
    $('[data-list]').innerHTML = shown.length ? html`${shown.map(i => html`<li class="${qty[i.id] ? 'picked' : ''}">
      <div class="info"><div class="name">${i.name}</div>
        <div class="sub">${[i.pack_size, i.unit !== 'each' ? 'per ' + i.unit : ''].filter(Boolean).join(' · ')}
        ${i.in_stock ? '' : html` ${badge('reorder', 'Out at warehouse')}`}</div></div>
      <div class="stepper"><button type="button" data-dec="${i.id}" aria-label="One less">−</button>
        <input type="number" inputmode="numeric" min="0" step="1" value="${qty[i.id] || ''}" placeholder="0" data-qty="${i.id}" aria-label="Quantity">
        <button type="button" data-inc="${i.id}" aria-label="One more">+</button></div></li>`)}`
      : html`<li class="muted">Nothing matches.</li>`;
    $('[data-list]').querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { qty[b.dataset.inc] = (qty[b.dataset.inc] || 0) + 1; draw(); });
    $('[data-list]').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
      qty[b.dataset.dec] = Math.max(0, (qty[b.dataset.dec] || 0) - 1);
      if (!qty[b.dataset.dec]) delete qty[b.dataset.dec];
      draw();
    });
    $('[data-list]').querySelectorAll('[data-qty]').forEach(inp => inp.onchange = () => {
      const v = Math.floor(Number(inp.value));
      if (v > 0) qty[inp.dataset.qty] = v; else delete qty[inp.dataset.qty];
      setTimeout(draw);
    });
    const n = Object.keys(qty).length;
    $('[data-bar]').hidden = !n;
    $('[data-count]').textContent = `${n} item${n === 1 ? '' : 's'} in this order`;
  }
  let t;
  $('[data-search]').oninput = e => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); draw(); }, 200); };
  $('[data-cat]').onchange = e => { cat = e.target.value; draw(); };
  draw();

  $('[data-review]').onclick = () => {
    const picked = items.filter(i => qty[i.id]);
    const m = modal('Check your order', html`
      <p class="muted">For <b>${stores.find(s => s.id === storeId)?.name}</b></p>
      <div class="table-wrap"><table><tbody>${picked.map(i => html`<tr><td>${i.name}${i.pack_size ? html`<br><small>${i.pack_size}</small>` : ''}</td>
        <td class="num"><b>${num(qty[i.id])}</b></td></tr>`)}</tbody></table></div>
      ${picked.some(i => !i.in_stock) ? html`<p class="notice warn">Some items are out at the warehouse. They'll send them when they come in.</p>` : ''}
      <form autocomplete="off">
        <div class="grid two"><label>Your name<input name="who" required value="${isStoreRole() && state.profile.role === 'store_manager' ? state.profile.full_name || '' : ''}"></label>
          <label>Needed by <span class="hint">(optional)</span><input type="date" name="needed" min="${isoDate(new Date())}" value="${isoDate(addDays(new Date(), 2))}"></label></div>
        <label>Notes for the warehouse <span class="hint">(optional)</span><textarea name="notes" rows="2"></textarea></label>
        <div class="actions"><button class="btn primary big">Send order to the warehouse</button></div></form>`, { wide: true });
    const form = m.el.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      busy(form.querySelector('button'), async () => {
        try {
          const r = await rpc('place_store_order', { p_store: storeId,
            p_lines: picked.map(i => ({ product_id: i.id, qty: qty[i.id] })),
            p_needed_by: form.needed.value || null, p_notes: form.notes.value, p_ordered_by_name: form.who.value });
          m.close();
          toast(`Order ${r.ref} sent to the warehouse`, 'ok');
          location.hash = '#/orders/' + r.id;
        } catch (err) { fail(err); }
      });
    };
  };
}

// ------------------------------------------------------------------ one order
async function detail(main, id) {
  const [o, lines] = await Promise.all([
    q(sb.from('store_orders').select('*, stores(name, code, type, address)').eq('id', id).single()),
    rpc('store_order_items', { p_order: id })
  ]);
  const wh = isWarehouse();
  const open = ['submitted', 'picking'].includes(o.status);
  const canCancel = open && (wh || o.status === 'submitted');
  main.innerHTML = html`
    <div class="page-head"><div><a href="#/orders">← Orders</a><h1>${o.ref} ${statusBadge(o.status)}</h1>
      <p class="muted">${o.stores?.name} · ordered ${dateTime(o.created_at)} by ${o.ordered_by_name || '—'}
        ${o.needed_by ? html` · <b>needed by ${date(o.needed_by)}</b>` : ''}</p></div>
      <div class="btn-row">
        ${wh && o.status === 'submitted' ? html`<button class="btn" data-pick>Start packing</button>` : ''}
        ${wh && open ? html`<a class="btn primary" href="#/dispatch/${o.store_id}/${o.id}">📤 Book out with Stock out</a>` : ''}
        ${wh && o.dispatch_id ? html`<a class="btn" href="#/dispatches/${o.dispatch_id}">Delivery note</a>` : ''}
        ${canCancel ? html`<button class="btn danger" data-cancel>Cancel order</button>` : ''}</div></div>
    ${o.notes ? html`<div class="notice">📝 ${o.notes}</div>` : ''}
    ${o.status === 'cancelled' ? html`<div class="notice bad">Cancelled${o.cancel_reason ? ': ' + o.cancel_reason : ''}.</div>` : ''}
    ${o.status === 'sent' ? html`<div class="notice ok">Packed and sent ${dateTime(o.updated_at)}.</div>` : ''}
    ${!wh && o.status === 'picking' ? html`<div class="notice">The warehouse is packing this order. To change it, call them.</div>` : ''}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th>${wh ? html`<th>Warehouse</th>` : ''}</tr></thead>
      <tbody>${lines.map(l => html`<tr><td>${l.name}${l.pack_size ? html`<br><small>${l.pack_size}</small>` : ''}</td>
        <td class="num"><b>${num(l.qty)}</b> <small>${l.unit}</small></td>
        ${wh ? html`<td>${l.in_stock ? badge('ok', 'In stock') : badge('out', 'Out of stock')}</td>` : ''}</tr>`)}</tbody></table></div></div>`;
  const pick = main.querySelector('[data-pick]');
  if (pick) pick.onclick = e => busy(e.target, async () => {
    try { await rpc('start_picking_store_order', { p_order: id }); toast('Marked as being packed', 'ok'); refreshCounts(); detail(main, id); } catch (err) { fail(err); }
  });
  const cancel = main.querySelector('[data-cancel]');
  if (cancel) cancel.onclick = () => {
    const m = modal('Cancel this order?', html`<form><label>Why? <span class="hint">(optional)</span><input name="why"></label>
      <div class="actions"><button class="btn danger">Cancel order</button></div></form>`);
    const form = m.el.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      busy(form.querySelector('button'), async () => {
        try { await rpc('cancel_store_order', { p_order: id, p_reason: form.why.value }); m.close(); toast('Order cancelled'); refreshCounts(); detail(main, id); }
        catch (err) { fail(err); }
      });
    };
  };
}

// Used by Stock out: the lines of an order, as products ready to book out.
export async function orderForDispatch(orderId) {
  const [o, lines] = await Promise.all([
    q(sb.from('store_orders').select('id, ref, store_id, status, notes').eq('id', orderId).single()),
    q(sb.from('store_order_lines').select('product_id, qty').eq('order_id', orderId))
  ]);
  const prods = lines.length ? await q(sb.from('product_stock').select('*').in('id', lines.map(l => l.product_id))) : [];
  return { order: o, lines: lines.map(l => ({ product: prods.find(p => p.id === l.product_id), qty: Number(l.qty) })).filter(l => l.product) };
}
