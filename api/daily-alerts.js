// Daily email: products to reorder, use-by dates coming up, late purchase
// orders and overdue invoices. Run by the Vercel cron in vercel.json.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY   from resend.com (free tier is plenty)
//   ALERT_FROM       e.g. "Chai Green Stock <stock@chaigreen.co.uk>" (domain verified in Resend)
//   CRON_SECRET      any long random string; Vercel sends it with cron calls
// Recipients are set in the app: Settings → "Daily reorder email to".

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function db(path) {
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorised' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured' });
  }
  try {
    const [settings] = await db('settings?id=eq.1&select=*');
    const to = (settings.alert_emails || '').split(',').map(s => s.trim()).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + settings.expiry_warning_days * 864e5).toISOString().slice(0, 10);

    const [reorder, expiring, latePos, overdue] = await Promise.all([
      db('product_stock?active=is.true&stock_status=in.(out,reorder)&select=name,qty_on_hand,unit,eff_reorder_point,eff_reorder_qty,supplier_name,lead_days&order=supplier_name,name'),
      db(`stock_batches?qty_remaining=gt.0&expiry_date=lte.${soon}&select=qty_remaining,expiry_date,products(name,unit)&order=expiry_date`),
      db(`purchase_orders?status=in.(sent,part_received)&expected_at=lt.${today}&select=ref,expected_at,suppliers(name)&order=expected_at`),
      db(`invoices?status=eq.unpaid&due_date=lt.${today}&select=number,store_name,total,due_date&order=due_date`)
    ]);
    const nothing = !reorder.length && !expiring.length && !latePos.length && !overdue.length;
    if (nothing || !to.length || !process.env.RESEND_API_KEY) {
      return res.status(200).json({ ok: true, sent: false, reorder: reorder.length, expiring: expiring.length,
        reason: nothing ? 'nothing to report' : !to.length ? 'no recipients set' : 'RESEND_API_KEY not set' });
    }

    const site = `https://${req.headers.host}`;
    const table = (head, rows) => `<table cellpadding="6" style="border-collapse:collapse;font-size:14px;width:100%">
      <tr>${head.map(h => `<th align="left" style="border-bottom:2px solid #2f6b3a">${h}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map(c => `<td style="border-bottom:1px solid #ddd">${c}</td>`).join('')}</tr>`).join('')}</table>`;
    let body = `<div style="font-family:system-ui,sans-serif;max-width:680px"><h2 style="color:#2f6b3a">Chai Green stock: ${esc(today)}</h2>`;
    if (reorder.length) body += `<h3>Reorder now (${reorder.length})</h3>` + table(['Product', 'Supplier', 'In stock', 'Reorder at', 'Suggested order', 'Lead time'],
      reorder.map(p => [esc(p.name), esc(p.supplier_name || '—'), `${p.qty_on_hand} ${esc(p.unit)}`, p.eff_reorder_point, p.eff_reorder_qty, `${p.lead_days} days`])) +
      `<p><a href="${site}/#/reorder">Create purchase orders →</a></p>`;
    if (expiring.length) body += `<h3>Use-by dates within ${settings.expiry_warning_days} days</h3>` + table(['Product', 'Qty', 'Use by'],
      expiring.map(b => [esc(b.products?.name), `${b.qty_remaining} ${esc(b.products?.unit)}`, esc(b.expiry_date)]));
    if (latePos.length) body += `<h3>Late deliveries</h3>` + table(['Order', 'Supplier', 'Was due'],
      latePos.map(p => [esc(p.ref), esc(p.suppliers?.name), esc(p.expected_at)]));
    if (overdue.length) body += `<h3>Overdue invoices</h3>` + table(['Invoice', 'Store', 'Total', 'Was due'],
      overdue.map(i => [esc(i.number), esc(i.store_name), gbp(i.total), esc(i.due_date)]));
    body += `<p style="color:#777;font-size:12px">Sent by Chai Green Stock. Change who gets this in Settings.</p></div>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_FROM || 'Chai Green Stock <onboarding@resend.dev>',
        to, subject: `Stock alert: ${reorder.length} to reorder${expiring.length ? `, ${expiring.length} going out of date` : ''}`, html: body
      })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return res.status(200).json({ ok: true, sent: true, to: to.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
