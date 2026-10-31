// Head office: every store's food safety at a glance — today's checks, scores,
// rushed checks and critical problems, plus the last 14 days.
import { sb, q, html, raw, dateTime, date, badge, isManager, addDays } from '../lib.js';

export async function render(main) {
  if (!isManager()) { main.innerHTML = '<div class="notice bad">Head office only.</div>'; return; }
  const since = addDays(new Date(), -13); since.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [stores, templates, runs, audits] = await Promise.all([
    q(sb.from('stores').select('id, name, code').eq('active', true).order('name')),
    q(sb.from('check_templates').select('*').eq('active', true).order('sort_order')),
    q(sb.from('check_runs').select('id, store_id, template_id, template_name, done_by, started_at, finished_at, score, failed, critical_failed, rushed, status')
      .eq('status', 'complete').gte('started_at', since.toISOString()).order('started_at', { ascending: false })),
    q(sb.from('check_runs').select('store_id, started_at, score, check_templates!inner(kind)').eq('status', 'complete')
      .eq('check_templates.kind', 'monthly').order('started_at', { ascending: false }).limit(500))
  ]);
  const daily = templates.filter(t => t.kind === 'daily');
  const days = [...Array(14)].map((_, i) => addDays(since, i));
  const dayKey = d => new Date(d).toDateString();
  const todayRuns = runs.filter(r => new Date(r.started_at) >= today);
  const fullyDone = stores.filter(s => daily.every(t => todayRuns.some(r => r.store_id === s.id && r.template_id === t.id))).length;
  const week = runs.filter(r => new Date(r.started_at) >= addDays(today, -6));
  const avg = week.length ? Math.round(week.reduce((a, r) => a + Number(r.score || 0), 0) / week.length) : null;
  const flags = runs.filter(r => r.rushed || r.critical_failed > 0).slice(0, 30);

  main.innerHTML = html`
    <div class="page-head"><div><h1>Food safety: all stores</h1><p class="muted">Live from every store's checks.</p></div>
      <div class="btn-row"><a class="btn" href="#/check-setup">Edit checklists</a></div></div>
    <div class="stats">
      <div class="stat ${fullyDone < stores.length ? 'warn' : ''}"><div class="label">Stores with all checks done today</div><div class="value">${fullyDone}/${stores.length}</div></div>
      <div class="stat"><div class="label">Average score, last 7 days</div><div class="value">${avg == null ? '—' : avg + '%'}</div></div>
      <div class="stat ${week.some(r => r.rushed) ? 'warn' : ''}"><div class="label">Rushed checks, last 7 days</div><div class="value">${week.filter(r => r.rushed).length}</div></div>
      <div class="stat ${week.some(r => r.critical_failed) ? 'bad' : ''}"><div class="label">Critical problems, last 7 days</div><div class="value">${week.reduce((a, r) => a + r.critical_failed, 0)}</div></div>
    </div>
    <div class="card"><h2>Today</h2><div class="table-wrap"><table>
      <thead><tr><th>Store</th>${daily.map(t => html`<th>${t.icon || ''} ${t.name}</th>`)}<th>Last 14 days</th><th>Monthly audit</th></tr></thead>
      <tbody>${stores.map(s => {
        const audit = audits.find(a => a.store_id === s.id);
        return html`<tr><td><b>${s.name}</b><br><small>${s.code || ''}</small></td>
        ${daily.map(t => {
          const r = todayRuns.find(x => x.store_id === s.id && x.template_id === t.id);
          return r ? html`<td class="click" data-id="${r.id}">${badge(r.rushed ? 'reorder' : r.critical_failed ? 'out' : 'ok', r.score + '%')}
            <br><small>${r.done_by}, ${dateTime(r.finished_at).split(', ').pop()}${r.rushed ? ' · rushed' : ''}</small></td>`
            : html`<td>${badge('out', 'Not done')}</td>`;
        })}
        <td><div class="heat">${days.map(d => {
          const first = runs.filter(r => r.store_id === s.id).at(-1);
          if (!first || new Date(d) < new Date(new Date(first.started_at).toDateString())) return raw(`<i title="${d.toLocaleDateString('en-GB')}: not using checks yet"></i>`);
          const n = daily.filter(t => runs.some(r => r.store_id === s.id && r.template_id === t.id && dayKey(r.started_at) === dayKey(d))).length;
          const bad = runs.some(r => r.store_id === s.id && dayKey(r.started_at) === dayKey(d) && (r.rushed || r.critical_failed));
          const cls = n === daily.length ? (bad ? 'amber' : 'green') : n ? 'amber' : 'red';
          return raw(`<i class="${cls}" title="${d.toLocaleDateString('en-GB')}: ${n} of ${daily.length} checks${bad ? ', with flags' : ''}"></i>`);
        })}</div></td>
        <td>${audit ? html`${date(audit.started_at)}<br><small>${audit.score}%</small>` : badge('reorder', 'None yet')}</td></tr>`;
      })}</tbody></table></div>
      <p class="muted"><span class="heat"><i class="green"></i></span> all checks done · <span class="heat"><i class="amber"></i></span> missed some or flagged · <span class="heat"><i class="red"></i></span> nothing done · <span class="heat"><i></i></span> not using checks yet</p></div>
    <div class="card"><h2>Flags to follow up</h2>${flags.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Store</th><th>Check</th><th>Done by</th><th>Flag</th></tr></thead>
      <tbody>${flags.map(r => html`<tr class="click" data-id="${r.id}"><td>${dateTime(r.started_at)}</td>
        <td>${stores.find(s => s.id === r.store_id)?.name}</td><td>${r.template_name}</td><td>${r.done_by}</td>
        <td>${r.rushed ? badge('reorder', 'Rushed') : ''} ${r.critical_failed ? badge('out', r.critical_failed + ' critical') : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">Nothing rushed and no critical problems in the last 14 days.</p>`}</div>`;
  main.querySelectorAll('[data-id]').forEach(el => el.onclick = () => { location.hash = '#/records/' + el.dataset.id; });
}
