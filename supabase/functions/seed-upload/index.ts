// Import ponctuel des archives dans le bucket privé « dossier ».
// Appelé uniquement par le script de build Vercel, protégé par le secret SEED_SECRET.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const secret = Deno.env.get("SEED_SECRET");
  if (!secret || req.headers.get("x-seed-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const path = req.headers.get("x-path") ?? "";
  if (!/^(radios|factures|devis|ordonnances|autres)\/[\w.\-]+$/.test(path)) {
    return new Response("bad path", { status: 400 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = new Uint8Array(await req.arrayBuffer());
  const { error } = await sb.storage.from("dossier").upload(path, body, {
    contentType: req.headers.get("content-type") ?? "application/octet-stream",
    upsert: true,
  });
  if (error) return new Response(error.message, { status: 500 });
  return new Response(JSON.stringify({ ok: true, path, bytes: body.length }), {
    headers: { "content-type": "application/json" },
  });
});
