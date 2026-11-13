// Marketing: upcoming campaigns & promotions (head office posts, franchise
// stores are emailed), marketing requests from stores (emailed to the
// marketing team) and a gallery of pre-approved images to download.
import { sb, q, rpc, state, html, raw, esc, busy, fail, toast, modal, isManager, confirmBox, date, compressImage, lightbox, options } from '../lib.js';
import { renderText } from './manual.js';

const KIND = { campaign: 'Campaign', promotion: 'Promotion', pr: 'PR' };
const STATUS = { new: ['New', 'warn'], in_progress: ['In progress', 'part'], done: ['Done', 'ok'], declined: ['Declined', 'bad'] };
const BUCKET = 'marketing';

const urlCache = new Map();
async function fileUrl(path, download) {
  const key = path + (download ? '|d' : '');
  if (urlCache.has(key)) return urlCache.get(key);
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  const url = data?.signedUrl || '';
  urlCache.set(key, url);
  return url;
}
async function hydrate(root) {
  await Promise.all([...root.querySelectorAll('img[data-mk]')].map(async img => {
    img.src = await fileUrl(img.dataset.mk);
  }));
}
async function upload(folder, blob, name) {
  const ext = (name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error('Upload failed: ' + error.message);
  return path;
}

// Ask the server to send the email. Returns a short message for a toast.
export async function sendEmail(kind, id) {
  const { data: { session } } = await sb.auth.getSession();
  try {
    const r = await fetch('/api/marketing-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ kind, id })
    });
    const j = await r.json().catch(() => ({}));
    if (j.sent) return { ok: true, msg: kind === 'campaign' ? `Emailed to ${j.count} franchise ${j.count === 1 ? 'address' : 'addresses'}.` : 'The marketing team has been emailed.' };
    return { ok: false, msg: j.reason || j.error || 'The email could not be sent.' };
  } catch (e) {
    return { ok: false, msg: 'The email could not be sent (no connection).' };
  }
}

export async function render(main, params) {
  const tab = ['campaigns', 'request', 'requests', 'gallery'].includes(params[0]) ? params[0] : 'campaigns';
  const mgr = isManager();
  const tabs = [['campaigns', 'Campaigns & promotions'], ['request', 'Make a request'],
    ['requests', mgr ? 'Requests received' : 'My requests'], ['gallery', 'Images']];
  main.innerHTML = html`
    <div class="page-head"><div><h1>Marketing</h1><p class="muted">Campaigns, promotions, PR and approved images for every Chai Green store.</p></div></div>
    <div class="tabs">${tabs.map(([k, l]) => html`<a href="#/marketing/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</div>
    <div id="mk"></div>`;
  const box = main.querySelector('#mk');
  const again = () => render(main, [tab]);
  if (tab === 'campaigns') return campaigns(box, mgr, again);
  if (tab === 'request') return requestForm(box);
  if (tab === 'requests') return requests(box, mgr, again);
  return gallery(box, mgr, again);
}

// ------------------------------------------------------------------ campaigns
async function campaigns(box, mgr, again) {
  const rows = await q(sb.from('marketing_campaigns').select('*').order('starts_on', { ascending: true, nullsFirst: false }).order('created_at'));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter(r => !r.ends_on || r.ends_on >= today);
  const past = rows.filter(r => r.ends_on && r.ends_on < today).reverse();
  const when = r => r.starts_on && r.ends_on ? `${date(r.starts_on)} – ${date(r.ends_on)}` : r.starts_on ? `From ${date(r.starts_on)}` : r.ends_on ? `Until ${date(r.ends_on)}` : 'Date to be confirmed';
  const card = r => html`<article class="card campaign" data-id="${r.id}">
      ${r.image_path ? html`<img class="campaign-img" data-mk="${r.image_path}" alt="">` : ''}
      <div class="campaign-body">
        <div class="campaign-top"><span class="badge ${r.kind}">${KIND[r.kind]}</span><span class="muted">${when(r)}</span></div>
        <h2>${r.title}</h2>
        <div class="campaign-text">${raw(renderText(r.details))}</div>
        ${mgr ? html`<div class="campaign-foot muted">${r.emailed_at
          ? html`✉️ Emailed to ${r.emailed_to ?? 0} franchise ${r.emailed_to === 1 ? 'address' : 'addresses'} on ${date(r.emailed_at)}`
          : html`<span class="bad-text">Not emailed yet.</span> <button class="btn small" data-send>Email franchisees now</button>`}
          <button class="btn small" data-edit>Edit</button></div>` : ''}
      </div></article>`;
  box.innerHTML = html`
    ${mgr ? html`<div class="btn-row" style="margin-bottom:1rem"><button class="btn primary" data-new>+ Add a campaign or promotion</button>
      <span class="muted">Every franchise store is emailed as soon as you save it.</span></div>` : ''}
    ${upcoming.length ? upcoming.map(card) : html`<div class="empty">No campaigns or promotions coming up yet.</div>`}
    ${past.length ? html`<details class="past"><summary>Past campaigns (${past.length})</summary>${past.map(card)}</details>` : ''}`;
  hydrate(box);
  box.querySelectorAll('.campaign-img').forEach(img => img.onclick = () => lightbox(img.src));
  if (!mgr) return;
  box.querySelector('[data-new]').onclick = () => editCampaign({ kind: 'campaign', title: '', details: '' }, again);
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editCampaign(rows.find(r => r.id === b.closest('[data-id]').dataset.id), again));
  box.querySelectorAll('[data-send]').forEach(b => b.onclick = () => busy(b, async () => {
    const res = await sendEmail('campaign', b.closest('[data-id]').dataset.id);
    toast(res.msg, res.ok ? 'ok' : 'bad');
    if (res.ok) again();
  }));
}

function editCampaign(c, done) {
  const isNew = !c.id;
  const m = modal(isNew ? 'New campaign or promotion' : 'Edit campaign', html`<form>
    <div class="grid two"><label>Type<select name="kind">${raw(Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <label>Title<input name="title" required value="${c.title}" placeholder="e.g. Ramadan evening menu"></label></div>
    <div class="grid two"><label>Starts<input name="starts_on" type="date" value="${c.starts_on || ''}"></label>
      <label>Ends<input name="ends_on" type="date" value="${c.ends_on || ''}"></label></div>
    <label>What it is and what stores need to do <span class="hint">"## " for a heading, "- " for a bullet</span>
      <textarea name="details" rows="9" required>${c.details}</textarea></label>
    <label>Picture (optional)<input name="image" type="file" accept="image/*"></label>
    ${isNew ? html`<div class="notice">When you save, every franchise store gets an email about this.</div>` : ''}
    <div class="actions">${isNew ? '' : html`<button type="button" class="btn danger" data-del>Delete</button>`}
      <button class="btn primary">${isNew ? 'Save and email franchisees' : 'Save'}</button></div></form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.onsubmit = ev => {
    ev.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      if (form.starts_on.value && form.ends_on.value && form.ends_on.value < form.starts_on.value) return toast('The end date is before the start date.', 'bad');
      const rec = { kind: form.kind.value, title: form.title.value.trim(), details: form.details.value.trim(),
        starts_on: form.starts_on.value || null, ends_on: form.ends_on.value || null };
      const file = form.image.files[0];
      try {
        if (file) rec.image_path = await upload('campaigns', await compressImage(file, 2000, 0.85), 'x.jpg');
        let id = c.id;
        if (isNew) {
          rec.created_by_name = state.profile.full_name || state.user.email;
          id = (await q(sb.from('marketing_campaigns').insert(rec).select('id').single())).id;
        } else {
          await q(sb.from('marketing_campaigns').update(rec).eq('id', c.id));
        }
        m.close();
        if (isNew) {
          const res = await sendEmail('campaign', id);
          toast(res.ok ? 'Saved. ' + res.msg : 'Saved, but ' + res.msg.charAt(0).toLowerCase() + res.msg.slice(1), res.ok ? 'ok' : 'bad');
        } else toast('Saved.', 'ok');
        done();
      } catch (e) { fail(e); }
    });
  };
  const del = form.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!await confirmBox('Delete this campaign?', `"${c.title}" will be removed for every store.`, 'Delete', true)) return;
    try {
      await q(sb.from('marketing_campaigns').delete().eq('id', c.id));
      if (c.image_path) await sb.storage.from(BUCKET).remove([c.image_path]);
      m.close(); toast('Deleted.', 'ok'); done();
    } catch (e) { fail(e); }
  };
}

// ------------------------------------------------------------------ request form
async function requestForm(box) {
  const mgr = isManager();
  const myStore = state.profile.store_id
    ? await q(sb.from('stores').select('id,name,contact_name,phone,email').eq('id', state.profile.store_id).maybeSingle()).catch(() => null)
    : null;
  const stores = mgr ? await q(sb.from('stores').select('id,name').eq('active', true).order('name')) : [];
  const min = new Date().toISOString().slice(0, 10);
  box.innerHTML = html`<form class="card" id="mr" style="max-width:720px">
    <p>Tell the marketing team what you need. They'll get your request by email and reply to you.</p>
    ${mgr ? html`<label>Store<select name="store_id">${raw(options(stores, null, { blank: 'Head office / not for one store' }))}</select></label>`
      : myStore ? html`<p><b>Store:</b> ${myStore.name}</p>` : ''}
    <div class="grid two"><label>Franchisee name<input name="franchisee_name" required autocomplete="name" value="${myStore?.contact_name || state.profile.full_name || ''}"></label>
      <label>Phone<input name="phone" type="tel" required autocomplete="tel" value="${myStore?.phone || ''}"></label></div>
    <div class="grid two"><label>Email<input name="email" type="email" required autocomplete="email" value="${myStore?.email || state.profile.email || ''}"></label>
      <label>When do you want the PR?<input name="wanted_by" type="date" required min="${min}"></label></div>
    <label>What is it for?<textarea name="what_for" rows="3" required placeholder="e.g. Grand opening of our new seating area on 5 December"></textarea></label>
    <label>What is the aim?<textarea name="aim" rows="3" required placeholder="e.g. More families in on weekday evenings"></textarea></label>
    <label>Notes <span class="hint">optional</span><textarea name="notes" rows="3" placeholder="Anything else: ideas, local contacts, budget, sizes"></textarea></label>
    <div class="actions"><button class="btn primary big">Send request</button></div></form>`;
  const form = box.querySelector('#mr');
  form.onsubmit = ev => {
    ev.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      const p = Object.fromEntries(new FormData(form));
      try {
        const r = await rpc('place_marketing_request', { p });
        const res = await sendEmail('request', r.id);
        box.innerHTML = html`<div class="card" style="max-width:720px"><div class="notice ok"><b>Request ${r.ref} sent.</b>
          ${res.ok ? ' The marketing team has been emailed and will get back to you.' : ' It is saved and the marketing team can see it in the app.'}</div>
          <div class="btn-row"><a class="btn" href="#/marketing/requests">See my requests</a><a class="btn" href="#/marketing/campaigns">Back to campaigns</a></div></div>`;
      } catch (e) { fail(e); }
    });
  };
}

// ------------------------------------------------------------------ requests list
async function requests(box, mgr, again) {
  const rows = await q(sb.from('marketing_requests').select('*, stores(name)').order('created_at', { ascending: false }));
  box.innerHTML = rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Store</th><th>From</th><th>Wanted by</th><th>What for</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => html`<tr data-id="${r.id}" class="clickable"><td>${r.ref}</td><td>${r.stores?.name || 'Head office'}</td>
      <td>${r.franchisee_name}</td><td>${date(r.wanted_by)}</td><td>${r.what_for.length > 60 ? r.what_for.slice(0, 60) + '…' : r.what_for}</td>
      <td><span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">No marketing requests yet. <a href="#/marketing/request">Make a request</a></div>`;
  box.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => showRequest(rows.find(r => r.id === tr.dataset.id), mgr, again));
}

function showRequest(r, mgr, done) {
  const line = (k, v) => html`<p><b>${k}:</b> ${v}</p>`;
  const m = modal(`Marketing request ${r.ref}`, html`
    ${line('Store', r.stores?.name || 'Head office')}${line('Franchisee', r.franchisee_name)}
    <p><b>Phone:</b> <a href="tel:${r.phone}">${r.phone}</a> · <b>Email:</b> <a href="mailto:${r.email}">${r.email}</a></p>
    ${line('Wanted by', date(r.wanted_by))}${line('Sent', date(r.created_at))}
    <h3>What it's for</h3><p>${r.what_for}</p><h3>The aim</h3><p>${r.aim}</p>
    ${r.notes ? html`<h3>Notes</h3><p>${r.notes}</p>` : ''}
    ${mgr ? html`<form><div class="grid two"><label>Status<select name="status">${raw(Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join(''))}</select></label></div>
      <label>Reply to the store <span class="hint">they see this in the app</span><textarea name="reply" rows="3">${r.reply}</textarea></label>
      <div class="actions">${r.emailed_at ? '' : html`<button type="button" class="btn" data-send>Email marketing team</button>`}<button class="btn primary">Save</button></div></form>`
      : html`<h3>Status</h3><p><span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></p>${r.reply ? html`<h3>Reply from marketing</h3><p>${r.reply}</p>` : ''}`}`, { wide: true });
  const form = m.el.querySelector('form');
  if (!form) return;
  form.onsubmit = ev => {
    ev.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      try {
        await q(sb.from('marketing_requests').update({ status: form.status.value, reply: form.reply.value.trim(), updated_at: new Date().toISOString() }).eq('id', r.id));
        m.close(); toast('Saved.', 'ok'); done();
      } catch (e) { fail(e); }
    });
  };
  const s = form.querySelector('[data-send]');
  if (s) s.onclick = () => busy(s, async () => { const res = await sendEmail('request', r.id); toast(res.msg, res.ok ? 'ok' : 'bad'); });
}

// ------------------------------------------------------------------ gallery
async function gallery(box, mgr, again) {
  const rows = await q(sb.from('marketing_images').select('*').order('category').order('created_at', { ascending: false }));
  const cats = [...new Set(rows.map(r => r.category))];
  box.innerHTML = html`
    <div class="btn-row" style="margin-bottom:1rem">${mgr ? html`<button class="btn primary" data-add>+ Add images</button>` : ''}
      ${cats.length > 1 ? html`<select id="cat"><option value="">All categories</option>${raw(cats.map(c => `<option>${esc(c)}</option>`).join(''))}</select>` : ''}
      <span class="muted">Approved for use by every store. Press Download for the full-size file.</span></div>
    ${rows.length ? html`<div class="gallery">${rows.map(r => html`<figure class="card gal" data-id="${r.id}" data-cat="${r.category}">
        <img data-mk="${r.thumb_path || r.path}" alt="${r.title}" loading="lazy">
        <figcaption><b>${r.title}</b><span class="muted">${r.category}${r.size_bytes ? ' · ' + (r.size_bytes / 1048576).toFixed(1) + ' MB' : ''}</span>
          ${r.notes ? html`<small>${r.notes}</small>` : ''}
          <div class="btn-row"><button class="btn small primary" data-dl>Download</button>${mgr ? html`<button class="btn small" data-rm>Remove</button>` : ''}</div></figcaption></figure>`)}</div>`
      : html`<div class="empty">No images yet.${mgr ? ' Press "+ Add images" to upload the approved photos and artwork.' : ''}</div>`}`;
  hydrate(box);
  const byId = id => rows.find(r => r.id === id);
  box.querySelectorAll('.gal img').forEach(img => img.onclick = async () => lightbox(await fileUrl(byId(img.closest('[data-id]').dataset.id).path)));
  box.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => {
    const r = byId(b.closest('[data-id]').dataset.id);
    const url = await fileUrl(r.path, r.file_name || (r.title + '.' + r.path.split('.').pop()));
    if (!url) return toast('Could not get the file. Try again.', 'bad');
    const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  });
  const cat = box.querySelector('#cat');
  if (cat) cat.onchange = () => box.querySelectorAll('.gal').forEach(f => f.classList.toggle('hidden', !!cat.value && f.dataset.cat !== cat.value));
  if (!mgr) return;
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const r = byId(b.closest('[data-id]').dataset.id);
    if (!await confirmBox('Remove this image?', `"${r.title}" will no longer be available to stores.`, 'Remove', true)) return;
    try {
      await q(sb.from('marketing_images').delete().eq('id', r.id));
      await sb.storage.from(BUCKET).remove([r.path, r.thumb_path].filter(Boolean));
      toast('Removed.', 'ok'); again();
    } catch (e) { fail(e); }
  });
  box.querySelector('[data-add]').onclick = () => addImages(cats, again);
}

function addImages(cats, done) {
  const m = modal('Add approved images', html`<form>
    <label>Images or artwork <span class="hint">JPG, PNG or PDF, up to 25 MB each; pick several at once</span>
      <input name="files" type="file" accept="image/*,application/pdf" multiple required></label>
    <div class="grid two"><label>Category<input name="category" list="mkcats" value="${cats[0] || 'General'}" required></label>
      <label>Title <span class="hint">leave blank to use the file names</span><input name="title"></label></div>
    <datalist id="mkcats">${raw(['Food', 'Drinks', 'Stores', 'Logos', 'Social media', 'Posters', ...cats].filter((c, i, a) => a.indexOf(c) === i).map(c => `<option value="${esc(c)}">`).join(''))}</datalist>
    <label>Notes <span class="hint">optional, e.g. "for Instagram only"</span><input name="notes"></label>
    <div class="actions"><button class="btn primary">Upload</button></div></form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = ev => {
    ev.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      const files = [...form.files.files];
      const big = files.find(f => f.size > 25 * 1048576);
      if (big) return toast(`${big.name} is over 25 MB.`, 'bad');
      try {
        for (const [i, f] of files.entries()) {
          const path = await upload('gallery', f, f.name);
          let thumb = null;
          if (f.type.startsWith('image/')) thumb = await upload('gallery/thumbs', await compressImage(f, 700, 0.8), 'x.jpg').catch(() => null);
          const base = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
          await q(sb.from('marketing_images').insert({
            title: form.title.value.trim() ? form.title.value.trim() + (files.length > 1 ? ` (${i + 1})` : '') : base,
            category: form.category.value.trim() || 'General', path, thumb_path: thumb, file_name: f.name, size_bytes: f.size, notes: form.notes.value.trim()
          }));
        }
        m.close(); toast(`${files.length} ${files.length === 1 ? 'image' : 'images'} added.`, 'ok'); done();
      } catch (e) { fail(e); }
    });
  };
}
