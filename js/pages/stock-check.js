// Weekly stock check rota. Each week one group of products is counted (plus
// anything flagged "every week" and anything that was wrong last week), so the
// whole range is checked every few weeks. Counts are blind: the counter
// doesn't see what the system expects. A manager approves the variances.
import { sb, q, rpc, state, html, raw, num, money, date, dateTime, badge, busy, fail, toast, confirmBox, scanner,
  findByBarcode, isManager, onLeave, options } from '../lib.js';
import { refreshCounts } from '../app.js';

export async function render(main, params) {
  const mgr = isManager();
  const [rota, history] = await Promise.all([
    rpc('check_rota', { p_weeks: 8 }),
    q(sb.from('stock_checks').select('id, week_start, status, kind, profiles:assigned_to(full_name)').order('week_start', { ascending: false }).limit(12))
  ]);
  const thisWeek = rota[0];
  const checkId = params[0] || thisWeek.check_id;

  main.innerHTML = html`
    <div class="page-head"><div><h1>Stock check</h1>
      <p class="muted">Every product is counted at least once every ${state.settings.check_cycle_weeks} weeks.</p></div></div>
    <div data-check></div>
    <div class="grid two">
      <div class="card"><h2>Rota</h2><div class="table-wrap"><table>
        <thead><tr><th>Week of</th><th>Who</th><th class="num">Products</th><th>Status</th></tr></thead>
        <tbody>${rota.map(r => html`<tr><td>${date(r.week_start)}</td><td>${r.assigned_name || html`<span class="muted">nobody in rota</span>`}</td>
          <td class="num">${num(r.product_count)}</td><td>${badge(r.status)}</td></tr>`)}</tbody></table></div>
        <p class="muted">The rota takes turns through everyone ticked "In stock check rota" on the Users page.</p></div>
      <div class="card"><h2>Past checks</h2>${history.length ? html`<div class="table-wrap"><table><tbody>
        ${history.map(h => html`<tr class="click" data-id="${h.id}"><td>${date(h.week_start)}${h.kind === 'full' ? html`<br><small>Full stock take</small>` : ''}</td><td>${h.profiles?.full_name || ''}</td><td>${badge(h.status)}</td></tr>`)}
        </tbody></table></div>` : html`<p class="muted">None yet.</p>`}</div>
    </div>`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/stock-check/' + tr.dataset.id; });

  const box = main.querySelector('[data-check]');
  if (!checkId) {
    box.innerHTML = html`<div class="card"><h2>This week (w/c ${date(thisWeek.week_start)})</h2>
      <p>${num(thisWeek.product_count)} products to count. On the rota: <b>${thisWeek.assigned_name || 'nobody'}</b>.</p>
      <button class="btn primary big" data-start>Start this week's stock check</button></div>`;
    box.querySelector('[data-start]').onclick = e => busy(e.target, async () => {
      try { const id = await rpc('start_stock_check', {}); location.hash = '#/stock-check/' + id; } catch (err) { fail(err); }
    });
    return;
  }
  await showCheck(box, checkId, mgr, () => render(main, params));
}

async function showCheck(box, id, mgr, reload) {
  const [c, lines, people] = await Promise.all([
    q(sb.from('stock_checks').select('*, assigned:assigned_to(full_name), submitter:submitted_by(full_name), approver:approved_by(full_name)').eq('id', id).single()),
    q(sb.from('stock_check_lines').select('*, products(id, name, sku, location, unit, pack_size, cost_price, qty_on_hand), counter:counted_by(full_name)').eq('check_id', id)),
    mgr ? q(sb.from('profiles').select('id, full_name').eq('active', true).order('full_name')) : []
  ]);
  lines.sort((a, b) => (a.products.location || '~').localeCompare(b.products.location || '~') || a.products.name.localeCompare(b.products.name));
  const counted = lines.filter(l => l.counted_qty != null).length;
  const open = c.status === 'open';
  const review = mgr && c.status !== 'open';

  box.innerHTML = html`<div class="card">
    <div class="page-head" style="margin:0"><div><h2 style="margin-top:0">${c.kind === 'full' ? 'Full stock take ' + date(c.week_start) : 'Week of ' + date(c.week_start)} ${badge(c.status)}</h2>
      <p class="muted">${num(counted)} of ${num(lines.length)} counted · on the rota: ${c.assigned?.full_name || 'nobody'}
      ${c.submitted_at ? html` · submitted by ${c.submitter?.full_name} ${dateTime(c.submitted_at)}` : ''}
      ${c.approved_at ? html` · approved by ${c.approver?.full_name} ${dateTime(c.approved_at)}` : ''}</p></div>
      ${mgr && open ? html`<label style="margin:0">Assigned to<select data-assign>${raw(options(people, c.assigned_to, { blank: '—', label: 'full_name' }))}</select></label>` : ''}
    </div>
    ${open ? html`<p>Walk the warehouse in this order. Scan a product (or find it in the list) and type how many you count.
      Count what's actually there. Don't look at the system figure.</p><div data-scan></div>` : ''}
    <div class="table-wrap" style="margin-top:.75rem"><table>
      <thead><tr><th>Location</th><th>Product</th>${review ? html`<th class="num">System</th>` : ''}<th class="num">Counted</th>
        ${review ? html`<th class="num">Difference</th><th class="num">Value</th>` : ''}<th>By</th></tr></thead>
      <tbody>${lines.map(l => {
        const diff = l.counted_qty == null ? null : Number(l.counted_qty) - Number(l.expected_qty);
        return html`<tr data-row="${l.product_id}">
          <td>${l.products.location || '—'}</td>
          <td><b>${l.products.name}</b><br><small>${[l.products.sku, l.products.pack_size, l.products.unit].filter(Boolean).join(' · ')}</small></td>
          ${review ? html`<td class="num">${num(l.expected_qty)}</td>` : ''}
          <td class="num">${open
            ? html`<input class="qty-input" type="number" inputmode="decimal" min="0" step="any" data-counted="${l.product_id}" value="${l.counted_qty ?? ''}">`
            : num(l.counted_qty)}</td>
          ${review ? html`<td class="num">${diff ? html`<b style="color:${diff < 0 ? 'var(--red)' : 'var(--blue)'}">${diff > 0 ? '+' : ''}${num(diff)}</b>` : '✓'}</td>
            <td class="num">${diff ? money(diff * l.products.cost_price) : ''}</td>` : ''}
          <td><small>${l.counter?.full_name || ''}</small></td></tr>`;
      })}</tbody>
      ${review ? html`<tfoot><tr><td colspan="${5}"><b>Net difference at cost</b></td>
        <td class="num"><b>${money(lines.reduce((a, l) => a + (l.counted_qty == null ? 0 : (l.counted_qty - l.expected_qty) * l.products.cost_price), 0))}</b></td><td></td></tr></tfoot>` : ''}
    </table></div>
    <p></p>
    <div class="btn-row">
      ${open ? html`<button class="btn primary" data-submit>Finished — submit count</button>` : ''}
      ${mgr && c.status === 'submitted' ? html`<button class="btn primary" data-approve>Approve &amp; correct stock</button><button class="btn" data-reopen>Send back for recount</button>` : ''}
    </div></div>`;

  const $ = s => box.querySelector(s);
  box.querySelectorAll('[data-counted]').forEach(inp => inp.onchange = async () => {
    if (inp.value === '') return;
    try {
      await rpc('record_count', { p_check: id, p_product: inp.dataset.counted, p_counted: Number(inp.value), p_note: null });
      inp.style.background = 'var(--green-soft)';
    } catch (e) { fail(e); }
  });
  if (open) {
    const scan = scanner($('[data-scan]'), async code => {
      try {
        const p = await findByBarcode(code);
        if (!p) return toast(`Barcode ${code} isn't linked to a product.`, 'bad');
        const inp = box.querySelector(`[data-counted="${p.id}"]`);
        if (!inp) return toast(`${p.name} isn't in this week's check.`, 'bad');
        scan.stop();
        inp.scrollIntoView({ block: 'center' });
        inp.focus();
        inp.select();
      } catch (e) { fail(e); }
    }, { continuous: false });
    onLeave(() => scan.stop());
  }
  const assign = $('[data-assign]');
  if (assign) assign.onchange = () => q(sb.from('stock_checks').update({ assigned_to: assign.value || null }).eq('id', id)).then(() => toast('Saved', 'ok'), fail);
  const submit = $('[data-submit]');
  if (submit) submit.onclick = () => busy(submit, async () => {
    // save anything typed but not yet saved
    for (const inp of box.querySelectorAll('[data-counted]')) {
      if (inp.value !== '' && !inp.style.background) await rpc('record_count', { p_check: id, p_product: inp.dataset.counted, p_counted: Number(inp.value), p_note: null });
    }
    try { await rpc('submit_stock_check', { p_check: id }); toast('Submitted for approval', 'ok'); reload(); } catch (e) { fail(e); }
  });
  const approve = $('[data-approve]');
  if (approve) approve.onclick = async () => {
    if (!(await confirmBox('Approve stock check', 'Stock levels will be corrected to match the count. This is recorded in the stock history.', 'Approve'))) return;
    try { const n = await rpc('approve_stock_check', { p_check: id }); toast(`Approved. ${n} product${n === 1 ? '' : 's'} corrected.`, 'ok'); refreshCounts(); reload(); } catch (e) { fail(e); }
  };
  const reopen = $('[data-reopen]');
  if (reopen) reopen.onclick = () => rpc('reopen_stock_check', { p_check: id }).then(reload, fail);
}
