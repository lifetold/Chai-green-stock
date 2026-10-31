// The Chai Green operations manual: pages grouped into sections, edited by head office.
import { sb, q, html, raw, esc, busy, fail, toast, modal, isManager, confirmBox, date } from '../lib.js';

// A little formatting: "## Heading", "- bullet", "1. step", blank line = new paragraph.
export function renderText(text) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw0 of String(text || '').split('\n')) {
    const l = raw0.trim();
    const m = l.match(/^(\d+)\.\s+(.*)$/);
    if (!l) { close(); continue; }
    if (l.startsWith('## ')) { close(); out.push(`<h3>${esc(l.slice(3))}</h3>`); }
    else if (l.startsWith('- ')) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${esc(l.slice(2))}</li>`); }
    else if (m) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${esc(m[2])}</li>`); }
    else { close(); out.push(`<p>${esc(l)}</p>`); }
  }
  close();
  return out.join('');
}

export async function render(main, params) {
  const pages = await q(sb.from('manual_pages').select('*').order('sort_order').order('title'));
  const mgr = isManager();
  const page = pages.find(p => p.id === params[0]) || (params[0] ? null : null);
  const sections = [...new Set(pages.map(p => p.section))];
  main.innerHTML = html`
    <div class="page-head"><div><h1>Operations manual</h1><p class="muted">How we run every Chai Green store.</p></div>
      <div class="btn-row no-print">${page ? html`<button class="btn" data-print>Print</button>` : ''}
      ${mgr ? html`${page ? html`<button class="btn" data-edit>Edit page</button>` : ''}<button class="btn primary" data-new>+ New page</button>` : ''}</div></div>
    <div class="manual">
      <nav class="card manual-nav no-print">${sections.map(s => html`<h3>${s}</h3>${pages.filter(p => p.section === s).map(p =>
        html`<a href="#/manual/${p.id}" class="${page?.id === p.id ? 'active' : ''}">${p.title}</a>`)}`)}
        ${pages.length ? '' : html`<p class="muted">No pages yet.</p>`}</nav>
      <article class="card manual-page">${page ? html`<p class="muted">${page.section}</p><h2>${page.title}</h2>${raw(renderText(page.body))}
        <p class="muted"><small>Last updated ${date(page.updated_at)}</small></p>`
        : html`<h2>Welcome</h2><p>Choose a page from the list.</p>`}</article>
    </div>`;
  const p = main.querySelector('[data-print]');
  if (p) p.onclick = () => window.print();
  const e = main.querySelector('[data-edit]');
  if (e) e.onclick = () => edit(page, sections, id => render(main, [id]));
  const n = main.querySelector('[data-new]');
  if (n) n.onclick = () => edit({ section: page?.section || sections[0] || '', title: '', body: '', sort_order: pages.length + 1 }, sections, id => { location.hash = '#/manual/' + id; });
}

function edit(pg, sections, done) {
  const m = modal(pg.id ? 'Edit page' : 'New page', html`<form>
    <div class="grid two"><label>Section<input name="section" list="sections" required value="${pg.section}"></label>
      <label>Title<input name="title" required value="${pg.title}"></label></div>
    <datalist id="sections">${sections.map(s => html`<option value="${s}">`)}</datalist>
    <label>Text <span class="hint">"## " for a heading, "- " for a bullet, "1. " for a numbered step</span>
      <textarea name="body" rows="16">${pg.body}</textarea></label>
    <label>Order in its section<input name="sort_order" type="number" value="${pg.sort_order ?? 0}"></label>
    <div class="actions">${pg.id ? html`<button type="button" class="btn danger" data-del>Delete</button>` : ''}<button class="btn primary">Save</button></div></form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.onsubmit = ev => {
    ev.preventDefault();
    busy(form.querySelector('.btn.primary'), async () => {
      const rec = { section: form.section.value.trim(), title: form.title.value.trim(), body: form.body.value,
        sort_order: Number(form.sort_order.value) || 0, updated_at: new Date().toISOString() };
      try {
        const saved = pg.id ? await q(sb.from('manual_pages').update(rec).eq('id', pg.id).select('id').single())
          : await q(sb.from('manual_pages').insert(rec).select('id').single());
        m.close(); toast('Saved', 'ok'); done(saved.id);
      } catch (err) { fail(err); }
    });
  };
  const del = form.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!await confirmBox('Delete page', `Delete "${pg.title}"?`, 'Delete', true)) return;
    try { await q(sb.from('manual_pages').delete().eq('id', pg.id)); m.close(); location.hash = '#/manual'; } catch (err) { fail(err); }
  };
}
