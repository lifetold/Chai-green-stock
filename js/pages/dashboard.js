import { sb, q, rpc, state, html, money, num, date, dateTime, badge, isManager } from '../lib.js';

export async function render(main) {
  const [s, low, rota, recent, expiring] = await Promise.all([
    rpc('dashboard_summary'),
    q(sb.from('product_stock').select('id, name, qty_on_hand, unit, eff_reorder_point, on_order, stock_status, supplier_name, lead_days')
      .in('stock_status', ['out', 'reorder']).order('qty_on_hand').limit(8)),
    rpc('check_rota', { p_weeks: 1 }),
    q(sb.from('stock_movements').select('created_at, type, qty_change, ref_text, products(name), stores(name)')
      .order('created_at', { ascending: false }).limit(8)),
    q(sb.from('stock_batches').select('qty_remaining, expiry_date, products(id, name, unit)')
      .gt('qty_remaining', 0).not('expiry_date', 'is', null)
      .lte('expiry_date', new Date(Date.now() + state.settings.expiry_warning_days * 864e5).toISOString().slice(0, 10))
      .order('expiry_date').limit(8))
  ]);
  const week = rota[0];
  const mine = week?.assigned_to === state.profile.id;
  const TYPE = { goods_in: 'Goods in', dispatch: 'Stock out', adjustment: 'Adjustment', stock_check: 'Stock check', void_return: 'Invoice void' };

  main.innerHTML = html`
    <div class="page-head"><div><h1>Hello ${(state.profile.full_name || '').split(' ')[0] || 'there'}</h1>
      <p class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div class="btn-row">
        <a class="btn primary" href="#/goods-in">📥 Goods in</a>
        <a class="btn primary" href="#/dispatch">📤 Stock out</a>
      </div></div>

    ${week && week.status !== 'approved' ? html`<div class="notice ${mine ? 'warn' : ''}">
      ✅ This week's stock check (${num(week.product_count)} products) is
      ${week.assigned_name ? html`on <b>${week.assigned_name}</b>'s rota` : 'not assigned'} —
      ${badge(week.status)} <a href="#/stock-check">${mine ? 'Start counting' : 'Open'}</a></div>` : ''}

    <div class="stats">
      <a class="stat ${s.out_of_stock ? 'bad' : ''}" href="#/stock?status=out"><div class="label">Out of stock</div><div class="value">${s.out_of_stock}</div></a>
      <a class="stat ${s.to_reorder ? 'warn' : ''}" href="#/reorder"><div class="label">Need reordering</div><div class="value">${s.to_reorder}</div></a>
      <a class="stat ${s.expiring ? 'warn' : ''}" href="#/stock?status=expiring"><div class="label">Going out of date soon</div><div class="value">${s.expiring}</div></a>
      <a class="stat ${s.overdue_pos ? 'warn' : ''}" href="#/purchase-orders"><div class="label">Orders on the way${s.overdue_pos ? ` (${s.overdue_pos} late)` : ''}</div><div class="value">${s.on_order}</div></a>
      ${isManager() ? html`
      <a class="stat" href="#/stock"><div class="label">Stock value (cost)</div><div class="value">${money(s.stock_value)}</div></a>
      <a class="stat ${s.overdue_total > 0 ? 'bad' : ''}" href="#/invoices"><div class="label">Unpaid invoices${s.overdue_total > 0 ? ` (${money(s.overdue_total)} overdue)` : ''}</div><div class="value">${money(s.unpaid_total)}</div></a>
      <a class="stat" href="#/invoices"><div class="label">Invoiced last 7 days</div><div class="value">${money(s.dispatched_7d)}</div></a>` : ''}
    </div>

    <div class="grid two">
      <div class="card"><h2>Running low</h2>
        ${low.length ? html`<div class="table-wrap"><table><tbody>${low.map(p => html`
          <tr class="click" data-href="#/product/${p.id}"><td>${p.name}<br><small>${p.supplier_name || 'No supplier'} · ${p.lead_days} day lead time</small></td>
          <td class="num">${num(p.qty_on_hand)} ${p.unit}<br>${badge(p.stock_status)}</td></tr>`)}</tbody></table></div>
          <p><a href="#/reorder">Reorder now →</a></p>` : html`<p class="muted">Nothing below its reorder level. 👍</p>`}
      </div>
      <div class="card"><h2>Going out of date</h2>
        ${expiring.length ? html`<div class="table-wrap"><table><tbody>${expiring.map(b => html`
          <tr class="click" data-href="#/product/${b.products.id}"><td>${b.products.name}</td>
          <td class="num">${num(b.qty_remaining)} ${b.products.unit}<br>
          ${badge(new Date(b.expiry_date) < new Date() ? 'out' : 'reorder', 'Use by ' + date(b.expiry_date))}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">Nothing due to go out of date in the next ${state.settings.expiry_warning_days} days.</p>`}
      </div>
    </div>

    <div class="card"><h2>Latest stock movements</h2>
      ${recent.length ? html`<div class="table-wrap"><table><tbody>${recent.map(m => html`
        <tr><td>${dateTime(m.created_at)}</td><td>${TYPE[m.type]}${m.stores ? html` → ${m.stores.name}` : ''}<br><small>${m.ref_text}</small></td>
        <td>${m.products?.name}</td><td class="num">${m.qty_change > 0 ? '+' : ''}${num(m.qty_change)}</td></tr>`)}</tbody></table></div>
        <p><a href="#/movements">All stock history →</a></p>` : html`<p class="muted">No stock movements yet. Start with <a href="#/goods-in">Goods in</a>.</p>`}
    </div>`;

  main.querySelectorAll('[data-href]').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
}
