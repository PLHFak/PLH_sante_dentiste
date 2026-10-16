// Étape de build : envoie les fichiers de seed/ vers Supabase (une seule fois).
// Ne fait rien si SEED_SECRET n'est pas défini.
import { readFile, access } from "node:fs/promises";
import manifest from "./manifest.json" with { type: "json" };

const secret = process.env.SEED_SECRET;
const url = process.env.SUPABASE_URL;
if (!secret || !url) { console.log("seed: ignoré (pas de SEED_SECRET)"); process.exit(0); }

const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
let ok = 0, fail = 0;
for (const { file, path } of manifest) {
  const local = `seed/${file}`;
  try { await access(local); } catch { console.log(`seed: absent ${file}`); continue; }
  const body = await readFile(local);
  const ext = file.split(".").pop().toLowerCase();
  const r = await fetch(`${url}/functions/v1/seed-upload`, {
    method: "POST",
    headers: { "x-seed-secret": secret, "x-path": path, "content-type": types[ext] ?? "application/octet-stream" },
    body,
  });
  const t = await r.text();
  console.log(`seed: ${r.status} ${path} ${t.slice(0, 120)}`);
  r.ok ? ok++ : fail++;
}
console.log(`seed: ${ok} ok, ${fail} erreurs`);
