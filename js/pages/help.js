// Help: how to use the app, for the person signed in (or every role), plus a downloadable PDF guide.
import { state, html } from '../lib.js';
import { HELP, ROLE_NAMES } from '../help-content.js';

const GUIDE = '/help/chai-green-app-guide.pdf';

export async function render(main) {
  const role = state.profile.role;
  let all = false;
  const draw = () => {
    const sections = all ? HELP : HELP.filter(s => s.who.includes(role));
    main.innerHTML = html`
      <div class="page-head"><div><h1>Help</h1>
        <p class="muted">${all ? 'The full guide for every role.' : `How to use the app as ${ROLE_NAMES[role] || 'a user'}.`}</p></div>
        <div class="btn-row">
          <a class="btn primary" href="${GUIDE}" download="Chai Green app guide.pdf">⬇ Download the help guide (PDF)</a>
          <button class="btn" data-all>${all ? 'Show my guide only' : 'Show every role'}</button></div></div>
      ${sections.map(s => html`<section class="card help-section"><h2>${s.title}</h2>
        ${s.topics.map(t => html`<details class="help-topic"><summary>${t.q}</summary>
          <ol>${t.steps.map(x => html`<li>${x}</li>`)}</ol></details>`)}</section>`)}`;
    main.querySelector('[data-all]').onclick = () => { all = !all; draw(); };
  };
  draw();
}
