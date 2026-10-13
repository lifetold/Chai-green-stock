// Invoices: list, printable invoice, email, mark paid, void, CSV for accounts.
import { sb, q, rpc, state, html, raw, block, money, num, date, badge, busy, fail, toast, modal, confirmBox,
  downloadCsv, isoDate, isManager, options } from '../lib.js';

export async function render(main, params) {
  if (params[0]) return invoice(main, params[0]);
  const stores = await q(sb.from('stores').select('id, name').order('name'));
  const filt = new URLSearchParams(location.hash.split('?')[1] || '');

  main.innerHTML = html`
    <div class="page-head"><div><h1>Invoices</h1><p class="muted">Raised automatically when stock is booked out.</p></div>
      <div class="btn-row"><button class="btn" data-csv>Export for accounts (CSV)</button></div></div>
    <div class="card"><div class="grid three">
      <label>Status<select name="status"><option value="">All</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option></select></label>
      <label>Store<select name="store">${raw(options(stores, filt.get('store'), { blank: 'All stores' }))}</select></label>
      <label>From<input type="date" name="from" value="${isoDate(new Date(Date.now() - 90 * 864e5))}"></label>
      <label>To<input type="date" name="to" value="${isoDate(new Date())}"></label>
    </div></div>
    <div class="card"><div data-list class="table-wrap"></div></div>`;

  const $ = s => main.querySelector(s);
  if (filt.get('status')) $('[name=status]').value = filt.get('status');
  let rows = [];
  async function load() {
    let query = sb.from('invoices').select('*').gte('issue_date', $('[name=from]').value).lte('issue_date', $('[name=to]').value)
      .order('issue_date', { ascending: false }).order('number', { ascending: false });
    const st = $('[name=status]').value;
    if (st === 'overdue') query = query.eq('status', 'unpaid').lt('due_date', isoDate(new Date()));
    else if (st) query = query.eq('status', st);
    if ($('[name=store]').value) query = query.eq('store_id', $('[name=store]').value);
    rows = await q(query);
    const today = isoDate(new Date());
    const total = rows.filter(r => r.status !== 'void').reduce((a, r) => a + Number(r.total), 0);
    $('[data-list]').innerHTML = rows.length ? html`<table>
      <thead><tr><th>Invoice</th><th>Store</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => html`<tr class="click" data-id="${r.id}">
        <td><b>${r.number}</b></td><td>${r.store_name} ${badge(r.store_type, r.store_type === 'company' ? 'Company' : 'Franchise')}</td>
        <td>${date(r.issue_date)}</td><td>${date(r.due_date)}</td><td class="num">${money(r.total)}</td>
        <td>${r.status === 'unpaid' && r.due_date < today ? badge('overdue', 'Overdue') : badge(r.status)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4"><b>${rows.length} invoices</b></td><td class="num"><b>${money(total)}</b></td><td></td></tr></tfoot></table>`
      : html`<div class="empty">No invoices match.</div>`;
    main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/invoices/' + tr.dataset.id; });
  }
  main.querySelectorAll('select, input').forEach(el => el.onchange = () => load().catch(fail));
  await load();

  // Xero-style sales invoice import: one row per line.
  $('[data-csv]').onclick = e => busy(e.target, async () => {
    const ids = rows.filter(r => r.status !== 'void').map(r => r.id);
    if (!ids.length) return toast('No invoices to export.');
    const lines = await q(sb.from('invoice_lines').select('*').in('invoice_id', ids));
    const byInv = Object.fromEntries(rows.map(r => [r.id, r]));
    const storeRefs = Object.fromEntries((await q(sb.from('stores').select('id, account_ref'))).map(s => [s.id, s.account_ref]));
    const out = [['*ContactName', 'AccountRef', 'EmailAddress', '*InvoiceNumber', '*InvoiceDate', '*DueDate', 'InventoryItemCode',
      '*Description', '*Quantity', '*UnitAmount', 'TaxRate%', 'NetAmount', 'TaxAmount', 'Status']];
    for (const l of lines) {
      const r = byInv[l.invoice_id];
      out.push([r.store_name, storeRefs[r.store_id] || '', r.store_email || '', r.number, r.issue_date, r.due_date, l.sku || '',
        l.description, l.qty, l.unit_price, l.vat_rate, l.net, l.vat, r.status]);
    }
    downloadCsv(`chai-green-invoices-${$('[name=from]').value}-to-${$('[name=to]').value}.csv`, out);
  });
}

async function invoice(main, id) {
  const [inv, lines] = await Promise.all([
    q(sb.from('invoices').select('*, dispatches:dispatch_id(ref, collected_by_name, method)').eq('id', id).single()),
    q(sb.from('invoice_lines').select('*').eq('invoice_id', id).order('description'))
  ]);
  const S = state.settings;
  const vatBands = {};
  lines.forEach(l => { vatBands[l.vat_rate] = (vatBands[l.vat_rate] || 0) + Number(l.vat); });
  const overdue = inv.status === 'unpaid' && inv.due_date < isoDate(new Date());

  main.innerHTML = html`
    <div class="page-head no-print"><div><a href="#/invoices">← Invoices</a></div>
      <div class="btn-row">
        <button class="btn primary" data-print>Print / save PDF</button>
        <button class="btn" data-email>Email to store</button>
        ${isManager() && inv.status === 'unpaid' ? html`<button class="btn" data-paid>Mark paid</button>` : ''}
        ${isManager() && inv.status === 'paid' ? html`<button class="btn" data-unpaid>Mark unpaid</button>` : ''}
        ${isManager() && inv.status !== 'void' ? html`<button class="btn danger" data-void>Void</button>` : ''}
      </div></div>
    ${inv.status !== 'unpaid' || overdue ? html`<div class="no-print notice ${inv.status === 'paid' ? 'ok' : 'bad'}">
      ${inv.status === 'paid' ? `Paid ${date(inv.paid_at)}${inv.payment_ref ? ' · ' + inv.payment_ref : ''}` : ''}
      ${inv.status === 'void' ? `Void${inv.void_reason ? ': ' + inv.void_reason : ''}` : ''}
      ${overdue ? `Overdue — was due ${date(inv.due_date)}` : ''}</div>` : ''}
    ${inv.emailed_at ? html`<p class="no-print muted">Emailed ${date(inv.emailed_at)}</p>` : ''}

    <div class="doc">
      ${inv.status === 'void' ? html`<div class="void-stamp">VOID</div>` : ''}
      <div class="doc-head">
        <div><p class="doc-title">INVOICE</p>
          <dl class="meta"><dt>Invoice no.</dt><dd>${inv.number}</dd><dt>Date</dt><dd>${date(inv.issue_date)}</dd>
          <dt>Due</dt><dd>${date(inv.due_date)}</dd>${inv.dispatches ? html`<dt>Delivery note</dt><dd>${inv.dispatches.ref}</dd>` : ''}</dl></div>
        <div class="from"><b>${S.company_name}</b><br>${block(S.company_address, S.company_phone, S.company_email, S.vat_number && 'VAT no. ' + S.vat_number)}</div>
      </div>
      <h3>Invoice to</h3>
      <div class="to"><b>${inv.store_name}</b><br>${block(inv.store_address)}</div>
      <div class="table-wrap" style="margin-top:1.25rem"><table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">VAT</th><th class="num">Net</th></tr></thead>
        <tbody>${lines.map(l => html`<tr><td>${l.description}${l.sku ? html`<br><small>${l.sku}</small>` : ''}</td>
          <td class="num">${num(l.qty)}</td><td class="num">${money(l.unit_price)}</td><td class="num">${num(l.vat_rate)}%</td>
          <td class="num">${money(l.net)}</td></tr>`)}</tbody></table></div>
      <table class="totals"><tbody>
        <tr><td>Subtotal</td><td class="num">${money(inv.subtotal)}</td></tr>
        ${Object.entries(vatBands).filter(([r]) => Number(r) > 0).map(([r, v]) => html`<tr><td>VAT @ ${num(r)}%</td><td class="num">${money(v)}</td></tr>`)}
        <tr class="grand"><td>Total</td><td class="num">${money(inv.total)}</td></tr>
      </tbody></table>
      <div class="foot">${S.bank_details ? 'Payment details\n' + S.bank_details + '\nPlease quote ' + inv.number + ' as the reference.\n\n' : ''}${S.company_number ? 'Company no. ' + S.company_number : ''}</div>
    </div>`;

  const $ = s => main.querySelector(s);
  $('[data-print]').onclick = () => window.print();
  $('[data-email]').onclick = async () => {
    const to = inv.store_email || '';
    const body = `Hello,\n\nPlease find invoice ${inv.number} for ${money(inv.total)}, due ${date(inv.due_date)}.\n\n` +
      lines.map(l => `${num(l.qty)} x ${l.description} @ ${money(l.unit_price)}`).join('\n') +
      `\n\nTotal (inc VAT): ${money(inv.total)}\n\n${S.bank_details ? 'Payment details:\n' + S.bank_details + '\nReference: ' + inv.number + '\n\n' : ''}Thank you,\n${S.company_name}`;
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Invoice ${inv.number} from ${S.company_name}`)}&body=${encodeURIComponent(body)}`;
    if (isManager() && !inv.emailed_at) await sb.from('invoices').update({ emailed_at: new Date().toISOString() }).eq('id', id);
  };
  const paid = $('[data-paid]');
  if (paid) paid.onclick = () => {
    const m = modal('Mark as paid', html`<label>Date paid<input type="date" name="d" value="${isoDate(new Date())}"></label>
      <label>Payment reference <span class="hint">(optional)</span><input name="ref"></label>
      <div class="actions"><button class="btn primary">Mark paid</button></div>`);
    m.el.querySelector('.btn.primary').onclick = e => busy(e.target, async () => {
      try {
        await q(sb.from('invoices').update({ status: 'paid', paid_at: m.el.querySelector('[name=d]').value, payment_ref: m.el.querySelector('[name=ref]').value || null }).eq('id', id));
        m.close(); toast('Marked paid', 'ok'); invoice(main, id);
      } catch (err) { fail(err); }
    });
  };
  const unpaid = $('[data-unpaid]');
  if (unpaid) unpaid.onclick = async () => {
    if (!(await confirmBox('Mark unpaid?', `Set ${inv.number} back to unpaid?`))) return;
    await q(sb.from('invoices').update({ status: 'unpaid', paid_at: null, payment_ref: null }).eq('id', id)).catch(fail);
    invoice(main, id);
  };
  const voidBtn = $('[data-void]');
  if (voidBtn) voidBtn.onclick = () => {
    const m = modal('Void invoice ' + inv.number, html`<p>Voiding cancels the invoice. It stays on record, marked VOID.</p>
      <label>Reason<input name="reason" required placeholder="e.g. wrong store, goods returned"></label>
      <label class="check"><input type="checkbox" name="restock" checked> The goods came back — put them back into stock</label>
      <div class="actions"><button class="btn danger">Void invoice</button></div>`);
    m.el.querySelector('.btn.danger').onclick = e => busy(e.target, async () => {
      const reason = m.el.querySelector('[name=reason]').value.trim();
      if (!reason) return toast('Give a reason.', 'bad');
      try {
        await rpc('void_invoice', { p_invoice: id, p_reason: reason, p_restock: m.el.querySelector('[name=restock]').checked });
        m.close(); toast('Invoice voided', 'ok'); invoice(main, id);
      } catch (err) { fail(err); }
    });
  };
}
