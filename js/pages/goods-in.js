// Goods in: scan each item off the delivery, photograph the delivery, book it in.
import { sb, q, rpc, html, raw, options, money, num, date, scanner, photoPicker, findByBarcode, busy, fail, toast,
  hydratePhotos, onLeave, confirmBox } from '../lib.js';
import { suppliers, unknownBarcode, pickProduct, stepper, bindSteppers, thumb } from '../widgets.js';
import { refreshCounts } from '../app.js';

export async function render(main, params) {
  const id = crypto.randomUUID();
  const [sups, pos] = await Promise.all([
    suppliers(true),
    q(sb.from('purchase_orders').select('id, ref, supplier_id, expected_at, suppliers(name)')
      .in('status', ['sent', 'part_received', 'draft']).order('expected_at'))
  ]);
  const lines = [];        // { product, qty, cost_price, expiry_date, batch_code }
  let poLines = [];        // expected lines when receiving against a PO

  main.innerHTML = html`
    <div class="page-head"><div><h1>Goods in</h1><p class="muted">Scan each item as it comes off the delivery.</p></div></div>
    <div class="card">
      <div class="grid two">
        <label>Supplier<select name="supplier">${raw(options(sups, null, { blank: '— choose —' }))}</select></label>
        <label>Purchase order <span class="hint">(if there is one)</span><select name="po"></select></label>
        <label>Delivery note / invoice no.<input name="ref" placeholder="from the paperwork"></label>
      </div>
    </div>
    <div class="card" data-expected hidden></div>
    <div class="card">
      <h2>Items received</h2>
      <div data-scan></div>
      <p><button class="btn small" data-search>Item has no barcode? Search by name</button></p>
      <ul class="lines" data-lines></ul>
      <p class="muted" data-empty>Nothing scanned yet.</p>
    </div>
    <div class="card">
      <h2>Photos of the delivery</h2>
      <p class="muted">Photograph the pallet / boxes and the delivery note, especially anything damaged.</p>
      <div data-photos></div>
      <label>Notes <span class="hint">(damage, shortages, driver name…)</span><textarea name="notes"></textarea></label>
    </div>
    <button class="btn primary big" data-save>Book in delivery</button>`;

  const $ = s => main.querySelector(s);
  const photos = photoPicker($('[data-photos]'), 'goods_in/' + id, { label: 'Photo' });

  const fillPos = () => {
    const sup = $('[name=supplier]').value;
    const list = pos.filter(p => !sup || p.supplier_id === sup)
      .map(p => ({ id: p.id, name: `${p.ref} · ${p.suppliers?.name || ''}${p.expected_at ? ' · due ' + date(p.expected_at) : ''}` }));
    $('[name=po]').innerHTML = options(list, $('[name=po]').value || params[0], { blank: '— none —' });
  };
  fillPos();
  $('[name=supplier]').onchange = fillPos;
  $('[name=po]').onchange = loadPo;
  if (params[0]) loadPo();

  async function loadPo() {
    const poId = $('[name=po]').value;
    const box = $('[data-expected]');
    poLines = [];
    if (!poId) { box.hidden = true; return; }
    const po = pos.find(p => p.id === poId);
    if (po) $('[name=supplier]').value = po.supplier_id;
    poLines = await q(sb.from('po_lines').select('product_id, qty_ordered, qty_received, unit_cost, products(name, unit)').eq('po_id', poId));
    box.hidden = false;
    drawExpected();
  }
  function drawExpected() {
    const box = $('[data-expected]');
    if (!poLines.length) { box.hidden = true; return; }
    box.innerHTML = html`<h2>Expected on this order</h2><div class="table-wrap"><table>
      <thead><tr><th>Product</th><th class="num">Ordered</th><th class="num">Already in</th><th class="num">Scanned now</th></tr></thead>
      <tbody>${poLines.map(l => {
        const now = lines.filter(x => x.product.id === l.product_id).reduce((a, x) => a + Number(x.qty), 0);
        const done = Number(l.qty_received) + now >= Number(l.qty_ordered);
        return html`<tr><td>${done ? '✅ ' : ''}${l.products.name}</td><td class="num">${num(l.qty_ordered)}</td>
          <td class="num">${num(l.qty_received)}</td><td class="num">${num(now)}</td></tr>`;
      })}</tbody></table></div>`;
  }

  async function addProduct(p) {
    const existing = lines.find(l => l.product.id === p.id);
    if (existing) existing.qty = Number(existing.qty) + 1;
    else {
      const po = poLines.find(l => l.product_id === p.id);
      lines.unshift({ product: p, qty: 1, cost_price: po?.unit_cost ?? p.cost_price, expiry_date: '', batch_code: '' });
    }
    draw();
  }

  const scan = scanner($('[data-scan]'), async code => {
    try {
      let p = await findByBarcode(code);
      if (!p) {
        scan.stop();
        p = await unknownBarcode(code, { supplierId: $('[name=supplier]').value || null });
      }
      if (p) { addProduct(p); toast('+1 ' + p.name); }
    } catch (e) { fail(e); }
  });
  onLeave(() => scan.stop());
  $('[data-search]').onclick = async () => { const p = await pickProduct(); if (p) addProduct(p); };

  function draw() {
    $('[data-empty]').hidden = lines.length > 0;
    $('[data-lines]').innerHTML = html`${lines.map((l, i) => html`<li>
      ${thumb(l.product)}
      <div class="info"><div class="name">${l.product.name}</div>
        <div class="sub">${l.product.pack_size || ''} ${l.product.unit} · in stock ${num(l.product.qty_on_hand)}</div>
        <div class="row" style="margin-top:.35rem">
          <label style="margin:0">Cost £<input class="qty-input" type="number" step="0.01" min="0" inputmode="decimal" data-cost="${i}" value="${l.cost_price ?? ''}"></label>
          ${l.product.track_expiry ? html`<label style="margin:0">Use by<input type="date" data-exp="${i}" value="${l.expiry_date}" required></label>
            <button type="button" class="btn small" data-split="${i}" title="Some of these have a different use-by date">+ another date</button>` : ''}
        </div>
      </div>
      ${stepper(i, l.qty)}</li>`)}`;
    bindSteppers($('[data-lines]'), lines, draw);
    main.querySelectorAll('[data-cost]').forEach(inp => inp.onchange = () => { lines[inp.dataset.cost].cost_price = inp.value; });
    main.querySelectorAll('[data-split]').forEach(b => b.onclick = () => {
      const l = lines[b.dataset.split];
      lines.splice(Number(b.dataset.split) + 1, 0, { ...l, qty: 1, expiry_date: '' });
      draw();
    });
    main.querySelectorAll('[data-exp]').forEach(inp => inp.onchange = () => { lines[inp.dataset.exp].expiry_date = inp.value; });
    hydratePhotos($('[data-lines]'));
    if (poLines.length) drawExpected();
  }
  draw();

  $('[data-save]').onclick = e => busy(e.target, async () => {
    if (!lines.length) return toast('Scan at least one item.', 'bad');
    if (photos.busy()) return toast('Wait for the photos to finish uploading.');
    const noExpiry = lines.find(l => l.product.track_expiry && !l.expiry_date);
    if (noExpiry) return toast(`Enter the use-by date for ${noExpiry.product.name}.`, 'bad');
    if (!photos.paths().length && !(await confirmBox('No photos', 'Book in without a photo of the delivery?', 'Book in anyway'))) return;
    try {
      await rpc('receive_goods', {
        p_id: id,
        p_supplier: $('[name=supplier]').value || null,
        p_po: $('[name=po]').value || null,
        p_delivery_ref: $('[name=ref]').value,
        p_notes: $('[name=notes]').value,
        p_lines: lines.map(l => ({ product_id: l.product.id, qty: Number(l.qty), cost_price: l.cost_price === '' ? null : l.cost_price,
          expiry_date: l.expiry_date || null, batch_code: l.batch_code || null })),
        p_photo_paths: photos.paths()
      });
      const total = lines.reduce((a, l) => a + Number(l.qty) * Number(l.cost_price || 0), 0);
      const g = await q(sb.from('goods_in').select('ref').eq('id', id).single());
      refreshCounts();
      main.innerHTML = html`<div class="card"><div class="notice ok">✅ Delivery <b>${g.ref}</b> booked in:
        ${lines.length} line${lines.length > 1 ? 's' : ''}, ${num(lines.reduce((a, l) => a + Number(l.qty), 0))} items, ${money(total)} at cost.</div>
        <div class="btn-row"><button class="btn primary" data-again>Book in another delivery</button>
        <a class="btn" href="#/movements">View stock history</a></div></div>`;
      main.querySelector('[data-again]').onclick = () => render(main, []);
    } catch (err) { fail(err); }
  });
}
