// Appel quotidien (cron Vercel) pour éviter la mise en pause du projet Supabase gratuit
// après 7 jours sans activité. Ne lit aucune donnée : la requête est filtrée par les règles RLS.
const URL = "https://ncohtxfyeicdtfuyvsij.supabase.co";
const KEY = "sb_publishable_fM2a2oZIXXjbd0srWopaww_IXT3nY7-";

export default async function handler(req, res) {
  try {
    const r = await fetch(`${URL}/rest/v1/teeth?select=fdi&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    res.status(200).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
}
