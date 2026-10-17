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

/* ---------- Journal d'accès ---------- */
function logEvent(event, email = null, detail = null) {
  sb.from("access_log").insert({ event, email: email || S.email || null, detail, user_agent: navigator.userAgent.slice(0, 400) })
    .then(() => {}, () => {});
}
function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { return null; } }

/* ---------- Œil sur les mots de passe ---------- */
function eyes(root = document) {
  $$('input[type="password"]', root).forEach((inp) => {
    if (inp.dataset.eye) return;
    inp.dataset.eye = "1";
    const wrap = document.createElement("span"); wrap.className = "pw";
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "eye"; b.title = "Afficher / masquer"; b.setAttribute("aria-label", "Afficher le mot de passe"); b.textContent = "👁";
    b.addEventListener("click", () => {
      const show = inp.type === "password"; inp.type = show ? "text" : "password";
      b.classList.toggle("on", show); b.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
    });
    wrap.appendChild(b);
  });
}

/* ---------- Authentification ---------- */
async function boot() {
  eyes();
  if (!SUPABASE_URL || !SUPABASE_KEY) { $("#login").classList.remove("hidden"); $("#login-msg").textContent = "Configuration Supabase manquante (config.js)."; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!store("visited")) { store("visited", "1"); logEvent("visit", session?.user?.email, location.pathname + location.hash); }
  if (session) await enter(session); else $("#login").classList.remove("hidden");
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === "SIGNED_IN" && sess && !S.email) { if (location.hash.includes("access_token")) logEvent("magic_link", sess.user.email); enter(sess); }
    if (ev === "SIGNED_OUT") location.reload();
    if (ev === "PASSWORD_RECOVERY") setTimeout(() => $("#pass-btn").click(), 600);
  });
}

/* Onglets de la page d'accès */
function authPane(name) {
  $$("#login [data-pane]").forEach((el) => el.classList.toggle("hidden", el.dataset.pane !== name));
  $$("#login .auth-tabs button").forEach((t) => t.classList.toggle("on", t.dataset.auth === name));
  $("#login .auth-tabs").classList.toggle("hidden", name === "sent");
  const f = $(`#login [data-pane="${name}"] input`); if (f) setTimeout(() => f.focus(), 50);
}
$$("#login [data-auth]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); authPane(el.dataset.auth); }));

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim(), password = $("#login-pass").value;
  $("#login-msg").textContent = "Connexion…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    logEvent("login_failed", email, error.message);
    if (/not confirmed/i.test(error.message)) {
      $("#sent-to").textContent = email; authPane("sent");
      $("#sent-msg").textContent = "Votre e-mail n'est pas encore confirmé. Cliquez le lien reçu, ou renvoyez-le ci-dessous.";
    } else $("#login-msg").textContent = /invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect. Pas encore de compte ? Cliquez « Créer mon accès »." : "Échec : " + error.message;
  } else logEvent("login", email);
});
$("#forgot").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  if (!email) { $("#login-msg").textContent = "Entrez d'abord votre e-mail ci-dessus, puis cliquez « Mot de passe oublié ? »."; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  $("#login-msg").textContent = error ? "Échec : " + error.message : "Un e-mail de réinitialisation a été envoyé à " + email + ".";
});
$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#su-email").value.trim(), p1 = $("#su-pass").value, p2 = $("#su-pass2").value;
  if (p1 !== p2) { $("#su-msg").textContent = "Les deux mots de passe diffèrent."; return; }
  $("#su-msg").textContent = "Envoi…";
  const { data, error } = await sb.auth.signUp({ email, password: p1, options: { emailRedirectTo: location.origin, data: { password_set: true } } });
  if (error) { $("#su-msg").textContent = "Échec : " + error.message; return; }
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    $("#su-msg").textContent = "Un compte existe déjà avec cet e-mail : utilisez « Se connecter » (ou « Mot de passe oublié ? »)."; return;
  }
  logEvent("signup", email);
  $("#su-msg").textContent = "";
  if (data?.session) return; // confirmation désactivée : entrée directe
  $("#sent-to").textContent = email; $("#sent-msg").textContent = ""; authPane("sent");
});
$("#resend").addEventListener("click", async () => {
  const email = $("#sent-to").textContent;
  const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: location.origin } });
  $("#sent-msg").textContent = error ? "Échec : " + error.message : "E-mail renvoyé.";
});
$("#logout-btn").addEventListener("click", async () => { logEvent("logout"); store("adm", null); await sb.auth.signOut(); });
$("#pass-btn").addEventListener("click", () => {
  openDialog(`<h3>Changer le mot de passe</h3>
    <label>Nouveau mot de passe (6 caractères min., ex. 6 chiffres)<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label>
    <label>Confirmer<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label>`,
    async (f) => {
      if (f.p1.value !== f.p2.value) { toast("Les deux saisies diffèrent"); return false; }
      const { error } = await sb.auth.updateUser({ password: f.p1.value, data: { password_set: true } });
      if (!error) logEvent("password_set");
      toast(error ? "Erreur : " + error.message : "Mot de passe modifié");
    });
});

async function enter(session) {
  S.email = session.user.email;
  const { data: me } = await sb.from("allowed_users").select("role").maybeSingle();
  if (!me) {
    $("#login").classList.remove("hidden");
    $("#login-msg").textContent = session.user.email_confirmed_at
      ? `L'accès du compte ${S.email} a été suspendu. Contactez Pierre L'Hoest.`
      : `Confirmez d'abord votre e-mail ${S.email} (lien reçu par mail).`;
    S.email = null;
    await sb.auth.signOut({ scope: "local" });
    return;
  }
  S.role = me.role;
  document.body.classList.toggle("reader", !isOwner());
  $("#admin-tab").classList.toggle("hidden", !isOwner());
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await loadAll();
  subscribe();
  const md = session.user.user_metadata || {};
  if (!md.password_set) showOnboarding(1);
  else if (!md.tour_done) showOnboarding(3);
  const h = location.hash.slice(1);
  if (h && $(`#tabs [data-tab="${h}"]`) && !$(`#tabs [data-tab="${h}"]`).classList.contains("hidden")) $(`#tabs [data-tab="${h}"]`).click();
}

/* ---------- Accueil guidé ---------- */
function obStep(n) {
  $$("#onboard .ob-step").forEach((s) => s.classList.toggle("hidden", s.dataset.step !== String(n)));
  $$("#onboard .steps span").forEach((s) => s.classList.toggle("on", +s.dataset.s <= n));
  const f = $(`#onboard .ob-step[data-step="${n}"] input`); if (f) setTimeout(() => f.focus(), 50);
}
function showOnboarding(n = 1) {
  eyes($("#onboard")); $("#onboard").classList.remove("hidden");
  const tourOnly = n === 3;
  $("#onboard .steps").classList.toggle("hidden", tourOnly);
  $("#ob3-title").textContent = tourOnly ? "Bienvenue dans le dossier dentaire" : "C'est fait ✓";
  $("#ob3-intro").textContent = tourOnly ? "Votre e-mail est confirmé. Voici comment s'y retrouver :" : "Votre mot de passe est enregistré. À la prochaine connexion, utilisez-le avec votre e-mail.";
  obStep(n);
}
$$("#onboard [data-go]").forEach((b) => b.addEventListener("click", () => obStep(+b.dataset.go)));
function obCheck() {
  const p1 = $("#ob-p1").value, p2 = $("#ob-p2").value;
  const ok1 = p1.length >= 6, ok2 = p1 && p1 === p2;
  $("#ob-check").innerHTML = `<span class="${ok1 ? "ok" : ""}">${ok1 ? "✓" : "○"} 6 caractères minimum</span><span class="${ok2 ? "ok" : ""}">${ok2 ? "✓" : "○"} Les deux saisies sont identiques</span>`;
  return ok1 && ok2;
}
["#ob-p1", "#ob-p2"].forEach((s) => $(s).addEventListener("input", obCheck));
$("#ob-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!obCheck()) { $("#ob-msg").textContent = "Vérifiez les deux points ci-dessus."; return; }
  $("#ob-msg").textContent = "Enregistrement…";
  const { error } = await sb.auth.updateUser({ password: $("#ob-p1").value, data: { password_set: true } });
  if (error) { $("#ob-msg").textContent = "Erreur : " + error.message; return; }
  logEvent("password_set");
  $("#ob-msg").textContent = "";
  obStep(3);
});
$("#ob-done").addEventListener("click", () => { $("#onboard").classList.add("hidden"); sb.auth.updateUser({ data: { tour_done: true } }); });

/* ---------- Admin ---------- */
const ADMIN_CODE = "PLH";
const EV_LABEL = { visit: "Visite", login: "Connexion", login_failed: "Échec de connexion", signup: "Inscription", password_set: "Mot de passe choisi", admin_open: "Ouverture admin", logout: "Déconnexion", magic_link: "Lien e-mail" };
const A = { users: [], log: [] };
function adminUnlocked() { return isOwner() && store("adm") === "1"; }
function showAdmin() {
  const ok = adminUnlocked();
  $("#admin-lock").classList.toggle("hidden", ok);
  $("#admin-body").classList.toggle("hidden", !ok);
  $("#admin-tab").textContent = ok ? "Admin" : "Admin 🔒";
  if (ok) loadAdmin(); else { eyes($("#admin-lock")); setTimeout(() => $("#admin-code").focus(), 50); }
}
$("#admin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("#admin-code").value.trim().toUpperCase() === ADMIN_CODE && isOwner()) {
    store("adm", "1"); $("#admin-code").value = ""; $("#admin-msg").textContent = ""; logEvent("admin_open"); showAdmin();
  } else $("#admin-msg").textContent = "Code incorrect.";
});
$("#admin-lockbtn").addEventListener("click", () => { store("adm", null); showAdmin(); });
$("#admin-refresh").addEventListener("click", () => loadAdmin());
$("#admin-filter").addEventListener("change", renderAdmin);
async function loadAdmin() {
  if (!adminUnlocked()) return;
  const [u, l] = await Promise.all([
    sb.rpc("admin_users"),
    sb.from("access_log").select("*").order("at", { ascending: false }).limit(500),
  ]);
  if (u.error) toast("Admin : " + u.error.message);
  A.users = u.data || []; A.log = l.data || [];
  renderAdmin();
}
function dt(s) { return s ? new Date(s).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" }) : "—"; }
function renderAdmin() {
  const since = (d) => Date.now() - d * 864e5;
  const cnt = (ev, d) => A.log.filter((r) => r.event === ev && new Date(r.at) >= since(d)).length;
  const pending = A.users.filter((u) => !u.role).length;
  $("#admin-stats").innerHTML = [
    ["Visites (7 j)", cnt("visit", 7)], ["Connexions (7 j)", cnt("login", 7) + cnt("magic_link", 7)],
    ["Échecs (7 j)", cnt("login_failed", 7)], ["Comptes", A.users.length], ["En attente", pending],
  ].map(([l, v]) => `<div class="stat ${l === "En attente" && v ? "warn" : ""}${l.startsWith("Échecs") && v ? " bad" : ""}"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#admin-users").innerHTML = `<thead><tr><th>E-mail</th><th>Inscrit le</th><th>Dernière connexion</th><th>Mot de passe</th><th>Accès</th></tr></thead><tbody>` +
    A.users.map((u) => {
      const self = u.email?.toLowerCase() === S.email?.toLowerCase();
      return `<tr><td>${esc(u.email)}${u.confirmed ? "" : ' <span class="badge b-Obturée">non confirmé</span>'}</td><td>${dt(u.created_at)}</td><td>${dt(u.last_sign_in_at)}</td><td>${u.password_set ? "choisi" : '<span class="muted">provisoire</span>'}</td>
      <td>${self ? '<span class="badge b-Implant">Propriétaire (vous)</span>' : `<select data-acc="${esc(u.email)}"><option value="" ${!u.role ? "selected" : ""}>Aucun accès</option><option value="reader" ${u.role === "reader" ? "selected" : ""}>Lecteur</option><option value="owner" ${u.role === "owner" ? "selected" : ""}>Propriétaire</option></select>`}</td></tr>`;
    }).join("") + "</tbody>";
  $$("[data-acc]").forEach((s) => s.addEventListener("change", async () => {
    const { error } = await sb.rpc("admin_set_access", { p_email: s.dataset.acc, p_role: s.value || null });
    toast(error ? "Erreur : " + error.message : "Accès mis à jour"); loadAdmin();
  }));
  const f = $("#admin-filter").value;
  const rows = A.log.filter((r) => !f || r.event === f || (f === "login" && r.event === "magic_link"));
  $("#admin-log").innerHTML = `<thead><tr><th>Date</th><th>Événement</th><th>E-mail</th><th>Appareil</th><th>Détail</th></tr></thead><tbody>` +
    rows.map((r) => `<tr class="ev-${esc(r.event)}"><td>${dt(r.at)}</td><td>${esc(EV_LABEL[r.event] || r.event)}</td><td>${esc(r.email || "anonyme")}</td><td class="small muted">${esc(device(r.user_agent))}</td><td class="small">${esc(r.detail || "")}</td></tr>`).join("") + "</tbody>";
}
function device(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "?";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return `${os} ${br}`.trim();
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
  if (isOwner()) ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "access_log" }, () => { if (adminUnlocked()) loadAdmin(); });
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
  eyes(form);
  dlg.showModal();
}

/* ---------- Onglets ---------- */
$$("#tabs button").forEach((b) => b.addEventListener("click", () => {
  $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  history.replaceState(null, "", "#" + b.dataset.tab);
  if (b.dataset.tab === "admin") showAdmin();
}));

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
