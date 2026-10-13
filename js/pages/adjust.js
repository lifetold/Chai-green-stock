// Write-offs and adjustments (damaged, out of date, found, returns), with photos.
import { sb, q, rpc, state, html, num, money, date, dateTime, REASONS, REASON_ADDS, scanner, findByBarcode, photoPicker,
  busy, fail, toast, hydratePhotos, isManager, onLeave } from '../lib.js';
import { pickProduct, thumb } from '../widgets.js';
import { refreshCounts } from '../app.js';

const STAFF_REASONS = ['damaged', 'expired', 'lost', 'sample', 'return_to_supplier', 'return_from_store'];

export async function render(main, params) {
  const id = crypto.randomUUID();
  const mgr = isManager();
  let product = params[0] ? await q(sb.from('product_stock').select('*').eq('id', params[0]).single()) : null;
  const recent = await q(sb.from('adjustments').select('*, products(name, unit, cost_price), profiles:user_id(full_name)')
    .order('created_at', { ascending: false }).limit(15));
  const reasons = Object.keys(REASONS).filter(r => r !== 'stock_check' && (mgr || STAFF_REASONS.includes(r)));

  main.innerHTML = html`
    <div class="page-head"><div><h1>Write-off / adjust</h1>
      <p class="muted">Damaged, out of date, lost, samples and returns. Every change is logged with who did it and why.</p></div></div>
    <div class="card">
      <div data-scan></div>
      <p><button class="btn small" data-search>Search by name</button></p>
      <div data-product></div>
    </div>
    <form class="card" data-form>
      <div class="grid two">
        <label>Reason<select name="reason">${reasons.map(r => html`<option value="${r}">${REASONS[r]}</option>`)}</select></label>
        <label>Quantity<input name="qty" type="number" min="0" step="any" inputmode="decimal" required></label>
      </div>
      <p data-dir class="muted"></p>
      <label data-exp-wrap class="hidden">Use-by date of the returned stock<input type="date" name="expiry"></label>
      <label>Notes<textarea name="notes" placeholder="What happened?"></textarea></label>
      <label>Photos <span class="hint">(of the damage / out-of-date stock)</span></label>
      <div data-photos></div>
      <p></p><button class="btn primary big" type="submit">Save adjustment</button>
    </form>
    <div class="card"><h2>Recent adjustments</h2>${recent.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Product</th><th>Reason</th><th class="num">Change</th>${mgr ? html`<th class="num">Value</th>` : ''}<th>By</th></tr></thead>
      <tbody>${recent.map(a => html`<tr><td>${dateTime(a.created_at)}</td><td>${a.products?.name}</td><td>${REASONS[a.reason]}${a.notes ? html`<br><small>${a.notes}</small>` : ''}</td>
        <td class="num">${a.qty_change > 0 ? '+' : ''}${num(a.qty_change)}</td>${mgr ? html`<td class="num">${money(a.qty_change * (a.products?.cost_price || 0))}</td>` : ''}
        <td>${a.profiles?.full_name || ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}</div>`;

  const $ = s => main.querySelector(s);
  const photos = photoPicker($('[data-photos]'), 'adjustment/' + id, { label: 'Photo' });
  const showProduct = () => {
    $('[data-product]').innerHTML = product ? html`<ul class="lines"><li>${thumb(product)}<div class="info"><div class="name">${product.name}</div>
      <div class="sub">${num(product.qty_on_hand)} ${product.unit} in stock</div></div></li></ul>` : html`<p class="muted">Scan or search for the product.</p>`;
    hydratePhotos($('[data-product]'));
    const adds = REASON_ADDS.includes($('[name=reason]').value);
    $('[data-dir]').textContent = adds ? 'This will ADD to stock.' : 'This will TAKE OFF stock.';
    $('[data-exp-wrap]').classList.toggle('hidden', !(adds && product?.track_expiry));
  };
  $('[name=reason]').onchange = showProduct;
  showProduct();

  const scan = scanner($('[data-scan]'), async code => {
    try {
      const p = await findByBarcode(code);
      if (!p) return toast(`Barcode ${code} isn't linked to a product.`, 'bad');
      product = p; scan.stop(); showProduct();
    } catch (e) { fail(e); }
  }, { continuous: false });
  onLeave(() => scan.stop());
  $('[data-search]').onclick = async () => { const p = await pickProduct(); if (p) { product = p; showProduct(); } };

  const form = $('[data-form]');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('[type=submit]'), async () => {
      if (!product) return toast('Choose a product first.', 'bad');
      if (photos.busy()) return toast('Wait for the photos to finish uploading.');
      const reason = form.reason.value;
      const qty = Number(form.qty.value);
      if (!qty || qty <= 0) return toast('Enter a quantity.', 'bad');
      const change = REASON_ADDS.includes(reason) ? qty : -qty;
      if (['damaged', 'expired'].includes(reason) && !photos.paths().length) return toast('Take a photo of the damaged / out-of-date stock.', 'bad');
      try {
        await rpc('adjust_stock', { p_id: id, p_product: product.id, p_qty_change: change, p_reason: reason,
          p_notes: form.notes.value, p_expiry: form.expiry.value || null, p_photo_paths: photos.paths() });
        toast(`${product.name}: ${change > 0 ? '+' : ''}${num(change)} saved`, 'ok');
        refreshCounts();
        render(main, []);
      } catch (err) { fail(err); }
    });
  };
}
