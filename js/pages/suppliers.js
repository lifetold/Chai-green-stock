// Suppliers and their default delivery lead times. A supplier can also be a
// logistics company that stores and delivers products for us; its charge per
// unit is added to the cost of every product it stores.
import { sb, q, html, raw, esc, money, num, formData, modal, busy, fail, toast, isManager } from '../lib.js';

export async function render(main) {
  const [sups, prods] = await Promise.all([
    q(sb.from('suppliers').select('*').order('name')),
    q(sb.from('products').select('id, category, supplier_id, stored_by').eq('active', true))
  ]);
  const n = {}, stored = {};
  prods.forEach(p => {
    n[p.supplier_id] = (n[p.supplier_id] || 0) + 1;
    if (p.stored_by) stored[p.stored_by] = (stored[p.stored_by] || 0) + 1;
  });
  const mgr = isManager();
  main.innerHTML = html`
    <div class="page-head"><div><h1>Suppliers</h1><p class="muted">The lead time here is used for any product that doesn't have its own.
      Logistics companies store and deliver for you; their charge is added to each product's cost.</p></div>
      ${mgr ? html`<button class="btn primary" data-new>+ Add supplier</button>` : ''}</div>
    <div class="card"><div class="table-wrap">${sups.length ? html`<table>
      <thead><tr><th>Supplier</th><th>Contact</th><th class="num">Lead time</th><th class="num">Min order</th><th class="num">Products</th><th></th></tr></thead>
      <tbody>${sups.map((s, i) => html`<tr ${s.active ? '' : html`style="opacity:.55"`}><td><b>${s.name}</b>
          ${s.is_logistics ? html` <span class="badge on_order">Logistics</span>` : ''}
          ${s.account_ref ? html`<br><small>Account ${s.account_ref}</small>` : ''}
          ${s.is_logistics ? html`<br><small>Stores ${num(stored[s.id] || 0)} products · ${money(s.logistics_cost_per_unit || 0)} per unit</small>` : ''}</td>
        <td>${s.contact_name || ''}<br><small>${s.email || ''} ${s.phone || ''}</small></td>
        <td class="num">${num(s.default_lead_time_days)} days</td><td class="num">${s.min_order_value ? money(s.min_order_value) : '—'}</td>
        <td class="num">${num(n[s.id] || 0)}</td>
        <td class="num">${mgr ? html`<div class="btn-row" style="justify-content:flex-end">
          ${s.is_logistics ? html`<button class="btn small" data-assign="${i}">Products they store</button>` : ''}
          <button class="btn small" data-edit="${i}">Edit</button></div>` : ''}</td></tr>`)}</tbody></table>`
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
      <label class="check"><input type="checkbox" name="is_logistics" ${s.is_logistics ? 'checked' : ''}> This is a logistics company (stores and delivers for us)</label>
      <div data-lg>
        <label>Their charge per unit £ <span class="hint">(storage + handling + delivery, added to the cost of each unit they store)</span>
          <input name="logistics_cost_per_unit" type="number" step="0.0001" min="0" inputmode="decimal" value="${s.logistics_cost_per_unit ?? ''}"></label>
        <label>Their rates <span class="hint">(for reference, e.g. £8 per pallet per week, £1.20 per pick, £25 per drop)</span>
          <textarea name="logistics_rates">${s.logistics_rates || ''}</textarea></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>`);
    const form = m.el.querySelector('form');
    const sync = () => m.el.querySelector('[data-lg]').classList.toggle('hidden', !form.is_logistics.checked);
    form.is_logistics.onchange = sync; sync();
    form.onsubmit = e => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        f.default_lead_time_days = Number(f.default_lead_time_days);
        f.min_order_value = f.min_order_value == null ? null : Number(f.min_order_value);
        f.logistics_cost_per_unit = f.logistics_cost_per_unit == null ? null : Number(f.logistics_cost_per_unit);
        try {
          if (s.id) await q(sb.from('suppliers').update(f).eq('id', s.id)); else await q(sb.from('suppliers').insert(f));
          m.close(); toast('Saved', 'ok'); render(main);
        } catch (err) { fail(err); }
      });
    };
  };

  // Choose which categories (or individual products) a logistics company stores.
  const assign = s => {
    const cats = {};
    prods.forEach(p => {
      const c = p.category || 'Uncategorised';
      (cats[c] ||= { total: 0, here: 0, elsewhere: 0 }).total++;
      if (p.stored_by === s.id) cats[c].here++;
      else if (p.stored_by) cats[c].elsewhere++;
    });
    const names = Object.keys(cats).sort();
    const m = modal(`Products ${s.name} stores`, html`
      <p>Tick the categories ${s.name} stores and delivers for you. Everything else stays in your own warehouse.
        You can change single products on the product's own page.</p>
      <div>${names.map(c => html`<label class="check" style="font-weight:400">
        <input type="checkbox" value="${c}" ${cats[c].here === cats[c].total ? 'checked' : ''}>
        ${c} <span class="muted">&nbsp;(${cats[c].total}${cats[c].here && cats[c].here < cats[c].total ? `, ${cats[c].here} stored now` : ''}${cats[c].elsewhere ? `, ${cats[c].elsewhere} with another company` : ''})</span></label>`)}</div>
      <div class="actions"><button class="btn primary" data-save>Save</button></div>`);
    m.el.querySelector('[data-save]').onclick = e => busy(e.target, async () => {
      const ticked = new Set([...m.el.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value));
      const toThem = prods.filter(p => ticked.has(p.category || 'Uncategorised') && p.stored_by !== s.id).map(p => p.id);
      const back = prods.filter(p => !ticked.has(p.category || 'Uncategorised') && p.stored_by === s.id).map(p => p.id);
      try {
        if (toThem.length) await q(sb.from('products').update({ stored_by: s.id }).in('id', toThem));
        if (back.length) await q(sb.from('products').update({ stored_by: null }).in('id', back));
        m.close(); toast(`${toThem.length} moved to ${s.name}, ${back.length} back to your warehouse`, 'ok'); render(main);
      } catch (err) { fail(err); }
    });
  };

  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = () => edit();
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(sups[b.dataset.edit]));
  main.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => assign(sups[b.dataset.assign]));
}
