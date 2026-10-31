// Food safety records: every check, temperature and fix, signed by name.
// The read-only view an Environmental Health Officer is given.
import { sb, q, state, html, raw, dateTime, date, badge, hydratePhotos, downloadCsv, isoDate, addDays } from '../lib.js';
import { myStoreId, storeSelect, bindStoreSelect, isInspector } from './store-common.js';

export async function render(main, params) {
  if (params[0]) return detail(main, params[0]);
  const stores = await q(sb.from('stores').select('id, name, code, address').eq('active', true).order('name'));
  if (!stores.length) { main.innerHTML = html`<div class="notice warn">No stores set up yet.</div>`; return; }
  const storeId = myStoreId(stores);
  const store = stores.find(s => s.id === storeId);
  const f = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const from = f.from || isoDate(addDays(new Date(), -30));
  const to = f.to || isoDate(new Date());
  const tab = f.tab || 'checks';
  const templates = await q(sb.from('check_templates').select('id, name').order('sort_order'));
  let runsQ = sb.from('check_runs').select('*').eq('store_id', storeId).neq('status', 'abandoned')
    .gte('started_at', from + 'T00:00:00').lte('started_at', to + 'T23:59:59').order('started_at', { ascending: false }).limit(1000);
  if (f.t) runsQ = runsQ.eq('template_id', f.t);
  const runs = await q(runsQ);
  const ids = runs.map(r => r.id);
  const answers = ids.length && tab !== 'checks'
    ? await q(sb.from('check_answers').select('*').in('run_id', ids.slice(0, 300))
        .or(tab === 'temps' ? 'kind.eq.temperature' : 'ok.eq.false').order('answered_at', { ascending: false }))
    : [];
  const runById = Object.fromEntries(runs.map(r => [r.id, r]));
  const exp = state.profile.access_expires_at;

  main.innerHTML = html`
    ${isInspector() ? html`<div class="notice">Read-only view for Environmental Health${exp ? html`. This access ends ${dateTime(exp)}` : ''}.
      Every record below was signed by name when it was made and cannot be changed.</div>` : ''}
    <div class="page-head"><div><h1>Food safety records</h1><p class="muted">${store.name}${store.address ? ' · ' + store.address.split('\n')[0] : ''}</p></div>
      <div class="btn-row no-print">${storeSelect(stores, storeId)}<button class="btn" data-csv>Download</button><button class="btn" data-print>Print</button></div></div>
    <form class="card no-print grid four" data-filter>
      <label>From<input type="date" name="from" value="${from}"></label>
      <label>To<input type="date" name="to" value="${to}"></label>
      <label>Check<select name="t"><option value="">All checks</option>${templates.map(t => html`<option value="${t.id}" ${f.t === t.id ? 'selected' : ''}>${t.name}</option>`)}</select></label>
      <div style="align-self:end"><button class="btn primary">Show</button></div>
    </form>
    <div class="tabs no-print">${[['checks', 'Checks'], ['temps', 'Temperatures'], ['problems', 'Problems & fixes']].map(([k, l]) =>
      html`<a href="#" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`)}</div>
    <div class="card"><div class="table-wrap">${tab === 'checks' ? checksTable(runs) : answersTable(answers, runById, tab)}</div></div>`;

  const go = patch => {
    const p = new URLSearchParams({ from, to, tab, ...(f.t ? { t: f.t } : {}), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    location.hash = '#/records?' + p;
  };
  main.querySelector('[data-filter]').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    go({ from: d.from, to: d.to, t: d.t });
  };
  main.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); go({ tab: a.dataset.tab }); });
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/records/' + tr.dataset.id; });
  main.querySelector('[data-print]').onclick = () => window.print();
  bindStoreSelect(main, () => render(main, []));
  main.querySelector('[data-csv]').onclick = () => tab === 'checks'
    ? downloadCsv(`${store.code || 'store'}-checks-${from}-to-${to}.csv`, [
        ['Date', 'Check', 'Done by', 'Started', 'Finished', 'Questions', 'Problems', 'Critical problems', 'Score %', 'Rushed', 'Time taken (s)'],
        ...runs.map(r => [date(r.started_at), r.template_name, r.done_by, dateTime(r.started_at), dateTime(r.finished_at), r.answered,
          r.failed, r.critical_failed, r.score, r.rushed ? 'Yes' : 'No', r.duration_seconds])])
    : downloadCsv(`${store.code || 'store'}-${tab}-${from}-to-${to}.csv`, [
        ['Date & time', 'Check', 'Done by', 'Question', 'Answer', 'Safe', 'What was done', 'Note', 'Seconds taken'],
        ...answers.map(a => [dateTime(a.answered_at), runById[a.run_id]?.template_name, runById[a.run_id]?.done_by, a.question,
          a.value ?? a.answer, a.ok ? 'Yes' : 'No', a.corrective_action, a.note, a.seconds])]);
}

function checksTable(runs) {
  if (!runs.length) return html`<div class="empty">No checks in these dates.</div>`;
  return html`<table><thead><tr><th>When</th><th>Check</th><th>Done by</th><th class="num">Score</th><th>Problems</th><th></th></tr></thead>
    <tbody>${runs.map(r => html`<tr class="click" data-id="${r.id}">
      <td>${dateTime(r.started_at)}</td><td><b>${r.template_name}</b></td><td>${r.done_by}</td>
      <td class="num">${r.status === 'complete' ? r.score + '%' : '—'}</td>
      <td>${r.status !== 'complete' ? badge('reorder', 'Not finished') : r.failed ? html`${r.failed} fixed${r.critical_failed ? html` ${badge('out', r.critical_failed + ' critical')}` : ''}` : badge('ok', 'None')}</td>
      <td>${r.rushed ? badge('reorder', 'Rushed') : ''}</td></tr>`)}</tbody></table>`;
}

function answersTable(answers, runById, tab) {
  if (!answers.length) return html`<div class="empty">${tab === 'temps' ? 'No temperatures recorded in these dates.' : 'No problems recorded in these dates. 👍'}</div>`;
  return html`<table><thead><tr><th>When</th><th>Check / by</th><th>What</th><th class="num">${tab === 'temps' ? 'Reading' : 'Answer'}</th><th>Result</th><th>What was done</th></tr></thead>
    <tbody>${answers.map(a => {
      const r = runById[a.run_id] || {};
      return html`<tr class="click" data-id="${a.run_id}"><td>${dateTime(a.answered_at)}</td><td>${r.template_name}<br><small>${r.done_by}</small></td>
        <td>${a.question}</td><td class="num"><b>${a.value != null ? a.value + (a.kind === 'temperature' ? '°C' : '') : a.answer}</b></td>
        <td>${a.ok ? badge('ok', 'Safe') : badge('out', a.critical ? 'Critical' : 'Problem')}</td>
        <td>${a.corrective_action || ''}${a.note ? html`<br><small>${a.note}</small>` : ''}</td></tr>`;
    })}</tbody></table>`;
}

async function detail(main, id) {
  const [r, answers] = await Promise.all([
    q(sb.from('check_runs').select('*, stores(name)').eq('id', id).single()),
    q(sb.from('check_answers').select('*').eq('run_id', id).order('sort_order'))
  ]);
  let section = null;
  main.innerHTML = html`
    <div class="page-head"><div><a class="no-print" href="#/records">← All records</a>
      <h1>${r.template_name}</h1><p class="muted">${r.stores.name} · ${dateTime(r.started_at)}</p></div>
      <div class="btn-row no-print"><button class="btn" data-print>Print</button></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Signed by</div><div class="value" style="font-size:1.2rem">${r.done_by}</div></div>
      <div class="stat"><div class="label">Score</div><div class="value">${r.score != null ? r.score + '%' : '—'}</div></div>
      <div class="stat ${r.failed ? 'warn' : ''}"><div class="label">Problems (all with an action)</div><div class="value">${r.failed}</div></div>
      <div class="stat ${r.rushed ? 'warn' : ''}"><div class="label">Time taken${r.rushed ? ' · RUSHED' : ''}</div>
        <div class="value" style="font-size:1.2rem">${r.duration_seconds != null ? r.duration_seconds + ' s for ' + r.answered + ' questions' : 'Not finished'}</div></div>
    </div>
    ${r.rushed ? html`<div class="notice warn">${r.rushed_items} of ${r.answered} answers were given too quickly to have been properly checked.</div>` : ''}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Question</th><th class="num">Answer</th><th>Result</th><th>What was done</th><th class="num">Time</th></tr></thead>
      <tbody>${answers.map(a => {
        const head = a.section && a.section !== section ? (section = a.section, html`<tr><th colspan="5" class="sec">${a.section}</th></tr>`) : '';
        return html`${head}<tr><td>${a.question}</td>
          <td class="num"><b>${a.value != null ? a.value + (a.kind === 'temperature' ? '°C' : '') : (a.answer || '').replace(/^yes$/, 'Yes').replace(/^no$/, 'No')}</b></td>
          <td>${a.ok ? badge('ok', 'OK') : badge('out', a.critical ? 'Critical' : 'Problem')}</td>
          <td>${a.corrective_action || ''}${a.note ? html`<br><small>${a.note}</small>` : ''}
            ${a.photo_path ? html`<div class="photos"><div class="ph"><img data-photo="${a.photo_path}" alt="Photo"></div></div>` : ''}</td>
          <td class="num">${dateTime(a.answered_at).split(', ').pop()}<br><small>${a.seconds}s${a.rushed ? raw(' <span class="badge reorder">quick</span>') : ''}</small></td></tr>`;
      })}</tbody></table></div></div>`;
  main.querySelector('[data-print]').onclick = () => window.print();
  hydratePhotos(main);
}
