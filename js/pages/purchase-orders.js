// Purchase orders to suppliers.
import { sb, q, state, html, raw, block, money, num, date, badge, busy, fail, toast, confirmBox, modal, isManager, isoDate, options } from '../lib.js';
import { pickProduct } from '../widgets.js';

export async function render(main, params) {
  if (params[0]) return po(main, params[0]);
  const rows = await q(sb.from('purchase_orders').select('*, suppliers(name), po_lines(qty_ordered, qty_received, unit_cost)')
    .order('created_at', { ascending: false }).limit(200));
  const today = isoDate(new Date());
  main.innerHTML = html`
    <div class="page-head"><div><h1>Purchase orders</h1></div>
      <div class="btn-row"><a class="btn" href="#/reorder">Reorder suggestions</a>
      ${isManager() ? html`<button class="btn primary" data-new>+ New order</button>` : ''}</div></div>
    <div class="card"><div class="table-wrap">${rows.length ? html`<table>
      <thead><tr><th>Ref</th><th>Supplier</th><th>Created</th><th>Expected</th><th class="num">Value</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => {
        const late = ['sent', 'part_received'].includes(r.status) && r.expected_at && r.expected_at < today;
        return html`<tr class="click" data-id="${r.id}"><td><b>${r.ref}</b></td><td>${r.suppliers?.name}</td><td>${date(r.created_at)}</td>
        <td>${date(r.expected_at)} ${late ? badge('overdue', 'Late') : ''}</td>
        <td class="num">${money(r.po_lines.reduce((a, l) => a + l.qty_ordered * (l.unit_cost || 0), 0))}</td><td>${badge(r.status)}</td></tr>`;
      })}</tbody></table>` : html`<div class="empty">No purchase orders yet.</div>`}</div></div>`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/purchase-orders/' + tr.dataset.id; });
  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = async () => {
    const sups = await q(sb.from('suppliers').select('id, name, default_lead_time_days').eq('active', true).order('name'));
    if (!sups.length) return toast('Add a supplier first.', 'bad');
    const m = modal('New purchase order', html`<label>Supplier<select name="s">${raw(options(sups))}</select></label>
      <div class="actions"><button class="btn primary">Create</button></div>`);
    m.el.querySelector('.btn.primary').onclick = e => busy(e.target, async () => {
      const s = sups.find(x => x.id === m.el.querySelector('[name=s]').value);
      try {
        const r = await q(sb.from('purchase_orders').insert({ supplier_id: s.id, created_by: state.profile.id,
          expected_at: isoDate(new Date(Date.now() + s.default_lead_time_days * 864e5)) }).select('id').single());
        m.close();
        location.hash = '#/purchase-orders/' + r.id;
      } catch (err) { fail(err); }
    });
  };
}

async function po(main, id) {
  const [o, lines] = await Promise.all([
    q(sb.from('purchase_orders').select('*, suppliers(*)').eq('id', id).single()),
    q(sb.from('po_lines').select('*, products(name, sku, supplier_code, pack_size, unit)').eq('po_id', id))
  ]);
  const S = state.settings;
  const mgr = isManager();
  const editable = mgr && o.status === 'draft';
  const total = lines.reduce((a, l) => a + l.qty_ordered * (l.unit_cost || 0), 0);

  main.innerHTML = html`
    <div class="page-head no-print"><a href="#/purchase-orders">← Purchase orders</a>
      <div class="btn-row">
        <button class="btn" onclick="print()">Print / PDF</button>
        ${mgr && o.status !== 'cancelled' ? html`<button class="btn" data-email>Email supplier</button>` : ''}
        ${editable ? html`<button class="btn" data-add>+ Add product</button><button class="btn primary" data-sent>Mark as sent</button>` : ''}
        ${['sent', 'part_received', 'draft'].includes(o.status) ? html`<a class="btn primary" href="#/goods-in/${id}">Receive delivery</a>` : ''}
        ${mgr && ['draft', 'sent'].includes(o.status) ? html`<button class="btn danger" data-cancel>Cancel order</button>` : ''}
      </div></div>
    <div class="doc">
      <div class="doc-head"><div><p class="doc-title">PURCHASE ORDER</p>
        <dl class="meta"><dt>Order no.</dt><dd>${o.ref}</dd><dt>Date</dt><dd>${date(o.ordered_at || o.created_at)}</dd>
        <dt>Delivery by</dt><dd>${editable ? html`<input type="date" name="exp" value="${o.expected_at || ''}" class="no-print" style="min-height:34px;padding:.2rem .4rem">` : ''}<span class="${editable ? 'print-only' : ''}">${date(o.expected_at)}</span></dd>
        <dt>Status</dt><dd>${badge(o.status)}</dd></dl></div>
        <div class="from"><b>${S.company_name}</b><br>${block(S.company_address, S.company_phone, S.company_email)}</div></div>
      <h3>Supplier</h3><div class="to"><b>${o.suppliers.name}</b><br>${block(o.suppliers.address, o.suppliers.account_ref && 'Our account: ' + o.suppliers.account_ref)}</div>
      <div class="table-wrap" style="margin-top:1rem"><table>
        <thead><tr><th>Item</th><th>Their code</th><th class="num">Qty</th><th class="num">Received</th><th class="num">Unit cost</th><th class="num">Total</th>${editable ? html`<th class="no-print"></th>` : ''}</tr></thead>
        <tbody>${lines.map(l => html`<tr><td>${l.products.name}${l.products.pack_size ? ` (${l.products.pack_size})` : ''}</td><td>${l.products.supplier_code || ''}</td>
          <td class="num">${editable ? html`<input class="qty-input" type="number" min="1" step="any" value="${l.qty_ordered}" data-qty="${l.id}">` : num(l.qty_ordered)}</td>
          <td class="num">${num(l.qty_received)}</td><td class="num">${money(l.unit_cost)}</td><td class="num">${money(l.qty_ordered * (l.unit_cost || 0))}</td>
          ${editable ? html`<td class="no-print"><button class="btn small danger" data-del="${l.id}">×</button></td>` : ''}</tr>`)}</tbody></table></div>
      <table class="totals"><tbody><tr class="grand"><td>Total (ex VAT)</td><td class="num">${money(total)}</td></tr></tbody></table>
      ${o.suppliers.min_order_value && total < o.suppliers.min_order_value ? html`<p class="no-print notice warn">Below this supplier's minimum order of ${money(o.suppliers.min_order_value)}.</p>` : ''}
      ${o.notes ? html`<h3>Notes</h3><p>${o.notes}</p>` : ''}
    </div>`;

  const $ = s => main.querySelector(s);
  const reload = () => po(main, id);
  const exp = $('[name=exp]');
  if (exp) exp.onchange = () => q(sb.from('purchase_orders').update({ expected_at: exp.value }).eq('id', id)).then(reload, fail);
  main.querySelectorAll('[data-qty]').forEach(inp => inp.onchange = () =>
    q(sb.from('po_lines').update({ qty_ordered: Number(inp.value) }).eq('id', inp.dataset.qty)).then(reload, fail));
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => q(sb.from('po_lines').delete().eq('id', b.dataset.del)).then(reload, fail));
  const add = $('[data-add]');
  if (add) add.onclick = async () => {
    const p = await pickProduct('Add to order');
    if (!p) return;
    await q(sb.from('po_lines').insert({ po_id: id, product_id: p.id, qty_ordered: p.eff_reorder_qty || 1, unit_cost: p.cost_price })).then(reload, fail);
  };
  const sent = $('[data-sent]');
  if (sent) sent.onclick = () => busy(sent, async () => {
    if (!lines.length) return toast('Add at least one product.', 'bad');
    await q(sb.from('purchase_orders').update({ status: 'sent', ordered_at: new Date().toISOString() }).eq('id', id)).then(reload, fail);
  });
  const cancel = $('[data-cancel]');
  if (cancel) cancel.onclick = async () => {
    if (!(await confirmBox('Cancel order', `Cancel ${o.ref}?`, 'Cancel order', true))) return;
    await q(sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id)).then(reload, fail);
  };
  const email = $('[data-email]');
  if (email) email.onclick = () => {
    const body = `Hello,\n\nPlease supply the following, order ${o.ref}${o.suppliers.account_ref ? ' (account ' + o.suppliers.account_ref + ')' : ''}:\n\n` +
      lines.map(l => `${num(l.qty_ordered)} x ${l.products.name}${l.products.supplier_code ? ' [' + l.products.supplier_code + ']' : ''}`).join('\n') +
      `\n\nRequired by: ${date(o.expected_at)}\nDeliver to:\n${S.company_address}\n\nThank you,\n${S.company_name}`;
    location.href = `mailto:${encodeURIComponent(o.suppliers.email || '')}?subject=${encodeURIComponent(`Purchase order ${o.ref} from ${S.company_name}`)}&body=${encodeURIComponent(body)}`;
  };
}
