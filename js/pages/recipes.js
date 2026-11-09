// Recipe cards: what goes in, how to make it, how it should look, and its
// allergens. Plus the allergen chart for the counter (and the EHO).
import { sb, q, html, raw, esc, money, badge, busy, fail, toast, modal, isManager, uploadBlob, compressImage, hydratePhotos, confirmBox } from '../lib.js';
import { ALLERGENS } from './store-common.js';

const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const brakesLink = code => `https://www.brake.co.uk/search?text=${encodeURIComponent(code)}`;

export async function render(main, params) {
  if (params[0] === 'allergens') return matrix(main);
  if (params[0]) return card(main, params[0]);
  const rows = await q(sb.from('recipes').select('id, name, category, description, price, allergens, allergens_confirmed, photo_path, active')
    .order('category').order('sort_order').order('name'));
  const mgr = isManager();
  const shown = rows.filter(r => r.active || mgr);
  const cats = [...new Set(shown.map(r => r.category))];
  main.innerHTML = html`
    <div class="page-head"><div><h1>Recipes</h1><p class="muted">How to make every dish, how it should look, and what's in it.</p></div>
      <div class="btn-row"><a class="btn" href="#/recipes/allergens">⚠️ Allergen chart</a>
      ${mgr ? html`<button class="btn primary" data-new>+ New recipe</button>` : ''}</div></div>
    <div class="card"><input type="search" placeholder="Find a dish…" data-search></div>
    <div data-list>${cats.map(c => html`<h2 class="cat-head">${c}</h2><div class="recipe-grid">${shown.filter(r => r.category === c).map(r => html`
      <a class="card recipe-tile ${r.active ? '' : 'off'}" href="#/recipes/${r.id}" data-name="${r.name.toLowerCase()}">
        ${r.photo_path ? html`<img data-photo="${r.photo_path}" alt="">` : html`<div class="no-photo">🍽️</div>`}
        <b>${r.name}</b>${r.price ? html` <span class="muted">${money(r.price)}</span>` : ''}
        <small>${r.allergens.length ? 'Contains: ' + r.allergens.join(', ') : 'No allergens listed'}</small>
        ${r.allergens_confirmed ? '' : badge('reorder', 'Allergens to confirm')}${r.active ? '' : badge('out', 'Off the menu')}</a>`)}</div>`)}
      ${shown.length ? '' : html`<div class="empty">No recipes yet.</div>`}</div>`;
  const search = main.querySelector('[data-search]');
  search.oninput = () => main.querySelectorAll('[data-name]').forEach(a => a.classList.toggle('hidden', !a.dataset.name.includes(search.value.toLowerCase())));
  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = () => edit({ ingredients: [], allergens: [], dietary: [], category: cats[0] || 'Desserts', active: true }, () => render(main, []));
  hydratePhotos(main);
}

async function card(main, id) {
  const r = await q(sb.from('recipes').select('*').eq('id', id).single());
  main.innerHTML = html`
    <div class="page-head"><div><a class="no-print" href="#/recipes">← All recipes</a><h1>${r.name}</h1>
      <p class="muted">${r.category}${r.price ? ' · ' + money(r.price) : ''}${r.portion ? ' · ' + r.portion : ''}</p></div>
      <div class="btn-row no-print"><button class="btn" data-print>Print card</button>
      ${isManager() ? html`<button class="btn primary" data-edit>Edit</button>` : ''}</div></div>
    <div class="grid two">
      <div class="card">${r.photo_path ? html`<img class="recipe-photo" data-photo="${r.photo_path}" alt="${r.name}">` : html`<div class="no-photo big">🍽️<br><small>No photo yet</small></div>`}
        ${r.description ? html`<p>${r.description}</p>` : ''}
        ${r.dietary.length ? html`<p>${r.dietary.map(d => badge('ok', d))}</p>` : ''}</div>
      <div class="card ${r.allergens.length ? 'allergen-card' : ''}"><h2>⚠️ Allergens</h2>
        ${r.allergens.length ? html`<p class="allergens">${r.allergens.map(a => html`<span>${a}</span>`)}</p>` : html`<p>None of the 14 allergens.</p>`}
        ${(r.may_contain || []).length ? html`<h3>May contain</h3><p class="allergens may">${r.may_contain.map(a => html`<span>${a}</span>`)}</p>
          <p class="muted">Made in a place that also handles these. Tell anyone with these allergies.</p>` : ''}
        ${r.allergens_confirmed ? html`<p class="muted">Checked against the supplier's product information.</p>`
          : html`<div class="notice warn">Not yet checked against the supplier's product specification. Check the labels before telling a customer.</div>`}</div>
    </div>
    <div class="card"><h2>What goes in</h2><div class="table-wrap"><table>
      <thead><tr><th>Ingredient</th><th>Amount</th><th>Brakes code</th></tr></thead>
      <tbody>${(r.ingredients || []).map(i => html`<tr><td>${i.name}</td><td>${i.qty || ''}</td>
        <td>${i.code ? html`<a href="${brakesLink(i.code)}" target="_blank" rel="noopener">${i.code}</a>` : ''}</td></tr>`)}</tbody></table></div></div>
    <div class="grid two">
      <div class="card"><h2>How to make it</h2><ol class="steps">${lines(r.method).map(s => html`<li>${s}</li>`)}</ol></div>
      <div class="card"><h2>How it should look</h2><ul>${lines(r.plating).map(s => html`<li>${s}</li>`)}</ul>
        ${r.hold_notes ? html`<h2>Storage & holding</h2><p>${r.hold_notes}</p>` : ''}</div>
    </div>`;
  main.querySelector('[data-print]').onclick = () => window.print();
  const e = main.querySelector('[data-edit]');
  if (e) e.onclick = () => edit(r, () => card(main, id));
  hydratePhotos(main);
}

async function matrix(main) {
  const rows = await q(sb.from('recipes').select('id, name, category, allergens, may_contain, allergens_confirmed').eq('active', true).order('category').order('sort_order'));
  main.innerHTML = html`
    <div class="page-head"><div><a class="no-print" href="#/recipes">← Recipes</a><h1>Allergen chart</h1>
      <p class="muted">✕ = contains · <b>?</b> = may contain (traces). Always check the recipe card and product labels for a customer with an allergy.</p></div>
      <div class="btn-row no-print"><button class="btn" data-print>Print</button></div></div>
    <div class="card"><div class="table-wrap"><table class="matrix">
      <thead><tr><th>Dish</th>${ALLERGENS.map(a => html`<th class="rot"><span>${a}</span></th>`)}</tr></thead>
      <tbody>${rows.map(r => html`<tr><td><a href="#/recipes/${r.id}">${r.name}</a>${r.allergens_confirmed ? '' : raw(' <small class="badge reorder">to confirm</small>')}</td>
        ${ALLERGENS.map(a => r.allergens.includes(a) ? raw('<td class="has">✕</td>')
          : (r.may_contain || []).includes(a) ? raw('<td class="may" title="may contain">?</td>') : raw('<td></td>'))}</tr>`)}</tbody></table></div></div>`;
  main.querySelector('[data-print]').onclick = () => window.print();
}

function edit(r, done) {
  const ing = (r.ingredients || []).map(i => [i.name, i.qty, i.code].filter(x => x != null).join(' | ')).join('\n');
  const m = modal(r.id ? 'Edit recipe' : 'New recipe', html`<form>
    <div class="grid two"><label>Name<input name="name" required value="${r.name || ''}"></label>
      <label>Category<input name="category" required value="${r.category || ''}" placeholder="Desserts, Milkshakes, Breakfast…"></label>
      <label>Menu price £<input name="price" type="number" step="0.01" value="${r.price ?? ''}"></label>
      <label>Portion<input name="portion" value="${r.portion || ''}" placeholder="e.g. 1 slice, 200 g bowl"></label></div>
    <label>Menu description<textarea name="description" rows="2">${r.description || ''}</textarea></label>
    <label>Allergens it contains</label><div class="allergen-pick">${ALLERGENS.map(a => html`<label class="check"><input type="checkbox" name="al" value="${a}" ${(r.allergens || []).includes(a) ? 'checked' : ''}> ${a}</label>`)}</div>
    <label>May contain <span class="hint">(traces, from the supplier's label)</span></label><div class="allergen-pick">${ALLERGENS.map(a => html`<label class="check"><input type="checkbox" name="may" value="${a}" ${(r.may_contain || []).includes(a) ? 'checked' : ''}> ${a}</label>`)}</div>
    <label class="check"><input type="checkbox" name="allergens_confirmed" ${r.allergens_confirmed ? 'checked' : ''}> Allergens checked against the supplier's product specification</label>
    <label>Suitable for <span class="hint">(comma separated, e.g. V, VG, Halal)</span><input name="dietary" value="${(r.dietary || []).join(', ')}"></label>
    <label>Ingredients <span class="hint">(one per line: name | amount | Brakes code)</span><textarea name="ingredients" rows="6">${ing}</textarea></label>
    <label>How to make it <span class="hint">(one step per line)</span><textarea name="method" rows="6">${r.method || ''}</textarea></label>
    <label>How it should look <span class="hint">(one point per line)</span><textarea name="plating" rows="3">${r.plating || ''}</textarea></label>
    <label>Storage & holding<textarea name="hold_notes" rows="2">${r.hold_notes || ''}</textarea></label>
    <label>Photo <input type="file" name="photo" accept="image/*"></label>
    <label class="check"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}> On the menu</label>
    <div class="actions">${r.id ? html`<button type="button" class="btn danger" data-del>Delete</button>` : ''}<button class="btn primary">Save</button></div></form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      const fd = new FormData(form);
      const rec = {
        name: fd.get('name').trim(), category: fd.get('category').trim(), price: fd.get('price') ? Number(fd.get('price')) : null,
        portion: fd.get('portion').trim() || null, description: fd.get('description').trim() || null,
        allergens: fd.getAll('al'), may_contain: fd.getAll('may').filter(a => !fd.getAll('al').includes(a)), allergens_confirmed: fd.has('allergens_confirmed'),
        dietary: fd.get('dietary').split(',').map(x => x.trim()).filter(Boolean),
        ingredients: lines(fd.get('ingredients')).map(l => { const [name, qty, code] = l.split('|').map(x => x.trim()); return { name, qty: qty || null, code: code || null }; }),
        method: fd.get('method').trim() || null, plating: fd.get('plating').trim() || null, hold_notes: fd.get('hold_notes').trim() || null,
        active: fd.has('active'), updated_at: new Date().toISOString()
      };
      try {
        const file = form.photo.files[0];
        if (file) rec.photo_path = await uploadBlob('recipes', await compressImage(file));
        if (r.id) await q(sb.from('recipes').update(rec).eq('id', r.id));
        else await q(sb.from('recipes').insert(rec));
        m.close(); toast('Saved', 'ok'); done();
      } catch (err) { fail(err); }
    });
  };
  const del = form.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!await confirmBox('Delete recipe', `Delete ${r.name}? To take it off the menu but keep the card, untick "On the menu" instead.`, 'Delete', true)) return;
    try { await q(sb.from('recipes').delete().eq('id', r.id)); m.close(); location.hash = '#/recipes'; } catch (err) { fail(err); }
  };
}
