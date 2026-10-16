import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG || {};
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => String(s ?? "").replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1").replace(/\b(\d{4})-(\d{2})\b/g, "$2/$1");
const euro = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("fr-BE", { style: "currency", currency: "EUR" });
const today = new Date().toISOString().slice(0, 10);

const CATS = ["Alerte", "Implant", "Bridge", "Endo", "Obturée", "Saine", "Absente"];
const CAT_LABEL = { Alerte: "Alerte", Implant: "Implant", Bridge: "Bridge / pontic", Endo: "Dévitalisée", "Obturée": "Obturée", Saine: "Naturelle", Absente: "Absente" };
const CAT_VAR = { Alerte: "alerte", Implant: "implant", Bridge: "bridge", Endo: "endo", "Obturée": "obturee", Saine: "saine", Absente: "absente" };
const UPPER = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
const LOWER = ["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"];
const ALL_TEETH = [...UPPER, ...LOWER];

const S = { teeth: [], events: [], documents: [], questions: [], notes: [], role: null, email: null, urls: {}, sel: null, editing: false };

/* ---------- Utilitaires ---------- */
function parseTeeth(str) {
  const s = String(str ?? "");
  if (/\*|toutes/i.test(s)) return new Set(ALL_TEETH);
  const out = new Set();
  for (const m of s.matchAll(/\b([1-4])([1-8])\s*[-–]\s*([1-4])([1-8])\b/g)) {
    if (m[1] === m[3]) { const a = +m[2], b = +m[4]; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(m[1] + i); }
  }
  for (const m of s.matchAll(/\b([1-4][1-8])\b/g)) out.add(m[1]);
  return out;
}
const tooth = (fdi) => S.teeth.find((t) => t.fdi === fdi);
const isOwner = () => S.role === "owner";
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }
function sortedEvents() {
  return [...S.events].sort((a, b) => (b.date_sort || "0000").localeCompare(a.date_sort || "0000") || (b.created_at || "").localeCompare(a.created_at || ""));
}

/* ---------- Authentification ---------- */
async function boot() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { $("#login").classList.remove("hidden"); $("#login-msg").textContent = "Configuration Supabase manquante (config.js)."; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(session); else $("#login").classList.remove("hidden");
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === "SIGNED_IN" && sess && !S.email) enter(sess);
    if (ev === "SIGNED_OUT") location.reload();
  });
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim(), password = $("#login-pass").value;
  if (!password) { $("#login-msg").textContent = "Entrez le mot de passe, ou demandez un lien par e-mail."; return; }
  $("#login-msg").textContent = "Connexion…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) $("#login-msg").textContent = "Échec : " + error.message;
});
$("#magic-btn").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  if (!email) { $("#login-msg").textContent = "Entrez votre e-mail d'abord."; return; }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
  $("#login-msg").textContent = error ? "Échec : " + error.message : "Lien envoyé. Ouvrez-le sur cet appareil.";
});
$("#logout-btn").addEventListener("click", () => sb.auth.signOut());
$("#pass-btn").addEventListener("click", () => {
  openDialog(`<h3>Changer le mot de passe</h3>
    <label>Nouveau mot de passe (12 caractères min.)<input type="password" name="p1" minlength="12" required autocomplete="new-password"></label>
    <label>Confirmer<input type="password" name="p2" minlength="12" required autocomplete="new-password"></label>`,
    async (f) => {
      if (f.p1.value !== f.p2.value) { toast("Les deux saisies diffèrent"); return false; }
      const { error } = await sb.auth.updateUser({ password: f.p1.value });
      toast(error ? "Erreur : " + error.message : "Mot de passe modifié");
    });
});

async function enter(session) {
  S.email = session.user.email;
  const { data: me } = await sb.from("allowed_users").select("role").maybeSingle();
  if (!me) {
    $("#login").classList.remove("hidden");
    $("#login-msg").textContent = `Le compte ${S.email} n'est pas autorisé.`;
    await sb.auth.signOut({ scope: "local" });
    return;
  }
  S.role = me.role;
  document.body.classList.toggle("reader", !isOwner());
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await loadAll();
  subscribe();
}

/* ---------- Données ---------- */
async function load(table) {
  const order = { teeth: "fdi", events: "date_sort", documents: "doc_date", questions: "num", notes: "created_at" }[table];
  const { data, error } = await sb.from(table).select("*").order(order, { ascending: table !== "notes", nullsFirst: false });
  if (error) { toast("Erreur de chargement : " + error.message); return; }
  S[table] = data;
}
async function loadAll() {
  await Promise.all(["teeth", "events", "documents", "questions", "notes"].map(load));
  await signUrls();
  renderAll();
}
async function signUrls() {
  const paths = S.documents.filter((d) => d.storage_path && !S.urls[d.storage_path]).map((d) => d.storage_path);
  if (!paths.length) return;
  const { data } = await sb.storage.from("dossier").createSignedUrls(paths, 3600);
  for (const r of data || []) if (r.signedUrl) S.urls[r.path] = r.signedUrl;
}
function subscribe() {
  const ch = sb.channel("dossier");
  for (const t of ["teeth", "events", "documents", "questions", "notes"]) {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, async () => {
      await load(t);
      if (t === "documents") await signUrls();
      renderAll();
      toast("Dossier mis à jour");
    });
  }
  ch.subscribe((status) => {
    const live = $("#live");
    const on = status === "SUBSCRIBED";
    live.className = "live " + (on ? "on" : "off");
    live.textContent = on ? "● temps réel" : "● hors ligne";
  });
  setInterval(() => { S.urls = {}; signUrls().then(renderDocs); }, 50 * 60 * 1000);
}

/* ---------- Rendu ---------- */
function renderAll() {
  renderHeader(); renderSynthese(); renderTeeth(); renderChrono(); renderDocs(); renderQuestions(); renderNotes();
  if (S.sel) openTooth(S.sel, true);
}

function renderHeader() {
  const next = [...S.events].filter((e) => e.date_sort && e.date_sort >= today).sort((a, b) => a.date_sort.localeCompare(b.date_sort))[0];
  $("#next-rdv").innerHTML = next ? `<b>Prochain rendez-vous</b>${esc(fmtDate(next.date_label))} · ${esc(next.practitioner)}<br><span class="muted">${esc(next.description)}</span>` : "";
  const open = S.questions.filter((q) => !q.resolved).length;
  $("#q-count").textContent = open || "";
}

function legendHTML() {
  return CATS.map((c) => `<span><i style="background:var(--c-${CAT_VAR[c]});border-color:var(--c-${CAT_VAR[c]}-s)"></i>${CAT_LABEL[c]}</span>`).join("");
}

function odontoSVG() {
  const w = (fdi) => { const n = +fdi[1]; return n >= 6 ? 50 : n >= 4 ? 40 : n === 3 ? 36 : 32; };
  const gap = 5, mid = 18;
  const rowW = (row) => row.reduce((s, f) => s + w(f) + gap, 0) - gap + mid;
  const W = Math.max(rowW(UPPER), rowW(LOWER)) + 40;
  let svg = `<svg viewBox="0 0 ${W} 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schéma dentaire">`;
  svg += `<line x1="${W / 2}" y1="8" x2="${W / 2}" y2="322" stroke="var(--line-2)" stroke-dasharray="3 4"/>`;
  svg += `<line x1="14" y1="165" x2="${W - 14}" y2="165" stroke="var(--line-2)" stroke-dasharray="3 4"/>`;
  svg += `<text x="16" y="20" style="font:600 10px var(--mono);fill:var(--muted)">DROITE PATIENT</text>`;
  svg += `<text x="${W - 16}" y="20" text-anchor="end" style="font:600 10px var(--mono);fill:var(--muted)">GAUCHE PATIENT</text>`;
  const pos = {};
  const drawRow = (row, upper) => {
    let x = (W - rowW(row)) / 2;
    row.forEach((fdi, i) => {
      if (i === 8) x += mid;
      const tw = w(fdi), t = tooth(fdi) || { category: "Saine" };
      const cat = t.category, v = CAT_VAR[cat] || "saine";
      const fill = `var(--c-${v})`, stroke = `var(--c-${v}-s)`;
      const cy = upper ? 78 : 198, ch = 54;
      const n = +fdi[1];
      pos[fdi] = { x, tw, cy, ch };
      let g = `<g class="tooth cat-${esc(cat)}${S.sel === fdi ? " sel" : ""}" data-fdi="${fdi}" tabindex="0">`;
      if (cat === "Alerte") g += `<rect class="ring" x="${x - 5}" y="${(upper ? 22 : cy) - 5}" width="${tw + 10}" height="${ch + 66}" rx="12" fill="none" stroke="var(--danger)" stroke-width="3"/>`;
      // racines / implant
      const rootTop = upper ? 26 : cy + ch, rootBot = upper ? cy : 308;
      if (cat === "Implant") {
        const iw = Math.min(16, tw * .4), ix = x + tw / 2 - iw / 2;
        g += `<rect x="${ix}" y="${upper ? rootTop + 6 : rootTop}" width="${iw}" height="${rootBot - rootTop - 6}" rx="3" fill="#c9d3dc" stroke="#6f7f8f" stroke-width="1.2"/>`;
        for (let k = (upper ? rootTop + 12 : rootTop + 6); k < (upper ? rootBot - 2 : rootBot - 8); k += 7)
          g += `<line x1="${ix}" y1="${k}" x2="${ix + iw}" y2="${k + 3}" stroke="#6f7f8f" stroke-width="1"/>`;
      } else if (cat !== "Absente" && !(cat === "Bridge" && fdi === "36")) {
        const roots = n >= 6 ? 2 : 1;
        for (let r = 0; r < roots; r++) {
          const rx = roots === 1 ? x + tw / 2 : x + tw * (r ? .72 : .28);
          const rw = roots === 1 ? tw * .42 : tw * .26;
          const tip = upper ? rootTop : rootBot;
          const base = upper ? rootBot : rootTop;
          g += `<path d="M${rx - rw / 2} ${base} Q${rx - rw / 3} ${(base + tip) / 2} ${rx} ${tip} Q${rx + rw / 3} ${(base + tip) / 2} ${rx + rw / 2} ${base}Z" fill="${cat === "Endo" || cat === "Alerte" ? fill : "#f3efe6"}" stroke="${stroke}" stroke-width="1.2"/>`;
          if (cat === "Endo" || cat === "Alerte") g += `<line x1="${rx}" y1="${base}" x2="${rx}" y2="${tip + (upper ? 6 : -6)}" stroke="${stroke}" stroke-width="2"/>`;
        }
      }
      // couronne
      const dash = cat === "Absente" ? ` stroke-dasharray="4 3"` : "";
      const crownFill = cat === "Absente" ? "transparent" : fill;
      g += `<rect class="body" x="${x}" y="${cy}" width="${tw}" height="${ch}" rx="${n >= 6 ? 10 : 8}" fill="${crownFill}" stroke="${stroke}"${dash}/>`;
      if (n >= 4 && cat !== "Absente") g += `<path d="M${x + tw * .25} ${cy + ch / 2} Q${x + tw / 2} ${cy + ch / 2 + (upper ? 6 : -6)} ${x + tw * .75} ${cy + ch / 2}" fill="none" stroke="${stroke}" stroke-width="1" opacity=".5"/>`;
      const rel = (t.reliability || "").toLowerCase().includes("confirmer");
      g += `<text x="${x + tw / 2}" y="${upper ? cy + ch + 22 : cy - 10}">${fdi}${rel ? "?" : ""}</text>`;
      g += `<title>${fdi} – ${esc(t.position || "")} : ${esc(CAT_LABEL[cat] || cat)}</title></g>`;
      svg += g;
      x += tw + gap;
    });
  };
  drawRow(UPPER, true); drawRow(LOWER, false);
  // bridge 35-(36)-37 (et tout pontic)
  for (const t of S.teeth.filter((t) => t.category === "Bridge" && /pontic|intermédiaire/i.test(t.state || ""))) {
    const q = t.fdi[0], n = +t.fdi[1];
    const a = pos[q + (n - 1)], b = pos[q + (n + 1)];
    if (a && b) svg += `<rect x="${a.x + a.tw / 2}" y="${a.cy + a.ch / 2 - 4}" width="${b.x + b.tw / 2 - a.x - a.tw / 2}" height="8" rx="4" fill="var(--c-bridge-s)" opacity=".55" pointer-events="none"/>`;
  }
  return svg + "</svg>";
}
function bindTeeth(root) {
  $$(".tooth", root).forEach((g) => {
    g.addEventListener("click", () => openTooth(g.dataset.fdi));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter") openTooth(g.dataset.fdi); });
  });
}

function renderSynthese() {
  const alerts = S.teeth.filter((t) => t.category === "Alerte");
  $("#alerts").innerHTML = alerts.length ? alerts.map((t) => `<div class="alert" data-fdi="${t.fdi}"><div class="num">${t.fdi}</div><div><p><b>${esc(t.position)}</b></p><p>${esc(t.latest || t.state)}</p></div></div>`).join("") : `<div class="empty">Aucune alerte.</div>`;
  $$("#alerts .alert").forEach((a) => a.addEventListener("click", () => openTooth(a.dataset.fdi)));
  const oq = S.questions.filter((q) => !q.resolved);
  $("#open-q").innerHTML = oq.length ? oq.map((q) => `<div class="list-item"><b>${esc(q.question)}</b><div class="muted small">${esc(q.who || "")}</div></div>`).join("") : `<div class="empty">Tout est clarifié.</div>`;
  $("#odonto-mini").innerHTML = odontoSVG(); bindTeeth($("#odonto-mini"));
  $("#legend").innerHTML = legendHTML();
  $("#recent").innerHTML = sortedEvents().slice(0, 6).map((e) => `<div class="list-item"><span class="date">${esc(fmtDate(e.date_label))}</span>${esc(e.description)} <span class="muted small">· ${esc(e.practitioner || "")}</span></div>`).join("");
  const miss = S.documents.filter((d) => d.missing);
  $("#missing").innerHTML = miss.length ? miss.map((d) => `<div class="list-item"><b>${esc(d.file_name)}</b><div class="muted small">${esc(d.content || "")}</div></div>`).join("") : `<div class="empty">Rien ne manque.</div>`;
}

function renderTeeth() {
  $("#odonto").innerHTML = odontoSVG(); bindTeeth($("#odonto"));
  $("#legend2").innerHTML = legendHTML();
  const sel = $("#cat-filter");
  if (sel.options.length === 1) CATS.forEach((c) => sel.add(new Option(CAT_LABEL[c], c)));
  const f = sel.value;
  const rows = ALL_TEETH.map(tooth).filter(Boolean).filter((t) => !f || t.category === f);
  $("#teeth-table").innerHTML = `<thead><tr><th>Dent</th><th>Position</th><th>Catégorie</th><th>État</th><th>Dernière info</th><th>Fiabilité</th></tr></thead><tbody>` +
    rows.map((t) => `<tr class="click" data-fdi="${t.fdi}"><td class="fdi">${t.fdi}</td><td>${esc(t.position)}</td><td><span class="badge b-${esc(t.category)}">${esc(CAT_LABEL[t.category] || t.category)}</span></td><td>${esc(t.state)}</td><td>${esc(t.latest === "—" ? "" : t.latest)}</td><td class="rel ${/confirmer|faible/i.test(t.reliability || "") ? "confirm" : ""}">${esc(t.reliability)}</td></tr>`).join("") + "</tbody>";
  $$("#teeth-table tr.click").forEach((r) => r.addEventListener("click", () => openTooth(r.dataset.fdi)));
}
$("#cat-filter").addEventListener("change", renderTeeth);

function eventHTML(e, compact = false) {
  const teeth = [...parseTeeth(e.teeth)];
  const chips = teeth.length && teeth.length < 32 ? `<span class="ev-teeth">${teeth.map((f) => `<span class="chip" data-fdi="${f}">${f}</span>`).join("")}</span>` : (e.teeth ? `<span class="muted small"> · ${esc(e.teeth)}</span>` : "");
  const future = e.date_sort && e.date_sort > today;
  return `<li class="t-${esc(e.type)}${future ? " future" : ""}">
    ${!compact && isOwner() ? `<span class="ev-actions"><button class="icon-btn" data-edit="${e.id}" title="Modifier">✎</button><button class="icon-btn" data-del="${e.id}" title="Supprimer">🗑</button></span>` : ""}
    <span class="ev-date">${esc(fmtDate(e.date_label))}</span><span class="ev-type">${esc(e.type)}</span>${chips}
    <p class="ev-title">${esc(e.description)}</p>
    <div class="ev-meta">${esc(e.practitioner || "")}${e.amount != null ? ` · <span class="amt">${euro(e.amount)}</span>` : ""}${e.status && e.status !== "—" ? ` · ${esc(e.status)}` : ""}${e.source ? ` · <i>${esc(e.source)}</i>` : ""}</div>
  </li>`;
}
function renderChrono() {
  const tsel = $("#chrono-type");
  const types = [...new Set(S.events.map((e) => e.type).filter(Boolean))].sort();
  const cur = tsel.value;
  tsel.innerHTML = `<option value="">Tous types</option>` + types.map((t) => `<option ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
  const q = $("#chrono-search").value.toLowerCase(), ty = tsel.value, tf = $("#chrono-tooth").value.trim();
  const list = sortedEvents().filter((e) =>
    (!ty || e.type === ty) &&
    (!tf || parseTeeth(e.teeth).has(tf)) &&
    (!q || [e.description, e.practitioner, e.source, e.status, e.teeth].join(" ").toLowerCase().includes(q)));
  const total = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  $("#chrono-total").textContent = `${list.length} événements · total des montants connus : ${euro(total)}`;
  $("#timeline").innerHTML = list.map((e) => eventHTML(e)).join("") || `<div class="empty">Aucun événement.</div>`;
  bindTimeline($("#timeline"));
}
function bindTimeline(root) {
  $$(".chip", root).forEach((c) => c.addEventListener("click", () => openTooth(c.dataset.fdi)));
  $$("[data-edit]", root).forEach((b) => b.addEventListener("click", () => editEvent(S.events.find((e) => e.id === b.dataset.edit))));
  $$("[data-del]", root).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Supprimer cet événement ?")) return;
    const { error } = await sb.from("events").delete().eq("id", b.dataset.del);
    if (error) toast(error.message);
  }));
}
["#chrono-search", "#chrono-tooth"].forEach((s) => $(s).addEventListener("input", renderChrono));
$("#chrono-type").addEventListener("change", renderChrono);

function editEvent(e = {}) {
  openDialog(`<h3>${e.id ? "Modifier" : "Nouvel"} événement</h3>
    <label>Date<input type="date" name="date_sort" value="${esc(e.date_sort || today)}"></label>
    <label>Libellé de date (facultatif, ex. « 2026-01-17 / 23 »)<input name="date_label" value="${esc(e.date_label && e.date_label !== e.date_sort ? e.date_label : "")}"></label>
    <label>Praticien / lieu<input name="practitioner" value="${esc(e.practitioner)}"></label>
    <label>Type<input name="type" list="types-dl" value="${esc(e.type || "Soin")}"><datalist id="types-dl">${[...new Set(S.events.map((x) => x.type))].map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label>
    <label>Dent(s)<input name="teeth" value="${esc(e.teeth)}" placeholder="ex. 36, 37"></label>
    <label>Acte / événement<textarea name="description" rows="3" required>${esc(e.description)}</textarea></label>
    <label>Montant (€)<input name="amount" type="number" step="0.01" value="${e.amount ?? ""}"></label>
    <label>Remboursement / statut<input name="status" value="${esc(e.status)}"></label>
    <label>Source<input name="source" value="${esc(e.source)}"></label>`,
    async (f) => {
      const row = {
        date_sort: f.date_sort.value || null, date_label: f.date_label.value.trim() || f.date_sort.value,
        practitioner: f.practitioner.value, type: f.type.value, teeth: f.teeth.value, description: f.description.value,
        amount: f.amount.value === "" ? null : Number(f.amount.value), status: f.status.value, source: f.source.value,
      };
      const { error } = e.id ? await sb.from("events").update(row).eq("id", e.id) : await sb.from("events").insert(row);
      toast(error ? "Erreur : " + error.message : "Enregistré");
    });
}
$("#add-event-btn").addEventListener("click", () => editEvent());

function isImage(d) { return /\.(png|jpe?g|webp|gif)$/i.test(d.storage_path || d.file_name); }
function docCard(d) {
  if (d.missing) return `<div class="doc-card missing"><div class="doc-thumb">MANQUANT</div><div class="meta"><b>${esc(d.file_name)}</b><span class="muted">${esc(d.content)}</span></div></div>`;
  const url = S.urls[d.storage_path];
  const thumb = isImage(d) && url ? `style="background-image:url('${url}')"` : "";
  return `<div class="doc-card" data-doc="${d.id}"><div class="doc-thumb" ${thumb}>${!isImage(d) ? "PDF" : url ? "" : "…"}</div><div class="meta"><b>${esc(fmtDate(d.date_label))} · ${esc(d.type)}</b><span class="muted">${esc(d.content)}</span></div></div>`;
}
function bindDocs(root) { $$("[data-doc]", root).forEach((c) => c.addEventListener("click", () => openDoc(S.documents.find((d) => d.id === c.dataset.doc)))); }
function renderDocs() {
  const radios = S.documents.filter((d) => /radio/i.test(d.type || "")).sort((a, b) => (a.missing - b.missing) || (b.doc_date || "").localeCompare(a.doc_date || ""));
  $("#radios").innerHTML = radios.map(docCard).join("");
  bindDocs($("#radios"));
  const others = S.documents.filter((d) => !/radio/i.test(d.type || "")).sort((a, b) => (b.doc_date || "").localeCompare(a.doc_date || ""));
  $("#docs-table").innerHTML = `<thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Contenu</th><th>Dents</th><th></th></tr></thead><tbody>` +
    others.map((d) => `<tr class="${d.missing ? "" : "click"}" ${d.missing ? "" : `data-doc="${d.id}"`}><td>${esc(fmtDate(d.date_label))}</td><td>${esc(d.type)}</td><td>${esc(d.file_name)}</td><td>${esc(d.content)}</td><td>${esc(d.teeth || "")}</td><td>${d.missing ? '<span class="badge b-Alerte">manquant</span>' : "Ouvrir ↗"}</td></tr>`).join("") + "</tbody>";
  bindDocs($("#docs-table"));
}
function openDoc(d) {
  const url = S.urls[d.storage_path];
  if (!url) { toast("Fichier pas encore disponible"); return; }
  if (isImage(d)) openViewer(url, `${fmtDate(d.date_label)} · ${d.content || d.file_name}`);
  else window.open(url, "_blank", "noopener");
}

/* Ajout de documents */
const dz = $("#dropzone");
$("#up-date").value = today;
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
$("#file-input").addEventListener("change", (e) => uploadFiles(e.target.files));
async function uploadFiles(files) {
  const type = $("#up-type").value, date = $("#up-date").value || today;
  const folder = { Radio: "radios", Facture: "factures", Devis: "devis", Ordonnance: "ordonnances" }[type] || "autres";
  for (const file of files) {
    const clean = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-");
    const path = `${folder}/${date}_${clean}`;
    $("#up-status").textContent = `Envoi de ${file.name}…`;
    const up = await sb.storage.from("dossier").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { $("#up-status").textContent = "Erreur : " + up.error.message; continue; }
    const { error } = await sb.from("documents").upsert({
      date_label: date, doc_date: date, file_name: `${date}_${clean}`, storage_path: path, type,
      content: $("#up-content").value || file.name, origin: "Ajout manuel", teeth: $("#up-teeth").value || null, missing: false,
    }, { onConflict: "storage_path" });
    $("#up-status").textContent = error ? "Erreur : " + error.message : `${file.name} ajouté.`;
  }
  $("#file-input").value = "";
}

/* Questions */
function renderQuestions() {
  const list = [...S.questions].sort((a, b) => (a.resolved - b.resolved) || (a.num ?? 99) - (b.num ?? 99));
  $("#questions").innerHTML = list.map((q) => `<div class="q ${q.resolved ? "done" : ""}">
    <input type="checkbox" data-q="${q.id}" ${q.resolved ? "checked" : ""} ${isOwner() ? "" : "disabled"} title="Marquer comme clarifié">
    <div><h3>${esc(q.question)}</h3><p>${esc(q.why)}</p><div class="who">${esc(q.who)}</div>
    ${isOwner() ? `<textarea rows="2" data-a="${q.id}" placeholder="Réponse obtenue…">${esc(q.answer)}</textarea>` : q.answer ? `<p><b>Réponse :</b> ${esc(q.answer)}</p>` : ""}</div></div>`).join("") || `<div class="empty">Aucune question.</div>`;
  $$("[data-q]").forEach((c) => c.addEventListener("change", async () => {
    const { error } = await sb.from("questions").update({ resolved: c.checked }).eq("id", c.dataset.q);
    if (error) toast(error.message);
  }));
  $$("[data-a]").forEach((t) => t.addEventListener("change", async () => {
    const { error } = await sb.from("questions").update({ answer: t.value }).eq("id", t.dataset.a);
    toast(error ? error.message : "Réponse enregistrée");
  }));
}
$("#add-q-btn").addEventListener("click", () => openDialog(`<h3>Nouvelle question</h3>
  <label>Question<textarea name="question" rows="2" required></textarea></label>
  <label>Pourquoi c'est important<textarea name="why" rows="2"></textarea></label>
  <label>Qui / quand<input name="who"></label>`, async (f) => {
  const num = Math.max(0, ...S.questions.map((q) => q.num || 0)) + 1;
  const { error } = await sb.from("questions").insert({ num, question: f.question.value, why: f.why.value, who: f.who.value });
  toast(error ? error.message : "Question ajoutée");
}));

/* Journal */
function noteHTML(n) {
  return `<div class="note"><span class="when">${new Date(n.created_at).toLocaleString("fr-BE", { dateStyle: "medium", timeStyle: "short" })}${n.fdi ? ` · dent ${esc(n.fdi)}` : ""}</span><p>${esc(n.body)}</p></div>`;
}
function renderNotes() { $("#notes").innerHTML = S.notes.map(noteHTML).join("") || `<div class="empty">Aucune note pour l'instant.</div>`; }
$("#note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fdi = $("#note-fdi").value.trim() || null;
  if (fdi && !tooth(fdi)) { toast("Numéro de dent inconnu"); return; }
  const { error } = await sb.from("notes").insert({ body: $("#note-body").value, fdi });
  if (error) toast(error.message); else { $("#note-body").value = ""; $("#note-fdi").value = ""; }
});

/* ---------- Fiche dent ---------- */
function openTooth(fdi, refresh = false) {
  const t = tooth(fdi); if (!t) return;
  if (!refresh) S.editing = false;
  S.sel = fdi;
  const evs = sortedEvents().filter((e) => { const s = parseTeeth(e.teeth); return s.has(fdi) && s.size < 32; });
  const docs = S.documents.filter((d) => parseTeeth(d.teeth).has(fdi));
  const notes = S.notes.filter((n) => n.fdi === fdi);
  const idx = ALL_TEETH.indexOf(fdi);
  const prev = ALL_TEETH[(idx + 31) % 32], next = ALL_TEETH[(idx + 1) % 32];
  const fields = [["state", "État constaté (radios)"], ["history", "Historique / actes connus"], ["latest", "Dernière info (2025-2026)"], ["reliability", "Fiabilité"], ["sources", "Sources"]];
  const view = fields.map(([k, l]) => t[k] && t[k] !== "—" ? `<div class="field"><label>${l}</label><p>${esc(t[k])}</p></div>` : "").join("");
  const edit = `<div class="field"><label>Catégorie</label><select name="category">${CATS.map((c) => `<option value="${c}" ${c === t.category ? "selected" : ""}>${CAT_LABEL[c]}</option>`).join("")}</select></div>` +
    fields.map(([k, l]) => `<div class="field"><label>${l}</label><textarea name="${k}" rows="${k === "reliability" ? 1 : 3}">${esc(t[k] === "—" ? "" : t[k])}</textarea></div>`).join("");
  $("#drawer-inner").innerHTML = `
    <div class="d-head"><div class="d-num">${fdi}</div><div><div class="d-pos">${esc(t.position)}</div><span class="badge b-${esc(t.category)}">${esc(CAT_LABEL[t.category] || t.category)}</span></div>
      <button class="btn ghost small d-close" id="d-close">Fermer ✕</button></div>
    ${S.editing ? `<form id="tooth-form">${edit}<div class="row"><button class="btn primary small">Enregistrer</button><button type="button" class="btn ghost small" id="d-cancel">Annuler</button></div></form>`
      : `${view}${isOwner() ? `<button class="btn ghost small" id="d-edit">✎ Modifier la fiche</button>` : ""}`}
    <div class="d-section"><h3>Radios et documents (${docs.length})</h3>${docs.length ? `<div class="d-docs">${docs.map(docCard).join("")}</div>` : `<div class="empty">Aucun document lié.</div>`}</div>
    <div class="d-section"><h3>Historique (${evs.length})</h3>${evs.length ? `<ol class="timeline">${evs.map((e) => eventHTML(e, true)).join("")}</ol>` : `<div class="empty">Aucun événement lié.</div>`}</div>
    <div class="d-section"><h3>Notes</h3>${notes.map(noteHTML).join("") || `<div class="empty">Aucune note.</div>`}
      ${isOwner() ? `<form id="d-note" class="note-form" style="margin-top:8px"><textarea rows="2" placeholder="Ajouter une note sur la ${fdi}…" required></textarea><div><button class="btn primary small">Ajouter</button></div></form>` : ""}</div>
    <div class="d-nav"><button class="btn ghost small" data-go="${prev}">← ${prev}</button><button class="btn ghost small" data-go="${next}">${next} →</button></div>`;
  const dr = $("#drawer-inner");
  $("#d-close").onclick = closeTooth;
  $("#d-edit") && ($("#d-edit").onclick = () => { S.editing = true; openTooth(fdi, true); });
  $("#d-cancel") && ($("#d-cancel").onclick = () => { S.editing = false; openTooth(fdi, true); });
  $("#tooth-form") && ($("#tooth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, row = { category: f.category.value };
    fields.forEach(([k]) => row[k] = f[k].value);
    const { error } = await sb.from("teeth").update(row).eq("fdi", fdi);
    if (error) toast(error.message); else { S.editing = false; toast("Fiche enregistrée"); }
  });
  $("#d-note") && ($("#d-note").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from("notes").insert({ body: e.target.querySelector("textarea").value, fdi });
    if (error) toast(error.message);
  });
  $$("[data-go]", dr).forEach((b) => b.onclick = () => openTooth(b.dataset.go));
  $$(".chip", dr).forEach((c) => c.onclick = () => openTooth(c.dataset.fdi));
  bindDocs(dr);
  $("#drawer").classList.add("open"); $("#scrim").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $$(".tooth").forEach((g) => g.classList.toggle("sel", g.dataset.fdi === fdi));
}
function closeTooth() {
  S.sel = null; S.editing = false;
  $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $$(".tooth.sel").forEach((g) => g.classList.remove("sel"));
}
$("#scrim").addEventListener("click", closeTooth);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#viewer").classList.contains("hidden")) closeViewer(); else closeTooth();
});

/* ---------- Visionneuse radio ---------- */
const V = { s: 1, x: 0, y: 0, pts: new Map(), last: null, dist: 0 };
const img = $("#viewer-img"), stage = $("#viewer-stage");
function applyV() {
  img.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`;
  img.style.left = "0"; img.style.top = "0";
  img.style.filter = `brightness(${$("#v-bright").value}%) contrast(${$("#v-contrast").value}%) ${$("#v-invert").checked ? "invert(1)" : ""}`;
}
function fitV() {
  const r = stage.getBoundingClientRect();
  V.s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) * 0.95;
  V.x = (r.width - img.naturalWidth * V.s) / 2; V.y = (r.height - img.naturalHeight * V.s) / 2;
  applyV();
}
function openViewer(url, title) {
  $("#viewer-title").textContent = title; $("#v-open").href = url;
  $("#viewer").classList.remove("hidden");
  img.onload = fitV; img.src = url;
  if (img.complete && img.naturalWidth) fitV();
}
function closeViewer() { $("#viewer").classList.add("hidden"); img.src = ""; }
$("#v-close").onclick = closeViewer;
$("#v-reset").onclick = () => { $("#v-bright").value = 100; $("#v-contrast").value = 100; $("#v-invert").checked = false; fitV(); };
["#v-bright", "#v-contrast", "#v-invert"].forEach((s) => $(s).addEventListener("input", applyV));
function zoomAt(cx, cy, f) {
  const ns = Math.min(12, Math.max(0.05, V.s * f));
  V.x = cx - (cx - V.x) * (ns / V.s); V.y = cy - (cy - V.y) * (ns / V.s); V.s = ns; applyV();
}
stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
stage.addEventListener("dblclick", fitV);
stage.addEventListener("pointerdown", (e) => { stage.setPointerCapture(e.pointerId); V.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); V.last = { x: e.clientX, y: e.clientY }; V.dist = 0; });
stage.addEventListener("pointermove", (e) => {
  if (!V.pts.has(e.pointerId)) return;
  V.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (V.pts.size === 2) {
    const [a, b] = [...V.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = stage.getBoundingClientRect();
    if (V.dist) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / V.dist);
    V.dist = d; return;
  }
  V.x += e.clientX - V.last.x; V.y += e.clientY - V.last.y; V.last = { x: e.clientX, y: e.clientY }; applyV();
});
["pointerup", "pointercancel"].forEach((ev) => stage.addEventListener(ev, (e) => { V.pts.delete(e.pointerId); V.dist = 0; const p = [...V.pts.values()][0]; if (p) V.last = p; }));

/* ---------- Dialogue générique ---------- */
function openDialog(html, onSubmit) {
  const dlg = $("#dlg"), form = $("#dlg-form");
  form.innerHTML = html + `<div class="actions"><button value="cancel" formnovalidate class="btn ghost">Annuler</button><button value="ok" class="btn primary">Enregistrer</button></div>`;
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const res = await onSubmit(form);
    if (res !== false) dlg.close();
  };
  dlg.showModal();
}

/* ---------- Onglets ---------- */
$$("#tabs button").forEach((b) => b.addEventListener("click", () => {
  $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  history.replaceState(null, "", "#" + b.dataset.tab);
}));
const h = location.hash.slice(1);
if (h && $(`#tabs [data-tab="${h}"]`)) $(`#tabs [data-tab="${h}"]`).click();

/* ---------- Résumé imprimable ---------- */
$("#print-btn").addEventListener("click", () => {
  const notable = ALL_TEETH.map(tooth).filter((t) => t && t.category !== "Saine");
  $("#print-area").innerHTML = `
    <h1>Pierre L'Hoest – résumé dentaire</h1>
    <p>Né le 08/05/1958 · édité le ${new Date().toLocaleDateString("fr-BE")} · lecture non médicale à valider par le praticien</p>
    ${odontoSVG()}
    <h2>Dents à signaler</h2>
    <table><tr><th>Dent</th><th>Catégorie</th><th>État</th><th>Dernière info</th></tr>
    ${notable.map((t) => `<tr><td><b>${t.fdi}</b></td><td>${esc(CAT_LABEL[t.category])}</td><td>${esc(t.state)}</td><td>${esc(t.latest === "—" ? "" : t.latest)}</td></tr>`).join("")}</table>
    <h2>Questions pour le praticien</h2>
    <ol>${S.questions.filter((q) => !q.resolved).map((q) => `<li><b>${esc(q.question)}</b> – ${esc(q.why)}</li>`).join("")}</ol>
    <h2>Derniers événements</h2>
    <table><tr><th>Date</th><th>Praticien</th><th>Dents</th><th>Acte</th></tr>
    ${sortedEvents().slice(0, 12).map((e) => `<tr><td>${esc(fmtDate(e.date_label))}</td><td>${esc(e.practitioner)}</td><td>${esc(e.teeth)}</td><td>${esc(e.description)}</td></tr>`).join("")}</table>`;
  window.print();
});

boot();
