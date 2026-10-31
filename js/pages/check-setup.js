// Head office: edit the checklists (questions, safe temperature limits, what to do if it fails).
import { sb, q, html, badge, busy, fail, toast, modal, isManager } from '../lib.js';

const KIND = { yes_no: 'Yes / No', temperature: 'Temperature (°C)', number: 'Number', text: 'Written answer' };

export async function render(main, params) {
  if (!isManager()) { main.innerHTML = '<div class="notice bad">Head office only.</div>'; return; }
  const templates = await q(sb.from('check_templates').select('*, check_items(count)').order('sort_order'));
  const t = templates.find(x => x.id === params[0]);
  if (!t) {
    main.innerHTML = html`<div class="page-head"><div><h1>Checklists</h1><p class="muted">The checks every store does. Changes apply from the next check.</p></div>
      <div class="btn-row"><button class="btn primary" data-new>+ New checklist</button></div></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Checklist</th><th>How often</th><th class="num">Questions</th><th>Who</th><th></th></tr></thead>
      <tbody>${templates.map(x => html`<tr class="click" data-id="${x.id}"><td>${x.icon || ''} <b>${x.name}</b><br><small>${x.description || ''}</small></td>
        <td>${x.kind === 'monthly' ? 'Monthly' : 'Daily'}</td><td class="num">${x.check_items[0]?.count || 0}</td>
        <td>${x.manager_only ? 'Managers' : 'Store team'}</td><td>${x.active ? '' : badge('out', 'Switched off')}</td></tr>`)}</tbody></table></div></div>`;
    main.querySelectorAll('[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/check-setup/' + tr.dataset.id; });
    main.querySelector('[data-new]').onclick = () => editTemplate({ kind: 'daily', min_seconds: 3, active: true, sort_order: templates.length + 1 }, id => { location.hash = '#/check-setup/' + id; });
    return;
  }
  const items = await q(sb.from('check_items').select('*').eq('template_id', t.id).order('sort_order'));
  main.innerHTML = html`<div class="page-head"><div><a href="#/check-setup">← Checklists</a><h1>${t.icon || ''} ${t.name}</h1>
      <p class="muted">${t.kind === 'monthly' ? 'Monthly' : 'Daily'} · answers quicker than ${t.min_seconds} seconds (double for temperatures) count as rushed</p></div>
      <div class="btn-row"><button class="btn" data-edit-t>Settings</button><button class="btn primary" data-add>+ Add question</button></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th class="num">#</th><th>Question</th><th>Answer</th><th>Safe if</th><th></th></tr></thead>
      <tbody>${items.map(i => html`<tr class="click ${i.active ? '' : 'muted'}" data-item="${i.id}"><td class="num">${i.sort_order}</td>
        <td>${i.section ? html`<small>${i.section}</small><br>` : ''}${i.question}</td><td>${KIND[i.kind]}</td>
        <td>${i.kind === 'yes_no' ? (i.expected === 'yes' ? 'Yes' : 'No') : i.kind === 'text' ? 'Answered' : [i.min_value != null ? '≥ ' + i.min_value : '', i.max_value != null ? '≤ ' + i.max_value : ''].filter(Boolean).join(' and ')}</td>
        <td>${i.critical ? badge('out', 'Critical') : ''} ${i.active ? '' : badge('reorder', 'Off')}</td></tr>`)}</tbody></table></div></div>`;
  main.querySelector('[data-edit-t]').onclick = () => editTemplate(t, () => render(main, [t.id]));
  main.querySelector('[data-add]').onclick = () => editItem({ template_id: t.id, kind: 'yes_no', expected: 'yes', actions: [], active: true,
    sort_order: (items.at(-1)?.sort_order || 0) + 1, section: items.at(-1)?.section || '' }, () => render(main, [t.id]));
  main.querySelectorAll('[data-item]').forEach(tr => tr.onclick = () => editItem(items.find(i => i.id === tr.dataset.item), () => render(main, [t.id])));
}

function editTemplate(t, done) {
  const m = modal(t.id ? 'Checklist settings' : 'New checklist', html`<form>
    <div class="grid two"><label>Name<input name="name" required value="${t.name || ''}"></label>
      <label>Icon (emoji)<input name="icon" value="${t.icon || ''}" maxlength="4"></label></div>
    <label>Description<input name="description" value="${t.description || ''}"></label>
    <div class="grid two"><label>How often<select name="kind"><option value="daily" ${t.kind === 'daily' ? 'selected' : ''}>Every day</option>
      <option value="monthly" ${t.kind === 'monthly' ? 'selected' : ''}>Every month</option></select></label>
      <label>Rushed if quicker than (seconds per question)<input name="min_seconds" type="number" step="0.5" min="0" value="${t.min_seconds}"></label>
      <label>Order<input name="sort_order" type="number" value="${t.sort_order || 0}"></label></div>
    <label class="check"><input type="checkbox" name="manager_only" ${t.manager_only ? 'checked' : ''}> Managers only (signed with their own login)</label>
    <label class="check"><input type="checkbox" name="active" ${t.active !== false ? 'checked' : ''}> Switched on</label>
    <div class="actions"><button class="btn primary">Save</button></div></form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      const rec = { name: form.name.value.trim(), icon: form.icon.value.trim() || null, description: form.description.value.trim() || null,
        kind: form.kind.value, min_seconds: Number(form.min_seconds.value) || 0, sort_order: Number(form.sort_order.value) || 0,
        manager_only: form.manager_only.checked, active: form.active.checked };
      try {
        const r = t.id ? await q(sb.from('check_templates').update(rec).eq('id', t.id).select('id').single())
          : await q(sb.from('check_templates').insert(rec).select('id').single());
        m.close(); toast('Saved', 'ok'); done(r.id);
      } catch (err) { fail(err); }
    });
  };
}

function editItem(i, done) {
  const m = modal(i.id ? 'Edit question' : 'New question', html`<form>
    <div class="grid two"><label>Section<input name="section" value="${i.section || ''}" placeholder="e.g. Kitchen"></label>
      <label>Order<input name="sort_order" type="number" value="${i.sort_order}"></label></div>
    <label>Question <span class="hint">(ask one clear thing)</span><textarea name="question" rows="2" required>${i.question || ''}</textarea></label>
    <label>Extra help <span class="hint">(optional)</span><input name="help" value="${i.help || ''}"></label>
    <div class="grid two"><label>Answer type<select name="kind">${Object.entries(KIND).map(([k, l]) => html`<option value="${k}" ${i.kind === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label>Safe answer (Yes / No questions)<select name="expected"><option value="yes" ${i.expected === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${i.expected === 'no' ? 'selected' : ''}>No</option></select></label>
      <label>Lowest safe reading<input name="min_value" type="number" step="0.1" value="${i.min_value ?? ''}" placeholder="e.g. 63 for hot food"></label>
      <label>Highest safe reading<input name="max_value" type="number" step="0.1" value="${i.max_value ?? ''}" placeholder="e.g. 5 for a chiller"></label></div>
    <label>If it isn't safe, what can they do? <span class="hint">(one option per line)</span><textarea name="actions" rows="4">${(i.actions || []).join('\n')}</textarea></label>
    <label class="check"><input type="checkbox" name="critical" ${i.critical ? 'checked' : ''}> Critical (a food safety risk)</label>
    <label class="check"><input type="checkbox" name="active" ${i.active !== false ? 'checked' : ''}> In use</label>
    <div class="actions"><button class="btn primary">Save</button></div></form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      const n = v => (v === '' ? null : Number(v));
      const rec = { template_id: i.template_id, section: form.section.value.trim() || null, sort_order: Number(form.sort_order.value) || 0,
        question: form.question.value.trim(), help: form.help.value.trim() || null, kind: form.kind.value, expected: form.expected.value,
        min_value: n(form.min_value.value), max_value: n(form.max_value.value),
        actions: form.actions.value.split('\n').map(x => x.trim()).filter(Boolean), critical: form.critical.checked, active: form.active.checked };
      try {
        if (i.id) await q(sb.from('check_items').update(rec).eq('id', i.id)); else await q(sb.from('check_items').insert(rec));
        m.close(); toast('Saved', 'ok'); done();
      } catch (err) { fail(err); }
    });
  };
}
