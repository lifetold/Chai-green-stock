// Marketing emails, sent from the app:
//   kind "campaign": a new campaign/promotion → every franchise store.
//   kind "request":  a store's marketing request → the marketing team
//                    (Settings → marketing email, default social@chaigreen1823.com).
// The browser sends the signed-in user's token; the database checks what that
// user may send (only head office can email campaigns, each item only once),
// so no service-role key is needed here.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY   from resend.com
//   MARKETING_FROM   e.g. "Chai Green Marketing <social@chaigreen1823.com>" (domain verified in Resend);
//                    falls back to ALERT_FROM, then Resend's test sender.
const URL = (process.env.SUPABASE_URL || 'https://aamacfkbpigtolysxgym.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_6rLHiFGLlSlFllWFZNiaRw_VqQ9xNnC';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const para = s => esc(s).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const day = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const KIND = { campaign: 'Campaign', promotion: 'Promotion', pr: 'PR' };

async function rpc(token, fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const text = await r.text();
  if (!r.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch (e) { /* plain text */ } throw Object.assign(new Error(m), { status: r.status }); }
  return text ? JSON.parse(text) : null;
}

const wrap = (title, inner, site) => `<div style="font-family:Georgia,serif;background:#0f2b23;padding:28px 0">
  <div style="max-width:620px;margin:0 auto;background:#fbf8f1;border-radius:6px;overflow:hidden">
  <div style="background:#0f2b23;color:#e9dcbc;padding:18px 28px;font-size:13px;letter-spacing:3px;text-transform:uppercase">Chai Green</div>
  <div style="padding:24px 28px;font-family:system-ui,Arial,sans-serif;color:#1d2b27;font-size:15px;line-height:1.55">
  <h1 style="font-family:Georgia,serif;font-weight:normal;color:#0f2b23;margin:0 0 12px">${esc(title)}</h1>${inner}
  <p style="margin-top:24px"><a href="${site}/#/marketing" style="background:#0f2b23;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none">Open Marketing in the Chai Green app</a></p>
  </div></div></div>`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'Please sign in again.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { kind, id } = body || {};
  if (!['campaign', 'request'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id || '')) return res.status(400).json({ ok: false, error: 'Bad request' });

  try {
    const p = await rpc(token, 'marketing_email_payload', { p_kind: kind, p_id: id });
    if (p.already_sent) return res.status(200).json({ ok: true, sent: false, reason: 'This was already emailed.' });
    const to = (p.to || []).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!to.length) return res.status(200).json({ ok: true, sent: false, reason: kind === 'campaign'
      ? 'No franchise store has an email address yet. Add them under Stores, then press "Email franchisees now".'
      : 'No marketing email address is set in Settings.' });
    if (!process.env.RESEND_API_KEY) return res.status(200).json({ ok: true, sent: false, reason: 'Email sending is not switched on yet.' });

    const site = `https://${req.headers.host}`;
    const it = p.item;
    let subject, html, replyTo;
    if (kind === 'campaign') {
      const when = it.starts_on && it.ends_on ? `${day(it.starts_on)} to ${day(it.ends_on)}` : it.starts_on ? `From ${day(it.starts_on)}` : it.ends_on ? `Until ${day(it.ends_on)}` : '';
      subject = `New ${(KIND[it.kind] || 'campaign').toLowerCase()}: ${it.title}`;
      html = wrap(it.title, `<p style="color:#8f7a45;text-transform:uppercase;letter-spacing:2px;font-size:12px;margin:0 0 4px">${esc(KIND[it.kind] || 'Campaign')}${when ? ' · ' + esc(when) : ''}</p>
        ${para(it.details.replace(/^## /gm, '').replace(/^- /gm, '• '))}`, site);
    } else {
      subject = `Marketing request ${it.ref}: ${it.store_name || 'Head office'}`;
      replyTo = it.email;
      const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${v}</td></tr>`;
      html = wrap(`Marketing request ${it.ref}`, `<table style="border-collapse:collapse;font-size:15px">
        ${row('Store', esc(it.store_name || 'Head office'))}${row('Franchisee', esc(it.franchisee_name))}
        ${row('Phone', `<a href="tel:${esc(it.phone)}">${esc(it.phone)}</a>`)}${row('Email', `<a href="mailto:${esc(it.email)}">${esc(it.email)}</a>`)}
        ${row('Wanted by', esc(day(it.wanted_by)))}${row('What it\'s for', para(it.what_for))}${row('The aim', para(it.aim))}
        ${it.notes ? row('Notes', para(it.notes)) : ''}</table><p style="color:#666;font-size:13px">Reply to this email to answer ${esc(it.franchisee_name)} directly.</p>`, site);
    }
    const from = process.env.MARKETING_FROM || process.env.ALERT_FROM || 'Chai Green <onboarding@resend.dev>';
    // One email per address, so franchisees don't see each other's addresses.
    const batch = to.map(addr => ({ from, to: [addr], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }));
    for (let i = 0; i < batch.length; i += 100) {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.slice(i, i + 100))
      });
      if (!r.ok) throw new Error(`Email service said ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    await rpc(token, 'mark_marketing_emailed', { p_kind: kind, p_id: id, p_count: to.length });
    return res.status(200).json({ ok: true, sent: true, count: to.length });
  } catch (e) {
    console.error(e);
    return res.status(e.status === 401 ? 401 : 500).json({ ok: false, sent: false, error: e.message });
  }
};
