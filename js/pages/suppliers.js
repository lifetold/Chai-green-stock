// Suppliers and their default delivery lead times.
import { sb, q, html, money, num, formData, modal, busy, fail, toast, isManager } from '../lib.js';

export async function render(main) {
  const [sups, counts] = await Promise.all([
    q(sb.from('suppliers').select('*').order('name')),
    q(sb.from('products').select('supplier_id').eq('active', true))
  ]);
  const n = {};
  counts.forEach(c => { n[c.supplier_id] = (n[c.supplier_id] || 0) + 1; });
  const mgr = isManager();
  main.innerHTML = html`
    <div class="page-head"><div><h1>Suppliers</h1><p class="muted">The lead time here is used for any product that doesn't have its own.</p></div>
      ${mgr ? html`<button class="btn primary" data-new>+ Add supplier</button>` : ''}</div>
    <div class="card"><div class="table-wrap">${sups.length ? html`<table>
      <thead><tr><th>Supplier</th><th>Contact</th><th class="num">Lead time</th><th class="num">Min order</th><th class="num">Products</th><th></th></tr></thead>
      <tbody>${sups.map((s, i) => html`<tr ${s.active ? '' : html`style="opacity:.55"`}><td><b>${s.name}</b>${s.account_ref ? html`<br><small>Account ${s.account_ref}</small>` : ''}</td>
        <td>${s.contact_name || ''}<br><small>${s.email || ''} ${s.phone || ''}</small></td>
        <td class="num">${num(s.default_lead_time_days)} days</td><td class="num">${s.min_order_value ? money(s.min_order_value) : '—'}</td>
        <td class="num">${num(n[s.id] || 0)}</td>
        <td class="num">${mgr ? html`<button class="btn small" data-edit="${i}">Edit</button>` : ''}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">No suppliers yet.</div>`}</div></div>`;

  const edit = s => {
    s = s || { active: true, default_lead_time_days: 7 };
    const m = modal(s.id ? 'Edit supplier' : 'Add supplier', html`<form autocomplete="off"><div class="grid two">
      <label>Name<input name="name" required value="${s.name || ''}"></label>
      <label>Our account number with them<input name="account_ref" value="${s.account_ref || ''}"></label>
      <label>Contact name<input name="contact_name" value="${s.contact_name || ''}"></label>
      <label>Order email<input name="email" type="email" value="${s.email || ''}"></label>
      <label>Phone<input name="phone" type="tel" value="${s.phone || ''}"></label>
      <label>Delivery lead time (days)<input name="default_lead_time_days" type="number" min="0" required value="${s.default_lead_time_days}"></label>
      <label>Minimum order £<input name="min_order_value" type="number" step="0.01" min="0" value="${s.min_order_value ?? ''}"></label>
      </div>
      <label>Address<textarea name="address">${s.address || ''}</textarea></label>
      <label>Notes <span class="hint">(order cut-off times, delivery days…)</span><textarea name="notes">${s.notes || ''}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>`);
    const form = m.el.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        f.default_lead_time_days = Number(f.default_lead_time_days);
        f.min_order_value = f.min_order_value == null ? null : Number(f.min_order_value);
        try {
          if (s.id) await q(sb.from('suppliers').update(f).eq('id', s.id)); else await q(sb.from('suppliers').insert(f));
          m.close(); toast('Saved', 'ok'); render(main);
        } catch (err) { fail(err); }
      });
    };
  };
  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = () => edit();
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(sups[b.dataset.edit]));
}
