// Keeps the free Supabase database awake. Supabase pauses free projects after
// about a week with no activity (that is how the first database was lost), so a
// Vercel cron calls this every day and it makes one small read.
// Uses the public (publishable) key only, so no secrets are needed.
const URL = process.env.SUPABASE_URL || 'https://aamacfkbpigtolysxgym.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_6rLHiFGLlSlFllWFZNiaRw_VqQ9xNnC';

module.exports = async (req, res) => {
  try {
    const r = await fetch(URL.replace(/\/$/, '') + '/rest/v1/rpc/keep_alive', {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}'
    });
    const body = await r.text();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: new Date().toISOString(), db: body.slice(0, 100) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
