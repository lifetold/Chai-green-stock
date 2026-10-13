// App shell: sign-in, navigation and the hash router.
import { sb, configured, state, q, loadSettings, esc, html, toast, fail, busy, isManager, isAdmin, runCleanups } from './lib.js';

const ROUTES = {
  '':                () => import('./pages/dashboard.js'),
  'goods-in':        () => import('./pages/goods-in.js'),
  'dispatch':        () => import('./pages/dispatch.js'),
  'stock':           () => import('./pages/stock.js'),
  'product':         () => import('./pages/product.js'),
  'reorder':         () => import('./pages/reorder.js'),
  'purchase-orders': () => import('./pages/purchase-orders.js'),
  'invoices':        () => import('./pages/invoices.js'),
  'dispatches':      () => import('./pages/dispatches.js'),
  'stock-check':     () => import('./pages/stock-check.js'),
  'adjust':          () => import('./pages/adjust.js'),
  'movements':       () => import('./pages/movements.js'),
  'stores':          () => import('./pages/stores.js'),
  'suppliers':       () => import('./pages/suppliers.js'),
  'settings':        () => import('./pages/settings.js'),
  'users':           () => import('./pages/users.js')
};

const NAV = [
  ['Daily work'],
  ['', '🏠', 'Dashboard'],
  ['goods-in', '📥', 'Goods in'],
  ['dispatch', '📤', 'Stock out'],
  ['stock-check', '✅', 'Stock check'],
  ['adjust', '♻️', 'Write-off / adjust'],
  ['Stock'],
  ['stock', '📦', 'Products & stock'],
  ['reorder', '🔔', 'Reorder', 'reorder'],
  ['purchase-orders', '🧾', 'Purchase orders'],
  ['movements', '📜', 'Stock history'],
  ['Money'],
  ['invoices', '💷', 'Invoices'],
  ['dispatches', '🚚', 'Collections'],
  ['Set up'],
  ['stores', '🏪', 'Stores'],
  ['suppliers', '🏭', 'Suppliers'],
  ['settings', '⚙️', 'Settings', null, 'manager'],
  ['users', '👥', 'Users', 'users', 'admin']
];

const app = document.getElementById('app');

// ------------------------------------------------------------------ auth
async function boot() {
  if (!configured) {
    app.innerHTML = `<div class="login"><div class="logo">Chai Green Stock</div>
      <div class="notice warn">This copy isn't connected to a database yet. Put the Supabase URL and anon key
      in <code>js/config.js</code> (see README.md).</div></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_OUT') location.reload();
    if (event === 'PASSWORD_RECOVERY') showNewPassword();
    if (event === 'SIGNED_IN' && !state.user && s) start(s.user);
  });
  if (location.hash.includes('type=recovery')) return; // handled by PASSWORD_RECOVERY
  if (session) start(session.user); else showLogin();
}

function showLogin(mode = 'signin') {
  const signup = mode === 'signup';
  app.innerHTML = html`<div class="login">
    <div class="logo">Chai Green</div>
    <div class="tag">Stock &amp; warehouse</div>
    <div class="card">
      <form id="auth">
        ${signup ? html`<label>Your name<input name="name" required autocomplete="name"></label>` : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required minlength="8"
          autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <p></p>
        <button class="btn primary big" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <p style="text-align:center;margin-top:1rem">
        ${signup
          ? html`Already have an account? <a href="#" data-mode="signin">Sign in</a>`
          : html`<a href="#" data-forgot>Forgotten password?</a> · <a href="#" data-mode="signup">New staff member</a>`}
      </p>
    </div></div>`;
  app.querySelectorAll('[data-mode]').forEach(a => a.onclick = e => { e.preventDefault(); showLogin(a.dataset.mode); });
  const forgot = app.querySelector('[data-forgot]');
  if (forgot) forgot.onclick = async e => {
    e.preventDefault();
    const email = app.querySelector('[name=email]').value.trim();
    if (!email) return toast('Type your email first, then press "Forgotten password?" again.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
    error ? fail(error) : toast('Check your email for a reset link.', 'ok');
  };
  const form = app.querySelector('#auth');
  form.onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    busy(form.querySelector('button[type=submit]'), async () => {
      if (signup) {
        const { data, error } = await sb.auth.signUp({
          email: f.email, password: f.password,
          options: { data: { full_name: f.name }, emailRedirectTo: location.origin + '/' }
        });
        if (error) return fail(error);
        if (!data.session) {
          app.querySelector('.card').innerHTML = `<div class="notice ok">Nearly there. We've sent a link to
            <b>${esc(f.email)}</b>. Click it to confirm your email, then ask a manager to switch your account on.</div>`;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) fail(new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message));
      }
    });
  };
}

function showNewPassword() {
  app.innerHTML = `<div class="login"><div class="logo">Chai Green</div><div class="card">
    <form id="pw"><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
    <p></p><button class="btn primary big">Save password</button></form></div></div>`;
  const form = app.querySelector('#pw');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      const { error } = await sb.auth.updateUser({ password: form.password.value });
      if (error) return fail(error);
      history.replaceState(null, '', '/');
      location.reload();
    });
  };
}

async function start(user) {
  state.user = user;
  try {
    state.profile = await q(sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
  } catch (e) { return fail(e); }
  if (!state.profile?.active) {
    app.innerHTML = html`<div class="login"><div class="logo">Chai Green</div><div class="card">
      <div class="notice warn">Hi ${state.profile?.full_name || user.email}. Your account is waiting for a manager to switch it on.
      Ask them to open <b>Users</b> and press <b>Switch on</b>.</div>
      <button class="btn big" id="out">Sign out</button></div></div>`;
    app.querySelector('#out').onclick = () => sb.auth.signOut();
    return;
  }
  await loadSettings().catch(fail);
  renderShell();
  window.addEventListener('hashchange', route);
  route();
}

// ------------------------------------------------------------------ shell
function renderShell() {
  const canSee = need => !need || (need === 'manager' ? isManager() : isAdmin());
  app.innerHTML = html`
    <header class="topbar">
      <button class="menu-btn" aria-label="Menu">☰</button>
      <a class="brand" href="#/">Chai Green <span>Stock</span></a>
      <div class="spacer"></div>
      <div class="who">${state.profile.full_name || state.user.email}</div>
      <button id="signout">Sign out</button>
    </header>
    <div class="shell">
      <nav class="side">${NAV.filter(n => canSee(n[4])).map(n => n.length === 1
        ? html`<div class="group">${n[0]}</div>`
        : html`<a href="#/${n[0]}" data-route="${n[0]}"><span>${n[1]}</span>${n[2]}${n[3] ? html`<span class="badge hidden" data-count="${n[3]}"></span>` : ''}</a>`)}
      </nav>
      <main id="main"></main>
    </div>
    <nav class="quickbar">
      <a href="#/" data-route=""><span class="ico">🏠</span>Home</a>
      <a href="#/goods-in" data-route="goods-in"><span class="ico">📥</span>Goods in</a>
      <a href="#/dispatch" data-route="dispatch"><span class="ico">📤</span>Stock out</a>
      <a href="#/stock" data-route="stock"><span class="ico">📦</span>Stock</a>
    </nav>`;
  app.querySelector('#signout').onclick = () => sb.auth.signOut();
  // Tapping a link to the page you're already on starts it afresh
  // (e.g. "Stock out" again after booking one out).
  app.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute('href') === (location.hash || '#/')) route();
  });
  app.querySelector('.menu-btn').onclick = () => document.body.classList.toggle('nav-open');
  refreshCounts();
}

// Little number badges in the menu (things needing attention).
export async function refreshCounts() {
  try {
    const s = await q(sb.rpc('dashboard_summary'));
    setCount('reorder', s?.to_reorder);
    setCount('users', isAdmin() ? s?.pending_users : 0);
  } catch (e) { /* not critical */ }
}
function setCount(key, n) {
  const el = app.querySelector(`[data-count="${key}"]`);
  if (!el) return;
  el.textContent = n;
  el.className = 'badge ' + (n ? 'warn' : 'hidden');
}

let routeSeq = 0;
async function route() {
  runCleanups();
  document.body.classList.remove('nav-open');
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const key = name.split('?')[0];
  app.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  const main = document.getElementById('main');
  const load = ROUTES[key];
  if (!load) { main.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to the dashboard</a></div>'; return; }
  const seq = ++routeSeq;
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const mod = await load();
    if (seq !== routeSeq) return;
    await mod.render(main, params.map(decodeURIComponent));
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== routeSeq) return;
    main.innerHTML = html`<div class="notice bad">${e.message || e}</div>`;
    console.error(e);
  }
}

boot();
