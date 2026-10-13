// Full stock take: goes through every product one at a time, in stock-take
// sheet order. For each: count it, photograph it, scan its barcode (if it has
// one). Everything saves as you go, so it can be stopped and carried on later.
// When finished it's submitted for a manager to approve (on the Stock check page).
import { sb, q, rpc, html, raw, num, esc, scanner, photoPicker, hydratePhotos, busy, fail, toast, onLeave, runCleanups, confirmBox } from '../lib.js';

export async function render(main) {
  const open = await q(sb.from('stock_checks').select('id, created_at').eq('kind', 'full').eq('status', 'open')
    .order('created_at', { ascending: false }).limit(1).maybeSingle());
  if (!open) return intro(main);
  return run(main, open.id);
}

async function intro(main) {
  const [{ count }, last] = await Promise.all([
    sb.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
    q(sb.from('stock_checks').select('id, week_start, status').eq('kind', 'full').order('created_at', { ascending: false }).limit(1).maybeSingle())
  ]);
  main.innerHTML = html`
    <div class="page-head"><div><h1>Full stock take</h1>
      <p class="muted">Go through every product one at a time: count it, take a photo, and scan its barcode if it has one.</p></div></div>
    <div class="card">
      <p><b>${num(count)}</b> products to count. Your progress saves after every item, so you can stop and carry on later.</p>
      ${last ? html`<p class="muted">Last full stock take: ${new Date(last.week_start).toLocaleDateString('en-GB')} (${last.status === 'approved' ? 'approved' : 'waiting for approval'})
        · <a href="#/stock-check/${last.id}">view</a></p>` : ''}
      <button class="btn primary big" data-start>Start stock take</button>
    </div>`;
  main.querySelector('[data-start]').onclick = e => busy(e.target, async () => {
    try { const id = await rpc('start_full_stock_take', {}); run(main, id); } catch (err) { fail(err); }
  });
}

async function run(main, checkId) {
  const lines = await q(sb.from('stock_check_lines')
    .select('product_id, counted_qty, products(id, name, category, unit, pack_size, qty_on_hand, photo_path, sort_order, location, product_barcodes(barcode))')
    .eq('check_id', checkId));
  lines.sort((a, b) => (a.products.sort_order ?? 1e9) - (b.products.sort_order ?? 1e9) || a.products.name.localeCompare(b.products.name));
  // start at the first item not yet counted
  let i = Math.max(0, lines.findIndex(l => l.counted_qty == null));
  if (lines.every(l => l.counted_qty != null)) i = lines.length;
  show();

  function show() {
    runCleanups();
    window.scrollTo(0, 0);
    if (i >= lines.length) return finish();
    const l = lines[i];
    const p = l.products;
    const done = lines.filter(x => x.counted_qty != null).length;
    const codes = p.product_barcodes.map(b => b.barcode);
    main.innerHTML = html`
      <div class="page-head" style="margin-bottom:.5rem"><div><h1>Stock take</h1>
        <p class="muted">Item ${i + 1} of ${lines.length} · ${done} counted</p></div>
        <button class="btn small" data-list>List</button></div>
      <div style="height:6px;background:var(--line);border-radius:3px;margin-bottom:1rem">
        <div style="height:6px;width:${raw(String(Math.round(done / lines.length * 100)))}%;background:var(--green);border-radius:3px"></div></div>
      <div class="card">
        <div class="muted" style="font-size:.85rem">${p.category || ''}${p.location ? ' · ' + p.location : ''}</div>
        <h2 style="margin:.2rem 0 .6rem;font-size:1.35rem">${p.name}</h2>
        ${p.photo_path ? html`<div class="photos"><div class="ph"><img data-photo="${p.photo_path}" alt=""></div></div>` : ''}
        <p>Current stock: <b>${num(p.qty_on_hand)}</b>${p.unit && p.unit !== 'each' ? ' ' + p.unit : ''}
          ${l.counted_qty != null ? html` · you counted <b>${num(l.counted_qty)}</b>` : ''}</p>

        <label>How many are there?</label>
        <div class="row">
          <input class="grow" type="number" inputmode="decimal" min="0" step="any" data-stock-count
            value="${l.counted_qty ?? ''}" style="font-size:1.4rem;text-align:center">
          <button class="btn" data-same>Same (${num(p.qty_on_hand)})</button>
        </div>

        <label>Photo <span class="hint">(${p.photo_path ? 'optional, already has one' : 'so everyone recognises it'})</span></label>
        <div data-photo-box></div>

        <label>Barcode <span class="hint">(skip if it hasn't got one)</span></label>
        ${codes.length ? html`<p class="muted" data-codes>Linked: ${codes.join(', ')}</p>` : html`<p class="muted" data-codes>None linked yet.</p>`}
        <div data-scan></div>
      </div>
      <button class="btn primary big" data-next>Save &amp; next →</button>
      <div class="btn-row" style="margin-top:.75rem;justify-content:space-between">
        <button class="btn" data-prev ${i === 0 ? 'disabled' : ''}>← Back</button>
        <button class="btn" data-skip>Skip for now</button>
      </div>`;
    hydratePhotos(main);
    const $ = s => main.querySelector(s);
    const count = $('[data-stock-count]');

    photoPicker($('[data-photo-box]'), 'products/' + p.id, {
      label: 'Take photo',
      onAdd: async path => {
        try {
          await rpc('stocktake_record', { p_check: checkId, p_product: p.id, p_counted: null, p_barcode: null, p_photo_path: path });
          if (!p.photo_path) p.photo_path = path;
          toast('Photo saved', 'ok');
        } catch (e) { fail(e); }
      }
    });

    const scan = scanner($('[data-scan]'), async code => {
      try {
        await rpc('stocktake_record', { p_check: checkId, p_product: p.id, p_counted: null, p_barcode: code, p_photo_path: null });
        scan.stop();
        if (!codes.includes(code)) codes.push(code);
        p.product_barcodes = codes.map(barcode => ({ barcode }));
        $('[data-codes]').textContent = 'Linked: ' + codes.join(', ');
        toast('Barcode saved', 'ok');
      } catch (e) { fail(e); }
    }, { continuous: false, placeholder: 'Scan or type the barcode' });
    onLeave(() => scan.stop());

    $('[data-same]').onclick = () => { count.value = p.qty_on_hand; };
    $('[data-next]').onclick = e => busy(e.target, async () => {
      if (count.value === '') return toast('Type how many there are (0 if none).', 'bad');
      try {
        const v = Number(count.value);
        await rpc('stocktake_record', { p_check: checkId, p_product: p.id, p_counted: v, p_barcode: null, p_photo_path: null });
        l.counted_qty = v;
        i++;
        show();
      } catch (err) { fail(err); }
    });
    $('[data-skip]').onclick = () => { i++; show(); };
    $('[data-prev]').onclick = () => { i = Math.max(0, i - 1); show(); };
    $('[data-list]').onclick = () => showList();
    setTimeout(() => count.focus(), 50);
  }

  function showList() {
    runCleanups();
    main.innerHTML = html`
      <div class="page-head"><div><h1>Stock take list</h1>
        <p class="muted">${lines.filter(x => x.counted_qty != null).length} of ${lines.length} counted. Tap an item to go to it.</p></div>
        <button class="btn" data-back>Back</button></div>
      <div class="card"><div class="table-wrap"><table><tbody>
        ${lines.map((l, n) => html`<tr class="click" data-n="${n}">
          <td>${l.counted_qty != null ? '✅' : '⬜'}</td>
          <td>${l.products.name}<br><small>${l.products.category || ''}</small></td>
          <td class="num">${l.counted_qty != null ? num(l.counted_qty) : ''}</td></tr>`)}
      </tbody></table></div></div>`;
    main.querySelector('[data-back]').onclick = () => show();
    main.querySelectorAll('[data-n]').forEach(tr => tr.onclick = () => { i = Number(tr.dataset.n); show(); });
    window.scrollTo(0, 0);
  }

  function finish() {
    const left = lines.filter(l => l.counted_qty == null);
    const diffs = lines.filter(l => l.counted_qty != null && Number(l.counted_qty) !== Number(l.products.qty_on_hand)).length;
    main.innerHTML = html`
      <div class="page-head"><div><h1>Stock take</h1></div></div>
      <div class="card">
        ${left.length
          ? html`<div class="notice warn">${left.length} item${left.length > 1 ? 's' : ''} still to count.</div>
              <button class="btn primary big" data-goto>Count the next one</button>
              <p></p><button class="btn" data-list>See the list</button>`
          : html`<div class="notice ok">✅ All ${lines.length} items counted. ${diffs} differ from the current stock figure.</div>
              <p>Submit it and a manager approves it on the Stock check page. Stock figures are corrected when it's approved.</p>
              <button class="btn primary big" data-submit>Submit stock take</button>`}
      </div>`;
    const $ = s => main.querySelector(s);
    if ($('[data-goto]')) $('[data-goto]').onclick = () => { i = lines.indexOf(left[0]); show(); };
    if ($('[data-list]')) $('[data-list]').onclick = () => showList();
    if ($('[data-submit]')) $('[data-submit]').onclick = e => busy(e.target, async () => {
      try {
        await rpc('submit_stock_check', { p_check: checkId });
        toast('Stock take submitted', 'ok');
        location.hash = '#/stock-check/' + checkId;
      } catch (err) { fail(err); }
    });
  }
}
