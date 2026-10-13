// Product pickers and the "new product from a barcode" form, shared by
// goods in, stock out, adjustments and stock checks.
import { sb, q, state, html, raw, esc, modal, options, formData, photoPicker, busy, fail, toast, num, money, isManager } from './lib.js';

let suppliersCache = null;
export async function suppliers(force) {
  if (!suppliersCache || force) suppliersCache = await q(sb.from('suppliers').select('id, name, default_lead_time_days').eq('active', true).order('name'));
  return suppliersCache;
}

export async function categories() {
  const rows = await q(sb.from('products').select('category').not('category', 'is', null));
  return [...new Set(rows.map(r => r.category))].sort();
}

// Search products by name / SKU. Resolves with the product_stock row, or null.
export function pickProduct(title = 'Find a product') {
  return new Promise(resolve => {
    let picked = null;
    const m = modal(title, `<input type="search" placeholder="Type a name or SKU" autofocus>
      <div class="table-wrap" style="margin-top:.75rem"><table><tbody></tbody></table></div>`,
      { onClose: () => resolve(picked) });
    const input = m.el.querySelector('input');
    const tbody = m.el.querySelector('tbody');
    let t;
    const search = async () => {
      const term = input.value.trim().replace(/[%,()]/g, ' ');
      let query = sb.from('product_stock').select('*').eq('active', true).order('name').limit(30);
      if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,category.ilike.%${term}%`);
      const rows = await q(query).catch(fail) || [];
      tbody.innerHTML = rows.length ? rows.map((p, i) => html`<tr class="click" data-i="${i}">
        <td>${p.name}<br><small>${p.sku || ''} ${p.pack_size ? '· ' + p.pack_size : ''}</small></td>
        <td class="num">${num(p.qty_on_hand)} ${p.unit}</td></tr>`).join('')
        : '<tr><td class="muted">No products found</td></tr>';
      tbody.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => { picked = rows[tr.dataset.i]; m.close(); });
    };
    input.oninput = () => { clearTimeout(t); t = setTimeout(search, 250); };
    search();
    setTimeout(() => input.focus(), 50);
  });
}

// Unknown barcode: either create a new product (with a photo of the packaging)
// or link the barcode to a product we already have.
// Resolves with the product_stock row, or null if cancelled.
export function unknownBarcode(code, { supplierId } = {}) {
  return new Promise(async resolve => {
    let result = null;
    const sups = await suppliers().catch(() => []);
    const cats = await categories().catch(() => []);
    const tempId = crypto.randomUUID();
    const m = modal('New barcode', html`
      <div class="notice">Barcode <b>${code}</b> isn't linked to a product yet.</div>
      <div class="tabs"><button class="active" data-tab="new">New product</button><button data-tab="link">It's a product we already have</button></div>
      <div data-pane="link" class="hidden">
        <p>Pick the product this barcode belongs to (for example a new supplier's packaging).</p>
        <button class="btn" data-pick>Choose product…</button>
      </div>
      <form data-pane="new" autocomplete="off">
        <label>Photo of the packaging <span class="hint">(front, so others recognise it)</span></label>
        <div data-photos></div>
        <label>Product name<input name="name" required placeholder="e.g. Masala chai concentrate 1L"></label>
        <div class="grid two">
          <label>Category<input name="category" list="cat-list" placeholder="e.g. Tea, Cups, Syrups">
            <datalist id="cat-list">${cats.map(c => html`<option value="${c}">`)}</datalist></label>
          <label>SKU / our code <span class="hint">(optional)</span><input name="sku"></label>
          <label>Counted in<select name="unit">${['each', 'case', 'box', 'bag', 'bottle', 'tub', 'pack', 'sleeve', 'kg', 'litre'].map(u => html`<option>${u}</option>`)}</select></label>
          <label>Pack size <span class="hint">(e.g. 6 x 1kg)</span><input name="pack_size"></label>
          <label>Supplier<select name="supplier_id">${raw(options(sups, supplierId, { blank: '— choose —' }))}</select></label>
          <label>Cost price £ <span class="hint">(per unit, ex VAT)</span><input name="cost_price" type="number" step="0.01" min="0" inputmode="decimal"></label>
          <label>Delivery lead time <span class="hint">(days)</span><input name="lead_time_days" type="number" min="0" inputmode="numeric" placeholder="supplier default"></label>
          <label>VAT rate %<select name="vat_rate"><option value="">Default (${state.settings.default_vat_rate}%)</option><option value="20">20% standard</option><option value="5">5% reduced</option><option value="0">0% zero-rated</option></select></label>
        </div>
        <label class="check"><input type="checkbox" name="track_expiry"> Has a use-by / best-before date</label>
        <div class="actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Save product</button></div>
      </form>`, { onClose: () => resolve(result) });

    const photos = photoPicker(m.el.querySelector('[data-photos]'), 'products/' + tempId, { label: 'Photo of pack' });
    m.el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      m.el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
      m.el.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
    });
    m.el.querySelector('[data-cancel]').onclick = () => m.close();
    m.el.querySelector('[data-pick]').onclick = async () => {
      const p = await pickProduct('Which product is this barcode?');
      if (!p) return;
      try {
        await q(sb.from('product_barcodes').insert({ barcode: code, product_id: p.id }));
        toast(`Barcode linked to ${p.name}`, 'ok');
        result = p;
        m.close();
      } catch (e) { fail(e); }
    };
    const form = m.el.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      if (photos.busy()) return toast('Wait for the photo to finish uploading.');
      busy(form.querySelector('[type=submit]'), async () => {
        try {
          const f = formData(form);
          const paths = photos.paths();
          const product = await q(sb.from('products').insert({
            id: tempId, name: f.name, category: f.category, sku: f.sku, unit: f.unit, pack_size: f.pack_size,
            supplier_id: f.supplier_id, cost_price: f.cost_price || 0, lead_time_days: f.lead_time_days,
            vat_rate: f.vat_rate, track_expiry: f.track_expiry, photo_path: paths[0] || null,
            created_by: state.profile.id
          }).select('id').single());
          await q(sb.from('product_barcodes').insert({ barcode: code, product_id: product.id }));
          if (paths.length) {
            await q(sb.from('photos').insert(paths.map(path => ({ kind: 'product', ref_id: product.id, path, taken_by: state.profile.id }))));
          }
          result = await q(sb.from('product_stock').select('*').eq('id', product.id).single());
          toast('Product saved', 'ok');
          m.close();
        } catch (err) { fail(err); }
      });
    };
    setTimeout(() => form.name.focus(), 50);
  });
}

// Quantity stepper markup for scanned lines.
export const stepper = (i, qty) => html`<div class="stepper">
  <button type="button" data-dec="${i}" aria-label="One less">−</button>
  <input type="number" inputmode="decimal" min="0" step="any" value="${qty}" data-qty="${i}" aria-label="Quantity">
  <button type="button" data-inc="${i}" aria-label="One more">+</button></div>`;

// Wire up steppers in `root` to the `lines` array; calls redraw() after changes.
export function bindSteppers(root, lines, draw) {
  // redraw after the current event finishes: replacing the list while an
  // input is losing focus would fire its change event mid-update
  const redraw = () => setTimeout(draw);
  root.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
    const l = lines[b.dataset.dec];
    l.qty = Math.max(0, Number(l.qty) - 1);
    if (l.qty === 0) lines.splice(b.dataset.dec, 1);
    redraw();
  });
  root.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { lines[b.dataset.inc].qty = Number(lines[b.dataset.inc].qty) + 1; redraw(); });
  root.querySelectorAll('[data-qty]').forEach(inp => inp.onchange = () => {
    const v = Number(inp.value);
    if (!v || v < 0) lines.splice(inp.dataset.qty, 1); else lines[inp.dataset.qty].qty = v;
    redraw();
  });
}

export const thumb = p => p.photo_path
  ? html`<img class="thumb" data-photo="${p.photo_path}" alt="">`
  : raw('<div class="thumb"></div>');

export { money };
