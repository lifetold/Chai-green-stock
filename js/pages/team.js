// Store team: the people who sign the checks, each with their own 4-number PIN.
import { sb, q, rpc, state, html, badge, busy, fail, toast, modal, isManager } from '../lib.js';
import { myStoreId, storeSelect, bindStoreSelect } from './store-common.js';

export async function render(main) {
  const canManage = isManager() || state.profile.role === 'store_manager';
  if (!canManage) { main.innerHTML = '<div class="notice bad">Managers only.</div>'; return; }
  const stores = await q(sb.from('stores').select('id, name, code').eq('active', true).order('name'));
  if (!stores.length) { main.innerHTML = html`<div class="notice warn">Add a store first.</div>`; return; }
  const storeId = myStoreId(stores);
  const store = stores.find(s => s.id === storeId);
  const team = await q(sb.from('staff_members').select('id, store_id, name, role_title, active, created_at').eq('store_id', storeId).order('active', { ascending: false }).order('name'));
  main.innerHTML = html`
    <div class="page-head"><div><h1>Store team</h1><p class="muted">${store.name}. Everyone who does checks signs them with their own PIN.</p></div>
      <div class="btn-row">${storeSelect(stores, storeId)}<button class="btn primary" data-new>+ Add person</button></div></div>
    <div class="card"><div class="table-wrap">${team.length ? html`<table>
      <thead><tr><th>Name</th><th>Job</th><th>Status</th><th></th></tr></thead>
      <tbody>${team.map(m => html`<tr><td><b>${m.name}</b></td><td>${m.role_title || ''}</td>
        <td>${m.active ? badge('ok', 'Active') : badge('out', 'Left')}</td>
        <td class="num"><button class="btn small" data-edit="${m.id}">Edit / new PIN</button></td></tr>`)}</tbody></table>`
      : html`<div class="empty">No one added yet. Add each member of staff so they can sign their checks.</div>`}</div></div>`;
  bindStoreSelect(main, () => render(main));
  main.querySelector('[data-new]').onclick = () => edit({ store_id: storeId, active: true }, () => render(main));
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(team.find(m => m.id === b.dataset.edit), () => render(main)));
}

function edit(m, done) {
  const md = modal(m.id ? 'Edit team member' : 'Add team member', html`<form autocomplete="off">
    <label>Name<input name="name" required value="${m.name || ''}"></label>
    <label>Job <span class="hint">(e.g. Barista, Kitchen, Supervisor)</span><input name="role_title" value="${m.role_title || ''}"></label>
    <label>${m.id ? 'New PIN (leave blank to keep their PIN)' : '4-number PIN'}<input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" ${m.id ? '' : 'required'}></label>
    ${m.id ? html`<label class="check"><input type="checkbox" name="active" ${m.active ? 'checked' : ''}> Still works here</label>` : ''}
    <div class="actions"><button class="btn primary">Save</button></div></form>`);
  const form = md.el.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      try {
        await rpc('save_staff_member', { p_id: m.id || null, p_store: m.store_id, p_name: form.name.value, p_role_title: form.role_title.value,
          p_pin: form.pin.value || null, p_active: m.id ? form.active.checked : true });
        md.close(); toast('Saved', 'ok'); done();
      } catch (err) { fail(err); }
    });
  };
}
