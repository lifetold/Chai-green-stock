// One product: details, pricing, barcodes, stock by use-by date, photos, history.
import { sb, q, state, html, raw, options, money, num, date, dateTime, badge, formData, busy, fail, toast, modal, confirmBox,
  photoPicker, hydratePhotos, photoStrip, scanner, isManager, onLeave } from '../lib.js';
import { suppliers, categories } from '../widgets.js';

const TYPE = { goods_in: 'Goods in', dispatch: 'Stock out', adjustment: 'Adjustment', stock_check: 'Stock check', void_return: 'Invoice void (returned)' };

export async function render(main, params) {
  const isNew = params[0] === 'new';
  const mgr = isManager();
  const [p, sups, cats, stores, logistics] = await Promise.all([
    isNew ? null : q(sb.from('product_stock').select('*').eq('id', params[0]).single()),
    suppliers(true), categories(), q(sb.from('stores').select('name, type, margin_pct').eq('active', true).order('name')),
    q(sb.from('suppliers').select('id, name').eq('is_logistics', true).eq('active', true).order('name'))
  ]);
  if (isNew && !mgr) { main.innerHTML = '<div class="notice bad">Only managers can add products here. Scan new items in at Goods in.</div>'; return; }
  const S = state.settings;
  const id = isNew ? crypto.randomUUID() : p.id;
  const v = p || { unit: 'each', active: true };

  const [barcodes, batches, moves, photos] = isNew ? [[], [], [], ''] : await Promise.all([
    q(sb.from('product_barcodes').select('*').eq('product_id', id).order('created_at')),
    q(sb.from('stock_batches').select('*').eq('product_id', id).gt('qty_remaining', 0).order('expiry_date', { nullsFirst: false }).order('received_at')),
    q(sb.from('stock_movements').select('*, stores(name), profiles:user_id(full_name)').eq('product_id', id).order('created_at', { ascending: false }).limit(60)),
    photoStrip('product', id)
  ]);

  const field = (name, label, attrs = '', hint = '') => html`<label>${label}${hint ? html` <span class="hint">(${hint})</span>` : ''}
    <input name="${name}" value="${v[name] ?? ''}" ${raw(attrs)} ${mgr ? '' : raw('disabled')}></label>`;

  main.innerHTML = html`
    <div class="page-head"><div><a href="#/stock">← Products &amp; stock</a>
      <h1>${isNew ? 'New product' : p.name}</h1>
      ${isNew ? '' : html`<p>${badge(p.stock_status)} <b>${num(p.qty_on_hand)} ${p.unit}</b> in stock
        ${p.on_order ? html` · ${num(p.on_order)} on order${p.next_due ? ' (due ' + date(p.next_due) + ')' : ''}` : ''}
        ${p.days_cover != null ? html` · about ${num(p.days_cover)} days' cover` : ''}</p>`}</div>
      ${isNew ? '' : html`<div class="btn-row"><a class="btn" href="#/adjust/${id}">Write-off / adjust</a>
        ${mgr ? html`<a class="btn" href="#/reorder/${id}">Order more</a>` : ''}</div>`}</div>

    ${isNew ? '' : html`<div class="card"><h2>Prices</h2><div class="price-grid">
      <div><div class="k">Cost (ex VAT)</div><div class="v">${money(p.cost_price)}</div></div>
      ${Number(p.logistics_unit_cost) > 0 ? html`<div><div class="k">+ Logistics (${p.stored_by_name})</div><div class="v">${money(p.logistics_unit_cost)}</div></div>
        <div><div class="k">Landed cost</div><div class="v">${money(p.landed_cost)}</div></div>` : ''}
      <div><div class="k">Company-owned stores</div><div class="v">${money(p.landed_cost)}</div><small>cost, no margin</small></div>
      <div><div class="k">Franchise stores</div><div class="v">${money(p.franchise_price)}</div><small>${Number(p.sell_price) > 0 ? 'selling price' : 'cost + ' + num(p.eff_margin_pct) + '%' + (p.margin_pct == null ? ' (default)' : '')}</small></div>
      <div><div class="k">VAT</div><div class="v">${num(p.eff_vat_rate)}%</div></div>
    </div>
    ${stores.some(s => s.type === 'franchise' && s.margin_pct != null) ? html`<p class="muted" style="margin-top:.75rem">Stores with their own agreed margin:
      ${stores.filter(s => s.type === 'franchise' && s.margin_pct != null).map((s, i) => html`${i ? ', ' : ''}${s.name} ${money(Math.round(p.landed_cost * (1 + s.margin_pct / 100) * 100) / 100)} (${num(s.margin_pct)}%)`)}</p>` : ''}
    </div>`}

    <form class="card" data-form autocomplete="off">
      <h2>Details</h2>
      <div class="grid two">
        ${field('name', 'Name', 'required')}
        ${field('sku', 'SKU / our code')}
        <label>Category<input name="category" list="cats" value="${v.category || ''}" ${mgr ? '' : raw('disabled')}>
          <datalist id="cats">${cats.map(c => html`<option value="${c}">`)}</datalist></label>
        <label>Counted in<input name="unit" list="units" value="${v.unit}" ${mgr ? '' : raw('disabled')}>
          <datalist id="units">${['each', 'case', 'box', 'bag', 'bottle', 'tub', 'pack', 'sleeve', 'kg', 'litre'].map(u => html`<option value="${u}">`)}</datalist></label>
        ${field('pack_size', 'Pack size', '', 'e.g. 6 x 1kg')}
        ${field('location', 'Warehouse location', '', 'bay / shelf / bin')}
        <label>Supplier<select name="supplier_id" ${mgr ? '' : raw('disabled')}>${raw(options(sups, v.supplier_id, { blank: '— none —' }))}</select></label>
        ${logistics.length || v.stored_by ? html`<label>Stored at<select name="stored_by" ${mgr ? '' : raw('disabled')}>${raw(options(logistics, v.stored_by, { blank: 'Our warehouse' }))}</select></label>` : ''}
        ${logistics.length ? field('logistics_cost', 'Logistics charge per unit £', 'type="number" step="0.0001" min="0" inputmode="decimal" placeholder="their standard charge"', 'only if stored by a logistics company') : ''}
        ${field('supplier_code', "Supplier's product code")}
      </div>
      <h3>Pricing</h3>
      <div class="grid three">
        ${field('cost_price', 'Cost price £', 'type="number" step="0.0001" min="0" inputmode="decimal"', 'per unit, ex VAT')}
        ${field('sell_price', 'Franchise selling price £', 'type="number" step="0.01" min="0" inputmode="decimal"', 'blank = cost + margin')}
        ${field('margin_pct', 'Franchise margin %', `type="number" step="0.01" placeholder="default ${S.default_margin_pct}%"`, 'used if no selling price')}
        <label>VAT rate<select name="vat_rate" ${mgr ? '' : raw('disabled')}>
          <option value="">Default (${num(S.default_vat_rate)}%)</option>
          ${[['20', '20% standard'], ['5', '5% reduced'], ['0', '0% zero-rated']].map(([r, l]) => html`<option value="${r}" ${v.vat_rate != null && Number(v.vat_rate) === Number(r) ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <h3>Reordering</h3>
      <div class="grid three">
        ${field('lead_time_days', 'Delivery lead time (days)', `type="number" min="0" placeholder="supplier default"`)}
        ${field('reorder_point', 'Reorder when stock falls to', `type="number" step="any" min="0" placeholder="auto${p ? ' (now ' + num(p.eff_reorder_point) + ')' : ''}"`, 'blank = work it out')}
        ${field('reorder_qty', 'Order quantity', `type="number" step="any" min="0" placeholder="auto${p ? ' (now ' + num(p.eff_reorder_qty) + ')' : ''}"`)}
        ${field('min_stock', 'Never below', 'type="number" step="any" min="0"', 'minimum to hold')}
      </div>
      <p class="muted">Auto reorder level = average daily use over the last ${S.usage_window_days} days × (lead time + ${S.safety_stock_days} safety days)${p ? ` = ${num(p.daily_usage)}/day × ${p.lead_days + S.safety_stock_days} days` : ''}.</p>
      <h3>Other</h3>
      <label class="check"><input type="checkbox" name="track_expiry" ${v.track_expiry ? 'checked' : ''} ${mgr ? '' : raw('disabled')}> Has a use-by / best-before date (asked at goods in, oldest sent out first)</label>
      <label class="check"><input type="checkbox" name="check_every_week" ${v.check_every_week ? 'checked' : ''} ${mgr ? '' : raw('disabled')}> Count in every weekly stock check (high value / high risk)</label>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} ${mgr ? '' : raw('disabled')}> Active</label>
      <label>Description / notes<textarea name="description" ${mgr ? '' : raw('disabled')}>${v.description || ''}</textarea></label>
      ${isNew ? html`<label>Photo of the packaging</label><div data-newphotos></div>` : ''}
      ${mgr ? html`<p></p><button class="btn primary" type="submit">${isNew ? 'Create product' : 'Save changes'}</button>` : ''}
    </form>

    ${isNew ? '' : html`
    <div class="card"><h2>Barcodes</h2>
      ${barcodes.length ? html`<ul class="lines">${barcodes.map(b => html`<li><div class="info"><div class="name">${b.barcode}</div>
        <div class="sub">${b.label || ''} added ${date(b.created_at)}</div></div>
        ${mgr ? html`<button class="btn small danger" data-unlink="${b.barcode}">Remove</button>` : ''}</li>`)}</ul>` : html`<p class="muted">No barcodes linked yet.</p>`}
      ${mgr ? html`<h3>Link another barcode</h3><div data-scan></div>` : ''}
    </div>

    <div class="card"><h2>Photos</h2><div class="photos">${raw(photos)}</div>
      <div data-addphotos style="margin-top:.5rem"></div></div>

    <div class="card"><h2>Stock by delivery</h2>
      ${batches.length ? html`<div class="table-wrap"><table><thead><tr><th>Received</th><th>Use by</th><th>Batch</th><th class="num">Left</th>${mgr ? html`<th class="num">Cost</th>` : ''}</tr></thead>
        <tbody>${batches.map(b => html`<tr><td>${date(b.received_at)}</td><td>${b.expiry_date ? date(b.expiry_date) : '—'}</td><td>${b.batch_code || ''}</td>
        <td class="num">${num(b.qty_remaining)} of ${num(b.qty_received)}</td>${mgr ? html`<td class="num">${money(b.cost_price)}</td>` : ''}</tr>`)}</tbody></table></div>
        <p class="muted">Stock out takes the earliest use-by date first, then the oldest delivery.</p>` : html`<p class="muted">None in stock.</p>`}
    </div>

    <div class="card"><h2>History</h2>
      ${moves.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>What</th><th>Who</th><th class="num">Change</th><th class="num">After</th></tr></thead>
        <tbody>${moves.map(m => html`<tr><td>${dateTime(m.created_at)}</td><td>${TYPE[m.type]}${m.stores ? ' → ' + m.stores.name : ''}<br><small>${m.ref_text}</small></td>
        <td>${m.profiles?.full_name || ''}</td><td class="num">${m.qty_change > 0 ? '+' : ''}${num(m.qty_change)}</td><td class="num">${num(m.qty_after)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">No stock movements yet.</p>`}
    </div>`}`;

  const $ = s => main.querySelector(s);
  hydratePhotos(main);
  const newPhotos = isNew ? photoPicker($('[data-newphotos]'), 'products/' + id, { label: 'Photo' }) : null;

  const form = $('[data-form]');
  form.onsubmit = e => {
    e.preventDefault();
    if (!mgr) return;
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        const f = formData(form);
        for (const k of ['cost_price', 'logistics_cost', 'sell_price', 'margin_pct', 'vat_rate', 'lead_time_days', 'reorder_point', 'reorder_qty', 'min_stock']) {
          f[k] = f[k] == null ? null : Number(f[k]);
        }
        f.cost_price = f.cost_price ?? 0;
        f.min_stock = f.min_stock ?? 0;
        if (isNew) {
          const paths = newPhotos.paths();
          await q(sb.from('products').insert({ ...f, id, photo_path: paths[0] || null, created_by: state.profile.id }));
          if (paths.length) await q(sb.from('photos').insert(paths.map(path => ({ kind: 'product', ref_id: id, path, taken_by: state.profile.id }))));
          toast('Product created', 'ok');
          location.hash = '#/product/' + id;
        } else {
          await q(sb.from('products').update(f).eq('id', id));
          toast('Saved', 'ok');
          render(main, params);
        }
      } catch (err) { fail(err); }
    });
  };
  if (isNew) return;

  main.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Remove barcode', `Unlink ${b.dataset.unlink} from ${p.name}?`, 'Remove', true))) return;
    try { await q(sb.from('product_barcodes').delete().eq('barcode', b.dataset.unlink)); render(main, params); } catch (e) { fail(e); }
  });
  if (mgr) {
    const scan = scanner($('[data-scan]'), async code => {
      try {
        await q(sb.from('product_barcodes').insert({ barcode: code, product_id: id }));
        scan.stop();
        toast('Barcode linked', 'ok');
        render(main, params);
      } catch (e) { fail(e); }
    }, { continuous: false });
    onLeave(() => scan.stop());
  }

  // Extra photos are saved straight away.
  let hasMain = !!p.photo_path;
  photoPicker($('[data-addphotos]'), 'products/' + id, {
    label: 'Add photo',
    onAdd: async path => {
      try {
        await q(sb.from('photos').insert({ kind: 'product', ref_id: id, path, taken_by: state.profile.id }));
        if (!hasMain && mgr) { await q(sb.from('products').update({ photo_path: path }).eq('id', id)); hasMain = true; }
        toast('Photo saved', 'ok');
      } catch (e) { fail(e); }
    }
  });
}
