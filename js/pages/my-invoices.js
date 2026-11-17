// My invoices: a franchise store manager's own invoices from Chai Green.
// Only the selling price is shown (what we charge the store), never our costs.
import { sb, q, state, html, block, money, num, date, badge, isoDate } from '../lib.js';

export async function render(main, params) {
  if (!state.franchise) { main.innerHTML = '<div class="notice">Invoices are shown to franchise store managers only.</div>'; return; }
  if (params[0]) return invoice(main, params[0]);
  const rows = await q(sb.from('invoices').select('id, number, issue_date, due_date, subtotal, vat_total, total, status')
    .order('issue_date', { ascending: false }).order('number', { ascending: false }).limit(500));
  const today = isoDate(new Date());
  const owed = rows.filter(r => r.status === 'unpaid').reduce((a, r) => a + Number(r.total), 0);
  main.innerHTML = html`
    <div class="page-head"><div><h1>My invoices</h1>
      <p class="muted">What Chai Green has charged your store for stock. Press an invoice to see it in full or print it.</p></div></div>
    ${owed ? html`<div class="notice warn">Still to pay: <b>${money(owed)}</b></div>` : ''}
    <div class="card"><div class="table-wrap">${rows.length ? html`<table>
      <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => html`<tr class="click" data-id="${r.id}"><td><b>${r.number}</b></td>
        <td>${date(r.issue_date)}</td><td>${date(r.due_date)}</td>
        <td class="num">${money(r.subtotal)}</td><td class="num">${money(r.vat_total)}</td><td class="num"><b>${money(r.total)}</b></td>
        <td>${r.status === 'unpaid' && r.due_date < today ? badge('overdue', 'Overdue') : badge(r.status)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">No invoices yet. One is made each time the warehouse sends you stock.</div>`}</div></div>`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/my-invoices/' + tr.dataset.id; });
}

async function invoice(main, id) {
  const [inv, lines] = await Promise.all([
    q(sb.from('invoices').select('*').eq('id', id).single()),
    q(sb.from('invoice_lines').select('description, sku, qty, unit_price, vat_rate, net, vat').eq('invoice_id', id).order('description'))
  ]);
  const S = state.settings;
  const vatBands = {};
  lines.forEach(l => { vatBands[l.vat_rate] = (vatBands[l.vat_rate] || 0) + Number(l.vat); });
  const overdue = inv.status === 'unpaid' && inv.due_date < isoDate(new Date());
  main.innerHTML = html`
    <div class="page-head no-print"><div><a href="#/my-invoices">← My invoices</a></div>
      <div class="btn-row"><button class="btn primary" data-print>Print / save PDF</button></div></div>
    ${inv.status === 'paid' ? html`<div class="no-print notice ok">Paid ${date(inv.paid_at)}</div>` : ''}
    ${overdue ? html`<div class="no-print notice bad">Overdue — was due ${date(inv.due_date)}</div>` : ''}
    <div class="doc">
      <div class="doc-head">
        <div><p class="doc-title">INVOICE</p>
          <dl class="meta"><dt>Invoice no.</dt><dd>${inv.number}</dd><dt>Date</dt><dd>${date(inv.issue_date)}</dd>
          <dt>Due</dt><dd>${date(inv.due_date)}</dd></dl></div>
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
  main.querySelector('[data-print]').onclick = () => window.print();
}
