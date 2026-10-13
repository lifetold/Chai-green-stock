// Users: switch new sign-ups on, set roles, choose who is on the stock-check rota.
import { sb, q, state, html, date, badge, fail, toast, isAdmin } from '../lib.js';
import { refreshCounts } from '../app.js';

export async function render(main) {
  if (!isAdmin()) { main.innerHTML = '<div class="notice bad">Admins only.</div>'; return; }
  const users = await q(sb.from('profiles').select('*').order('active').order('full_name'));
  main.innerHTML = html`
    <div class="page-head"><div><h1>Users</h1>
      <p class="muted">New staff sign up on the login page with "New staff member", then you switch them on here.</p></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Stock check rota</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map(u => html`<tr>
        <td><b>${u.full_name || ''}</b><br><small>${u.email} · joined ${date(u.created_at)}</small></td>
        <td><select data-role="${u.id}" ${u.id === state.profile.id ? 'disabled' : ''} style="min-height:36px">
          ${[['staff', 'Staff'], ['manager', 'Manager'], ['admin', 'Admin']].map(([v, l]) => html`<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`)}</select></td>
        <td><label class="check" style="margin:0"><input type="checkbox" data-rota="${u.id}" ${u.in_check_rota ? 'checked' : ''}> In rota</label></td>
        <td>${u.active ? badge('ok', 'Active') : badge('reorder', 'Waiting')}</td>
        <td class="num">${u.id === state.profile.id ? '' : u.active
          ? html`<button class="btn small danger" data-active="${u.id}" data-to="false">Switch off</button>`
          : html`<button class="btn small primary" data-active="${u.id}" data-to="true">Switch on</button>`}</td></tr>`)}</tbody></table></div>
      <p class="muted"><b>Staff</b>: goods in, stock out, counts, write-offs. <b>Manager</b>: also prices, products, stores, suppliers, purchase orders,
      invoices, approving stock checks. <b>Admin</b>: also users.</p></div>`;

  const save = (id, patch) => q(sb.from('profiles').update(patch).eq('id', id)).then(() => { toast('Saved', 'ok'); refreshCounts(); }, fail);
  main.querySelectorAll('[data-role]').forEach(s => s.onchange = () => save(s.dataset.role, { role: s.value }));
  main.querySelectorAll('[data-rota]').forEach(c => c.onchange = () => save(c.dataset.rota, { in_check_rota: c.checked }));
  main.querySelectorAll('[data-active]').forEach(b => b.onclick = async () => { await save(b.dataset.active, { active: b.dataset.to === 'true' }); render(main); });
}
