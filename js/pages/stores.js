// Stores: company-owned (charged at cost) and franchises (cost + margin).
import { sb, q, state, html, money, num, badge, formData, modal, busy, fail, toast, isManager } from '../lib.js';

export async function render(main) {
  const [stores, totals] = await Promise.all([
    q(sb.from('stores').select('*').order('name')),
    q(sb.from('invoices').select('store_id, total, status, due_date').neq('status', 'void'))
  ]);
  const owed = {};
  totals.filter(t => t.status === 'unpaid').forEach(t => { owed[t.store_id] = (owed[t.store_id] || 0) + Number(t.total); });
  const mgr = isManager();
  main.innerHTML = html`
    <div class="page-head"><div><h1>Stores</h1>
      <p class="muted">Company-owned stores are charged at cost. Franchise stores pay cost + margin: the store's agreed margin if it has one, otherwise each product's margin (default ${num(state.settings.default_margin_pct)}%).</p></div>
      ${mgr ? html`<button class="btn primary" data-new>+ Add store</button>` : ''}</div>
    <div class="card"><div class="table-wrap">${stores.length ? html`<table>
      <thead><tr><th>Store</th><th>Type</th><th class="num">Margin</th><th>Invoice email</th><th class="num">Owed</th><th></th></tr></thead>
      <tbody>${stores.map((s, i) => html`<tr ${s.active ? '' : html`style="opacity:.55"`}>
        <td><b>${s.name}</b>${s.code ? html` <small>${s.code}</small>` : ''}<br><small>${s.contact_name || ''} ${s.phone || ''}</small></td>
        <td>${badge(s.type)}</td>
        <td class="num">${s.type === 'company' ? '0% (cost)' : s.margin_pct != null ? num(s.margin_pct) + '%' : 'per product'}</td>
        <td>${s.email || html`<span class="badge warn">missing</span>`}</td>
        <td class="num">${owed[s.id] ? html`<a href="#/invoices?store=${s.id}&status=unpaid">${money(owed[s.id])}</a>` : '—'}</td>
        <td class="num"><div class="btn-row" style="justify-content:flex-end">
          <a class="btn small" href="#/dispatch/${s.id}">Stock out</a>
          ${mgr ? html`<button class="btn small" data-edit="${i}">Edit</button>` : ''}</div></td></tr>`)}</tbody></table>`
      : html`<div class="empty">No stores yet.</div>`}</div></div>`;

  const edit = s => {
    s = s || { type: 'franchise', active: true };
    const m = modal(s.id ? 'Edit store' : 'Add store', html`<form autocomplete="off">
      <div class="grid two">
        <label>Store name<input name="name" required value="${s.name || ''}"></label>
        <label>Short code <span class="hint">(optional)</span><input name="code" value="${s.code || ''}"></label>
        <label>Type<select name="type"><option value="franchise" ${s.type === 'franchise' ? 'selected' : ''}>Franchise (cost + margin)</option>
          <option value="company" ${s.type === 'company' ? 'selected' : ''}>Company owned (cost, no margin)</option></select></label>
        <label data-margin>Agreed margin % <span class="hint">(blank = each product's margin)</span><input name="margin_pct" type="number" step="0.01" value="${s.margin_pct ?? ''}"></label>
        <label>Contact name<input name="contact_name" value="${s.contact_name || ''}"></label>
        <label>Phone<input name="phone" type="tel" value="${s.phone || ''}"></label>
        <label>Invoice email<input name="email" type="email" value="${s.email || ''}"></label>
        <label>Payment terms (days) <span class="hint">(blank = ${state.settings.payment_terms_days})</span><input name="payment_terms_days" type="number" min="0" value="${s.payment_terms_days ?? ''}"></label>
        <label>Accounts reference <span class="hint">(Xero / Sage contact)</span><input name="account_ref" value="${s.account_ref || ''}"></label>
      </div>
      <label>Address <span class="hint">(goes on invoices)</span><textarea name="address">${s.address || ''}</textarea></label>
      <label>Notes<textarea name="notes">${s.notes || ''}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>`);
    const form = m.el.querySelector('form');
    const sync = () => m.el.querySelector('[data-margin]').classList.toggle('hidden', form.type.value === 'company');
    form.type.onchange = sync; sync();
    form.onsubmit = e => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        f.margin_pct = f.type === 'company' || f.margin_pct == null ? null : Number(f.margin_pct);
        f.payment_terms_days = f.payment_terms_days == null ? null : Number(f.payment_terms_days);
        try {
          if (s.id) await q(sb.from('stores').update(f).eq('id', s.id)); else await q(sb.from('stores').insert(f));
          m.close(); toast('Saved', 'ok'); render(main);
        } catch (err) { fail(err); }
      });
    };
  };
  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = () => edit();
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(stores[b.dataset.edit]));
}
