// BAMP Sastanak: group availability for BAMP, BAPA and friends.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBP2hNt44apjO5GB4XiZ-BgGVFvjtzFCOQ",
  authDomain: "bamp-sastanak.firebaseapp.com",
  projectId: "bamp-sastanak",
  storageBucket: "bamp-sastanak.firebasestorage.app",
  messagingSenderId: "864099506997",
  appId: "1:864099506997:web:d0574dc19195cabfb9ca7c"
};
const OWNER_EMAIL = "kani190spy@gmail.com";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ---------- helpers ----------
const $ = s => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const SLOT = 30;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOWL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nice = s => { const d = parseD(s); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
const niceL = s => { const d = parseD(s); return `${DOWL[d.getDay()]}, ${MONL[d.getMonth()]} ${d.getDate()}`; };
const tl = min => { let h = Math.floor(min / 60); const m = min % 60, ap = h >= 12 && h < 24 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`; };
const slotsOf = ev => { const o = []; for (let t = ev.dayStart * 60; t < ev.dayEnd * 60; t += SLOT) o.push(t); return o; };
const daysOf = ev => { const o = []; for (let d = parseD(ev.start); d <= parseD(ev.end); d.setDate(d.getDate() + 1)) o.push(fmtD(d)); return o; };
const hours = n => { const h = n * SLOT / 60; return `${h} ${h === 1 ? "hour" : "hours"}`; };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
const ROLES = [["new", "New to BAMP"], ["board", "BAMP board"], ["other", "Other"]];
const roleText = r => r?.role === "other" ? (r.roleOther?.trim() ? `Other: ${r.roleOther.trim()}` : "Other") : (ROLES.find(x => x[0] === r?.role)?.[1] || "No group picked");
const groupLabel = g => ({ Interested: "Interested in BAMP", Joint: "BAMP + BAPA" }[g] || g);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

// ---------- shared state ----------
const S = {
  user: null, isAdmin: false, isOwner: false, adminChecked: false,
  events: {}, settings: {}, responses: {}, admins: [],
  mine: null, evId: null, dirty: false, saving: false, savedOnce: false,
  aTab: "results", aEv: null, roleFilter: "", cell: null,
};
function generalEvent() { const a = new Date(), b = new Date(); b.setDate(b.getDate() + 41); return { title: "Upcoming BAMP meetings", group: "BAMP", start: fmtD(a), end: fmtD(b), dayStart: 8, dayEnd: 21, tz: "Eastern Time", note: "" }; }
const evById = id => id === "general" ? generalEvent() : S.events[id];
function currentId() {
  if (S.settings.current && S.events[S.settings.current]) return S.settings.current;
  const evs = Object.entries(S.events).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  return evs[0]?.[0] || "general";
}
const route = () => location.hash === "#admin" ? "admin" : "home";

// ---------- data subscriptions ----------
let unsubs = [];
function subscribePublic() {
  unsubs.push(onSnapshot(collection(db, "events"), q => { S.events = {}; q.forEach(d => (S.events[d.id] = d.data())); render(); }, e => fail("meetings", e)));
  unsubs.push(onSnapshot(doc(db, "settings", "main"), s => { S.settings = s.exists() ? s.data() : {}; render(); }, e => fail("settings", e)));
}
let adminUnsubs = [];
function subscribeAdmin() {
  adminUnsubs.forEach(u => u()); adminUnsubs = [];
  adminUnsubs.push(onSnapshot(collection(db, "responses"), q => { S.responses = {}; q.forEach(d => (S.responses[d.id] = d.data())); render(); }, e => fail("responses", e)));
  if (S.isOwner) adminUnsubs.push(onSnapshot(collection(db, "admins"), q => { S.admins = q.docs.map(d => d.id); render(); }, e => fail("admins", e)));
}
function fail(what, e) { console.error(what, e); toast(`Couldn’t load ${what}. Check your connection and refresh.`); }

async function checkAdmin(user) {
  S.isOwner = !!user?.email && user.email.toLowerCase() === OWNER_EMAIL;
  S.isAdmin = S.isOwner;
  if (!S.isAdmin && user?.email) {
    try { S.isAdmin = (await getDoc(doc(db, "admins", user.email.toLowerCase()))).exists(); } catch { S.isAdmin = false; }
  }
  S.adminChecked = true;
}

async function loadMine() {
  const uid = S.user?.uid; if (!uid) return;
  try {
    const s = await getDoc(doc(db, "responses", uid));
    const d = s.exists() ? s.data() : {};
    S.mine = { name: d.name || store.get("sastanak-name") || "", role: d.role || "", roleOther: d.roleOther || "", note: d.note || "", avail: d.avail || {} };
    S.savedOnce = s.exists();
  } catch (e) {
    S.mine = { name: "", role: "", roleOther: "", note: "", avail: {} };
  }
  render();
}

onAuthStateChanged(auth, async user => {
  S.user = user; S.adminChecked = false; S.isAdmin = false; S.isOwner = false;
  if (!user) {
    if (route() === "home") { try { await signInAnonymously(auth); } catch (e) { console.error(e); $("#app").replaceChildren(el("div", { class: "card" }, el("h2", {}, "We couldn’t start the page"), el("p", { class: "hint" }, "Please refresh. If it keeps happening, let the organizer know."), el("p", { class: "hint", style: "font-size:14px" }, `Error code: ${e?.code || e?.message || "unknown"}`))); } }
    else render();
    return;
  }
  await checkAdmin(user);
  if (S.isAdmin) subscribeAdmin();
  await loadMine();
});
subscribePublic();
window.addEventListener("hashchange", () => {
  if (route() === "home" && !S.user) signInAnonymously(auth).catch(() => {});
  window.scrollTo(0, 0); render();
});
window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- render ----------
function render() {
  renderHead();
  const app = $("#app");
  const keep = document.activeElement?.id, sel = keep && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (route() === "admin") renderAdmin(app); else renderHome(app);
  if (keep) { const n = document.getElementById(keep); if (n && n !== document.activeElement) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(...sel); } catch {} } }
}
function renderHead() {
  const h = $("#headActions"); h.replaceChildren();
  $("#footAdmin").hidden = route() === "admin";
  if (route() === "admin") {
    h.append(el("a", { class: "btn gold sm", href: "#" }, "See participant view"));
    if (S.user && !S.user.isAnonymous) h.append(el("span", { class: "who" }, S.user.email), el("button", { class: "btn ghost sm", onclick: () => signOut(auth) }, "Sign out"));
  } else if (S.isAdmin) {
    h.append(el("a", { class: "btn gold sm", href: "#admin" }, "Back to admin view"));
  }
}

// ===== Participant page =====
function renderHome(app) {
  app.replaceChildren();
  if (!S.mine) { app.append(el("p", { class: "loading" }, "Loading…")); return; }
  const id = currentId(), ev = evById(id); S.evId = id;
  const mine = S.mine; const days = (mine.avail[id] ||= {});
  const inRange = new Set(daysOf(ev));
  const picked = Object.keys(days).filter(d => inRange.has(d)).sort();
  const change = () => { S.dirty = true; render(); };

  app.append(el("p", { class: "welcome" }, "Welcome to ", el("b", {}, "BAMP Sastanak"), ", please pick the days you can meet, set hours of availability and we will try to match the best dates."));
  app.append(el("div", { class: "card" },
    el("h2", { style: "font-size:22px" }, ev.title),
    el("p", { class: "hint" }, `${niceL(ev.start)} to ${niceL(ev.end)}. All times are ${ev.tz || "Eastern Time"}.${ev.note ? " " + ev.note : ""}`)));

  if (S.justSaved) {
    app.append(el("div", { class: "thanks", role: "status" },
      el("h2", {}, `Thank you${mine.name ? ", " + mine.name.split(" ")[0] : ""}!`),
      el("p", { style: "margin:0" }, "Your availability is saved. If anything changes, come back to this same page on this device and update it."),
      el("div", {}, el("button", { class: "btn ghost sm", onclick: () => { S.justSaved = false; render(); } }, "Make changes"))));
  }

  // Step 1: name
  const nameIn = el("input", { type: "text", id: "fName", autocomplete: "name", maxlength: "80", placeholder: "First and last name", value: mine.name });
  nameIn.addEventListener("input", () => { mine.name = nameIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, stepH(1, "Your name"), nameIn));

  // Step 2: group
  const otherIn = el("input", { type: "text", id: "fOther", maxlength: "80", placeholder: "For example: BAPA member, family, friend of BAMP", value: mine.roleOther });
  otherIn.addEventListener("input", () => { mine.roleOther = otherIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, stepH(2, "Which describes you?"),
    el("div", { class: "choices", role: "radiogroup", "aria-label": "Which describes you?" },
      ROLES.map(([v, l]) => el("button", { type: "button", class: "choice", role: "radio", "aria-checked": String(mine.role === v), onclick: () => { mine.role = v; change(); } }, l))),
    mine.role === "other" ? el("div", { class: "field" }, el("label", { class: "lbl", for: "fOther" }, "Tell us a little more (optional)"), otherIn) : null));

  // Step 3: days
  const months = el("div", { class: "months" });
  const s = parseD(ev.start), e = parseD(ev.end);
  for (let m = new Date(s.getFullYear(), s.getMonth(), 1); m <= e; m.setMonth(m.getMonth() + 1)) {
    const g = el("div", { class: "g7" }, DOW.map(d => el("div", { class: "dow", "aria-hidden": "true" }, d.slice(0, 2))));
    for (let i = 0; i < m.getDay(); i++) g.append(el("div"));
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const key = fmtD(new Date(m.getFullYear(), m.getMonth(), d)), ok = inRange.has(key), on = ok && key in days;
      g.append(el("button", { type: "button", class: `day ${ok ? "in" : "out"} ${on ? "sel" : ""}`, disabled: !ok, "aria-pressed": ok ? String(on) : null, "aria-label": ok ? niceL(key) : null,
        onclick: () => { if (key in days) delete days[key]; else days[key] = []; change(); } }, String(d)));
    }
    months.append(el("div", { class: "month" }, el("h3", {}, `${MONL[m.getMonth()]} ${m.getFullYear()}`), g));
  }
  app.append(el("section", { class: "card" }, stepH(3, "Pick the days you could meet"),
    el("p", { class: "hint" }, "Tap each day that might work. Tap it again to remove it."), months,
    picked.length ? el("p", { class: "sumline", style: "margin:0" }, `${picked.length} ${picked.length === 1 ? "day" : "days"} picked`) : null));

  // Step 4: hours per day
  const slots = slotsOf(ev);
  const quick = [["Morning", 8, 12], ["Afternoon", 12, 17], ["Evening", 17, 21], ["All day", 0, 24]];
  const step4 = el("section", { class: "card" }, stepH(4, "Set your hours for each day"));
  if (!picked.length) step4.append(el("p", { class: "hint" }, "Pick at least one day above, and it will show up here."));
  else {
    step4.append(el("p", { class: "hint" }, "Tap the times you’re free. Blue means free. Each day can have different hours."));
    const list = el("div", { class: "daylist" });
    picked.forEach((d, i) => {
      const set = new Set(days[d]);
      const toggleRange = (a, b) => { const r = slots.filter(t => t >= a * 60 && t < b * 60); const all = r.length && r.every(t => set.has(t)); r.forEach(t => all ? set.delete(t) : set.add(t)); days[d] = [...set].sort((x, y) => x - y); change(); };
      list.append(el("div", { class: "dayblock" },
        el("div", { class: "dayblock-h" }, el("h3", {}, niceL(d)), el("span", { class: "hint" }, set.size ? `Free ${hours(set.size)}` : "No times yet")),
        el("div", { class: "quick" },
          quick.map(([l, a, b]) => el("button", { type: "button", class: "btn ghost sm", onclick: () => toggleRange(a, b) }, l)),
          set.size ? el("button", { type: "button", class: "btn ghost sm", onclick: () => { days[d] = []; change(); } }, "Clear") : null,
          i > 0 ? el("button", { type: "button", class: "btn ghost sm", onclick: () => { days[d] = [...days[picked[i - 1]]]; change(); } }, "Same as day above") : null),
        el("div", { class: "slots" }, slots.map(t => el("button", { type: "button", class: "slot", "aria-pressed": String(set.has(t)),
          onclick: () => { set.has(t) ? set.delete(t) : set.add(t); days[d] = [...set].sort((x, y) => x - y); change(); } }, tl(t))))));
    });
    step4.append(list);
  }
  app.append(step4);

  // Note
  const noteIn = el("textarea", { id: "fNote", maxlength: "1000", rows: "3", placeholder: "Anything you’d like us to know: topics, questions, how you prefer to meet…" });
  noteIn.value = mine.note;
  noteIn.addEventListener("input", () => { mine.note = noteIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, el("div", { class: "step-h" }, el("h2", {}, "Anything else? (optional)")), noteIn));

  renderSaveBar();
}
function stepH(n, t) { return el("div", { class: "step-h" }, el("span", { class: "num", "aria-hidden": "true" }, n), el("h2", {}, t)); }

function renderSaveBar() {
  let bar = $("#savebar");
  if (route() !== "home") { bar?.remove(); return; }
  if (!bar) { bar = el("div", { class: "savebar", id: "savebar" }); document.body.append(bar); }
  const m = S.mine; if (!m) return;
  const missing = !m.name.trim() ? "Add your name (step 1)" : !m.role ? "Pick which describes you (step 2)" : null;
  const status = S.saving ? "Saving…" : missing ? missing : S.dirty ? "You have changes that aren’t saved yet" : S.savedOnce ? "✓ Saved" : "";
  bar.replaceChildren(el("div", { class: "wrap" },
    el("span", { class: `status ${!S.dirty && S.savedOnce && !missing ? "ok" : ""}` }, status),
    el("button", { class: "btn gold", disabled: S.saving || !!missing || (!S.dirty && S.savedOnce), onclick: save }, "Save my availability")));
}

async function save() {
  const m = S.mine, uid = S.user?.uid; if (!uid) return;
  S.saving = true; renderSaveBar();
  // keep only days with at least one time, for this meeting; keep other meetings untouched
  const avail = {};
  for (const [evId, days] of Object.entries(m.avail)) { const o = {}; for (const [d, arr] of Object.entries(days)) if (arr.length) o[d] = arr; if (Object.keys(o).length) avail[evId] = o; }
  try {
    await setDoc(doc(db, "responses", uid), { name: m.name.trim(), role: m.role, roleOther: m.roleOther.trim(), note: m.note.trim(), avail, updatedAt: serverTimestamp() });
    store.set("sastanak-name", m.name.trim());
    S.dirty = false; S.savedOnce = true; S.justSaved = true;
    toast("Saved. Thank you!"); window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error(e); toast("Your availability wasn’t saved. Check your internet connection and press Save again.");
  }
  S.saving = false; render();
}

// ===== Admin =====
function renderAdmin(app) {
  app.replaceChildren();
  if (!S.user || S.user.isAnonymous) {
    app.append(el("section", { class: "card", style: "max-width:560px" },
      el("h2", {}, "Organizer sign in"),
      el("p", { class: "hint" }, "Admins sign in with Google to create meetings and see everyone’s availability."),
      el("div", {}, el("button", { class: "btn", onclick: googleIn }, "Sign in with Google"))));
    return;
  }
  if (!S.adminChecked) { app.append(el("p", { class: "loading" }, "Checking access…")); return; }
  if (!S.isAdmin) {
    app.append(el("section", { class: "card", style: "max-width:560px" },
      el("h2", {}, "You’re not an admin yet"),
      el("p", { class: "hint" }, `You’re signed in as ${S.user.email}. Ask the page owner to add this email as an admin, then refresh this page.`),
      el("div", { class: "row" }, el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Use a different account"), el("a", { class: "btn", href: "#" }, "Go to the sign-up page"))));
    return;
  }
  const tabs = [["results", "Results"], ["meetings", "Meetings"], ...(S.isOwner ? [["admins", "Admins"]] : [])];
  app.append(el("div", { class: "tabs", role: "tablist" }, tabs.map(([k, l]) => el("button", { class: "tab", role: "tab", "aria-selected": String(S.aTab === k), onclick: () => { S.aTab = k; S.cell = null; render(); } }, l))));
  if (S.aTab === "results") adminResults(app);
  else if (S.aTab === "meetings") adminMeetings(app);
  else adminAdmins(app);
}
async function googleIn() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { if (e?.code !== "auth/popup-closed-by-user") toast("Sign-in didn’t work: " + (e?.code || e?.message || "unknown error")); }
}

function meetingPicker() {
  const ids = [...Object.keys(S.events).sort((a, b) => (S.events[b].createdAt || 0) - (S.events[a].createdAt || 0)), "general"];
  if (!S.aEv || !evById(S.aEv)) S.aEv = currentId();
  const sel = el("select", { id: "aEv", onchange: e => { S.aEv = e.target.value; S.cell = null; render(); } },
    ids.map(id => el("option", { value: id, selected: id === S.aEv }, `${evById(id).title}${id === currentId() ? " (shown to participants)" : ""}`)));
  return el("div", { class: "field" }, el("label", { class: "lbl", for: "aEv" }, "Meeting"), sel);
}

function adminResults(app) {
  const card = el("section", { class: "card" }, meetingPicker());
  const evId = S.aEv, ev = evById(evId);
  card.append(el("div", { class: "row" }, el("span", { class: "lbl" }, "Show:"),
    [["", "Everyone"], ...ROLES].map(([v, l]) => el("button", { class: "choice", role: "radio", style: "padding:6px 14px;font-size:16px", "aria-checked": String(S.roleFilter === v), onclick: () => { S.roleFilter = v; S.cell = null; render(); } }, l))));
  app.append(card);

  const people = Object.entries(S.responses).filter(([, r]) => r.avail?.[evId] && Object.values(r.avail[evId]).some(a => a.length) && (!S.roleFilter || r.role === S.roleFilter));
  const total = people.length;
  const nameOf = id => (S.responses[id]?.name || "").trim() || "Unnamed";
  if (!total) { app.append(el("div", { class: "empty" }, S.roleFilter ? "No one in this group has responded to this meeting yet." : "No responses for this meeting yet. Share the sign-up link and they’ll appear here as people save.")); return; }

  const map = {};
  for (const [id, r] of people) for (const [d, arr] of Object.entries(r.avail[evId])) for (const t of arr) ((map[d] ||= {})[t] ||= []).push(id);
  const days = daysOf(ev).filter(d => map[d]);
  const slots = slotsOf(ev);
  const shade = n => n === 0 ? 0 : Math.max(1, Math.ceil(n / total * 4));
  const colors = ["--heat0", "--heat1", "--heat2", "--heat3", "--heat4"];

  const heat = el("div", { class: "heat", style: `grid-template-columns:auto repeat(${days.length}, 48px)` }, el("div"));
  days.forEach(d => { const x = parseD(d); heat.append(el("div", { class: "hh" }, DOW[x.getDay()], el("br"), `${MON[x.getMonth()]} ${x.getDate()}`)); });
  for (const t of slots) {
    heat.append(el("div", { class: "hl" }, t % 60 === 0 ? tl(t) : ""));
    for (const d of days) {
      const n = (map[d]?.[t] || []).length, k = `${d}|${t}`;
      heat.append(el("button", { class: `hc ${S.cell === k ? "active" : ""}`, style: `background:var(${colors[shade(n)]})`, "aria-label": `${nice(d)} ${tl(t)}: ${n} of ${total} free`, onclick: () => { S.cell = k; render(); } }));
    }
  }

  const who = el("div", { class: "card" });
  if (!S.cell) who.append(el("h3", {}, "Who’s free"), el("p", { class: "hint" }, "Tap any square to see names."));
  else {
    const [d, t] = S.cell.split("|"), ids = map[d]?.[+t] || [];
    who.append(el("h3", {}, `${nice(d)}, ${tl(+t)}–${tl(+t + SLOT)}`), el("p", { style: "margin:0;font-weight:700" }, `${ids.length} of ${total} free`),
      el("div", { class: "chips" }, people.map(([id, r]) => el("span", { class: `chip ${ids.includes(id) ? "yes" : "no"}`, title: roleText(r) }, nameOf(id)))));
  }

  const runs = [];
  for (const d of days) { let i = 0; while (i < slots.length) { const n = (map[d][slots[i]] || []).length; if (!n) { i++; continue; } let j = i; while (j + 1 < slots.length && (map[d][slots[j + 1]] || []).length === n) j++; runs.push({ d, a: slots[i], b: slots[j] + SLOT, n }); i = j + 1; } }
  runs.sort((x, y) => y.n - x.n || (y.b - y.a) - (x.b - x.a));
  const best = el("div", { class: "card" }, el("h3", {}, "Best times"),
    el("div", { class: "best" }, runs.slice(0, 6).map(r => el("button", { onclick: () => { S.cell = `${r.d}|${r.a}`; render(); } }, el("span", {}, `${nice(r.d)} · ${tl(r.a)}–${tl(r.b)}`), el("b", {}, `${r.n} of ${total}`)))));

  app.append(el("div", { class: "grid2" },
    el("div", { class: "card" }, el("div", { class: "legend" }, "Fewer", colors.map(c => el("i", { style: `background:var(${c})` })), "More people free"), el("div", { class: "heatwrap" }, heat)),
    el("div", { style: "display:grid;gap:18px;align-content:start;min-width:0" }, who, best)));

  const noted = people.filter(([, r]) => (r.note || "").trim());
  if (noted.length) app.append(el("section", { class: "card" }, el("h3", {}, "Notes"), noted.map(([id, r]) => el("blockquote", { class: "note" }, r.note.trim(), el("cite", {}, `${nameOf(id)} · ${roleText(r)}`)))));

  app.append(el("section", { class: "card" }, el("h3", {}, `People who responded (${total})`),
    el("div", { class: "list" }, people.sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]))).map(([id, r]) => {
      const nd = Object.values(r.avail[evId]).filter(a => a.length).length;
      return el("div", { class: "li" }, el("div", {}, nameOf(id), el("small", {}, `${roleText(r)} · ${nd} ${nd === 1 ? "day" : "days"}`)), confirmBtn("Remove", "Tap again to remove", async () => { await deleteDoc(doc(db, "responses", id)); toast("Response removed"); }));
    }))));
}

function adminMeetings(app) {
  const t = new Date(); t.setDate(t.getDate() + 7); const t2 = new Date(t); t2.setDate(t2.getDate() + 13);
  const hourOpts = def => Array.from({ length: 18 }, (_, i) => i + 6).map(h => el("option", { value: h, selected: h === def }, tl(h * 60)));
  const f = el("form", { class: "card" },
    el("h2", { style: "font-size:22px" }, "New meeting"),
    el("div", { class: "form2" },
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "mTitle" }, "Meeting name"), el("input", { type: "text", id: "mTitle", required: true, maxlength: "100", placeholder: "BAMP winter general meeting" })),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mGroup" }, "Who it’s for"), el("select", { id: "mGroup" }, ["BAMP", "BAPA", "Joint", "Interested"].map(g => el("option", { value: g }, groupLabel(g))))),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mTz" }, "Time zone shown"), el("input", { type: "text", id: "mTz", value: "Eastern Time", maxlength: "40" })),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mStart" }, "First possible day"), el("input", { type: "date", id: "mStart", required: true, value: fmtD(t) })),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mEnd" }, "Last possible day"), el("input", { type: "date", id: "mEnd", required: true, value: fmtD(t2) })),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mFrom" }, "Earliest time"), el("select", { id: "mFrom" }, hourOpts(9))),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mTo" }, "Latest time"), el("select", { id: "mTo" }, hourOpts(21))),
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "mNote" }, "Note for participants (optional)"), el("input", { type: "text", id: "mNote", maxlength: "200", placeholder: "Zoom or in person, about 1 hour" }))),
    el("div", { class: "row" }, el("button", { class: "btn" }, "Create meeting"), el("span", { class: "hint" }, "New meetings are shown to participants right away.")));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value;
    const start = v("mStart"), end = v("mEnd"), from = +v("mFrom"), to = +v("mTo");
    if (end < start) return toast("The last day must be on or after the first day.");
    if (to <= from) return toast("The latest time must be after the earliest time.");
    if ((parseD(end) - parseD(start)) / 864e5 > 92) return toast("Keep it to 3 months or less.");
    const id = "m" + Date.now().toString(36);
    try {
      await setDoc(doc(db, "events", id), { title: v("mTitle").trim(), group: v("mGroup"), tz: v("mTz").trim() || "Eastern Time", note: v("mNote").trim(), start, end, dayStart: from, dayEnd: to, createdAt: Date.now(), createdBy: S.user.email });
      await setDoc(doc(db, "settings", "main"), { current: id }, { merge: true });
      S.aEv = id; S.aTab = "results"; toast("Meeting created and shown to participants"); render();
    } catch (err) { console.error(err); toast("Couldn’t create the meeting. Are you still signed in as an admin?"); }
  });
  app.append(f);

  const evs = Object.entries(S.events).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const cur = currentId();
  app.append(el("section", { class: "card" }, el("h2", { style: "font-size:22px" }, "All meetings"),
    evs.length ? el("div", { class: "list" }, evs.map(([id, ev]) => el("div", { class: "li" },
      el("div", {}, ev.title, id === cur ? el("span", { class: "pill" }, "Shown") : null, el("small", {}, `${groupLabel(ev.group)} · ${nice(ev.start)} – ${nice(ev.end)} · ${tl(ev.dayStart * 60)}–${tl(ev.dayEnd * 60)}`)),
      el("div", { class: "row" },
        id !== cur ? el("button", { class: "btn gold sm", onclick: async () => { try { await setDoc(doc(db, "settings", "main"), { current: id }, { merge: true }); toast("Participants now see this meeting"); } catch { toast("Couldn’t change it. Try again."); } } }, "Show to participants") : null,
        confirmBtn("Delete", "Tap again to delete", async () => { await deleteDoc(doc(db, "events", id)); toast("Meeting deleted"); })))))
      : el("p", { class: "hint" }, "No meetings yet. Until you create one, participants see a general calendar for the next 6 weeks.")));
}

function adminAdmins(app) {
  const f = el("form", { class: "card" }, el("h2", { style: "font-size:22px" }, "Add an admin"),
    el("p", { class: "hint" }, "Enter the Google email they’ll sign in with. Admins can create meetings and see everyone’s availability. Only you can add or remove admins."),
    el("div", { class: "row" }, el("input", { type: "email", id: "aEmail", required: true, placeholder: "name@gmail.com", style: "flex:1;min-width:220px" }), el("button", { class: "btn" }, "Add admin")));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const em = $("#aEmail").value.trim().toLowerCase(); if (!em) return;
    try { await setDoc(doc(db, "admins", em), { addedAt: Date.now() }); $("#aEmail").value = ""; toast(`${em} is now an admin`); }
    catch { toast("Couldn’t add that admin. Try again."); }
  });
  app.append(f);
  app.append(el("section", { class: "card" }, el("h2", { style: "font-size:22px" }, "Admins"),
    el("div", { class: "list" },
      el("div", { class: "li" }, el("div", {}, OWNER_EMAIL, el("small", {}, "Owner"))),
      S.admins.map(em => el("div", { class: "li" }, el("div", {}, em), confirmBtn("Remove", "Tap again to remove", async () => { await deleteDoc(doc(db, "admins", em)); toast("Admin removed"); }))))));
}

function confirmBtn(label, armedLabel, action) {
  let armed = false;
  const b = el("button", { class: "btn danger sm", type: "button" }, label);
  b.addEventListener("click", async () => {
    if (!armed) { armed = true; b.textContent = armedLabel; setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    try { await action(); } catch (e) { console.error(e); toast("That didn’t work. Try again."); }
  });
  return b;
}

render();
