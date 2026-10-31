// Users: switch new sign-ups on, set roles, choose who is on the stock-check rota.
import { sb, q, state, html, date, badge, fail, toast, isAdmin } from '../lib.js';
import { refreshCounts } from '../app.js';

export async function render(main) {
  if (!isAdmin()) { main.innerHTML = '<div class="notice bad">Admins only.</div>'; return; }
  const [users, stores] = await Promise.all([
    q(sb.from('profiles').select('*').order('active').order('full_name')),
    q(sb.from('stores').select('id, name').eq('active', true).order('name'))
  ]);
  const ROLES = [['staff', 'Warehouse staff'], ['manager', 'Head office manager'], ['admin', 'Admin'],
    ['store_manager', 'Store manager'], ['store', 'Store (shared device)'], ['inspector', 'EHO inspector (read-only)']];
  const STORE_ROLES = ['store_manager', 'store', 'inspector'];
  main.innerHTML = html`
    <div class="page-head"><div><h1>Users</h1>
      <p class="muted">New staff sign up on the login page with "New staff member", then you switch them on here.</p></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Store / access</th><th>Stock check rota</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map(u => html`<tr>
        <td><b>${u.full_name || ''}</b><br><small>${u.email} · joined ${date(u.created_at)}</small></td>
        <td><select data-role="${u.id}" ${u.id === state.profile.id ? 'disabled' : ''} style="min-height:36px">
          ${ROLES.map(([v, l]) => html`<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`)}</select></td>
        <td>${STORE_ROLES.includes(u.role) ? html`<select data-store="${u.id}" style="min-height:36px"><option value="">— choose store —</option>
          ${stores.map(s => html`<option value="${s.id}" ${u.store_id === s.id ? 'selected' : ''}>${s.name}</option>`)}</select>
          ${u.role === 'inspector' ? html`<br><small>Access until</small> <input type="date" data-expires="${u.id}" value="${u.access_expires_at ? u.access_expires_at.slice(0, 10) : ''}" style="min-height:36px">` : ''}` : ''}</td>
        <td><label class="check" style="margin:0"><input type="checkbox" data-rota="${u.id}" ${u.in_check_rota ? 'checked' : ''}> In rota</label></td>
        <td>${u.active ? badge('ok', 'Active') : badge('reorder', 'Waiting')}</td>
        <td class="num">${u.id === state.profile.id ? '' : u.active
          ? html`<button class="btn small danger" data-active="${u.id}" data-to="false">Switch off</button>`
          : html`<button class="btn small primary" data-active="${u.id}" data-to="true">Switch on</button>`}</td></tr>`)}</tbody></table></div>
      <p class="muted"><b>Warehouse staff</b>: goods in, stock out, counts, write-offs. <b>Head office manager</b>: also prices, products, stores, suppliers,
      purchase orders, invoices, stock-check approval, every store's food safety, recipes and the manual. <b>Admin</b>: also users.<br>
      <b>Store manager</b>: their store's checks, records, recipes, manual and team PINs. <b>Store (shared device)</b>: the tablet in a store; staff sign each check with their own PIN.
      <b>EHO inspector</b>: read-only food safety records and allergens for one store, until the date you set.</p></div>`;

  const save = (id, patch) => q(sb.from('profiles').update(patch).eq('id', id)).then(() => { toast('Saved', 'ok'); refreshCounts(); }, fail);
  main.querySelectorAll('[data-role]').forEach(s => s.onchange = async () => {
    const patch = { role: s.value };
    if (s.value === 'inspector') patch.access_expires_at = new Date(Date.now() + 7 * 864e5).toISOString();
    if (!STORE_ROLES.includes(s.value)) { patch.store_id = null; patch.access_expires_at = null; }
    await save(s.dataset.role, patch); render(main);
  });
  main.querySelectorAll('[data-store]').forEach(s => s.onchange = () => save(s.dataset.store, { store_id: s.value || null }));
  main.querySelectorAll('[data-expires]').forEach(i => i.onchange = () => save(i.dataset.expires, { access_expires_at: i.value ? i.value + 'T23:59:59' : null }));
  main.querySelectorAll('[data-rota]').forEach(c => c.onchange = () => save(c.dataset.rota, { in_check_rota: c.checked }));
  main.querySelectorAll('[data-active]').forEach(b => b.onclick = async () => { await save(b.dataset.active, { active: b.dataset.to === 'true' }); render(main); });
}
