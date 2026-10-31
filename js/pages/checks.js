// Today's safety checks for a store, and the one-question-at-a-time check runner.
// Every answer is timed on the server; checks done too quickly are flagged as rushed.
import { sb, q, rpc, state, html, raw, esc, dateTime, date, badge, busy, fail, toast, isManager, uploadBlob, compressImage } from '../lib.js';
import { myStoreId, storeSelect, bindStoreSelect } from './store-common.js';

export async function render(main, params) {
  if (params[0] === 'run') return runner(main, params[1], params[2]);
  const stores = await q(sb.from('stores').select('id, name, code').eq('active', true).order('name'));
  if (!stores.length) { main.innerHTML = html`<div class="notice warn">No stores set up yet.</div>`; return; }
  const storeId = myStoreId(stores);
  const store = stores.find(s => s.id === storeId);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [templates, runs] = await Promise.all([
    q(sb.from('check_templates').select('*').eq('active', true).order('sort_order')),
    q(sb.from('check_runs').select('*').eq('store_id', storeId).eq('status', 'complete')
      .gte('started_at', monthStart.toISOString()).order('started_at', { ascending: false }))
  ]);
  const latest = t => runs.find(r => r.template_id === t.id && (t.kind === 'monthly' || new Date(r.started_at) >= today));
  const daily = templates.filter(t => t.kind === 'daily');
  const doneToday = daily.filter(latest).length;

  main.innerHTML = html`
    <div class="page-head"><div><h1>Today's checks</h1>
      <p class="muted">${store.name} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      ${storeSelect(stores, storeId)}</div>
    <div class="notice ${doneToday === daily.length ? 'ok' : ''}">${doneToday} of ${daily.length} daily checks done today.
      Do every check for real: answers that are too quick are flagged to head office.</div>
    <div class="check-list">${templates.map(t => {
      const r = latest(t);
      return html`<div class="card check-card ${r ? 'done' : ''}">
        <div class="check-ico">${t.icon || '✅'}</div>
        <div class="check-info"><h2>${t.name}</h2><p class="muted">${t.description || ''}</p>
          ${r ? html`<p>${badge('ok', t.kind === 'monthly' ? 'Done ' + date(r.started_at) : 'Done')} by <b>${r.done_by}</b> at ${dateTime(r.finished_at)}
            · ${r.score}%${r.failed ? html` · ${r.failed} problem${r.failed > 1 ? 's' : ''} fixed` : ''}
            ${r.rushed ? html` ${badge('reorder', 'Rushed')}` : ''}</p>` : html`<p>${badge('out', t.kind === 'monthly' ? 'Not done this month' : 'Not done yet')}</p>`}</div>
        <div><a class="btn ${r ? '' : 'primary'}" href="#/checks/run/${t.id}/${storeId}">${r ? 'Do again' : 'Start'}</a></div></div>`;
    })}</div>`;
  bindStoreSelect(main, () => render(main, []));
}

// ------------------------------------------------------------------ runner
async function runner(main, templateId, storeId) {
  const [t, items, store, team] = await Promise.all([
    q(sb.from('check_templates').select('*').eq('id', templateId).single()),
    q(sb.from('check_items').select('*').eq('template_id', templateId).eq('active', true).order('sort_order')),
    q(sb.from('stores').select('id, name').eq('id', storeId).single()),
    q(sb.from('staff_members').select('id, name, role_title').eq('store_id', storeId).eq('active', true).order('name'))
  ]);
  const canSignAsMe = ['admin', 'manager', 'store_manager'].includes(state.profile.role);
  let runId = null, by = '';

  // Step 1: who's checking?
  const whoScreen = () => {
    if (t.manager_only && !canSignAsMe) {
      main.innerHTML = html`<div class="notice bad">Only a manager can do the ${t.name}.</div>`;
      return;
    }
    main.innerHTML = html`<div class="runner">
      <div class="run-top"><a href="#/checks">← Back</a><b>${t.name}</b><span>${store.name}</span></div>
      <div class="card">
        <h1>Who's checking?</h1>
        ${t.manager_only ? html`<p class="muted">This check is signed with your own login.</p>` : html`<p class="muted">Tap your name, then type your PIN.</p>
        ${team.length ? html`<div class="who-grid">${team.map(m => html`<button class="who-btn" data-staff="${m.id}">
          <span class="avatar">${m.name.slice(0, 1).toUpperCase()}</span><b>${m.name}</b><small>${m.role_title || ''}</small></button>`)}</div>`
          : html`<div class="notice warn">No team members set up for ${store.name} yet. ${canSignAsMe ? html`<a href="#/team">Add the team</a>, or sign as yourself below.` : 'Ask your manager to add the team.'}</div>`}`}
        ${canSignAsMe ? html`<p><button class="btn ${t.manager_only ? 'primary big' : ''}" data-me>Sign as me (${state.profile.full_name || state.profile.email})</button></p>` : ''}
      </div></div>`;
    main.querySelectorAll('[data-staff]').forEach(b => b.onclick = () => pinScreen(team.find(m => m.id === b.dataset.staff)));
    const me = main.querySelector('[data-me]');
    if (me) me.onclick = () => busy(me, () => begin(null, null, state.profile.full_name || state.profile.email));
  };

  const pinScreen = m => {
    let pin = '';
    main.innerHTML = html`<div class="runner">
      <div class="run-top"><a href="#" data-backwho>← Not ${m.name}?</a><b>${t.name}</b><span>${store.name}</span></div>
      <div class="card center"><span class="avatar big">${m.name.slice(0, 1).toUpperCase()}</span><h1>Hi ${m.name}</h1>
        <p class="muted">Type your 4-number PIN</p><div class="pin-dots" data-dots></div>
        <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? raw('<span></span>') : html`<button data-k="${k}">${k}</button>`)}</div></div></div>`;
    const dots = main.querySelector('[data-dots]');
    const draw = () => { dots.innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
    draw();
    main.querySelector('[data-backwho]').onclick = e => { e.preventDefault(); whoScreen(); };
    main.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => {
      if (b.dataset.k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += b.dataset.k;
      draw();
      if (pin.length === 4) {
        try { await begin(m.id, pin, m.name); }
        catch (e) { dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 500); pin = ''; draw(); fail(e); }
      }
    });
  };

  const begin = async (staffId, pin, name) => {
    runId = await rpc('start_check', { p_template: t.id, p_store: storeId, p_staff: staffId, p_pin: pin });
    by = name;
    question(0);
  };

  // Step 2: one question at a time
  const question = i => {
    if (i >= items.length) return finish();
    const it = items[i];
    const range = it.kind === 'temperature' || it.kind === 'number'
      ? [it.min_value != null ? `at least ${it.min_value}${it.kind === 'temperature' ? '°C' : ''}` : '', it.max_value != null ? `${it.max_value}${it.kind === 'temperature' ? '°C' : ''} or below` : ''].filter(Boolean).join(' and ')
      : '';
    main.innerHTML = html`<div class="runner">
      <div class="run-top"><span>${t.name} · ${by}</span><b>${i + 1} of ${items.length}</b></div>
      <div class="progress"><i style="width:${Math.round(i / items.length * 100)}%"></i></div>
      <div class="card q-card">
        ${it.section ? html`<p class="q-section">${it.section}</p>` : ''}
        <div class="q-ico">${raw(iconFor(it))}</div>
        <h1 class="q-text">${it.question}</h1>
        ${it.help ? html`<p class="muted">${it.help}</p>` : ''}
        ${range ? html`<p class="muted">It must be ${range}.</p>` : ''}
        <div data-input>${it.kind === 'yes_no' ? html`<div class="yn">
            <button class="yn-btn yes" data-a="yes"><span>✓</span>Yes</button>
            <button class="yn-btn no" data-a="no"><span>✗</span>No</button></div>`
          : it.kind === 'text' ? html`<textarea name="v" rows="3"></textarea><button class="btn primary big" data-save>Save</button>`
          : html`<div class="temp-in"><button class="btn" data-neg title="Make it minus">±</button>
              <input name="v" inputmode="decimal" autocomplete="off" placeholder="0">${it.kind === 'temperature' ? raw('<span>°C</span>') : ''}</div>
              <button class="btn primary big" data-save>Save reading</button>`}</div>
        <div data-result></div>
      </div></div>`;
    const input = main.querySelector('[name=v]');
    if (input) input.focus();
    const neg = main.querySelector('[data-neg]');
    if (neg) neg.onclick = () => { input.value = input.value.startsWith('-') ? input.value.slice(1) : '-' + input.value; input.focus(); };
    const submit = async (btn, answer, value) => busy(btn, async () => {
      let res;
      try { res = await rpc('answer_check', { p_run: runId, p_item: it.id, p_answer: answer, p_value: value }); }
      catch (e) { return fail(e); }
      if (res.needs_action) return problem(i, it, res, value);
      if (it.kind === 'temperature' || it.kind === 'number') {
        main.querySelector('[data-input]').innerHTML = '';
        main.querySelector('[data-result]').innerHTML = html`<div class="notice ok big-note">✓ ${it.kind === 'temperature' ? 'Safe.' : 'OK.'}
          Reading of <b>${value}${it.kind === 'temperature' ? '°C' : ''}</b> saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} by ${by}.</div>`;
        setTimeout(() => question(i + 1), 900);
      } else question(i + 1);
    });
    main.querySelectorAll('[data-a]').forEach(b => b.onclick = () => submit(b, b.dataset.a, null));
    const save = main.querySelector('[data-save]');
    if (save) {
      save.onclick = () => {
        if (it.kind === 'text') return submit(save, input.value, null);
        const v = Number(String(input.value).replace(',', '.'));
        if (input.value.trim() === '' || !Number.isFinite(v)) return toast('Type the reading first.', 'bad');
        submit(save, null, v);
      };
      input.onkeydown = e => { if (e.key === 'Enter' && it.kind !== 'text') save.click(); };
    }
  };

  // A failed answer: say what was done about it before moving on.
  const problem = (i, it, res, value) => {
    main.querySelector('[data-input]').innerHTML = '';
    main.querySelector('[data-result]').innerHTML = html`
      <div class="notice bad big-note">${it.kind === 'temperature' ? html`<b>${value}°C is not safe.</b>` : html`<b>This needs sorting out.</b>`}
        ${res.critical ? ' This is a food safety risk.' : ''} What did you do about it?</div>
      <div class="actions-list">${(res.actions || []).map(a => html`<button class="btn action-btn" data-act="${a}">${a}</button>`)}</div>
      <label>Something else / more detail<textarea name="note" rows="2"></textarea></label>
      <label class="btn photo-btn">📷 Add a photo (optional)<input type="file" accept="image/*" capture="environment" hidden></label>
      <span data-photo-state class="muted"></span>
      <button class="btn primary big" data-other>Save what I did</button>`;
    let photo = null;
    const file = main.querySelector('input[type=file]');
    file.onchange = async () => {
      const st = main.querySelector('[data-photo-state]');
      st.textContent = 'Uploading photo…';
      try { photo = await uploadBlob('checks/' + runId, await compressImage(file.files[0])); st.textContent = '✓ Photo added'; }
      catch (e) { st.textContent = ''; fail(e); }
    };
    const send = (btn, action) => busy(btn, async () => {
      const note = main.querySelector('[name=note]').value.trim();
      if (!action && !note) return toast('Tap what you did, or type it in the box.', 'bad');
      try { await rpc('answer_check', { p_run: runId, p_item: it.id, p_answer: null, p_value: null, p_action: action || note, p_note: action ? note : null, p_photo: photo }); }
      catch (e) { return fail(e); }
      question(i + 1);
    });
    main.querySelectorAll('[data-act]').forEach(b => b.onclick = () => send(b, b.dataset.act));
    main.querySelector('[data-other]').onclick = e => send(e.target, null);
  };

  // Step 3: finish and sign
  const finish = async () => {
    main.innerHTML = '<div class="loading">Saving…</div>';
    let r;
    try { r = await rpc('finish_check', { p_run: runId }); }
    catch (e) { main.innerHTML = html`<div class="notice bad">${e.message}</div>`; return; }
    main.innerHTML = html`<div class="runner"><div class="card center">
      <div class="q-ico">🎉</div><h1>All done. ${r.rushed ? 'Thank you.' : 'Nice work!'}</h1>
      <p>${r.answered} of ${r.total_items} checks complete</p>
      <div class="table-wrap"><table><tbody>
        <tr><td>Signed by</td><td class="num"><b>${r.done_by}</b> at ${new Date(r.finished_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td></tr>
        <tr><td>Problems found</td><td class="num">${r.failed ? html`<b style="color:var(--red)">${r.failed}, all with an action</b>` : 'None'}</td></tr>
        <tr><td>Score</td><td class="num">${r.score}%</td></tr>
        <tr><td>Time taken</td><td class="num">${mins(r.duration_seconds)}</td></tr>
        <tr><td>Kept for</td><td class="num">2 years</td></tr></tbody></table></div>
      ${r.rushed ? html`<div class="notice warn">Some answers were very quick, so head office will see this check as <b>rushed</b>.
        Next time, take the time to actually check each one.</div>` : ''}
      <a class="btn primary big" href="#/checks">Back to today's checks</a></div></div>`;
  };

  whoScreen();
}

const mins = s => (s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`);

function iconFor(it) {
  const t = (it.question + ' ' + (it.section || '')).toLowerCase();
  const pick = [['freezer', '❄️'], ['chiller', '🧊'], ['fridge', '🧊'], ['display', '🍰'], ['probe', '🍗'], ['hot', '🔥'], ['sink', '🧼'],
    ['hand', '🧼'], ['toilet', '🚻'], ['fire', '🧯'], ['first aid', '🩹'], ['pest', '🐭'], ['allergen', '⚠️'], ['bin', '🗑️'],
    ['floor', '🧹'], ['clean', '🧽'], ['door', '🚪'], ['window', '🪟'], ['uniform', '👕'], ['fit for work', '🤒'], ['chemical', '🧴'],
    ['till', '💷'], ['alarm', '🔔'], ['urn', '🫖'], ['coffee', '☕'], ['fryer', '🍟'], ['label', '🏷️'], ['date', '📅'], ['raw', '🥩'],
    ['table', '🪑'], ['menu', '📋'], ['stock', '📦'], ['customer', '🙂'], ['electrical', '🔌']];
  return (pick.find(([k]) => t.includes(k)) || [null, it.kind === 'temperature' ? '🌡️' : '✅'])[1];
}
