// Company details (for invoices), pricing defaults, stock-check rota settings.
import { sb, q, rpc, state, html, raw, formData, busy, fail, toast, loadSettings, isManager } from '../lib.js';

export async function render(main) {
  if (!isManager()) { main.innerHTML = '<div class="notice bad">Managers only.</div>'; return; }
  const s = await loadSettings();
  const f = (name, label, attrs = '', hint = '') => html`<label>${label}${hint ? html` <span class="hint">(${hint})</span>` : ''}<input name="${name}" value="${s[name] ?? ''}" ${raw(attrs)}></label>`;
  const t = (name, label, hint = '') => html`<label>${label}${hint ? html` <span class="hint">(${hint})</span>` : ''}<textarea name="${name}">${s[name] || ''}</textarea></label>`;
  main.innerHTML = html`
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <form data-form>
    <div class="card"><h2>Company (shown on invoices)</h2><div class="grid two">
      ${f('company_name', 'Company name', 'required')}${f('company_email', 'Email', 'type="email"')}${f('company_phone', 'Phone')}
      ${f('vat_number', 'VAT number')}${f('company_number', 'Company number')}</div>
      ${t('company_address', 'Address')}${t('bank_details', 'Bank details for payment', 'account name, sort code, account number')}</div>
    <div class="card"><h2>Invoices &amp; pricing</h2><div class="grid three">
      ${f('invoice_prefix', 'Invoice number prefix', 'required')}${f('next_invoice_no', 'Next invoice number', 'type="number" min="1" required')}
      ${f('payment_terms_days', 'Payment terms (days)', 'type="number" min="0" required')}
      ${f('default_margin_pct', 'Default franchise margin %', 'type="number" step="0.01" required')}
      ${f('default_vat_rate', 'Default VAT rate %', 'type="number" step="0.01" required')}</div>
      <label class="check"><input type="checkbox" name="require_dispatch_photo" ${s.require_dispatch_photo ? 'checked' : ''}> A photo is required for every stock out</label></div>
    <div class="card"><h2>Reordering &amp; dates</h2><div class="grid three">
      ${f('usage_window_days', 'Average usage over (days)', 'type="number" min="7" required')}
      ${f('safety_stock_days', 'Safety stock (days)', 'type="number" min="0" required', 'extra cover on top of lead time')}
      ${f('expiry_warning_days', 'Warn about use-by dates within (days)', 'type="number" min="1" required')}</div>
      ${f('alert_emails', 'Daily reorder email to', '', 'comma separated; needs the email set-up in README')}</div>
    <div class="card"><h2>Weekly stock check</h2><div class="grid three">
      ${f('check_cycle_weeks', 'Count every product every … weeks', 'type="number" min="1" max="52" required')}
      <label>Week starts on<select name="check_day">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => html`<option value="${i + 1}" ${s.check_day === i + 1 ? 'selected' : ''}>${d}</option>`)}</select></label></div>
      <p class="muted">Products are split into ${s.check_cycle_weeks} groups and one group is counted each week. After changing the number of weeks, press "Re-split products".</p>
      <button type="button" class="btn" data-rebalance>Re-split products into groups</button></div>
    <button class="btn primary big" type="submit">Save settings</button></form>`;

  const form = main.querySelector('[data-form]');
  form.onsubmit = e => {
    e.preventDefault();
    busy(form.querySelector('[type=submit]'), async () => {
      const v = formData(form);
      for (const k of ['next_invoice_no', 'payment_terms_days', 'default_margin_pct', 'default_vat_rate', 'usage_window_days',
        'safety_stock_days', 'expiry_warning_days', 'check_cycle_weeks', 'check_day']) v[k] = Number(v[k]);
      v.updated_at = new Date().toISOString();
      try { await q(sb.from('settings').update(v).eq('id', 1)); await loadSettings(); toast('Settings saved', 'ok'); } catch (err) { fail(err); }
    });
  };
  main.querySelector('[data-rebalance]').onclick = e => busy(e.target, async () => {
    try { await rpc('rebalance_check_groups', {}); toast('Products re-split into groups', 'ok'); } catch (err) { fail(err); }
  });
}
