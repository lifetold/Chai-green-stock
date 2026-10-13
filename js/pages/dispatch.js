// Stock out: pick the store, scan what's going, photograph it, get a
// signature. Booking it out takes it off stock and raises the invoice.
import { sb, q, rpc, state, html, raw, money, num, scanner, photoPicker, signaturePad, uploadBlob, findByBarcode,
  busy, fail, toast, hydratePhotos, onLeave, badge } from '../lib.js';
import { pickProduct, stepper, bindSteppers, thumb } from '../widgets.js';
import { refreshCounts } from '../app.js';

// Same rule as price_for() in the database (the database has the final say).
export function priceFor(product, store, settings) {
  if (!store) return { margin: 0, price: Number(product.cost_price) };
  const margin = store.type === 'company' ? 0
    : Number(store.margin_pct ?? product.margin_pct ?? settings.default_margin_pct);
  return { margin, price: Math.round(Number(product.cost_price) * (1 + margin / 100) * 100) / 100 };
}

export async function render(main, params) {
  const id = crypto.randomUUID();
  const stores = await q(sb.from('stores').select('*').eq('active', true).order('name'));
  const lines = [];   // { product, qty }
  const S = state.settings;

  if (!stores.length) {
    main.innerHTML = html`<h1>Stock out</h1><div class="notice warn">Add your stores first.
      <a href="#/stores">Go to Stores</a></div>`;
    return;
  }

  main.innerHTML = html`
    <div class="page-head"><div><h1>Stock out</h1><p class="muted">Scan everything going to the store. An invoice is raised when you book it out.</p></div></div>
    <div class="card">
      <label>Going to<select name="store"><option value="">— choose store —</option>
        ${stores.map(s => html`<option value="${s.id}" ${s.id === params[0] ? 'selected' : ''}>${s.name}${s.code ? ' (' + s.code + ')' : ''} — ${s.type === 'company' ? 'company owned' : 'franchise'}</option>`)}
      </select></label>
      <p data-store-info class="muted"></p>
    </div>
    <div class="card">
      <h2>Items going out</h2>
      <div data-scan></div>
      <p><button class="btn small" data-search>Item has no barcode? Search by name</button></p>
      <ul class="lines" data-lines></ul>
      <p class="muted" data-empty>Nothing scanned yet.</p>
      <div data-total></div>
    </div>
    <div class="card">
      <h2>Proof</h2>
      <p class="muted">Photograph everything going out${S.require_dispatch_photo ? ' (required)' : ''}: the loaded trolley, van or boxes.</p>
      <div data-photos></div>
      <div class="grid two">
        <label>How is it going?<select name="method"><option value="collection">Collected by the store</option><option value="delivery">We're delivering it</option></select></label>
        <label><span data-who-label>Collected by (name)</span><input name="collected_by" autocomplete="off"></label>
      </div>
      <label>Signature</label>
      <div data-sig></div>
      <label>Notes<textarea name="notes"></textarea></label>
    </div>
    <button class="btn primary big" data-save>Book out &amp; raise invoice</button>`;

  const $ = s => main.querySelector(s);
  const photos = photoPicker($('[data-photos]'), 'dispatch/' + id, { label: 'Photo' });
  const sig = signaturePad($('[data-sig]'));
  const store = () => stores.find(s => s.id === $('[name=store]').value);

  $('[name=method]').onchange = () => {
    $('[data-who-label]').textContent = $('[name=method]').value === 'delivery' ? 'Driver / received by (name)' : 'Collected by (name)';
  };
  $('[name=store]').onchange = () => { showStore(); draw(); };
  function showStore() {
    const s = store();
    $('[data-store-info]').innerHTML = s ? html`${badge(s.type)} ${s.type === 'company'
      ? 'Charged at cost, no margin.'
      : (s.margin_pct != null ? `Charged at cost + ${num(s.margin_pct)}% (this store's agreed margin).` : 'Charged at cost + each product\'s franchise margin.')}
      ${s.email ? html` Invoice email: ${s.email}` : html` <b>No invoice email set for this store.</b>`}` : '';
  }
  showStore();

  function addProduct(p) {
    const existing = lines.find(l => l.product.id === p.id);
    if (existing) existing.qty = Number(existing.qty) + 1;
    else lines.unshift({ product: p, qty: 1 });
    const l = existing || lines[0];
    if (Number(l.qty) > Number(p.qty_on_hand)) toast(`Only ${num(p.qty_on_hand)} ${p.name} in stock`, 'bad');
    draw();
  }

  const scan = scanner($('[data-scan]'), async code => {
    try {
      const p = await findByBarcode(code);
      if (!p) return toast(`Barcode ${code} isn't linked to a product. Book it in at Goods in first.`, 'bad');
      addProduct(p);
      toast('+1 ' + p.name);
    } catch (e) { fail(e); }
  });
  onLeave(() => scan.stop());
  $('[data-search]').onclick = async () => { const p = await pickProduct(); if (p) addProduct(p); };

  function draw() {
    const s = store();
    let net = 0, vat = 0;
    $('[data-empty]').hidden = lines.length > 0;
    $('[data-lines]').innerHTML = html`${lines.map((l, i) => {
      const { price } = priceFor(l.product, s, S);
      const lineNet = Math.round(price * l.qty * 100) / 100;
      const rate = Number(l.product.vat_rate ?? S.default_vat_rate);
      net += lineNet;
      vat += Math.round(lineNet * rate) / 100;
      const short = Number(l.qty) > Number(l.product.qty_on_hand);
      return html`<li>${thumb(l.product)}
        <div class="info"><div class="name">${l.product.name}</div>
        <div class="sub">${money(price)} each · ${short ? html`<b style="color:var(--red)">only ${num(l.product.qty_on_hand)} in stock</b>` : `${num(l.product.qty_on_hand)} in stock`}</div></div>
        ${stepper(i, l.qty)}</li>`;
    })}`;
    $('[data-total]').innerHTML = lines.length ? html`<table class="totals" style="max-width:320px;margin-left:auto"><tbody>
      <tr><td>Net</td><td class="num">${money(net)}</td></tr>
      <tr><td>VAT</td><td class="num">${money(vat)}</td></tr>
      <tr><td><b>Invoice total</b></td><td class="num"><b>${money(net + vat)}</b></td></tr></tbody></table>` : '';
    bindSteppers($('[data-lines]'), lines, draw);
    hydratePhotos($('[data-lines]'));
  }
  draw();

  $('[data-save]').onclick = e => busy(e.target, async () => {
    const s = store();
    if (!s) return toast('Choose which store this is going to.', 'bad');
    if (!lines.length) return toast('Scan at least one item.', 'bad');
    if (photos.busy()) return toast('Wait for the photos to finish uploading.');
    if (S.require_dispatch_photo && !photos.paths().length) return toast('Take at least one photo of the stock going out.', 'bad');
    const who = $('[name=collected_by]').value.trim();
    if (!who) return toast('Enter the name of the person collecting / receiving.', 'bad');
    try {
      const sigPath = sig.isEmpty() ? null : await uploadBlob('dispatch/' + id, await sig.toBlob(), 'png');
      const res = await rpc('dispatch_stock', {
        p_id: id, p_store: s.id,
        p_lines: lines.map(l => ({ product_id: l.product.id, qty: Number(l.qty) })),
        p_method: $('[name=method]').value, p_collected_by: who, p_signature_path: sigPath,
        p_notes: $('[name=notes]').value, p_photo_paths: photos.paths()
      });
      refreshCounts();
      main.innerHTML = html`<div class="card"><div class="notice ok">✅ Booked out to <b>${s.name}</b>.
        Delivery note <b>${res.dispatch_ref}</b>, invoice <b>${res.invoice_number}</b> raised.</div>
        <div class="btn-row">
          <a class="btn primary" href="#/invoices/${res.invoice_id}">View / send invoice</a>
          <a class="btn" href="#/dispatches/${res.dispatch_id}">Delivery note</a>
          <button class="btn" data-again>Book out another</button></div></div>`;
      main.querySelector('[data-again]').onclick = () => render(main, []);
    } catch (err) { fail(err); }
  });
}
